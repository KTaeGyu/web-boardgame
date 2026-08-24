/**
 * 정체성. 닉네임이 아니라 이 id 가 「나」다.
 *
 * sessionStorage 를 쓰는 이유가 두 가지다. 새로고침해도 살아남아 방으로 돌아갈 수 있고,
 * 탭마다 따로라 한 브라우저에서 여러 명으로 붙어 테스트할 수 있다.
 */

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

export function getNickname(): string {
  return sessionStorage.getItem(NICKNAME_KEY) ?? ''
}

export function setNickname(nickname: string): void {
  sessionStorage.setItem(NICKNAME_KEY, nickname)
}
