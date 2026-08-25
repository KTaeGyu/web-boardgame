/**
 * 방 저장소. 상태는 전부 이 프로세스의 메모리에 있고 DB 는 없다.
 *
 * 소켓을 전혀 모른다. 그래야 네트워크 없이 규칙만 테스트할 수 있다.
 * 시간도 주입받는다 — 재접속 유예를 테스트하려면 시계를 마음대로 돌려야 한다.
 */

import {
  CHAT_KEEP,
  CHAT_MAX,
  DEFAULT_SETTINGS,
  GAME_MODES,
  MAX_PLAYERS_LIMIT,
  MIN_PLAYERS,
  READY_CHALLENGES,
  READY_SPECIALISTS,
  SPECIALIST_ROUNDS,
  displayNames,
  emptyRounds,
  nextHost as pickNextHost,
  type ErrorCode,
  type GameMode,
  type ChallengeId,
  type SpecialistId,
  type Result,
  type RoomPhase,
  type RoomSettings,
  type ChatMessage,
  type RoomSummary,
  type RoomView,
} from '@the-gang/shared'

/**
 * 끊긴 사람의 자리를 지켜주는 시간. 새로고침이나 잠깐의 전파 끊김을 흡수한다.
 *
 * 넉넉한 것은 사람이 휴대폰을 잠그거나 지하철에 들어가도 판이 이어지게 하려는 것이다.
 * 대신 그동안 판은 그 사람을 기다리며 멈춰 있다.
 */
export const DISCONNECT_GRACE_MS = 10 * 60_000

interface Player {
  id: string
  nickname: string
  connected: boolean
  disconnectedAt: number | null
  joinedAt: number
}

interface Room {
  code: string
  hostId: string
  /** 배열인 이유는 입장 순서를 유지하기 위해서다. 방장 인계가 이 순서를 따른다. */
  players: Player[]
  settings: RoomSettings
  phase: RoomPhase
  createdAt: number
  /** 마지막으로 누군가 무언가를 한 시각. 아무 일도 없는 방을 골라내는 기준이다. */
  lastActivityAt: number
  /** 지난 말. 방과 함께 살고 방과 함께 사라진다. */
  chat: ChatMessage[]
  /**
   * 이 방에서 몇 번째 말인가.
   *
   * 방마다 따로 센다. 저장소 전체에서 하나씩 올리면 옆 방 대화가 번호를 가져가,
   * 한 방 안에서도 번호가 띄엄띄엄해진다. 그러면 화면이 「번호가 안 이어진다」를
   * 「사이가 빠졌다」로 읽을 수 없다.
   */
  chatSeq: number
}

