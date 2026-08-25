/**
 * 서버와 웹이 함께 쓰는 계약.
 *
 * 이벤트 이름과 페이로드를 한 곳에 두면, 규칙이 바뀔 때 어긋난 자리를
 * 타입 검사가 잡아준다. 이 파일이 서버와 화면 사이의 유일한 합의다.
 */

import type { Card } from './cards.ts'
import type { ChallengeId, SpecialistId } from './extraCards.ts'
import { SPECIALIST_ROUNDS } from './game.ts'
import type { GameOverReason, GameView } from './game.ts'

/** 방 설정. 지금은 기본값 고정으로 시작하고, UI 는 자리만 잡아둔다. */
export const GAME_MODES = ['basic', 'advanced', 'professional', 'masterThief', 'custom'] as const
export type GameMode = (typeof GAME_MODES)[number]

export const GAME_MODE_LABEL: Record<GameMode, string> = {
  basic: '기본 모드',
  advanced: '고급 모드',
  professional: '프로 모드',
  masterThief: '마스터 시프 모드',
  custom: '직접 고르기',
}

export const GAME_MODE_HINT: Record<GameMode, string> = {
  basic: '도전자·해결사 카드 없이 순수한 규칙으로.',
  advanced: '성공하면 도전자 카드, 실패하면 해결사 카드가 붙습니다.',
  professional: '도전자 한 장이 게임 내내 붙어 있고, 그 위에 고급 모드가 얹힙니다.',
  masterThief: '도전자 두 장이 언제나 걸립니다. 해결사는 없고 경보 두 번이면 끝납니다.',
  custom: '원하는 카드를 직접 고릅니다. 도전자는 모든 판에 걸리고, 해결사는 판을 지정해 둡니다.',
}

export const MIN_PLAYERS = 3
export const MAX_PLAYERS_LIMIT = 10

export interface RoomSettings {
  mode: GameMode
  /** 「직접 고르기」에서 고른 도전자 카드. 다른 모드에서는 쓰이지 않는다. */
  pickedChallenges: ChallengeId[]
  /**
   * 「직접 고르기」에서 판마다 걸릴 해결사. **자리 하나가 판 하나다** —
   * `[null, null, 10, null, null]` 이면 셋째 판에만 「근육」이 나오고 나머지 판은 비어 있다.
   *
   * 한 판에 걸리는 해결사는 하나뿐이라 자리마다 한 장이다. 다만 같은 카드가 여러 판에
   * 설 수는 있다 — 「썼는가」는 판마다 새로 시작한다. 길이는 늘 SPECIALIST_ROUNDS 다.
   */
  specialistRounds: (SpecialistId | null)[]
  maxPlayers: number
}

/** 빈 자리 다섯. 설정을 새로 만들 때마다 새 배열이어야 방끼리 섞이지 않는다. */
export function emptyRounds(): (SpecialistId | null)[] {
  return Array.from({ length: SPECIALIST_ROUNDS }, () => null)
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'basic',
  pickedChallenges: [],
  specialistRounds: emptyRounds(),
  maxPlayers: 6,
}

export type RoomPhase = 'lobby' | 'playing' | 'result'

export interface PlayerView {
  id: string
  nickname: string
  /** 화면에 부를 이름. 같은 닉네임이 여럿이면 꼬리표가 붙는다. */
  displayName: string
  isHost: boolean
  /** 끊긴 사람도 유예 시간 동안은 자리를 지킨다. 화면에는 흐리게 표시한다. */
  connected: boolean
}

/** 방 목록에 한 줄로 나가는 정보. */
export interface RoomSummary {
  code: string
  hostNickname: string
  playerCount: number
  maxPlayers: number
  phase: RoomPhase
}

/** 방 안에 있는 사람이 보는 전체 상태. */
export interface RoomView {
  code: string
  hostId: string
  players: PlayerView[]
  settings: RoomSettings
  phase: RoomPhase
}

