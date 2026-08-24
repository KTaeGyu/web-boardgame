/**
 * 운영 한도. 게임 규칙이 아니라 서버가 감당할 양의 문제다.
 *
 * 한도에 걸린 사람이 아무 설명 없이 튕겨나가면 고장으로 느껴진다.
 * 이유가 먼저 가고 그다음에 끊기는지를 본다.
 */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

import { io as connect, type Socket } from 'socket.io-client'
import type { Result, RoomView } from '@the-gang/shared'

import { createApp, type GameApp } from '../src/app.ts'

let app: GameApp
let url = ''
const open: Socket[] = []

before(async () => {
  // 두 명까지만 받는 서버. 한도 동작을 보려면 한도가 작아야 한다.
  app = createApp({ maxConnections: 2, maxRooms: 1 })
  await new Promise<void>((resolve) => app.http.listen(0, resolve))
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`
})

after(async () => {
  for (const socket of open) socket.disconnect()
  await app.close()
})

async function client(): Promise<Socket> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false })
  open.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return socket
}

function call<T>(socket: Socket, event: string, ...args: unknown[]): Promise<Result<T>> {
  return new Promise((resolve) => socket.emit(event, ...args, resolve))
}

describe('접속 한도', () => {
  it('한도를 넘긴 사람에게는 이유를 알리고 끊는다', async () => {
    await client()
    await client()

    const third = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false })
    open.push(third)

    const told = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('안내도 없이 끊겼다')), 3000)
      third.on('server:full', (payload: { message: string }) => {
        clearTimeout(timer)
        resolve(payload.message)
      })
    })
    assert.match(told, /접속이 많습니다/)

    await new Promise<void>((resolve) => {
      if (!third.connected) return resolve()
      third.once('disconnect', () => resolve())
    })
    assert.equal(third.connected, false, '안내만 하고 붙여두면 한도가 무의미하다')
  })
})

describe('방 수 한도', () => {
  it('한도를 넘기면 사유와 함께 거절한다', async () => {
    const first = open[0]
    const second = open[1]

    const made = await call<RoomView>(first, 'room:create', {
      playerId: 'capacity-aaaa-1',
      nickname: '가',
    })
    assert.equal(made.ok, true)

    const blocked = await call<RoomView>(second, 'room:create', {
      playerId: 'capacity-aaaa-2',
      nickname: '나',
    })
    assert.equal(blocked.ok, false)
    if (!blocked.ok) {
      assert.equal(blocked.code, 'ROOM_LIMIT')
      assert.match(blocked.message, /잠시 뒤에/)
    }
  })
})
