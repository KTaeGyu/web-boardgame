/**
 * 게임을 소켓 너머로 한 판 돌린다.
 *
 * 엔진 테스트가 규칙을 보장하므로 여기서는 전달을 본다 —
 * 특히 손패가 주인에게만 가는지. 은닉 정보가 새면 게임이 성립하지 않는다.
 */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

import { io as connect, type Socket } from 'socket.io-client'
import { TOKEN_LOCK_MS, type Card, type GameView, type Result, type RoomView } from '@the-gang/shared'

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

function call<T>(socket: Socket, event: string, ...args: unknown[]): Promise<Result<T>> {
  return new Promise((resolve) => socket.emit(event, ...args, resolve))
}

function until<T>(socket: Socket, event: string, match: (payload: T) => boolean, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer)
      socket.off(event, listener)
      fn()
    }
    const listener = (payload: T) => {
      if (match(payload)) done(() => resolve(payload))
    }
    const timer = setTimeout(() => done(() => reject(new Error(`${event} 대기 시간 초과`))), timeoutMs)
    socket.on(event, listener)
  })
}

function unwrap<T>(result: Result<T>): T {
  assert.equal(result.ok, true, result.ok ? '' : `${result.code}: ${result.message}`)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

type Person = {
  socket: Socket
  nickname: string
  playerId: string
  hands: Card[][]
  states: GameView[]
}

/**
 * 이미 도착한 상태부터 훑고, 없으면 기다린다.
 *
 * 브로드캐스트는 ack 직후에 오므로 「응답을 받고 나서 리스너를 건다」는 순서로는
 * 놓치기 쉽다. 각자가 받은 상태를 모아 두고 여기서 되짚는 편이 안전하다.
 */
function waitState(person: Person, match: (view: GameView) => boolean, timeoutMs = 3000): Promise<GameView> {
  const already = person.states.find(match)
  if (already) return Promise.resolve(already)
  return until<GameView>(person.socket, 'game:state', match, timeoutMs)
}

let seq = 0

/** 방 하나에 사람 셋을 앉히고, 각자의 손패 수신을 기록해 둔다. */
async function seatThree() {
  const tag = `table${seq++}`.padEnd(10, 'x')
  const people = await Promise.all(
    ['가', '나', '다'].map(async (nickname, index) => {
      const socket = connect(url, { transports: ['websocket'], forceNew: true })
      open.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve())
        socket.once('connect_error', reject)
      })
      const hands: Card[][] = []
      socket.on('game:hand', (payload: { hole: Card[] }) => hands.push(payload.hole))
      const states: GameView[] = []
      socket.on('game:state', (view: GameView) => states.push(view))
      return { socket, nickname, playerId: `${tag}-${index}`, hands, states }
    }),
  )

  const [host, ...guests] = people
  const room = unwrap(
    await call<RoomView>(host.socket, 'room:create', { playerId: host.playerId, nickname: host.nickname }),
  )
  for (const guest of guests) {
    unwrap(
      await call<RoomView>(guest.socket, 'room:join', {
        playerId: guest.playerId,
        nickname: guest.nickname,
        code: room.code,
      }),
    )
  }
  return { people, host, guests, code: room.code }
}

/** 셋이 토큰을 하나씩 집는다. 잠금이 있으므로 간격을 둔다. */
async function grabAll(people: Awaited<ReturnType<typeof seatThree>>['people']) {
  for (const [index, person] of people.entries()) {
    unwrap(await call<null>(person.socket, 'game:take', { token: index + 1 }))
    await new Promise((resolve) => setTimeout(resolve, TOKEN_LOCK_MS + 30))
  }
}

async function passRound(people: Awaited<ReturnType<typeof seatThree>>['people']) {
  await grabAll(people)
  for (const person of people) unwrap(await call<null>(person.socket, 'game:ready', { ready: true }))
}