/** 실패를 예외가 아니라 값으로 돌려준다. 화면이 사유별로 다르게 안내해야 하기 때문이다. */
export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_GAME'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'INVALID_NICKNAME'
  | 'INVALID_SETTINGS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'PLAYER_AWAY'
  | 'ROOM_LIMIT'
  | 'SERVER_FULL'
  | 'GAME_NOT_RUNNING'
  | 'ALREADY_STARTED'
  | 'WRONG_PHASE'
  | 'INVALID_TOKEN'
  | 'TOKEN_LOCKED'

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string }

export interface Identity {
  /** 브라우저 sessionStorage 에 저장된 랜덤 id. 닉네임이 아니라 이것이 정체성이다. */
  playerId: string
  nickname: string
}

/** 클라이언트 → 서버. 모두 ack 콜백으로 결과를 돌려받는다. */
export interface ClientToServerEvents {
  'room:create': (payload: Identity, ack: (result: Result<RoomView>) => void) => void
  'room:join': (payload: Identity & { code: string }, ack: (result: Result<RoomView>) => void) => void
  'room:leave': (ack: (result: Result<null>) => void) => void
  'room:list': (ack: (result: Result<RoomSummary[]>) => void) => void
  'room:settings': (payload: Partial<RoomSettings>, ack: (result: Result<RoomView>) => void) => void
  /** 방 목록 페이지에 머무는 동안 갱신을 받기 위해 구독한다. */
  'rooms:watch': (payload: { watching: boolean }) => void

  /** 방장이 판을 연다. */
  'game:start': (ack: (result: Result<GameView>) => void) => void
  /** 토큰을 집는다. 중앙에 있든 남이 쥐고 있든 같은 요청이다. */
  'game:take': (payload: { token: number }, ack: (result: Result<null>) => void) => void
  'game:ready': (payload: { ready: boolean }, ack: (result: Result<null>) => void) => void
  /** 쇼다운을 보고 다음 판으로 넘어간다. 모두가 눌러야 넘어간다. */
  'game:continue': (ack: (result: Result<null>) => void) => void
  /** 게임이 끝난 뒤 재경기. 한 명이라도 거절하면 방이 닫힌다. */
  'game:rematch': (payload: { agree: boolean }, ack: (result: Result<null>) => void) => void
  /** 방장이 판을 접고 모두를 대기실로 되돌린다. 방은 그대로 남는다. */
  'game:toLobby': (ack: (result: Result<null>) => void) => void
  /** 딜 직후 다 같이 하는 단계에서 내 몫을 마친다. 넘길 카드가 필요하면 함께 보낸다. */
  'game:setupCard': (payload: { cardIndex?: number }, ack: (result: Result<null>) => void) => void
  /** 한 장을 더 받은 뒤 버릴 카드를 고른다. */
  'game:discard': (payload: { cardIndex: number }, ack: (result: Result<null>) => void) => void
  /** 스캔에 답한다. 접속 중인 사람이 모두 같은 답을 고르면 확정된다. */
  'game:scanVote': (
    payload: { kind: 'rank' | 'category'; value: number },
    ack: (result: Result<null>) => void,
  ) => void
  /** 한 줄 보낸다. 방 안에서만 오간다. */
  'chat:send': (payload: { text: string }, ack: (result: Result<null>) => void) => void
  /** 해결사 카드를 쓴다. 누른 사람이 쓰는 사람이고, 카드에 따라 대상·숫자·내 카드가 더 필요하다. */
  'game:useSpecialist': (
    payload: { targetId?: string; value?: number; cardIndex?: number },
    ack: (result: Result<null>) => void,
  ) => void
}

/**
 * 한 줄의 말.
 *
 * 카드 이야기를 금지하는 게임이지만, 그것은 사람끼리 지키는 약속이지 화면이 막을 일이
 * 아니다. 서버는 누가 언제 무엇을 말했는지만 옮긴다.
 */
export interface ChatMessage {
  id: number
  playerId: string
  /** 동명이인이 갈린 이름. 자리에 붙는 이름과 같아야 누가 한 말인지 이어진다. */
  name: string
  text: string
  at: number
}

/** 한 줄의 길이. 길어지면 화면이 아니라 대화가 무너진다. */
export const CHAT_MAX = 200

/** 방이 들고 있는 지난 말의 수. 새로고침한 사람이 흐름을 잡을 만큼만. */
export const CHAT_KEEP = 50

