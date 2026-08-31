/**
 * 서버와 웹이 함께 쓰는 계약.
 *
 * 이벤트 이름과 페이로드를 한 곳에 두면, 규칙이 바뀔 때 어긋난 자리를
 * 타입 검사가 잡아준다. 이 파일이 서버와 화면 사이의 유일한 합의다.
 */

import type { Card } from './cards.ts'
import type { ChallengeId, SpecialistId } from './extraCards.ts'
import { ALARMS_TO_LOSE, SPECIALIST_ROUNDS, VAULTS_TO_WIN } from './game.ts'
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

/**
 * 한 방에서 보고만 있을 수 있는 사람 수.
 *
 * 자리에 앉은 사람보다 구경꾼이 많으면 방이 무엇을 하는 곳인지 흐려진다.
 * 접속 한도와 다른 이야기다 — 저쪽은 서버가 감당할 양이고 이쪽은 방의 모양이다.
 */
export const MAX_SPECTATORS = 5
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
  /**
   * 그 판의 해결사를 무작위로 뽑을 것인가. 배치표 맨 윗줄이다.
   *
   * 한 판에 해결사는 하나뿐이라 지정 카드와 같은 칸에 함께 설 수 없다 —
   * 무작위를 찍으면 그 칸에 서 있던 카드가 자리를 내준다. 길이는 자리 수와 같다.
   */
  specialistRandomRounds: boolean[]
  /**
   * 해결사를 **직전 판을 졌을 때만** 내보내는가. 기본은 그렇다.
   *
   * 원작에서 해결사는 실패한 다음 판을 거들어주는 카드다. 끄면 결과와 무관하게
   * 배치표대로 나온다. 켜져 있으면 첫 판에는 나오지 않는다 — 직전 판이 없다.
   */
  specialistOnLoss: boolean
  /**
   * 「직접 고르기」에서 고른 것 위에 무작위로 더 얹을 도전자 수(0~3).
   *
   * **판마다 새로 뽑는다.** 고른 카드(고정)와는 겹치지 않지만, 지난 판에 나왔던 카드가
   * 다시 나오는 것은 막지 않는다 — 매 판 달라지는 것이 이 설정의 뜻이다.
   */
  randomChallenges: number
  /**
   * 무작위 도전자를 **직전 판을 이겼을 때만** 뽑는가. 기본은 아니다(매 판 뽑는다).
   *
   * 원작의 「성공하면 어려워진다」를 쓰고 싶을 때 켠다. 첫 판은 직전 결과가 없으므로
   * 켜져 있으면 나오지 않는다. 고른 카드(고정)는 이 조건과 무관하게 늘 걸린다.
   */
  randomChallengesOnWin: boolean
  /**
   * 한 번 나온 무작위 도전자가 그다음 판에도 남는가. 기본은 아니다(그 판에만).
   *
   * 켜면 판이 갈수록 쌓인다 — 이미 걸려 있는 것은 다시 뽑지 않으므로 매 판 새 카드가
   * 그만큼 더해진다.
   */
  randomChallengesStay: boolean
  /** 몇 개를 열면 이기는가. 「직접 고르기」에서만 3이 아닐 수 있다. */
  vaultsToWin: number
  /** 몇 번 울리면 지는가. 「직접 고르기」에서만 3이 아닐 수 있다. */
  alarmsToLose: number
  maxPlayers: number
}

/**
 * 빈 자리. 설정을 새로 만들 때마다 새 배열이어야 방끼리 섞이지 않는다.
 * 길이는 최대 판수를 따른다 — 승·패 수를 바꾸면 자리 수도 함께 바뀐다.
 */
export function emptyRounds(count: number = SPECIALIST_ROUNDS): (SpecialistId | null)[] {
  return Array.from({ length: count }, () => null)
}

/** 배치표 맨 윗줄(무작위)의 빈 한 벌. 길이는 자리 수를 따른다. */
export function emptyFlags(count: number = SPECIALIST_ROUNDS): boolean[] {
  return Array.from({ length: count }, () => false)
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'basic',
  pickedChallenges: [],
  specialistRounds: emptyRounds(),
  specialistRandomRounds: emptyFlags(),
  specialistOnLoss: true,
  randomChallenges: 0,
  randomChallengesOnWin: false,
  randomChallengesStay: false,
  vaultsToWin: VAULTS_TO_WIN,
  alarmsToLose: ALARMS_TO_LOSE,
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
  /**
   * 찬 자리 수. 접속 중인 사람이 아니라 **자리**를 센다.
   *
   * 끊긴 사람의 자리는 유예 시간 동안 지켜지므로 남이 앉을 수 없다. 접속 중인 수만
   * 세면 목록이 「2 / 3」이라 말해 놓고 서버는 「정원이 찼습니다」로 돌려보낸다 —
   * 실제로 그렇게 났다(2026-08-31). 들어갈 수 있는지를 정하는 수와 같은 수여야 한다.
   */
  playerCount: number
  /** 그중 자리 비움. 「셋인데 왜 둘만 보이나」를 화면이 설명할 수 있어야 한다. */
  awayCount: number
  maxPlayers: number
  phase: RoomPhase
  /** 자리 없이 보고만 있는 사람 수. 판이 도는 방에만 붙는다. */
  spectatorCount: number
}

