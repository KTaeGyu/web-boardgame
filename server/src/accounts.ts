/**
 * 계정. 이름·비밀번호·전적을 서버가 들고 있는다.
 *
 * **메모리에만 있다.** 방과 같은 자리다 — 서버를 다시 띄우면 계정도 함께 사라진다.
 * 무료 요금제는 15분 동안 아무도 오지 않으면 잠들고, 깨어날 때 이 표도 비어 있다.
 * 그러니 이것은 「증명서」가 아니라 **지금 이 서버가 도는 동안 이름을 붙들어 두는 것**이다.
 * 화면도 그렇게 적어야 한다 — 비밀번호를 받아 두고 남는다고 믿게 하면 그것이 더 나쁘다.
 *
 * 그래도 서버만 할 수 있는 일이 하나 있다. **같은 이름을 두 사람이 동시에 쓰지 못하게**
 * 하는 것이다. 기기에만 두는 방식으로는 안 되는 유일한 것이고, 이 표를 두는 값이다.
 *
 * 비밀번호는 해시로 둔다. 메모리에만 있다고 평문으로 두면, 어느 날 이 표를 찍어보는
 * 코드 한 줄이 붙는 순간 그대로 새어 나간다. 사람들은 다른 곳에서 쓰던 비밀번호를 친다.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  NICKNAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  normalizeNickname,
  type ErrorCode,
  type PlayOutcome,
  type PlayRecord,
  type Result,
  type Session,
} from '@the-gang/shared'

function err<T>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, code, message }
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

interface Account {
  name: string
  salt: string
  hash: Buffer
  record: PlayRecord
  /** 이 판의 끝을 이미 셌는가. 같은 끝이 두 번 오면(새로고침) 한 번만 센다. */
  counted: Set<string>
}

const EMPTY: PlayRecord = { played: 0, wins: 0, losses: 0, quits: 0 }

function hash(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 32)
}

/**
 * 이름을 견주는 열쇠.
 *
 * 「태규」와 「 태규 」가 다른 계정이 되면 이름을 붙들어 두는 뜻이 없다.
 * 대소문자도 같이 본다 — 화면에는 적은 대로 보이되, 자리는 하나만 준다.
 */
function keyOf(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export class Accounts {
  private byKey = new Map<string, Account>()
  /** 지금 살아 있는 표. 토큰 하나가 계정 하나를 가리킨다. */
  private sessions = new Map<string, string>()

  /** 몇 명이 계정을 만들었나. 서버 상태를 볼 때 쓴다. */
  get size(): number {
    return this.byKey.size
  }

  /**
   * 이 이름이 누군가의 계정인가.
   *
   * 게스트가 남의 계정 이름으로 방에 들어오는 것을 막는 자리다. 이것이 없으면
   * 계정을 만든 뜻이 없다 — 아무나 그 이름을 적고 들어올 수 있다.
   */
  taken(name: string): boolean {
    return this.byKey.has(keyOf(name))
  }

  signup(rawName: string, password: string): Result<Session> {
    const name = normalizeNickname(rawName)
    if (!name) return err('INVALID_NICKNAME', `이름은 1~${NICKNAME_MAX}자로 입력해 주세요.`)
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return err('INVALID_SETTINGS', `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해 주세요.`)
    }
    if (this.byKey.has(keyOf(name))) return err('INVALID_SETTINGS', '이미 쓰이는 이름입니다.')

    const salt = randomBytes(16).toString('hex')
    const account: Account = {
      name,
      salt,
      hash: hash(password, salt),
      record: { ...EMPTY },
      counted: new Set(),
    }
    this.byKey.set(keyOf(name), account)
    return ok(this.open(account))
  }

  login(rawName: string, password: string): Result<Session> {
    const account = this.byKey.get(keyOf(rawName))
    /*
     * 없는 이름과 틀린 비밀번호를 같은 말로 돌려보낸다. 갈라 말하면 어느 이름이
     * 쓰이고 있는지 물어보는 것만으로 알 수 있다.
     */
    const wrong = err<Session>('AUTH_FAILED', '이름이나 비밀번호가 맞지 않습니다.')
    if (!account) return wrong

    const given = hash(password, account.salt)
    if (given.length !== account.hash.length || !timingSafeEqual(given, account.hash)) return wrong
    return ok(this.open(account))
  }

  /** 새로고침하고 돌아왔다. 토큰이 살아 있으면 다시 로그인하지 않는다. */
  resume(token: string): Result<Session> {
    const account = this.find(token)
    if (!account) return err('NOT_SIGNED_IN', '다시 로그인해 주세요.')
    return ok({ token, name: account.name, record: { ...account.record } })
  }

  logout(token: string): void {
    this.sessions.delete(token)
  }

  /** 이 표가 가리키는 이름. 방에 들어갈 때 「이 이름을 써도 되는 사람인가」를 가른다. */
  nameOf(token: string): string | null {
    return this.find(token)?.name ?? null
  }

  /**
   * 이 표를 가진 사람이 그 이름의 주인인가.
   *
   * 적어 온 이름과 계정에 적힌 이름은 대소문자나 사이 여백이 다를 수 있다. 같은 자리를
   * 가리키는지만 보면 되므로 열쇠로 견준다.
   */
  owns(token: string, name: string): boolean {
    const account = this.find(token)
    return account !== undefined && keyOf(account.name) === keyOf(name)
  }

  /**
   * 한 판의 끝을 적는다.
   *
   * `once` 는 그 판을 가리키는 표시다. 결과 화면에서 새로고침하면 같은 끝이 다시 오는데,
   * 그때 또 세면 한 판이 두 판이 된다. 화면이 쓰던 규칙을 그대로 서버로 옮겼다.
   */
  record(token: string, outcome: PlayOutcome, once: string): Result<PlayRecord> {
    const account = this.find(token)
    if (!account) return err('NOT_SIGNED_IN', '다시 로그인해 주세요.')
    if (account.counted.has(once)) return ok({ ...account.record })

    account.counted.add(once)
    account.record = {
      played: account.record.played + 1,
      wins: account.record.wins + (outcome === 'win' ? 1 : 0),
      losses: account.record.losses + (outcome === 'lose' ? 1 : 0),
      quits: account.record.quits + (outcome === 'quit' ? 1 : 0),
    }
    return ok({ ...account.record })
  }

  private find(token: string): Account | undefined {
    const key = this.sessions.get(token)
    return key ? this.byKey.get(key) : undefined
  }

  /**
   * 표를 새로 뗀다.
   *
   * 로그인할 때마다 새 토큰이고 옛 것도 살아 있다 — 창 여럿으로 같은 계정에 붙어
   * 볼 수 있어야 한다(이 저장소는 그렇게 만들어 왔다). 자리를 하나로 묶는 것은
   * 이름이지 표가 아니다.
   */
  private open(account: Account): Session {
    const token = randomBytes(24).toString('hex')
    this.sessions.set(token, keyOf(account.name))
    return { token, name: account.name, record: { ...account.record } }
  }
}
