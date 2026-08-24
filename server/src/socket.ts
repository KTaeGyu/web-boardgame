/**
 * 소켓 배선. 규칙은 RoomStore 와 Game 이 갖고, 여기서는 누가 무엇을 듣는지만 정한다.
 *
 * 요청/응답은 전부 ack 콜백으로 돌려준다. 실패도 예외가 아니라 값으로 오므로
 * 화면이 사유별로 다르게 안내할 수 있다.
 */

import type { Server, Socket } from 'socket.io'
import {
  MIN_PLAYERS,
  TOKEN_LOCK_MS,
  type ClientToServerEvents,
  type GameView,
  type Identity,
  type Result,
  type RoomSettings,
  type RoomView,
  type ServerToClientEvents,
  normalizeNickname,
} from '@the-gang/shared'

import { IDLE_ROOM_MS, MAX_CONNECTIONS, MAX_ROOMS, SWEEP_INTERVAL_MS } from './config.ts'
import { Game } from './game.ts'
import { uniqueRoomCode } from './ids.ts'
import { RoomStore } from './rooms.ts'

/** 방 목록 페이지를 보고 있는 소켓들이 모여 있는 곳. 목록이 바뀔 때만 쏜다. */
const LOBBY_WATCHERS = 'lobby-watchers'

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>

const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

function fail<T>(message: string): Result<T> {
  return { ok: false, code: 'INVALID_NICKNAME', message }
}

/** playerId 는 브라우저가 만들어 보내는 값이므로 형태를 확인한다. */
function readIdentity(payload: Identity): Result<{ playerId: string; nickname: string }> {
  if (typeof payload?.playerId !== 'string' || !PLAYER_ID_PATTERN.test(payload.playerId)) {
    return fail('접속 정보가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.')
  }
  const nickname = normalizeNickname(String(payload.nickname ?? ''))
  if (!nickname) return fail('닉네임은 1~12자로 입력해 주세요.')
  return { ok: true, value: { playerId: payload.playerId, nickname } }
}

export interface ServerLimits {
  maxConnections?: number
  maxRooms?: number
  idleMs?: number
}

