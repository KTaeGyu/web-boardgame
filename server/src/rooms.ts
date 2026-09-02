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
  MAX_MARKS,
  MAX_PLAYERS_LIMIT,
  MAX_RANDOM_CHALLENGES,
  MAX_SPECTATORS_LIMIT,
  MIN_MARKS,
  MIN_PLAYERS,
  POKER_VARIANTS,
  VARIANTS,
  VARIANT_LABEL,
  READY_CHALLENGES,
  READY_SPECIALISTS,
  conflictsWith,
  displayNames,
  emptyRounds,
  maxHeists,
  nextHost as pickNextHost,
  type ErrorCode,
  type GameMode,
  type PokerVariant,
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
  /** 사람이 아니다. 튜토리얼에서만 앉는다. */
  bot?: boolean
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
   * 자리 없이 보고만 있는 사람들. 방을 살려두지 못한다 —
   * 자리에 앉은 사람이 하나도 없으면 관전자가 남아 있어도 방은 닫힌다.
   */
  spectators: { id: string; nickname: string }[]
  /**
   * 내보내진 사람들. 방이 사라지면 함께 사라진다 — 영구 차단이 아니라 이 방에서만이다.
   * 이것이 없으면 내보내도 번호만 다시 치면 들어와, 내보내기가 뜻을 잃는다.
   */
  banned: Set<string>
  /**
   * 혼자 해보는 방인가. 목록에 뜨지 않고, 사람이 빠지면 그대로 닫힌다.
   * 봇만 남은 방은 아무도 없는 방이지만 인원이 0 이 아니라 저절로 닫히지 않는다.
   */
  tutorial: boolean
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

/** 화면이 보내온 수. 정수가 아니면 범위를 볼 것도 없다. */
function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/** 배치표를 자리 수에 맞춘다. 모자라면 빈칸으로 채우고, 남으면 뒤를 버린다. */
function fitRounds(rounds: readonly (SpecialistId | null)[], slots: number): (SpecialistId | null)[] {
  return Array.from({ length: slots }, (_, index) => rounds[index] ?? null)
}

