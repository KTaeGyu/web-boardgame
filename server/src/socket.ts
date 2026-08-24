/**
 * 소켓 배선. 규칙은 RoomStore 가 갖고, 여기서는 누가 무엇을 듣는지만 정한다.
 *
 * 요청/응답은 전부 ack 콜백으로 돌려준다. 실패도 예외가 아니라 값으로 오므로
 * 화면이 사유별로 다르게 안내할 수 있다.
 */

import type { Server, Socket } from 'socket.io'
import {
  type ClientToServerEvents,
  type Identity,
  type Result,
  type RoomSettings,
  type RoomView,
  type ServerToClientEvents,
  normalizeNickname,
} from '@the-gang/shared'

import { SWEEP_INTERVAL_MS } from './config.ts'
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

export function attachGameServer(io: GameServer): { store: RoomStore; stop: () => void } {
  const store = new RoomStore({ makeCode: uniqueRoomCode })
  /** 소켓 하나가 사람 하나를 대변한다. 끊길 때 누구였는지 알아야 자리를 지켜줄 수 있다. */
  const playerOfSocket = new Map<string, string>()

  const sendRoom = (room: RoomView) => io.to(room.code).emit('room:updated', room)
  const sendRoomList = () => io.to(LOBBY_WATCHERS).emit('rooms:changed', store.list())

  /** 방 안과 목록은 거의 항상 함께 바뀐다. 빠뜨리기 쉬워 한 곳으로 모았다. */
  const announce = (room: RoomView | null) => {
    if (room) sendRoom(room)
    sendRoomList()
  }

  io.on('connection', (socket: GameSocket) => {
    socket.on('room:create', (payload, ack) => {
      const identity = readIdentity(payload)
      if (!identity.ok) return ack(identity)

      const { playerId, nickname } = identity.value
      detach(socket, playerId)
      const result = store.createRoom(playerId, nickname)
      if (!result.ok) return ack(result)

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
      detach(socket, playerId)
      const result = store.joinRoom(playerId, nickname, payload.code.trim())
      if (!result.ok) return ack(result)

      bind(socket, playerId, result.value.code)
      ack(result)
      announce(result.value)
    })

    socket.on('room:leave', (ack) => {
      const playerId = playerOfSocket.get(socket.id)
      if (!playerId) return ack({ ok: true, value: null })

      const code = store.codeOf(playerId)
      const { room, closedCode } = store.leaveRoom(playerId)
      if (code) socket.leave(code)
      playerOfSocket.delete(socket.id)

      ack({ ok: true, value: null })
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

      const result = store.updateSettings(playerId, patch ?? {})
      ack(result)
      if (result.ok) announce(result.value)
    })

    socket.on('disconnect', () => {
      const playerId = playerOfSocket.get(socket.id)
      playerOfSocket.delete(socket.id)
      if (!playerId) return
      // 나간 것이 아니라 끊긴 것이다. 자리는 유예 시간 동안 지켜준다.
      announce(store.markDisconnected(playerId))
    })
  })

  /** 같은 사람이 다른 탭에서 붙었다면 이전 소켓의 연결 고리를 끊는다. */
  function detach(socket: GameSocket, playerId: string) {
    for (const [socketId, owner] of playerOfSocket) {
      if (owner === playerId && socketId !== socket.id) playerOfSocket.delete(socketId)
    }
  }

  function bind(socket: GameSocket, playerId: string, code: string) {
    playerOfSocket.set(socket.id, playerId)
    socket.join(code)
    socket.leave(LOBBY_WATCHERS)
  }

  const sweeper = setInterval(() => {
    const { changed, closedCodes } = store.sweep()
    for (const room of changed) sendRoom(room)
    for (const code of closedCodes) io.to(code).emit('room:closed', { reason: 'empty' })
    if (changed.length > 0 || closedCodes.length > 0) sendRoomList()
  }, SWEEP_INTERVAL_MS)
  sweeper.unref()

  return { store, stop: () => clearInterval(sweeper) }
}