describe('판 시작', () => {
  it('방장이 시작하면 방이 게임 중으로 바뀌고 모두 상태를 받는다', async () => {
    const { people, host, code } = await seatThree()
    const started = waitState(people[1], (view) => view.heist === 1)

    const view = unwrap(await call<GameView>(host.socket, 'game:start'))
    assert.equal(view.round, 1)
    assert.equal(view.centerTokens.length, 3, '토큰은 인원수만큼만 깔린다')

    await started
    assert.equal(app.store.view(code)?.phase, 'playing')
  })

  it('방장이 아니면 시작할 수 없다', async () => {
    const { host, guests } = await seatThree()
    void host
    const result = await call<GameView>(guests[0].socket, 'game:start')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_HOST')
  })

  it('세 명이 안 되면 시작할 수 없다', async () => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true })
    open.push(socket)
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    unwrap(await call<RoomView>(socket, 'room:create', { playerId: 'solo-player-1', nickname: '혼자' }))

    const result = await call<GameView>(socket, 'game:start')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_ENOUGH_PLAYERS')
  })
})

describe('직접 고르기', () => {
  it('카드를 고르지 않으면 시작 자체를 막는다', async () => {
    const { host } = await seatThree()

    // 고르는 도중에는 비어 있는 것이 자연스럽다. 설정을 옮기는 것 자체는 허용된다.
    const moved = await call<unknown>(host.socket, 'room:settings', {
      mode: 'custom',
      pickedChallenges: [],
    })
    assert.equal(moved.ok, true)

    const blocked = await call<GameView>(host.socket, 'game:start')
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.match(blocked.message, /하나 이상 골라/)

    // 한 장이라도 고르면 열린다.
    unwrap(await call<unknown>(host.socket, 'room:settings', { pickedChallenges: [8] }))
    const started = await call<GameView>(host.socket, 'game:start')
    assert.equal(started.ok, true)
    if (started.ok) assert.deepEqual(started.value.challenges, [8])
  })
})

describe('은닉 정보', () => {
  it('손패는 주인에게만 간다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    await waitState(people[2], (view) => view.heist === 1)
    await new Promise((resolve) => setTimeout(resolve, 100))

    for (const person of people) {
      assert.equal(person.hands.length, 1, `${person.nickname} 은 자기 손패를 정확히 한 번 받아야 한다`)
      assert.equal(person.hands[0].length, 2)
    }
    // 셋의 손패가 서로 다르다 = 남의 것을 받은 사람이 없다
    const all = people.flatMap((p) => p.hands[0])
    assert.equal(new Set(all).size, 6)
  })

  it('공개 상태에는 진행 중 누구의 홀카드도 실리지 않는다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    const view = await waitState(people[1], (v) => v.heist === 1)

    for (const player of view.players) assert.equal(player.hole, null)
  })
})

describe('토큰 경합', () => {
  it('집으면 모두의 화면에 반영된다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))

    const seen = waitState(people[2], (view) => view.players.find((p) => p.id === host.playerId)?.currentToken === 2,
    )
    unwrap(await call<null>(host.socket, 'game:take', { token: 2 }))
    await seen
  })

  it('날아가는 중인 토큰은 거절된다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    unwrap(await call<null>(host.socket, 'game:take', { token: 2 }))

    const result = await call<null>(people[1].socket, 'game:take', { token: 2 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'TOKEN_LOCKED')
  })

  it('잠금이 풀리면 알려주는 사람이 없어도 화면이 풀린다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))

    const unlocked = waitState(people[1], (view) => view.lockedTokens.length === 0)
    unwrap(await call<null>(host.socket, 'game:take', { token: 2 }))
    await unlocked // 아무도 아무것도 하지 않았는데 풀린 상태가 도착해야 한다
  })
})

