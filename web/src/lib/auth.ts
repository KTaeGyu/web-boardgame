/**
 * 로그인.
 *
 * 계정이 하는 일은 **같은 사람이 돌아왔을 때 전적을 이어 주는 것**이다. 닉네임을
 * 붙들어 두지는 않는다 — 계정이 있어도 그 이름은 남도 쓴다. 그래서 방에 들어가는
 * 요청은 이 표를 싣지 않는다.
 *
 * **표는 sessionStorage 에 둔다.** 정체성(playerId)과 같은 자리다. localStorage 로
 * 옮기면 창을 새로 열어도 로그인이 따라오지만, 대신 한 브라우저에서 여러 명으로 붙어
 * 볼 수 없게 된다 — 이 저장소는 그 방식으로 만들어져 왔다(창마다 다른 사람).
 * 그래서 로그인은 새로고침을 넘기되 새 창까지 따라가지는 않는다.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PlayOutcome, PlayRecord, Session } from '@the-gang/shared'

import { call, socket } from './socket.ts'
import { setNickname } from './identity.ts'

const KEY = 'the-gang:session'

/** 지금 창의 로그인. 어디서 물어도 같은 답이어야 해서 한 곳에 둔다. */
let current: Session | null = read()
const watchers = new Set<(session: Session | null) => void>()

function read(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    if (typeof parsed?.token !== 'string' || typeof parsed?.email !== 'string') return null
    return parsed as Session
  } catch {
    return null
  }
}

function put(session: Session | null): void {
  current = session
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* 기억하지 못할 뿐이다 */
  }
  /*
   * 로그인하면 그 계정의 닉네임으로 앉는다. 유일한 이름은 아니지만, 계정을 만들 때
   * 적어 둔 이름을 다시 치게 할 이유가 없다.
   */
  if (session) setNickname(session.nickname)
  for (const watch of watchers) watch(session)
}

/** 지금 로그인한 사람. 로그인하지 않았으면 null. */
export function session(): Session | null {
  return current
}

export async function signup(email: string, password: string, nickname: string): Promise<string | null> {
  const result = await call<Session>('auth:signup', { email, password, nickname })
  if (!result.ok) return result.message
  put(result.value)
  return null
}

export async function login(email: string, password: string): Promise<string | null> {
  const result = await call<Session>('auth:login', { email, password })
  if (!result.ok) return result.message
  put(result.value)
  return null
}

export async function logout(): Promise<void> {
  const token = current?.token
  put(null)
  if (token) await call<null>('auth:logout', { token })
}

/**
 * 표가 아직 사는지 서버에 묻는다.
 *
 * 새로고침한 뒤와 다시 붙은 뒤에 부른다. 서버가 그 사이에 다시 떴으면 표가 죽었을 수
 * 있고, 그때는 로그인하지 않은 것으로 돌아가야 한다 — 화면만 로그인한 척하고 있으면
 * 판이 끝나도 전적이 어디에도 안 쌓인다.
 */
export async function resume(): Promise<void> {
  const token = current?.token
  if (!token) return
  const result = await call<Session>('auth:resume', { token })
  put(result.ok ? result.value : null)
}

/** 한 판의 끝을 계정에 적는다. 게스트면 아무 일도 하지 않는다. */
export async function recordPlay(outcome: PlayOutcome, once: string): Promise<void> {
  const token = current?.token
  if (!token) return
  const result = await call<PlayRecord>('auth:record', { token, outcome, once })
  if (result.ok && current) put({ ...current, record: result.value })
}

/** 화면이 로그인 상태를 따라가게 한다. */
export function useSession(): Session | null {
  const [value, setValue] = useState(current)
  useEffect(() => {
    watchers.add(setValue)
    return () => {
      watchers.delete(setValue)
    }
  }, [])
  return value
}

/**
 * 붙을 때마다 표를 다시 확인한다.
 *
 * 앱이 뜰 때 한 번, 그리고 재접속마다. 서버가 다시 뜬 것을 알아채는 유일한 자리다.
 */
export function useResumeSession(): void {
  const again = useCallback(() => void resume(), [])
  useEffect(() => {
    again()
    socket.on('connect', again)
    return () => {
      socket.off('connect', again)
    }
  }, [again])
}