/** 서버 → 클라이언트. */
export interface ServerToClientEvents {
  'room:updated': (room: RoomView) => void
  'room:closed': (payload: { reason: 'empty' | 'hostClosed' | 'rematchDeclined' | 'idle' }) => void
  /** 서버가 감당할 수 있는 인원을 넘겼다. 곧 연결이 끊긴다. */
  'server:full': (payload: { message: string }) => void
  'rooms:changed': (rooms: RoomSummary[]) => void

  /** 모두가 보는 상태. 누구의 홀카드도 들어 있지 않다. */
  'game:state': (game: GameView) => void
  /** 내 카드. 나에게만 간다. 판이 바뀌거나 재접속할 때 다시 온다. */
  'game:hand': (payload: { heist: number; hole: Card[] }) => void
  /** 사람이 빠져 판을 이어갈 수 없게 됐다. */
  'game:aborted': (payload: GameOverReason) => void
  /**
   * 카드가 나에게만 알려준 것. 드로어의 그 카드에 적히고, 눌러서 다시 볼 수 있다.
   *
   * 「정보원」으로 본 남의 카드, 「사기꾼」에게 넘어가기 전 내 카드처럼
   * 나만 알아야 하는 정보는 모두 이 통로로 온다. 판이 바뀌면 사라진다.
   */
  'game:note': (payload: {
    heist: number
    specialist: number
    title: string
    text?: string
    cards?: Card[]
  }) => void
  /**
   * 방금 나에게 벌어진 일. 잠깐 떴다 사라지고 아무 데도 남지 않는다.
   *
   * 쪽지(`game:note`)와 다르다. 저쪽은 「내가 알게 된 것」이라 판이 끝날 때까지 드로어에
   * 남고, 이쪽은 「내 것이 바뀌었다」는 알림이라 지나가면 그만이다. 공개 상태만으로는
   * 남이 내 토큰을 가져간 것과 내가 스스로 놓은 것이 구별되지 않아, 서버가 짚어 준다.
   */
  'game:toast': (payload: { text: string; tone?: 'info' | 'warn' }) => void
  /** 누군가 한 말. 그 방 전체에 간다. */
  'chat:message': (message: ChatMessage) => void
  /** 방에 들어온 사람에게만. 새로고침해도 앞의 흐름이 남는다. */
  'chat:history': (payload: { messages: ChatMessage[] }) => void
}

export const NICKNAME_MAX = 12

/**
 * 방장이 빠졌을 때 다음 방장.
 *
 * 접속 중인 사람 중 가장 먼저 들어온 사람. 아무도 접속 중이 아니면 남은 사람 중
 * 가장 먼저 들어온 사람. 넘기는 배열은 방장이 빠진 뒤의 인원이며 입장 순서여야 한다.
 *
 * 서버가 실제로 넘기는 규칙이자, 화면이 「누구에게 넘어갑니다」를 미리 말할 때 쓰는
 * 규칙이다. 두 곳이 갈라지면 안내와 결과가 어긋나므로 한 곳에 둔다.
 */
export function nextHost<T extends { connected: boolean }>(remaining: readonly T[]): T | null {
  return remaining.find((player) => player.connected) ?? remaining[0] ?? null
}

/**
 * 화면에 부를 이름을 정한다.
 *
 * 같은 닉네임이 둘 이상이면 들어온 순서대로 [1], [2] 를 붙인다. 혼자뿐이면
 * 그대로 둔다 — 겹치지도 않는데 꼬리표가 붙으면 거슬린다.
 * 순서가 곧 번호이므로 넘기는 배열은 입장 순서여야 한다.
 */
export function displayNames(nicknames: readonly string[]): string[] {
  const total = new Map<string, number>()
  for (const nickname of nicknames) total.set(nickname, (total.get(nickname) ?? 0) + 1)

  const seen = new Map<string, number>()
  return nicknames.map((nickname) => {
    if ((total.get(nickname) ?? 0) < 2) return nickname
    const index = (seen.get(nickname) ?? 0) + 1
    seen.set(nickname, index)
    return `${nickname} [${index}]`
  })
}

export function normalizeNickname(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0 || trimmed.length > NICKNAME_MAX) return null
  return trimmed
}