function err<T>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, code, message }
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export interface RoomStoreOptions {
  now?: () => number
  makeCode?: (taken: (code: string) => boolean) => string
  graceMs?: number
  maxRooms?: number
  idleMs?: number
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>()
  /** playerId → 방 코드. 사람은 한 번에 한 방에만 있는다. */
  private readonly whereIs = new Map<string, string>()
  private readonly now: () => number
  private readonly makeCode: (taken: (code: string) => boolean) => string
  private readonly graceMs: number
  private readonly maxRooms: number
  private readonly idleMs: number

  constructor(options: RoomStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.makeCode = options.makeCode ?? defaultCodeFactory
    this.graceMs = options.graceMs ?? DISCONNECT_GRACE_MS
    this.maxRooms = options.maxRooms ?? Number.POSITIVE_INFINITY
    this.idleMs = options.idleMs ?? Number.POSITIVE_INFINITY
  }

  createRoom(playerId: string, nickname: string): Result<RoomView> {
    if (this.rooms.size >= this.maxRooms) {
      return err('ROOM_LIMIT', '지금은 열려 있는 방이 많습니다. 잠시 뒤에 다시 시도해 주세요.')
    }
    this.leaveRoom(playerId) // 다른 방에 남아 있었다면 정리하고 시작한다
    const code = this.makeCode((candidate) => this.rooms.has(candidate))
    const now = this.now()
    const room: Room = {
      code,
      hostId: playerId,
      players: [{ id: playerId, nickname, connected: true, disconnectedAt: null, joinedAt: now }],
      settings: { ...DEFAULT_SETTINGS, pickedChallenges: [], specialistRounds: emptyRounds() },
      phase: 'lobby',
      createdAt: now,
      lastActivityAt: now,
      chat: [],
      chatSeq: 0,
    }
    this.rooms.set(code, room)
    this.whereIs.set(playerId, code)
    return ok(toView(room))
  }

  joinRoom(playerId: string, nickname: string, code: string): Result<RoomView> {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) return err('ROOM_NOT_FOUND', '없는 방입니다. 방 번호를 다시 확인해 주세요.')

    const existing = room.players.find((p) => p.id === playerId)
    if (existing) {
      // 같은 방에 다시 들어온 것은 입장이 아니라 재접속이다. 게임 중이어도 받아줘야 한다.
      existing.connected = true
      existing.disconnectedAt = null
      existing.nickname = nickname
      this.whereIs.set(playerId, room.code)
      return ok(toView(room))
    }

    if (room.phase !== 'lobby') return err('ROOM_IN_GAME', '이미 게임이 시작된 방입니다.')
    if (room.players.length >= room.settings.maxPlayers) return err('ROOM_FULL', '정원이 찼습니다.')

    this.leaveRoom(playerId)
    room.players.push({ id: playerId, nickname, connected: true, disconnectedAt: null, joinedAt: this.now() })
    this.whereIs.set(playerId, room.code)
    return ok(toView(room))
  }

  /** 스스로 나가는 경우. 끊김과 달리 유예 없이 즉시 자리를 비운다. */
  leaveRoom(playerId: string): { room: RoomView | null; closedCode: string | null } {
    const code = this.whereIs.get(playerId)
    if (!code) return { room: null, closedCode: null }
    this.whereIs.delete(playerId)

    const room = this.rooms.get(code)
    if (!room) return { room: null, closedCode: null }

    room.players = room.players.filter((p) => p.id !== playerId)
    if (room.players.length === 0) {
      this.rooms.delete(room.code)
      return { room: null, closedCode: room.code }
    }
    if (room.hostId === playerId) room.hostId = nextHost(room)
    return { room: toView(room), closedCode: null }
  }

  /**
   * 누군가 무언가를 했다. 방이 살아 있다는 표시다.
   *
   * 끊김 유예와 달리 이쪽은 「사람이 실제로 하고 있는가」를 본다.
   * 접속만 걸어두고 떠나면 아무리 연결이 멀쩡해도 방이 정리된다.
   */
  /**
   * 한 줄을 방에 남긴다. 빈 말과 너무 긴 말은 여기서 걸러 낸다.
   *
   * 이름은 저장하지 않고 남길 때 붙인다 — 자리에 붙는 이름과 같은 규칙(동명이인 구분)으로
   * 지어야 누가 한 말인지 이어지기 때문이다.
   */
  addChat(playerId: string, text: string): ChatMessage | null {
    const code = this.whereIs.get(playerId)
    const room = code ? this.rooms.get(code) : undefined
    if (!room) return null

    const index = room.players.findIndex((player) => player.id === playerId)
    if (index < 0) return null

    const trimmed = text.trim().slice(0, CHAT_MAX)
    if (!trimmed) return null

    const names = displayNames(room.players.map((player) => player.nickname))
    const message: ChatMessage = {
      id: (room.chatSeq += 1),
      playerId,
      name: names[index],
      text: trimmed,
      at: this.now(),
    }
    room.chat.push(message)
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP)
    return message
  }

  /** 방에 남아 있는 지난 말. 들어온 사람에게 한 번 건넨다. */
  chatOf(code: string | null): ChatMessage[] {
    const room = code ? this.rooms.get(code) : undefined
    return room ? [...room.chat] : []
  }

  touch(code: string | null): void {
    const room = code ? this.rooms.get(code.toUpperCase()) : undefined
    if (room) room.lastActivityAt = this.now()
  }

  /** 소켓이 끊겼을 뿐이다. 자리는 유예 시간 동안 남겨둔다. */
  markDisconnected(playerId: string): RoomView | null {
    const room = this.roomOf(playerId)
    const player = room?.players.find((p) => p.id === playerId)
    if (!room || !player) return null
    player.connected = false
    player.disconnectedAt = this.now()
    return toView(room)
  }

  /** 유예를 넘긴 자리와, 아무 일도 없는 방을 실제로 치운다. 소켓 계층이 주기적으로 부른다. */
  sweep(): { changed: RoomView[]; closedCodes: string[]; idleCodes: string[] } {
    const now = this.now()
    const deadline = now - this.graceMs
    const changed: RoomView[] = []
    const closedCodes: string[] = []
    const idleCodes: string[] = []

    // 아무도 아무것도 하지 않은 방부터 접는다. 남은 사람이 있어도 접는다.
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivityAt < this.idleMs) continue
      for (const player of room.players) this.whereIs.delete(player.id)
      this.rooms.delete(room.code)
      idleCodes.push(room.code)
    }

    for (const room of [...this.rooms.values()]) {
      const expired = room.players.filter(
        (p) => !p.connected && p.disconnectedAt !== null && p.disconnectedAt <= deadline,
      )
      if (expired.length === 0) continue

      for (const player of expired) this.whereIs.delete(player.id)
      const expiredIds = new Set(expired.map((p) => p.id))
      room.players = room.players.filter((p) => !expiredIds.has(p.id))

      if (room.players.length === 0) {
        this.rooms.delete(room.code)
        closedCodes.push(room.code)
        continue
      }
      if (expiredIds.has(room.hostId)) room.hostId = nextHost(room)
      changed.push(toView(room))
    }
    return { changed, closedCodes, idleCodes }
  }

  updateSettings(playerId: string, patch: Partial<RoomSettings>): Result<RoomView> {
    const room = this.roomOf(playerId)
    if (!room) return err('NOT_IN_ROOM', '방에 들어와 있지 않습니다.')
    if (room.hostId !== playerId) return err('NOT_HOST', '방장만 설정을 바꿀 수 있습니다.')

    const next: RoomSettings = { ...room.settings, ...patch }
    if (!GAME_MODES.includes(next.mode as GameMode)) return err('INVALID_SETTINGS', '알 수 없는 모드입니다.')
    if (!Number.isInteger(next.maxPlayers) || next.maxPlayers < MIN_PLAYERS || next.maxPlayers > MAX_PLAYERS_LIMIT) {
      return err('INVALID_SETTINGS', `최대 인원은 ${MIN_PLAYERS}~${MAX_PLAYERS_LIMIT}명입니다.`)
    }
    if (next.maxPlayers < room.players.length) {
      return err('INVALID_SETTINGS', '이미 들어와 있는 인원보다 적게 줄일 수 없습니다.')
    }
    if (next.pickedChallenges.some((id) => !READY_CHALLENGES.includes(id as ChallengeId))) {
      return err('INVALID_SETTINGS', '고를 수 없는 도전자 카드입니다.')
    }
    // 자리 하나가 판 하나다. 길이가 어긋나면 몇 번째 판인지가 통째로 밀린다.
    if (next.specialistRounds.length !== SPECIALIST_ROUNDS) {
      return err('INVALID_SETTINGS', '해결사 자리는 판마다 하나씩입니다.')
    }
    const placed = next.specialistRounds.filter((id): id is SpecialistId => id !== null)
    if (placed.some((id) => !READY_SPECIALISTS.includes(id))) {
      return err('INVALID_SETTINGS', '고를 수 없는 해결사 카드입니다.')
    }
    // 같은 카드가 여러 판에 서는 것은 막지 않는다. 「썼는가」는 판마다 새로 시작하므로
    // (Game.startHeist) 앞 판의 사용 여부가 뒤 판으로 새지 않는다.
    room.settings = {
      ...next,
      pickedChallenges: [...new Set(next.pickedChallenges)].sort((a, b) => a - b),
      // 정렬하지 않는다 — 여기서는 자리가 곧 뜻이다.
      specialistRounds: [...next.specialistRounds],
    }
    return ok(toView(room))
  }

  /** 방 목록. 접속 중인 사람이 하나도 없는 방은 보이지 않는다. */
  list(): RoomSummary[] {
    const summaries: RoomSummary[] = []
    for (const room of this.rooms.values()) {
      const connected = room.players.filter((p) => p.connected)
      if (connected.length === 0) continue
      const host = toView(room).players.find((p) => p.isHost)
      summaries.push({
        code: room.code,
        hostNickname: host?.displayName ?? '(알 수 없음)',
        playerCount: connected.length,
        maxPlayers: room.settings.maxPlayers,
        phase: room.phase,
      })
    }
    return summaries.sort((a, b) => a.code.localeCompare(b.code))
  }

  /** 게임 계층이 방의 단계를 옮긴다. 목록 노출과 입장 가능 여부가 여기에 달려 있다. */
  setPhase(code: string, phase: RoomPhase): RoomView | null {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) return null
    room.phase = phase
    return toView(room)
  }

  view(code: string): RoomView | null {
    const room = this.rooms.get(code.toUpperCase())
    return room ? toView(room) : null
  }

  codeOf(playerId: string): string | null {
    return this.whereIs.get(playerId) ?? null
  }

  get size(): number {
    return this.rooms.size
  }

  private roomOf(playerId: string): Room | undefined {
    const code = this.whereIs.get(playerId)
    return code ? this.rooms.get(code) : undefined
  }
}

function defaultCodeFactory(): string {
  throw new Error('RoomStore 에 makeCode 를 넘겨야 한다')
}

/** 규칙은 공용에 있다. 화면이 「누구에게 넘어갑니다」를 말할 때 같은 규칙을 쓴다. */
function nextHost(room: Room): string {
  const byJoin = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)
  const next = pickNextHost(byJoin)
  if (!next) throw new Error('남은 사람이 없는데 방장을 찾고 있다')
  return next.id
}

function toView(room: Room): RoomView {
  const names = displayNames(room.players.map((p) => p.nickname))
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map((p, index) => ({
      id: p.id,
      nickname: p.nickname,
      displayName: names[index],
      isHost: p.id === room.hostId,
      connected: p.connected,
    })),
    settings: {
      ...room.settings,
      pickedChallenges: [...room.settings.pickedChallenges],
      specialistRounds: [...room.settings.specialistRounds],
    },
    phase: room.phase,
  }
}
