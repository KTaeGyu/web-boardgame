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
  NICKNAME_MAX,
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

export class Accounts {
  private byEmail = new Map<string, Account>()
  /** 지금 살아 있는 표. 토큰 하나가 계정 하나를 가리킨다. */
  private sessions = new Map<string, string>()

  /** 몇 명이 계정을 만들었나. 서버 상태를 볼 때 쓴다. */
  get size(): number {
    return this.byEmail.size
  }

  signup(rawEmail: string, password: string, rawNickname: string): Result<Session> {
    const email = normalizeEmail(rawEmail)
    if (!email) return err('INVALID_NICKNAME', '이메일 주소를 다시 확인해 주세요.')

    const nickname = normalizeNickname(rawNickname)
    if (!nickname) return err('INVALID_NICKNAME', `닉네임은 1~${NICKNAME_MAX}자로 입력해 주세요.`)

    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return err('INVALID_SETTINGS', `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해 주세요.`)
    }
    if (this.byEmail.has(email)) return err('INVALID_SETTINGS', '이미 쓰이는 이메일입니다.')

    const salt = randomBytes(16).toString('hex')
    return ok(this.open(this.put({
      email,
      nickname,
      salt,
      hash: hash(password, salt),
      record: { ...EMPTY },
      counted: new Set(),
    })))
  }

  login(rawEmail: string, password: string): Result<Session> {
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
    return ok({ ...account.record })
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
