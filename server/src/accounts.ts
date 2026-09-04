/**
 * 계정. 이메일·비밀번호·닉네임·전적을 서버가 들고 있는다.
 *
 * **유일한 것은 이메일뿐이다.** 닉네임은 겹쳐도 된다 — 테이블에서 같은 이름이 둘이면
 * 예전처럼 [1] [2] 가 붙는다. 그래서 계정이 있어도 그 이름을 남이 못 쓰게 막지 않는다.
 * 계정이 하는 일은 「같은 사람이 돌아왔을 때 전적을 이어 주는 것」이다.
 *
 * 이메일은 보내서 확인하지 않는다. 주인임을 증명하는 값이 아니라 **사람이 자기 것으로
 * 알아볼 만한 유일한 글자**로 쓴다. 친구들끼리 하는 판이라 그 이상이 필요 없다.
 *
 * 비밀번호는 해시로 둔다. 어딘가에 저장되는 값이라, 어느 날 이 표를 찍어보는 코드
 * 한 줄이 붙는 순간 평문이면 그대로 새어 나간다. 사람들은 다른 곳에서 쓰던 것을 친다.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  EMPTY_COSMETICS,
  NICKNAME_MAX,
  balanceOf,
  cosmeticOf,
  owns,
  sanitizeEquipped,
  type Cosmetics,
  type Equipped,
  PASSWORD_MAX,
  PASSWORD_MIN,
  normalizeEmail,
  normalizeNickname,
  type ErrorCode,
  type PlayOutcome,
  type PlayRecord,
  type Result,
  type Session,
} from '@the-gang/shared'

import { logLine } from './log.ts'
import type { AccountStore } from './accountStore.ts'

function err<T>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, code, message }
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export interface Account {
  email: string
  nickname: string
  salt: string
  hash: string
  record: PlayRecord
  /**
   * 걸치고 있는 것과 산 것들.
   *
   * **분배금은 여기서만 줄어든다.** `record.wins` 는 누적이라 손대지 않는다 —
   * 거기서 깎으면 많이 이기고 많이 쓴 사람의 전적이 0승이 된다.
   */
  cosmetics: Cosmetics
  /**
   * 이 판의 끝을 이미 셌는가.
   *
   * 결과 화면에서 새로고침하면 같은 끝이 다시 오는데, 그때 또 세면 한 판이 두 판이 된다.
   * 서버 메모리에만 있어도 되는 값이다 — 재시작하면 그 판은 이미 지나갔다.
   */
  counted: Set<string>
}

const EMPTY: PlayRecord = { wins: 0, losses: 0 }

/**
 * 해시는 16진 글자로 둔다.
 *
 * Buffer 로 들고 있으면 밖으로 내보낼 때마다 옮겨 적어야 한다 — 저장소가 붙으면
 * 글자로 나가고 글자로 돌아온다. 견줄 때만 Buffer 로 되돌린다.
 */
