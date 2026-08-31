/**
 * 소켓 배선 통합 테스트. RoomStore 단위 테스트가 규칙을 보장하므로
 * 여기서는 "누가 무엇을 듣는가"만 확인한다 — 브로드캐스트 대상과 ack 형태.
 */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

import { io as connect, type Socket } from 'socket.io-client'
import type { Result, RoomSummary, RoomView } from '@the-gang/shared'

import { createApp, type GameApp } from '../src/app.ts'

let app: GameApp
let url = ''
const open: Socket[] = []

before(async () => {
  // 소켓을 계속 열어두는 테스트라 운영 한도(40)에 걸린다. 여기서는 한도를 풀어둔다.
  app = createApp({ maxConnections: 1000, maxRooms: 1000 })
  await new Promise<void>((resolve) => app.http.listen(0, resolve))
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`
})

after(async () => {
  for (const socket of open) socket.disconnect()
  await app.close()
})

async function client(): Promise<Socket> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true })
  open.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return socket
}

/** ack 콜백을 프라미스로 바꾼다. 서버 응답은 전부 Result 형태다. */
function call<T>(socket: Socket, event: string, ...args: unknown[]): Promise<Result<T>> {
  return new Promise((resolve) => socket.emit(event, ...args, resolve))
}

/** 다음 이벤트 하나를 기다린다. 반드시 트리거 전에 걸어둬야 한다. */
function next<T>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return until<T>(socket, event, () => true, timeoutMs)
}

/**
 * 조건에 맞는 이벤트가 올 때까지 기다린다.
 *
 * "다음 하나"로 기다리면 직전 동작이 만든 브로드캐스트를 잘못 집는다.
 * 예를 들어 입장 알림이 도착한 뒤에야 끊김 알림이 오는데, 순서를 가정하면
 * 테스트가 우연에 기댄다. 무엇을 기다리는지 조건으로 적는 편이 안전하다.
 */
function until<T>(socket: Socket, event: string, match: (payload: T) => boolean, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const seen: T[] = []
    const done = (fn: () => void) => {
      clearTimeout(timer)
      socket.off(event, listener)
      fn()
    }
    const listener = (payload: T) => {
      seen.push(payload)
      if (match(payload)) done(() => resolve(payload))
    }
    const timer = setTimeout(
      () => done(() => reject(new Error(`${event} 를 기다리다 시간이 지났다. 받은 것: ${JSON.stringify(seen)}`))),
      timeoutMs,
    )
    socket.on(event, listener)
  })
}

const identity = (playerId: string, nickname: string) => ({ playerId, nickname })

function unwrap<T>(result: Result<T>): T {
  assert.equal(result.ok, true, result.ok ? '' : `${result.code}: ${result.message}`)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

describe('방 만들기와 입장', () => {
  it('방을 만들면 방 정보를 돌려준다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-aaaa1111', '태규')))
    assert.match(room.code, /^[A-Z2-9]{4}$/)
    assert.equal(room.hostId, 'player-aaaa1111')
    assert.equal(room.players.length, 1)
  })

  it('다른 사람이 들어오면 방 안의 모두에게 알린다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-bbbb1111', '태규')))

    const guest = await client()
    const broadcast = until<RoomView>(host, 'room:updated', (r) => r.players.length === 2)
    unwrap(await call<RoomView>(guest, 'room:join', { ...identity('player-bbbb2222', '민수'), code: room.code }))

    const updated = await broadcast
    assert.deepEqual(updated.players.map((p) => p.nickname), ['태규', '민수'])
  })

  it('없는 방이면 사유와 함께 거절한다', async () => {
    const guest = await client()
    const result = await call<RoomView>(guest, 'room:join', { ...identity('player-cccc1111', '민수'), code: 'ZZZZ' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.code, 'ROOM_NOT_FOUND')
      assert.match(result.message, /방 번호/)
    }
  })

  it('닉네임이 비어 있으면 거절한다', async () => {
    const socket = await client()
    const result = await call<RoomView>(socket, 'room:create', identity('player-dddd1111', '   '))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'INVALID_NICKNAME')
  })

  it('브라우저가 보낸 playerId 의 형태를 확인한다', async () => {
    const socket = await client()
    const result = await call<RoomView>(socket, 'room:create', identity('짧음', '태규'))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'INVALID_NICKNAME')
  })
})

describe('방 목록', () => {
  it('만들어진 방이 목록에 보인다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-eeee1111', '태규')))

    const browser = await client()
    const rooms = unwrap(await call<RoomSummary[]>(browser, 'room:list'))
    const found = rooms.find((r) => r.code === room.code)
    assert.equal(found?.hostNickname, '태규')
    assert.equal(found?.playerCount, 1)
    assert.equal(found?.awayCount, 0)
    assert.equal(found?.phase, 'lobby')
  })

  /*
   * 목록 화면이 「돌아가기」를 그리는 근거다. 소켓이 아니라 playerId 로 묻는 것이
   * 핵심이다 — 새로고침한 창은 소켓이 어느 사람인지 매여 있지 않은데, 정작 그때가
   * 이 물음이 필요한 자리다.
   */
  it('내 자리가 어느 방인지 다른 소켓으로도 물을 수 있다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-ffff2222', '태규')))

    const fresh = await client()
    assert.equal(unwrap(await call<string | null>(fresh, 'room:where', { playerId: 'player-ffff2222' })), room.code)
    assert.equal(unwrap(await call<string | null>(fresh, 'room:where', { playerId: 'player-9999zzzz' })), null)
    assert.equal(unwrap(await call<string | null>(fresh, 'room:where', { playerId: '짧음' })), null, '형식이 틀리면 없는 것으로')
  })

  it('구독하면 즉시 현재 목록을 받고, 방이 생기면 다시 받는다', async () => {
    const browser = await client()
    const first = next<RoomSummary[]>(browser, 'rooms:changed')
    browser.emit('rooms:watch', { watching: true })
    await first

    const host = await client()
    let code = ''
    const changed = until<RoomSummary[]>(browser, 'rooms:changed', (rooms) => rooms.some((r) => r.code === code))
    code = unwrap(await call<RoomView>(host, 'room:create', identity('player-ffff1111', '지연'))).code
    await changed
  })

  it('구독을 끄면 더 이상 받지 않는다', async () => {
    const browser = await client()
    browser.emit('rooms:watch', { watching: true })
    await next<RoomSummary[]>(browser, 'rooms:changed')
    browser.emit('rooms:watch', { watching: false })

    const host = await client()
    const silence = next<RoomSummary[]>(browser, 'rooms:changed', 300).then(
      () => 'received',
      () => 'silent',
    )
    unwrap(await call<RoomView>(host, 'room:create', identity('player-gggg1111', '하늘')))
    assert.equal(await silence, 'silent')
  })
})

describe('나가기와 방장 인계', () => {
  it('방장이 나가면 남은 사람에게 방장이 넘어가고 그 사실이 전파된다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-hhhh1111', '태규')))
    const guest = await client()
    unwrap(await call<RoomView>(guest, 'room:join', { ...identity('player-hhhh2222', '민수'), code: room.code }))

    const broadcast = until<RoomView>(guest, 'room:updated', (r) => r.hostId === 'player-hhhh2222')
    unwrap(await call<null>(host, 'room:leave'))

    const updated = await broadcast
    assert.equal(updated.hostId, 'player-hhhh2222')
    assert.equal(updated.players.length, 1)
    assert.equal(updated.players[0].isHost, true)
  })

  it('마지막 사람이 나가면 방이 사라진다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-iiii1111', '태규')))
    unwrap(await call<null>(host, 'room:leave'))
    assert.equal(app.store.view(room.code), null)
  })

  it('끊기면 자리는 남고 접속 상태만 흐려진다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-jjjj1111', '태규')))
    const guest = await client()
    unwrap(await call<RoomView>(guest, 'room:join', { ...identity('player-jjjj2222', '민수'), code: room.code }))

    const broadcast = until<RoomView>(
      host,
      'room:updated',
      (r) => r.players.find((p) => p.id === 'player-jjjj2222')?.connected === false,
    )
    guest.disconnect()

    const updated = await broadcast
    assert.equal(updated.players.length, 2, '끊겼다고 자리를 빼앗으면 새로고침에서 튕긴다')
    assert.equal(updated.players.find((p) => p.id === 'player-jjjj2222')?.connected, false)
  })
})

describe('방 설정', () => {
  it('방장이 바꾸면 방 안 모두에게 전파된다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-kkkk1111', '태규')))
    const guest = await client()
    unwrap(await call<RoomView>(guest, 'room:join', { ...identity('player-kkkk2222', '민수'), code: room.code }))

    const broadcast = until<RoomView>(guest, 'room:updated', (r) => r.settings.maxPlayers === 8)
    unwrap(await call<RoomView>(host, 'room:settings', { maxPlayers: 8 }))
    assert.equal((await broadcast).settings.maxPlayers, 8)
  })

  it('방장이 아니면 거절한다', async () => {
    const host = await client()
    const room = unwrap(await call<RoomView>(host, 'room:create', identity('player-llll1111', '태규')))
    const guest = await client()
    unwrap(await call<RoomView>(guest, 'room:join', { ...identity('player-llll2222', '민수'), code: room.code }))

    const result = await call<RoomView>(guest, 'room:settings', { maxPlayers: 8 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_HOST')
  })

  it('방에 없으면 거절한다', async () => {
    const stray = await client()
    const result = await call<RoomView>(stray, 'room:settings', { maxPlayers: 8 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_IN_ROOM')
  })
})