/** 배치표 맨 윗줄(무작위)도 같은 길이로 맞춘다. */
function fitFlags(flags: readonly boolean[], slots: number): boolean[] {
  return Array.from({ length: slots }, (_, index) => flags[index] === true)
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
      tutorial: false,
      banned: new Set(),
      spectators: [],
    }
    this.rooms.set(code, room)
    this.whereIs.set(playerId, code)
    return ok(toView(room))
  }

  /**
   * 혼자 해보는 방. 봇이 함께 앉은 채로 만들어진다.
   *
   * 보통 방과 갈라 두는 것은 「사람이 아닌 자리」가 규칙에 끼어들기 때문이다 —
   * 목록에 뜨면 남이 들어오고, 사람이 나가도 봇 때문에 방이 닫히지 않는다.
   */
  createTutorialRoom(playerId: string, nickname: string, bots: { id: string; nickname: string }[]): Result<RoomView> {
    const created = this.createRoom(playerId, nickname)
    if (!created.ok) return created

    const room = this.rooms.get(created.value.code)
    if (!room) return err('ROOM_NOT_FOUND', '방을 만들지 못했습니다.')

    room.tutorial = true
    const now = this.now()
    for (const bot of bots) {
      room.players.push({ ...bot, connected: true, disconnectedAt: null, joinedAt: now, bot: true })
    }
    room.settings = { ...room.settings, mode: 'basic', maxPlayers: room.players.length }
    return ok(toView(room))
  }

  /**
   * 자리 없이 보기만 한다.
   *
   * 판이 도는 방에만 들어간다 — 대기실은 볼 것이 없고, 들어갈 거면 자리에 앉으면 된다.
   */
  spectate(playerId: string, nickname: string, code: string): Result<RoomView> {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) return err('ROOM_NOT_FOUND', '없는 방입니다. 방 번호를 다시 확인해 주세요.')
    if (room.tutorial) return err('ROOM_NOT_FOUND', '없는 방입니다. 방 번호를 다시 확인해 주세요.')
    if (room.banned.has(playerId)) return err('ROOM_NOT_FOUND', '이 방에는 다시 들어갈 수 없습니다.')

    const seated = room.players.find((player) => player.id === playerId)
    if (seated) {
      /*
       * 앉아 있던 사람이 스스로 물러나는 길. 대기실에서만 열어 둔다 —
       * 판이 도는 중에 자리가 비면 라운드가 끝나지 않아 판이 통째로 접힌다.
       */
      if (room.phase !== 'lobby') {
        return err('WRONG_PHASE', '판이 도는 중에는 관전으로 바꿀 수 없습니다.')
      }
      if (room.players.length <= 1) {
        return err('INVALID_SETTINGS', '혼자 있는 방에서는 관전으로 바꿀 수 없습니다.')
      }
    }

    const watching = room.spectators.some((watcher) => watcher.id === playerId)
    // 몇 자리를 열어둘지는 방장이 정한다. 0 이면 아예 받지 않는다.
    if (!watching && room.spectators.length >= room.settings.maxSpectators) {
      return err(
        'ROOM_FULL',
        room.settings.maxSpectators === 0
          ? '이 방은 관전을 받지 않습니다.'
          : `관전은 ${room.settings.maxSpectators}명까지입니다.`,
      )
    }

    // 다른 방에 앉아 있었다면 그 자리를 먼저 비운다. 한 사람은 한 번에 한 방에만 있는다.
    if (this.whereIs.get(playerId) !== room.code) this.leaveRoom(playerId)

    if (seated) {
      room.players = room.players.filter((player) => player.id !== playerId)
      // 방장이 물러났으면 자리에 앉아 있는 사람에게 넘긴다. 구경꾼은 방장이 될 수 없다.
      if (room.hostId === playerId) room.hostId = nextHost(room)
    }

    const already = room.spectators.find((watcher) => watcher.id === playerId)
    if (already) already.nickname = nickname
    else room.spectators.push({ id: playerId, nickname })

    this.whereIs.set(playerId, room.code)
    room.lastActivityAt = this.now()
    return ok(toView(room))
  }

  /** 자리 없이 보고 있는 중인가. 소켓 계층이 자리 처리와 갈라 쓴다. */
  isSpectator(playerId: string): boolean {
    const room = this.roomOf(playerId)
    return room ? room.spectators.some((watcher) => watcher.id === playerId) : false
  }

  /**
   * 한 사람을 내보낸다. 길이 둘이다.
   *
   * **방장이 내보내는 길** — 나가기와 같은 처리를 하되, 차단을 고르면 그 사람만
   * 다시 못 들어오게 표시를 남긴다.
   *
   * **자리를 비운 방장을 넘겨받는 길**(2026-08-31) — 방장의 소켓이 끊기면 「자리 비움」이
   * 붙고, 유예 10분이 지나야 자리가 치워지며 방장이 넘어간다. 그동안 방이 멈춘다 —
   * 시작은 전원이 있어야 하고 설정은 방장만 바꾸므로, 남은 사람들이 할 수 있는 일이
   * 없다. 그래서 **자리를 비운 방장은 앉아 있는 누구나 내보낼 수 있고, 먼저 부른 사람이
   * 방장을 가진다.**
   *
   * 이 길에서는 차단을 받지 않는다. 영영 못 들어오게 하는 것은 방을 넘겨받는 것과 다른
   * 이야기이고, 자리를 비운 사람은 그 자리에서 반박할 수 없다.
   *
   * 대기실에서만 허용하는 판단은 소켓 계층이 한다 — 여기서는 방의 규칙만 본다.
   */
  kick(byId: string, targetId: string, ban = false): Result<RoomView> {
    const code = this.whereIs.get(byId)
    const room = code ? this.rooms.get(code) : undefined
    if (!room) return err('NOT_IN_ROOM', '방에 들어와 있지 않습니다.')
    if (targetId === byId) return err('INVALID_SETTINGS', '자기 자신은 내보낼 수 없습니다.')

    const target = room.players.find((player) => player.id === targetId)
    if (!target) return err('NOT_IN_ROOM', '그 사람은 이 방에 없습니다.')

    const iAmHost = room.hostId === byId
    /*
     * 넘겨받는 길인가. 앉아 있는 사람이어야 한다 — 구경꾼은 「인원」이 아니고,
     * 애초에 방장이 될 수 없다(관전으로 물러날 때 방장을 내려놓는 것과 같은 규칙).
     */
    const seated = room.players.some((player) => player.id === byId)
    const takeover = !iAmHost && seated && targetId === room.hostId && !target.connected
    if (!iAmHost && !takeover) {
      return err('NOT_HOST', '방장만 내보낼 수 있습니다. 자리를 비운 방장은 누구나 내보낼 수 있습니다.')
    }

    // 차단은 고른 사람만 받는다. 그냥 내보내면 번호를 알면 다시 들어올 수 있다.
    if (ban && !takeover) room.banned.add(targetId)
    this.whereIs.delete(targetId)
    room.players = room.players.filter((player) => player.id !== targetId)
    // 넘겨받는 길에서는 입장 순서가 아니라 「먼저 부른 사람」이 방장이 된다.
    if (takeover) room.hostId = byId
    room.lastActivityAt = this.now()
    return ok(toView(room))
  }

  /** 이 방이 혼자 해보는 방인가. 소켓 계층이 봇을 움직일지 판단한다. */
  isTutorial(code: string | null): boolean {
    return code ? (this.rooms.get(code)?.tutorial ?? false) : false
  }

  /** 봇이 아닌 자리들. 「아무도 없는 방」을 가릴 때 쓴다. */
  humanIds(code: string | null): string[] {
    const room = code ? this.rooms.get(code) : undefined
    return room ? room.players.filter((player) => !player.bot).map((player) => player.id) : []
  }

  joinRoom(playerId: string, nickname: string, code: string): Result<RoomView> {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) return err('ROOM_NOT_FOUND', '없는 방입니다. 방 번호를 다시 확인해 주세요.')
    if (room.banned.has(playerId)) {
      return err('ROOM_NOT_FOUND', '이 방에는 다시 들어갈 수 없습니다.')
    }

    // 보고 있던 사람이 자리에 앉으러 왔다. 두 곳에 동시에 있을 수는 없다.
    room.spectators = room.spectators.filter((watcher) => watcher.id !== playerId)

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

    // 보고만 있던 사람은 자리를 비우는 것이 아니다. 방은 그대로 두고 목록에서만 뺀다.
    const watching = room.spectators.some((watcher) => watcher.id === playerId)
    if (watching) {
      room.spectators = room.spectators.filter((watcher) => watcher.id !== playerId)
      return { room: toView(room), closedCode: null }
    }

    room.players = room.players.filter((p) => p.id !== playerId)
    // 봇만 남은 방은 아무도 없는 방이다. 인원이 0 이 아니라 저절로 닫히지 않으므로 여기서 닫는다.
    if (room.players.length === 0 || (room.tutorial && !room.players.some((p) => !p.bot))) {
      for (const left of [...room.players, ...room.spectators]) this.whereIs.delete(left.id)
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
    const watcher = index < 0 ? room.spectators.find((one) => one.id === playerId) : null
    if (index < 0 && !watcher) return null

    const trimmed = text.trim().slice(0, CHAT_MAX)
    if (!trimmed) return null

    // 앉은 사람의 이름은 자리에 붙는 것과 같은 규칙으로 짓는다. 관전자는 그 규칙 밖이라
    // 자기 닉네임 그대로 쓰고, 대신 관전이라는 표시를 달아 보낸다.
    const names = displayNames(room.players.map((player) => player.nickname))
    const message: ChatMessage = {
      id: (room.chatSeq += 1),
      playerId,
      name: watcher ? watcher.nickname : names[index],
      text: trimmed,
      at: this.now(),
      ...(watcher ? { spectator: true } : {}),
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

  /**
   * 이 방이 열린 시각.
   *
   * 번호가 같아도 다른 방일 수 있다 — 닫힌 방의 번호는 다시 쓰인다. 창이 들고 있는
   * 옛 대화가 남의 방에 섞이지 않으려면 번호 말고 하나가 더 필요하다.
   */
  openedAt(code: string | null): number {
    const room = code ? this.rooms.get(code) : undefined
    return room ? room.createdAt : 0
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
      for (const left of [...room.players, ...room.spectators]) this.whereIs.delete(left.id)
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

      if (room.players.length === 0 || (room.tutorial && !room.players.some((p) => !p.bot))) {
        for (const left of room.players) this.whereIs.delete(left.id)
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
    if (!POKER_VARIANTS.includes(next.variant as PokerVariant)) {
      return err('INVALID_SETTINGS', '알 수 없는 포커 방식입니다.')
    }
    /*
     * 변형마다 정원이 다르다. 취향이 아니라 덱 52장의 산수다 — 자세한 계산은
     * shared/src/variants.ts 머리말에 있다.
     *
     * 이미 앉아 있는 사람보다 적은 정원의 변형으로는 바꿀 수 없다. 바꾸는 것이 곧
     * 내보내는 것이 되면, 설정 한 칸이 사람을 쫓아내는 단추가 된다.
     */
    const seatLimit = VARIANTS[next.variant].maxSeats
    if (room.players.length > seatLimit) {
      return err(
        'INVALID_SETTINGS',
        `${VARIANT_LABEL[next.variant]}는 ${seatLimit}명까지입니다. 지금 ${room.players.length}명이 앉아 있습니다.`,
      )
    }
    if (!Number.isInteger(next.maxPlayers) || next.maxPlayers < MIN_PLAYERS || next.maxPlayers > MAX_PLAYERS_LIMIT) {
      return err('INVALID_SETTINGS', `최대 인원은 ${MIN_PLAYERS}~${MAX_PLAYERS_LIMIT}명입니다.`)
    }
    if (next.maxPlayers < room.players.length) {
      return err('INVALID_SETTINGS', '이미 들어와 있는 인원보다 적게 줄일 수 없습니다.')
    }
    /*
     * 정원이 변형의 상한을 넘으면 되돌려보내지 않고 여기서 깎는다.
     *
     * 해결사 자리 수를 승·패 수에 맞추는 것(fitRounds)과 같은 판단이다 — 방장은
     * 「오마하로 바꾸겠다」고 했지 「정원을 먼저 8로 줄이고 오마하로 바꾸겠다」고 하지 않았다.
     */
    const maxPlayers = Math.min(next.maxPlayers, seatLimit)
    if (!inRange(next.maxSpectators, 0, MAX_SPECTATORS_LIMIT)) {
      return err('INVALID_SETTINGS', `관전은 0~${MAX_SPECTATORS_LIMIT}명입니다.`)
    }
    /*
     * 이미 보고 있는 사람보다 적게 줄이지 않는다. 자리에 앉은 사람과 같은 규칙이다 —
     * 줄이는 것이 곧 내보내는 것이 되면, 설정 한 칸이 사람을 쫓아내는 단추가 된다.
     */
    if (next.maxSpectators < room.spectators.length) {
      return err('INVALID_SETTINGS', '이미 보고 있는 사람보다 적게 줄일 수 없습니다.')
    }
    if (next.pickedChallenges.some((id) => !READY_CHALLENGES.includes(id as ChallengeId))) {
      return err('INVALID_SETTINGS', '고를 수 없는 도전자 카드입니다.')
    }
    /*
     * 함께 걸면 서로 어긋나는 짝이 있다.
     *
     * 화면이 이미 막고 있지만 여기서도 본다 — 계약은 방에 있지 화면에 있지 않다.
     */
    const together = [...new Set(next.pickedChallenges)] as ChallengeId[]
    if (together.some((id) => conflictsWith(id).some((other) => together.includes(other)))) {
      return err('INVALID_SETTINGS', '「빠른 접근」과 감지기(동작·레이저)는 함께 걸 수 없습니다.')
    }
    if (!inRange(next.randomChallenges, 0, MAX_RANDOM_CHALLENGES)) {
      return err('INVALID_SETTINGS', `무작위 도전자는 0~${MAX_RANDOM_CHALLENGES}장입니다.`)
    }
    if (!inRange(next.vaultsToWin, MIN_MARKS, MAX_MARKS) || !inRange(next.alarmsToLose, MIN_MARKS, MAX_MARKS)) {
      return err('INVALID_SETTINGS', `금고와 경보는 ${MIN_MARKS}~${MAX_MARKS} 사이입니다.`)
    }

    /*
     * 해결사 자리 수는 승·패 수에서 나온다(승 + 패 - 1).
     *
     * 그래서 금고나 경보를 바꾸면 자리 수도 함께 바뀐다 — 그때는 표를 다시 보내라고
     * 하는 대신 여기서 길이를 맞춘다. 늘어난 자리는 비어 있고, 줄어든 자리에 서 있던
     * 해결사는 사라진다. 없어질 판에 서 있던 카드라 남겨둘 자리가 없다.
     */
    const slots = maxHeists(next.vaultsToWin, next.alarmsToLose)
    if (patch.specialistRounds !== undefined && patch.specialistRounds.length !== slots) {
      return err('INVALID_SETTINGS', '해결사 자리는 판마다 하나씩입니다.')
    }
    if (patch.specialistRandomRounds !== undefined && patch.specialistRandomRounds.length !== slots) {
      return err('INVALID_SETTINGS', '해결사 자리는 판마다 하나씩입니다.')
    }
    const rounds = fitRounds(next.specialistRounds, slots)
    const randomRounds = fitFlags(next.specialistRandomRounds, slots)
    /*
     * 한 판에 해결사는 하나뿐이다. 무작위를 찍은 판에는 지정 카드가 서 있을 수 없다 —
     * 표가 그것을 막지만, 계약은 방에 있지 화면에 있지 않다.
     */
    for (const [at, random] of randomRounds.entries()) {
      if (random) rounds[at] = null
    }
    const placed = rounds.filter((id): id is SpecialistId => id !== null)
    if (placed.some((id) => !READY_SPECIALISTS.includes(id))) {
      return err('INVALID_SETTINGS', '고를 수 없는 해결사 카드입니다.')
    }
    // 같은 카드가 여러 판에 서는 것은 막지 않는다. 「썼는가」는 판마다 새로 시작하므로
    // (Game.startHeist) 앞 판의 사용 여부가 뒤 판으로 새지 않는다.
    room.settings = {
      ...next,
      maxPlayers,
      pickedChallenges: [...new Set(next.pickedChallenges)].sort((a, b) => a - b),
      // 정렬하지 않는다 — 여기서는 자리가 곧 뜻이다.
      specialistRounds: rounds,
      specialistRandomRounds: randomRounds,
    }
    return ok(toView(room))
  }

  /**
   * 방 목록. 접속 중인 사람이 하나도 없는 방은 보이지 않는다.
   *
   * **인원은 자리로 센다.** 끊긴 사람의 자리는 유예 시간 동안 지켜지므로 남이 앉을 수
   * 없는데, 접속 중인 수만 세면 목록이 「2 / 3」이라 말해 놓고 joinRoom 은 그 자리에서
   * 「정원이 찼습니다」로 돌려보낸다. 두 셈이 갈리면 화면이 거짓말을 한다.
   *
   * 「보이지 않는다」의 기준만 접속 중인 수다. 아무도 붙어 있지 않은 방은 아직 자리가
   * 남아 있어도 부를 사람이 없다.
   */
  list(): RoomSummary[] {
    const summaries: RoomSummary[] = []
    for (const room of this.rooms.values()) {
      // 혼자 해보는 방은 남이 들어올 자리가 아니다.
      if (room.tutorial) continue
      const connected = room.players.filter((p) => p.connected)
      if (connected.length === 0) continue
      const host = toView(room).players.find((p) => p.isHost)
      summaries.push({
        code: room.code,
        hostNickname: host?.displayName ?? '(알 수 없음)',
        playerCount: room.players.length,
        awayCount: room.players.length - connected.length,
        maxPlayers: room.settings.maxPlayers,
        phase: room.phase,
        spectatorCount: room.spectators.length,
        maxSpectators: room.settings.maxSpectators,
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
    tutorial: room.tutorial,
    spectators: room.spectators.map((watcher) => ({ ...watcher })),
  }
}