export function attachGameServer(io: GameServer, limits: ServerLimits = {}): { store: RoomStore; stop: () => void } {
  const maxConnections = limits.maxConnections ?? MAX_CONNECTIONS
  const store = new RoomStore({
    makeCode: uniqueRoomCode,
    maxRooms: limits.maxRooms ?? MAX_ROOMS,
    idleMs: limits.idleMs ?? IDLE_ROOM_MS,
  })
  /** 방 코드 → 진행 중인 판. 방 하나에 판 하나다. */
  const games = new Map<string, Game>()
  /** 소켓 하나가 사람 하나를 대변한다. 양방향으로 들고 있어야 개인 정보를 골라 보낼 수 있다. */
  const playerOfSocket = new Map<string, string>()
  const socketOfPlayer = new Map<string, string>()
  /** 잠금이 풀리는 시점에 상태를 한 번 더 쏘기 위한 타이머. */
  const unlockTimers = new Map<string, NodeJS.Timeout>()

  const sendRoom = (room: RoomView) => io.to(room.code).emit('room:updated', room)
  const sendRoomList = () => io.to(LOBBY_WATCHERS).emit('rooms:changed', store.list())

  const announce = (room: RoomView | null) => {
    if (room) sendRoom(room)
    sendRoomList()
  }

  /** 공개 상태는 방 전체에, 손패는 각자에게. 이 구분이 게임의 전부다. */
  function sendGame(code: string, options: { hands?: boolean } = {}): void {
    const game = games.get(code)
    if (!game) return

    const view = game.view()
    io.to(code).emit('game:state', view)

    if (options.hands) {
      for (const player of view.players) sendHand(code, player.id)
    }
    scheduleUnlock(code, view)
  }

  function sendHand(code: string, playerId: string): void {
    const game = games.get(code)
    const socketId = socketOfPlayer.get(playerId)
    const hole = game?.handOf(playerId)
    if (!game || !socketId || !hole) return
    io.to(socketId).emit('game:hand', { heist: game.view().heist, hole })
  }

  /**
   * 토큰 잠금은 시간이 지나면 저절로 풀리지만, 아무도 그 사실을 알려주지 않으면
   * 화면에는 계속 잠긴 채로 남는다. 풀리는 시점에 상태를 한 번 더 보낸다.
   */
  function scheduleUnlock(code: string, view: GameView): void {
    if (view.lockedTokens.length === 0) return
    if (unlockTimers.has(code)) return

    const timer = setTimeout(() => {
      unlockTimers.delete(code)
      const game = games.get(code)
      if (!game) return
      const next = game.view()
      io.to(code).emit('game:state', next)
      scheduleUnlock(code, next)
    }, TOKEN_LOCK_MS + 20)
    timer.unref()
    unlockTimers.set(code, timer)
  }

  /** 방이 사라졌다. 딸려 있던 판과 타이머도 함께 정리한다. */
  function forgetRoom(code: string): void {
    games.delete(code)
    clearTimeout(unlockTimers.get(code))
    unlockTimers.delete(code)
  }

  /** 사람이 빠지면 판을 이어갈 수 없다. 판을 접고 방은 대기실로 되돌린다. */
  function abortGame(code: string, message: string): void {
    if (!games.has(code)) return
    forgetRoom(code)
    io.to(code).emit('game:aborted', { reason: 'playerLeft', message })
    announce(store.setPhase(code, 'lobby'))
  }

  io.on('connection', (socket: GameSocket) => {
    // 한도를 넘겼으면 방에 들어가기 전에 돌려보낸다. 이미 놀고 있는 사람을 밀어내지는 않는다.
    if (io.engine.clientsCount > maxConnections) {
      socket.emit('server:full', {
        message: '지금은 접속이 많습니다. 잠시 뒤에 다시 시도해 주세요.',
      })
      socket.disconnect(true)
      return
    }

    socket.on('room:create', (payload, ack) => {
      const identity = readIdentity(payload)
      if (!identity.ok) return ack(identity)

      const { playerId, nickname } = identity.value
      const previous = store.codeOf(playerId)
      const result = store.createRoom(playerId, nickname)
      if (!result.ok) return ack(result)

      if (previous) leftRoom(previous, playerId)
      bind(socket, playerId, result.value.code)
      ack(result)
      sendRoomList()
    })

    socket.on('room:join', (payload, ack) => {
      const identity = readIdentity(payload)
      if (!identity.ok) return ack(identity)
      if (typeof payload.code !== 'string' || payload.code.trim() === '') {
        return ack({ ok: false, code: 'ROOM_NOT_FOUND', message: '방 번호를 입력해 주세요.' })
      }

      const { playerId, nickname } = identity.value
      const previous = store.codeOf(playerId)
      const result = store.joinRoom(playerId, nickname, payload.code.trim())
      if (!result.ok) return ack(result)

      const code = result.value.code
      if (previous && previous !== code) leftRoom(previous, playerId)
      store.touch(code)
      bind(socket, playerId, code)
      ack(result)
      announce(result.value)

      // 판이 도는 중에 돌아온 것이라면 자리와 손패를 되돌려준다.
      const game = games.get(code)
      if (game) {
        game.setConnected(playerId, true)
        sendGame(code)
        sendHand(code, playerId)
      }
    })

    socket.on('room:leave', (ack) => {
      const playerId = playerOfSocket.get(socket.id)
      if (!playerId) return ack({ ok: true, value: null })

      const code = store.codeOf(playerId)
      const { room, closedCode } = store.leaveRoom(playerId)
      if (code) socket.leave(code)
      unbind(socket.id, playerId)

      ack({ ok: true, value: null })
      if (code) leftRoom(code, playerId)
      if (closedCode) io.to(closedCode).emit('room:closed', { reason: 'empty' })
      announce(room)
    })

    socket.on('room:list', (ack) => ack({ ok: true, value: store.list() }))

    socket.on('rooms:watch', ({ watching }) => {
      if (watching) {
        socket.join(LOBBY_WATCHERS)
        socket.emit('rooms:changed', store.list())
      } else {
        socket.leave(LOBBY_WATCHERS)
      }
    })

    socket.on('room:settings', (patch: Partial<RoomSettings>, ack) => {
      const playerId = playerOfSocket.get(socket.id)
      if (!playerId) return ack({ ok: false, code: 'NOT_IN_ROOM', message: '방에 들어와 있지 않습니다.' })

      store.touch(store.codeOf(playerId))
      const result = store.updateSettings(playerId, patch ?? {})
      ack(result)
      if (result.ok) announce(result.value)
    })

    // ── 게임 ────────────────────────────────────────────

    socket.on('game:start', (ack) => {
      const playerId = playerOfSocket.get(socket.id)
      const code = playerId ? store.codeOf(playerId) : null
      const room = code ? store.view(code) : null
      if (!playerId || !code || !room) {
        return ack({ ok: false, code: 'NOT_IN_ROOM', message: '방에 들어와 있지 않습니다.' })
      }
      if (room.hostId !== playerId) {
        return ack({ ok: false, code: 'NOT_HOST', message: '방장만 시작할 수 있습니다.' })
      }
      if (games.has(code) || room.phase !== 'lobby') {
        return ack({ ok: false, code: 'ALREADY_STARTED', message: '이미 진행 중입니다.' })
      }
      if (room.players.length < MIN_PLAYERS) {
        return ack({
          ok: false,
          code: 'NOT_ENOUGH_PLAYERS',
          message: `${MIN_PLAYERS}명부터 시작할 수 있습니다.`,
        })
      }
      // 고르는 중에는 설정을 저장할 수 있게 두고, 시작하는 순간에 막는다.
      if (room.settings.mode === 'custom' && room.settings.pickedChallenges.length === 0) {
        return ack({
          ok: false,
          code: 'INVALID_SETTINGS',
          message: '직접 고르기에서는 도전자 카드를 하나 이상 골라 주세요.',
        })
      }
      if (room.players.some((player) => !player.connected)) {
        return ack({
          ok: false,
          code: 'PLAYER_AWAY',
          message: '자리를 비운 사람이 있습니다. 돌아오기를 기다려 주세요.',
        })
      }

      store.touch(code)
      const game = new Game(
        code,
        room.players.map((p) => ({ ...p })),
        { mode: room.settings.mode, pickedChallenges: room.settings.pickedChallenges },
      )
      games.set(code, game)
      announce(store.setPhase(code, 'playing'))
      ack({ ok: true, value: game.view() })
      sendGame(code, { hands: true })
    })

    socket.on('game:take', ({ token }, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.takeToken(playerId, Number(token))
        ack(result)
        if (result.ok) sendGame(code)
      })
    })

    socket.on('game:ready', ({ ready }, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.setReady(playerId, Boolean(ready))
        ack(result)
        // 라운드가 넘어가도 손패는 그대로다. 새로 깔린 커뮤니티 카드는 공개 상태에 실린다.
        if (result.ok) sendGame(code)
      })
    })

    socket.on('game:continue', (ack) => {
      withGame(ack, (game, code, playerId) => {
        const before = game.view().heist
        const result = game.continueAfterHeist(playerId)
        ack(result)
        if (!result.ok) return
        // 새 판이 시작됐다면 모두에게 새 손패를 돌린다.
        sendGame(code, { hands: game.view().heist !== before })
      })
    })

    /** 카드가 한 사람에게만 알려주는 것은 그 사람 소켓으로만 간다. */
    function deliver(notes: { toId: string; heist: number; specialist: number; title: string; text?: string; cards?: string[] }[]) {
      for (const note of notes) {
        const socketId = socketOfPlayer.get(note.toId)
        if (!socketId) continue
        io.to(socketId).emit('game:note', {
          heist: note.heist,
          specialist: note.specialist,
          title: note.title,
          text: note.text,
          cards: note.cards as never,
        })
      }
    }

    socket.on('game:setupCard', ({ cardIndex }, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.submitSetup(playerId, cardIndex)
        if (!result.ok) return ack(result)
        ack({ ok: true, value: null })
        deliver(result.value.notes)
        // 카드가 오갔으면 손패도 새로 보내야 한다.
        sendGame(code, { hands: result.value.notes.length > 0 })
      })
    })

    socket.on('game:discard', ({ cardIndex }, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.discard(playerId, Number(cardIndex))
        if (!result.ok) return ack(result)
        ack({ ok: true, value: null })
        if (result.value.note) deliver([result.value.note])
        sendGame(code)
        sendHand(code, playerId)
      })
    })

    socket.on('game:scanVote', ({ value }, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.voteScan(playerId, Number(value))
        ack(result)
        if (result.ok) sendGame(code)
      })
    })

    socket.on('game:useSpecialist', (payload, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.useSpecialist(playerId, payload ?? {})
        if (!result.ok) return ack(result)
        ack({ ok: true, value: null })

        if (result.value.note) deliver([result.value.note])
        sendGame(code)
        // 「해커」·「잭」은 손패가 늘어난다. 쓴 사람에게 새 손패를 보낸다.
        sendHand(code, playerId)
      })
    })

    socket.on('game:rematch', ({ agree }, ack) => {
      withGame(ack, (game, code, playerId) => {
        const result = game.proposeRematch(playerId, Boolean(agree))
        if (!result.ok) return ack(result)
        ack({ ok: true, value: null })

        if (result.value === 'declined') {
          // 한 명이라도 거절하면 방을 접는다. 남은 사람끼리 어색하게 기다리지 않도록.
          games.delete(code)
          clearTimeout(unlockTimers.get(code))
          unlockTimers.delete(code)
          io.to(code).emit('room:closed', { reason: 'rematchDeclined' })
          return
        }
        if (result.value === 'restart') announce(store.setPhase(code, 'playing'))
        sendGame(code, { hands: result.value === 'restart' })
      })
    })

    socket.on('disconnect', () => {
      const playerId = playerOfSocket.get(socket.id)
      unbind(socket.id, playerId)
      if (!playerId) return

      const code = store.codeOf(playerId)
      // 나간 것이 아니라 끊긴 것이다. 자리는 유예 시간 동안 지켜준다.
      announce(store.markDisconnected(playerId))
      if (code) {
        games.get(code)?.setConnected(playerId, false)
        sendGame(code)
      }
    })

    /** 게임 이벤트가 공통으로 밟는 확인 절차. */
    function withGame(
      ack: (result: Result<null>) => void,
      run: (game: Game, code: string, playerId: string) => void,
    ): void {
      const playerId = playerOfSocket.get(socket.id)
      const code = playerId ? store.codeOf(playerId) : null
      const game = code ? games.get(code) : null
      if (!playerId || !code || !game) {
        return ack({ ok: false, code: 'GAME_NOT_RUNNING', message: '진행 중인 판이 없습니다.' })
      }
      store.touch(code)
      run(game, code, playerId)
    }
  })

  /** 누군가 방에서 빠졌다. 판이 돌고 있었다면 이어갈 수 없다. */
  function leftRoom(code: string, playerId: string): void {
    const game = games.get(code)
    if (!game) return
    const seat = game.view().players.find((player) => player.id === playerId)
    if (!seat) return
    abortGame(code, `${seat.displayName}님이 나가서 판을 이어갈 수 없습니다.`)
  }

  function bind(socket: GameSocket, playerId: string, code: string) {
    // 같은 사람이 다른 탭에서 붙었다면 이전 소켓의 연결 고리를 끊는다.
    const stale = socketOfPlayer.get(playerId)
    if (stale && stale !== socket.id) playerOfSocket.delete(stale)

    playerOfSocket.set(socket.id, playerId)
    socketOfPlayer.set(playerId, socket.id)
    socket.join(code)
    socket.leave(LOBBY_WATCHERS)
  }

  function unbind(socketId: string, playerId: string | undefined) {
    playerOfSocket.delete(socketId)
    if (playerId && socketOfPlayer.get(playerId) === socketId) socketOfPlayer.delete(playerId)
  }

  const sweeper = setInterval(() => {
    const { changed, closedCodes, idleCodes } = store.sweep()
    for (const room of changed) {
      sendRoom(room)
      // 유예를 넘겨 자리가 비었다. 판이 돌고 있었다면 여기서 접는다.
      const game = games.get(room.code)
      if (game) {
        const missing = game.view().players.find((seat) => !room.players.some((p) => p.id === seat.id))
        if (missing) abortGame(room.code, `${missing.displayName}님이 돌아오지 않아 판을 접습니다.`)
      }
    }
    for (const code of closedCodes) {
      forgetRoom(code)
      io.to(code).emit('room:closed', { reason: 'empty' })
    }
    for (const code of idleCodes) {
      forgetRoom(code)
      io.to(code).emit('room:closed', { reason: 'idle' })
    }
    if (changed.length > 0 || closedCodes.length > 0 || idleCodes.length > 0) sendRoomList()
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()

  return {
    store,
    stop: () => {
      clearInterval(sweeper)
      for (const timer of unlockTimers.values()) clearTimeout(timer)
      unlockTimers.clear()
    },
  }
}