/** 방 안에 있는 사람이 보는 전체 상태. */
export interface RoomView {
  code: string
  hostId: string
  players: PlayerView[]
  settings: RoomSettings
  phase: RoomPhase
  /** 자리 없이 보고만 있는 사람들. 대기실에서도 판에서도 보인다. */
  spectators: { id: string; nickname: string }[]
  /**
   * 혼자 해보는 방인가.
   *
   * 화면이 알아야 하는 것은 「방장이냐」가 아니라 「돌아갈 대기실이 있느냐」다.
   * 튜토리얼은 만든 사람이 곧 방장이지만 그 방에 돌아갈 이유가 없다.
   */
  tutorial: boolean
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
  | 'TOO_FAST'

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
  /**
   * 내 자리가 어느 방에 남아 있는가. 없으면 null.
   *
   * 목록 화면이 정원 찬 방을 잠그는데, 이미 내 자리인 방은 정원과 무관하게 들어갈 수
   * 있어야 한다(joinRoom 이 정원을 보기 전에 재접속으로 처리한다). 그 방이 어느
   * 것인지는 서버만 안다 — 새로고침한 창은 소켓이 어느 사람인지도 잊었으므로
   * playerId 를 함께 보낸다.
   */
  'room:where': (payload: { playerId: string }, ack: (result: Result<string | null>) => void) => void
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
  /**
   * 자리 없이 보기만 한다. 판이 도는 방에만 들어갈 수 있다.
   *
   * 공개 상태에는 쇼다운 전까지 누구의 홀카드도 없으므로, 그대로 흘려도 새는 것이 없다.
   */
  'room:spectate': (
    payload: Identity & { code: string },
    ack: (result: Result<RoomView>) => void,
  ) => void
  /**
   * 방장이 한 사람을 내보낸다. 대기실에서만 할 수 있다.
   *
   * 판이 도는 중에는 열지 않는다 — 한 명이 빠지면 라운드가 끝나지 않아 판이 통째로
   * 접힌다. 그건 내보내기가 아니라 판을 엎는 것이다.
   */
  'room:kick': (
    payload: { playerId: string; ban?: boolean },
    ack: (result: Result<null>) => void,
  ) => void
  /**
   * 혼자 해보는 판을 연다. 봇 둘이 함께 앉고, 곧바로 시작된다.
   *
   * 방을 만들고 시작하는 것이 한 동작인 이유는 대기실에서 기다릴 사람이 없기 때문이다.
   */
  'tutorial:start': (payload: Identity, ack: (result: Result<{ code: string }>) => void) => void
  /** 안내를 읽고 닫았다. 이걸 받아야 봇이 다시 움직인다. */
  'tutorial:next': (ack: (result: Result<null>) => void) => void
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
  /**
   * 자리 없이 보고 있는 사람의 말인가.
   *
   * 표시해 두는 것은 규칙 때문이다 — 판 밖에 있는 사람의 말은 판 안의 선언과 무게가
   * 다르다. 누가 한 말인지 모르면 관전자의 한마디가 선언처럼 읽힌다.
   */
  spectator?: boolean
}

/** 한 줄의 길이. 길어지면 화면이 아니라 대화가 무너진다. */
export const CHAT_MAX = 200

/** 방이 들고 있는 지난 말의 수. 새로고침한 사람이 흐름을 잡을 만큼만. */
export const CHAT_KEEP = 50

/** 서버 → 클라이언트. */
export interface ServerToClientEvents {
  'room:updated': (room: RoomView) => void
  'room:closed': (payload: { reason: 'empty' | 'hostClosed' | 'rematchDeclined' | 'idle' }) => void
  /** 내보내진 사람에게만. 방이 닫힌 것과 구별해야 안내가 맞는다. */
  'room:kicked': (payload: { message: string }) => void
  /** 서버가 감당할 수 있는 인원을 넘겼다. 곧 연결이 끊긴다. */
  'server:full': (payload: { message: string }) => void
  'rooms:changed': (rooms: RoomSummary[]) => void
  /**
   * 지금 몇 명이 붙어 있고 방은 몇 개인가. 목록을 보고 있는 사람에게만 간다.
   *
   * 사람 수는 방에 든 사람만이 아니라 **화면을 열어둔 모두**다 — 목록에서 누군가를
   * 기다리는 사람이 보이지 않으면 「아무도 없다」로 읽힌다.
   */
  'lobby:stats': (payload: { online: number; rooms: number }) => void

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
  /**
   * 방에 들어온 사람에게만. 새로고침해도 앞의 흐름이 남는다.
   *
   * `since` 는 이 방이 열린 시각이다. 방 번호는 네 자리라 닫힌 방의 번호가 다시 쓰일 수
   * 있는데, 번호만 보고 「같은 방」이라 여기면 창에 남은 옛 대화가 남의 새 방에 섞인다.
   */
  'chat:history': (payload: { messages: ChatMessage[]; since: number }) => void
  /**
   * 튜토리얼 안내. 스스로 사라지지 않는다 — 읽고 닫을 때까지 판이 멈춰 서 있다.
   *
   * 게임 알림(game:toast)과 다른 통로인 이유가 그것이다. 저쪽은 지나가는 소식이고
   * 이쪽은 사람이 닫아야 다음이 있다.
   */
  'tutorial:tip': (payload: {
    step: number
    total: number
    title: string
    text: string
    /** 읽고 나서 바로 할 일. 규칙만 알려주고 무엇을 누르라는 말이 없으면 거기서 멈춘다. */
    action: string
  }) => void
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
