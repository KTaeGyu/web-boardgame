/**
 * 정체성. 닉네임이 아니라 이 id 가 「나」다.
 *
 * sessionStorage 를 쓰는 이유가 두 가지다. 새로고침해도 살아남아 방으로 돌아갈 수 있고,
 * 탭마다 따로라 한 브라우저에서 여러 명으로 붙어 테스트할 수 있다.
 */

import { useSyncExternalStore } from 'react'

const PLAYER_ID_KEY = 'the-gang:playerId'
const NICKNAME_KEY = 'the-gang:nickname'

function makePlayerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `p-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function getPlayerId(): string {
  const saved = sessionStorage.getItem(PLAYER_ID_KEY)
  if (saved) return saved
  const fresh = makePlayerId()
  sessionStorage.setItem(PLAYER_ID_KEY, fresh)
  return fresh
}

/** id 가 바뀌는 것을 듣는 화면들. 바뀌는 일은 아래 `adoptPlayerId` 하나뿐이다. */
const listeners = new Set<() => void>()

/**
 * 서버가 건넨 id 로 갈아탄다.
 *
 * 로그인한 사람이 새 창에서 돌아왔을 때다 — 이 창의 id 는 새로 만든 것이라 앉아 있던
 * 자리를 모른다. 서버가 계정으로 그 자리를 찾아 id 를 건네주면, 이 창은 그 사람이 된다.
 */
export function adoptPlayerId(id: string): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || getPlayerId() === id) return
  sessionStorage.setItem(PLAYER_ID_KEY, id)
  for (const listen of listeners) listen()
}

/** 화면에서 읽을 때. 갈아타면 다시 그려진다. */
export function usePlayerId(): string {
  return useSyncExternalStore(
    (listen) => {
      listeners.add(listen)
      return () => listeners.delete(listen)
    },
    getPlayerId,
  )
}

export function getNickname(): string {
  return sessionStorage.getItem(NICKNAME_KEY) ?? ''
}

export function setNickname(nickname: string): void {
  sessionStorage.setItem(NICKNAME_KEY, nickname)
}