function hash(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

/** 부팅 로딩을 몇 번까지 다시 해보나. 한 번 삐끗한 것과 정말 안 되는 것을 가른다. */
const LOAD_TRIES = 3
/** 다시 해보기 전에 쉬는 시간. 회를 거듭할수록 늘린다. */
const LOAD_WAIT_MS = 1500
/** 전적을 밖으로 흘려보내는 사이. CMA 는 초당 일곱 건쯤에서 막는다. */
const DRAIN_MS = 300
/** 판이 끝나고 이만큼 모았다가 내보낸다. 열 명이 한꺼번에 끝나도 한 줄기로 나간다. */
const HOLD_MS = 3000

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

export class Accounts {
  private byEmail = new Map<string, Account>()
  /** 지금 살아 있는 표. 토큰 하나가 계정 하나를 가리킨다. */
  private sessions = new Map<string, string>()
  private store: AccountStore | null
  /**
   * 밖에 둔 것을 못 읽었다.
   *
   * 이때 빈 채로 열면 안 된다 — 가입해 둔 사람들이 「없는 계정」이 되어 다시 가입하고,
   * 그러면 같은 이메일로 줄이 둘 생긴다. 차라리 계정 기능을 닫는다. 게스트는 그대로 된다.
   */
  private locked = false
  /** 아직 밖으로 못 보낸 전적. 이메일로 모아 두므로 같은 사람이 두 판 끝내도 한 번 나간다. */
  private pending = new Set<string>()
  private drain: ReturnType<typeof setTimeout> | null = null
  private retryWaitMs: number
  private holdMs: number

  /**
   * @param timing 기다리는 시간. 테스트가 몇 초를 앉아서 보내지 않게 하려고 열어 두었다 —
   *               운영에서는 넘기지 않고 위의 상수를 그대로 쓴다.
   */
  constructor(
    store: AccountStore | null = null,
    timing: { retryWaitMs?: number; holdMs?: number } = {},
  ) {
    this.store = store
    this.retryWaitMs = timing.retryWaitMs ?? LOAD_WAIT_MS
    this.holdMs = timing.holdMs ?? HOLD_MS
  }

  /** 몇 명이 계정을 만들었나. 서버 상태를 볼 때 쓴다. */
  get size(): number {
    return this.byEmail.size
  }

  /**
   * 밖에 둔 계정을 메모리로 옮긴다. 부팅 때 한 번만 부른다.
   *
   * 저장소가 없으면 아무 일도 하지 않는다 — 그때는 메모리만으로 도는 것이 정상이다.
   */
  async load(): Promise<void> {
    if (!this.store) return

    for (let tried = 1; tried <= LOAD_TRIES; tried += 1) {
      try {
        const loaded = await this.store.loadAll()
        this.byEmail.clear()
        for (const one of loaded) {
          this.byEmail.set(one.email, {
            email: one.email,
            nickname: one.nickname,
            salt: one.passwordSalt,
            hash: one.passwordHash,
            record: { wins: one.wins, losses: one.losses },
            cosmetics: one.cosmetics ?? { ...EMPTY_COSMETICS },
            counted: new Set(),
          })
        }
        this.locked = false
        logLine('info', `계정 ${this.byEmail.size}개를 읽었다`)
        return
      } catch (trouble) {
        logLine('error', `계정을 읽지 못했다 (${tried}/${LOAD_TRIES})`, trouble)
        if (tried < LOAD_TRIES) await wait(this.retryWaitMs * tried)
      }
    }

    this.locked = true
    logLine('error', '계정 기능을 잠근다. 빈 채로 열면 같은 이메일로 줄이 둘 생긴다')
  }

  /** 밖에 둔 것을 못 읽어 계정 기능이 닫혀 있는가. 화면이 이유를 말할 수 있어야 한다. */
  get closed(): boolean {
    return this.locked
  }

  /** 모아 둔 것을 마저 내보내고 시계를 멈춘다. 서버가 닫힐 때 부른다. */
  stop(): void {
    if (this.drain) clearTimeout(this.drain)
    this.drain = null
  }

  async signup(rawEmail: string, password: string, rawNickname: string): Promise<Result<Session>> {
    if (this.locked) return err('NOT_SIGNED_IN', '계정 기능을 지금 쓸 수 없습니다. 게스트로 해 주세요.')

    const email = normalizeEmail(rawEmail)
    if (!email) return err('INVALID_NICKNAME', '이메일 주소를 다시 확인해 주세요.')

    const nickname = normalizeNickname(rawNickname)
    if (!nickname) return err('INVALID_NICKNAME', `닉네임은 1~${NICKNAME_MAX}자로 입력해 주세요.`)

    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return err('INVALID_SETTINGS', `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해 주세요.`)
    }
    if (this.byEmail.has(email)) return err('INVALID_SETTINGS', '이미 쓰이는 이메일입니다.')

    const salt = randomBytes(16).toString('hex')
    const account: Account = {
      email,
      nickname,
      salt,
      hash: hash(password, salt),
      record: { ...EMPTY },
      cosmetics: { ...EMPTY_COSMETICS },
      counted: new Set(),
    }

    /*
     * 밖에 먼저 쓰고 성공을 확인한 뒤에야 메모리에 넣는다. 순서를 뒤집으면 「가입됐다」고
     * 말해 놓고 서버가 다시 뜨는 순간 그 계정이 없어진다.
     *
     * 있는지도 메모리만 믿지 않고 한 번 더 물어본다 — 드문 동작이라 값이 싸고,
     * 부팅 로딩이 반쯤 어긋났을 때 같은 이메일로 줄이 둘 생기는 것을 막는다.
     */
    if (this.store) {
      try {
        if (await this.store.has(email)) return err('INVALID_SETTINGS', '이미 쓰이는 이메일입니다.')
        await this.store.create({
          email,
          nickname,
          passwordHash: account.hash,
          passwordSalt: account.salt,
          wins: 0,
          losses: 0,
          // 기본 차림은 없는 것과 같은 뜻이다. 굳이 채워 보내지 않는다.
          cosmetics: null,
        })
      } catch (trouble) {
        logLine('error', '계정을 만들지 못했다', trouble)
        return err('INVALID_SETTINGS', '계정을 만들지 못했습니다. 잠시 뒤에 다시 시도해 주세요.')
      }
    }

    return ok(this.open(this.put(account)))
  }

  login(rawEmail: string, password: string): Result<Session> {
    if (this.locked) return err('NOT_SIGNED_IN', '계정 기능을 지금 쓸 수 없습니다. 게스트로 해 주세요.')

    /*
     * 없는 이메일과 틀린 비밀번호를 같은 말로 돌려보낸다. 갈라 말하면 어느 주소가
     * 쓰이고 있는지 물어보는 것만으로 알 수 있다.
     */
    const wrong = err<Session>('AUTH_FAILED', '이메일이나 비밀번호가 맞지 않습니다.')
    const email = normalizeEmail(rawEmail)
    if (!email) return wrong

    const account = this.byEmail.get(email)
    if (!account) return wrong

    const given = Buffer.from(hash(password, account.salt), 'hex')
    const kept = Buffer.from(account.hash, 'hex')
    if (given.length !== kept.length || !timingSafeEqual(given, kept)) return wrong
    return ok(this.open(account))
  }

  /** 새로고침하고 돌아왔다. 토큰이 살아 있으면 다시 로그인하지 않는다. */
  resume(token: string): Result<Session> {
    const account = this.find(token)
    if (!account) return err('NOT_SIGNED_IN', '다시 로그인해 주세요.')
    return ok(this.view(token, account))
  }

  logout(token: string): void {
    this.sessions.delete(token)
  }

  /**
   * 한 판의 끝을 적는다. 이긴 판과 진 판만 온다 — 도중에 나간 판은 아무 줄도 남기지 않는다.
   *
   * `once` 는 그 판을 가리키는 표시다. 같은 끝이 두 번 오면(새로고침) 한 번만 센다.
   */
  record(token: string, outcome: PlayOutcome, once: string): Result<PlayRecord> {
    const account = this.find(token)
    if (!account) return err('NOT_SIGNED_IN', '다시 로그인해 주세요.')
    if (account.counted.has(once)) return ok({ ...account.record })

    account.counted.add(once)
    account.record = {
      wins: account.record.wins + (outcome === 'win' ? 1 : 0),
      losses: account.record.losses + (outcome === 'lose' ? 1 : 0),
    }
    this.later(account.email)
    return ok({ ...account.record })
  }

  /**
   * 꾸미기 하나를 산다.
   *
   * **판정은 여기서 한다.** 가격표를 화면이 들고 있으므로 값을 고쳐 부를 수 있다 —
   * 잔액도 소유도 서버가 표를 보고 다시 센다.
   *
   * **밖에 쓰고 성공을 확인한 뒤에야 메모리에 넣는다.** 전적과 반대다. 전적은 늦게
   * 맞아도 되지만 이쪽은 분배금이 걸려 있어, 순서를 뒤집으면 「샀다」고 말해 놓고
   * 서버가 다시 뜨는 순간 값만 깎인 채로 남는다.
   */
  async buy(token: string, id: string): Promise<Result<Cosmetics>> {
    const account = this.find(token)
    if (!account) return err('NOT_SIGNED_IN', '다시 로그인해 주세요.')

    const item = cosmeticOf(id)
    if (!item) return err('INVALID_SETTINGS', '없는 물건입니다.')
    if (owns(account.cosmetics, id)) return err('INVALID_SETTINGS', '이미 가지고 있습니다.')

    const left = balanceOf(account.record.wins, account.cosmetics.spent)
    if (left < item.price) {
      return err('INVALID_SETTINGS', `분배금이 ${item.price - left} 모자랍니다.`)
    }

    const next: Cosmetics = {
      owned: [...account.cosmetics.owned, id],
      equipped: { ...account.cosmetics.equipped },
      spent: account.cosmetics.spent + item.price,
    }
    if (this.store) {
      try {
        await this.store.saveCosmetics(account.email, next)
      } catch (trouble) {
        logLine('error', `산 것을 남기지 못했다: ${account.email}`, trouble)
        return err('INVALID_SETTINGS', '지금은 살 수 없습니다. 잠시 뒤에 다시 시도해 주세요.')
      }
    }
    account.cosmetics = next
    return ok({ ...next, owned: [...next.owned], equipped: { ...next.equipped } })
  }

  /**
   * 걸치는 것을 바꾼다.
   *
   * 가지지 않은 것을 걸치려 하면 **그 겹만 기본으로 되돌린다**(`sanitizeEquipped`).
   * 통째로 거절하지 않는 것은, 한 겹이 어긋났다고 나머지 세 겹까지 잃을 이유가 없어서다.
   */
  async equip(token: string, worn: Partial<Equipped>): Promise<Result<Cosmetics>> {
    const account = this.find(token)
    if (!account) return err('NOT_SIGNED_IN', '다시 로그인해 주세요.')

    const wanted: Cosmetics = {
      ...account.cosmetics,
      equipped: { ...account.cosmetics.equipped, ...worn },
    }
    const next: Cosmetics = { ...wanted, equipped: sanitizeEquipped(wanted) }
    if (this.store) {
      try {
        await this.store.saveCosmetics(account.email, next)
      } catch (trouble) {
        logLine('error', `차림을 남기지 못했다: ${account.email}`, trouble)
        return err('INVALID_SETTINGS', '지금은 바꿀 수 없습니다. 잠시 뒤에 다시 시도해 주세요.')
      }
    }
    account.cosmetics = next
    return ok({ ...next, owned: [...next.owned], equipped: { ...next.equipped } })
  }

  /**
   * 전적을 밖으로 흘려보낸다. **사람은 기다리지 않는다.**
   *
   * 열 명이 앉은 판이 끝나면 쓰기 열 건이 한꺼번에 나가는데, CMA 는 초당 일곱 건쯤에서
   * 막는다. 몇 초 모았다가 한 사람씩 간격을 두고 내보낸다. 이메일로 모으므로 그 사이에
   * 같은 사람이 두 판을 끝내도 마지막 값 한 번만 나간다.
   *
   * 실패는 삼킨다. 전적 한 줄 때문에 판을 멈출 이유가 없고, 다음 판이 끝나면 그때의
   * 값이 다시 나간다 — 늦게 맞으면 된다.
   */
  private later(email: string): void {
    if (!this.store) return
    this.pending.add(email)
    if (this.drain) return
    this.drain = setTimeout(() => void this.flush(), this.holdMs)
    this.drain.unref?.()
  }

  private async flush(): Promise<void> {
    this.drain = null
    const going = [...this.pending]
    this.pending.clear()

    for (const email of going) {
      const account = this.byEmail.get(email)
      if (!account || !this.store) continue
      try {
        await this.store.saveRecord(email, account.record.wins, account.record.losses)
      } catch (trouble) {
        logLine('error', `전적을 남기지 못했다: ${email}`, trouble)
      }
      await wait(DRAIN_MS)
    }
  }

  /** 표를 들고 있는 계정. 저장소에 넘길 것을 고를 때 쓴다. */
  accountOf(token: string): Account | null {
    return this.find(token) ?? null
  }

  private put(account: Account): Account {
    this.byEmail.set(account.email, account)
    return account
  }

  private find(token: string): Account | undefined {
    const email = this.sessions.get(token)
    return email ? this.byEmail.get(email) : undefined
  }

  private view(token: string, account: Account): Session {
    return {
      token,
      email: account.email,
      nickname: account.nickname,
      record: { ...account.record },
      cosmetics: {
        ...account.cosmetics,
        owned: [...account.cosmetics.owned],
        equipped: { ...account.cosmetics.equipped },
      },
    }
  }

  /**
   * 표를 새로 뗀다.
   *
   * 로그인할 때마다 새 토큰이고 옛 것도 살아 있다 — 창 여럿으로 같은 계정에 붙어
   * 볼 수 있어야 한다(이 저장소는 그렇게 만들어 왔다). 자리를 하나로 묶는 것은
   * 이메일이지 표가 아니다.
   */
  private open(account: Account): Session {
    const token = randomBytes(24).toString('hex')
    this.sessions.set(token, account.email)
    return this.view(token, account)
  }
}
