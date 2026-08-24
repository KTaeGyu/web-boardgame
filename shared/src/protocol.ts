/**
 * 서버와 웹이 함께 쓰는 계약.
 *
 * 이벤트 이름과 페이로드를 한 곳에 두면, 규칙이 바뀔 때 어긋난 자리를
 * 타입 검사가 잡아준다. 이 파일이 서버와 화면 사이의 유일한 합의다.
 */

/** 방 설정. 지금은 기본값 고정으로 시작하고, UI 는 자리만 잡아둔다. */
export const GAME_MODES = ['basic', 'advanced', 'professional', 'masterThief'] as const
export type GameMode = (typeof GAME_MODES)[number]

export const GAME_MODE_LABEL: Record<GameMode, string> = {
  basic: '기본 모드',
  advanced: '고급 모드',
  professional: '프로 모드',
  masterThief: '마스터 시프 모드',
}

/** 원작의 챌린지 카드에 해당한다. 아직 게임 로직에 연결되지 않았다. */
export const PENALTIES = ['quickAccess', 'retinaScan', 'fingerprintScan'] as const
export type Penalty = (typeof PENALTIES)[number]

export const PENALTY_LABEL: Record<Penalty, string> = {
  quickAccess: '빠른 접근',
  retinaScan: '망막 스캔',
  fingerprintScan: '지문 스캔',
}

export const MIN_PLAYERS = 3
export const MAX_PLAYERS_LIMIT = 10

export interface RoomSettings {
  penalties: Penalty[]
  mode: GameMode
  maxPlayers: number
}

export const DEFAULT_SETTINGS: RoomSettings = {
  penalties: [],
  mode: 'basic',
  maxPlayers: 6,
}

export type RoomPhase = 'lobby' | 'playing' | 'result'

export interface PlayerView {
  id: string
  nickname: string
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
}

/** 서버 → 클라이언트. */
export interface ServerToClientEvents {
  'room:updated': (room: RoomView) => void
  'room:closed': (payload: { reason: 'empty' | 'hostClosed' }) => void
  'rooms:changed': (rooms: RoomSummary[]) => void
}

export const NICKNAME_MAX = 12

export function normalizeNickname(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0 || trimmed.length > NICKNAME_MAX) return null
  return trimmed
}