describe('한 판 끝까지', () => {
  it('네 라운드를 지나면 쇼다운이 열린다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))

    for (let round = 0; round < 4; round++) await passRound(people)

    const view = await waitState(people[0], (v) => v.phase !== 'picking')
    assert.notEqual(view.showdown, null)
    assert.equal(view.showdown?.reveals.length, 3)
    for (const player of view.players) assert.equal(player.hole?.length, 2, '쇼다운에서는 모두 공개된다')
    assert.equal(view.vaults + view.alarms, 1)
  })

  it('모두 확인해야 다음 판이 시작되고 새 손패가 돌아간다', async () => {
    const { people, host } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    for (let round = 0; round < 4; round++) await passRound(people)
    await waitState(people[0], (v) => v.phase !== 'picking')

    if (people[0].states.at(-1)?.phase === 'gameOver') return // 첫 판에 끝날 수는 없다

    for (const person of people) unwrap(await call<null>(person.socket, 'game:continue'))
    const next = await waitState(people[0], (v) => v.heist === 2)

    assert.equal(next.round, 1)
    assert.deepEqual(next.community, [])
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(people[0].hands.length, 2, '새 판에는 새 손패가 온다')
    assert.notDeepEqual(people[0].hands[0], people[0].hands[1])
  })
})

describe('판이 도는 중의 이탈', () => {
  it('나가면 판이 접히고 방은 대기실로 돌아간다', async () => {
    const { people, host, guests, code } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    await waitState(people[0], (v) => v.heist === 1)

    const aborted = until<{ message: string }>(host.socket, 'game:aborted', () => true)
    unwrap(await call<null>(guests[0].socket, 'room:leave'))

    const notice = await aborted
    assert.match(notice.message, /나가서/)
    assert.equal(app.store.view(code)?.phase, 'lobby')
  })

  it('끊긴 것은 이탈이 아니다 — 자리를 지키고 판은 그대로다', async () => {
    const { people, host, guests, code } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    await waitState(people[0], (v) => v.heist === 1)

    const away = until<GameView>(
      host.socket,
      'game:state',
      (view) => view.players.find((p) => p.id === guests[1].playerId)?.connected === false,
    )
    guests[1].socket.disconnect()
    await away

    assert.equal(app.store.view(code)?.phase, 'playing', '끊겼다고 판을 접으면 새로고침에서 게임이 날아간다')
  })

  it('돌아오면 자리와 손패가 복구된다', async () => {
    const { people, host, guests, code } = await seatThree()
    unwrap(await call<GameView>(host.socket, 'game:start'))
    await waitState(people[0], (v) => v.heist === 1)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const before = guests[1].hands[0]
    guests[1].socket.disconnect()
    await until<GameView>(
      host.socket,
      'game:state',
      (view) => view.players.find((p) => p.id === guests[1].playerId)?.connected === false,
    )

    // 새로고침한 것처럼 같은 playerId 로 다시 붙는다
    const back = connect(url, { transports: ['websocket'], forceNew: true })
    open.push(back)
    await new Promise<void>((resolve) => back.once('connect', () => resolve()))
    // 복구 상태는 join 응답 직후에 날아온다. 붙자마자 받아 두어야 놓치지 않는다.
    const backAgain: Person = { socket: back, nickname: '나', playerId: guests[1].playerId, hands: [], states: [] }
    back.on('game:hand', (payload: { hole: Card[] }) => backAgain.hands.push(payload.hole))
    back.on('game:state', (view: GameView) => backAgain.states.push(view))

    unwrap(
      await call<RoomView>(back, 'room:join', {
        playerId: guests[1].playerId,
        nickname: guests[1].nickname,
        code,
      }),
    )

    const view = await waitState(
      backAgain,
      (v) => v.players.find((p) => p.id === guests[1].playerId)?.connected === true,
    )
    assert.equal(view.phase, 'picking')
    assert.deepEqual(backAgain.hands[0], before, '돌아왔는데 손패가 바뀌면 판이 무너진다')
  })
})
