import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { RoomStore } from '../src/rooms.ts'

function makeStore(options: { maxRooms?: number; idleMs?: number } = {}) {
  let clock = 1_000_000
  let counter = 0
  const store = new RoomStore({
    now: () => clock,
    makeCode: () => `R${counter++}`,
    maxRooms: options.maxRooms,
    idleMs: options.idleMs,
  })
  return { store, advance: (ms: number) => (clock += ms) }
}

describe('방 수 한도', () => {
  it('한도까지는 열리고 그 뒤로는 거절한다', () => {
    const { store } = makeStore({ maxRooms: 2 })
    assert.equal(store.createRoom('p1', '가').ok, true)
    assert.equal(store.createRoom('p2', '나').ok, true)

    const result = store.createRoom('p3', '다')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.code, 'ROOM_LIMIT')
      assert.match(result.message, /잠시 뒤에/)
    }
  })

  it('방이 하나 사라지면 다시 열 수 있다', () => {
    const { store } = makeStore({ maxRooms: 1 })
    store.createRoom('p1', '가')
    assert.equal(store.createRoom('p2', '나').ok, false)

    store.leaveRoom('p1') // 마지막 사람이 나가 방이 사라진다
    assert.equal(store.createRoom('p2', '나').ok, true)
  })

  it('한도를 두지 않으면 얼마든지 열린다', () => {
    const { store } = makeStore()
    for (let i = 0; i < 20; i++) assert.equal(store.createRoom(`p${i}`, `사람${i}`).ok, true)
    assert.equal(store.size, 20)
  })
})

describe('아무 일도 없는 방 정리', () => {
  const TEN_MIN = 10 * 60_000

  it('한도 안에서는 남아 있는다', () => {
    const { store, advance } = makeStore({ idleMs: TEN_MIN })
    store.createRoom('p1', '가')
    advance(TEN_MIN - 1)
    assert.deepEqual(store.sweep().idleCodes, [])
    assert.equal(store.size, 1)
  })

  it('아무도 아무것도 하지 않으면 사람이 있어도 지운다', () => {
    const { store, advance } = makeStore({ idleMs: TEN_MIN })
    const created = store.createRoom('p1', '가')
    const code = created.ok ? created.value.code : ''
    store.joinRoom('p2', '나', code)

    advance(TEN_MIN)
    const { idleCodes } = store.sweep()
    assert.deepEqual(idleCodes, [code])
    assert.equal(store.size, 0)
    assert.equal(store.codeOf('p1'), null, '자리 기록도 함께 지워야 한다')
    assert.equal(store.codeOf('p2'), null)
  })

  it('누가 무언가 하면 시계가 다시 돈다', () => {
    const { store, advance } = makeStore({ idleMs: TEN_MIN })
    const created = store.createRoom('p1', '가')
    const code = created.ok ? created.value.code : ''

    advance(TEN_MIN - 1)
    store.touch(code)
    advance(TEN_MIN - 1)

    assert.deepEqual(store.sweep().idleCodes, [])
    assert.equal(store.size, 1)
  })

  it('입장도 활동이다', () => {
    const { store, advance } = makeStore({ idleMs: TEN_MIN })
    const created = store.createRoom('p1', '가')
    const code = created.ok ? created.value.code : ''

    advance(TEN_MIN - 1)
    store.joinRoom('p2', '나', code)
    store.touch(code)
    advance(2)

    assert.deepEqual(store.sweep().idleCodes, [])
  })

  it('없는 방을 건드려도 아무 일도 없다', () => {
    const { store } = makeStore({ idleMs: TEN_MIN })
    store.touch('ZZZZ')
    store.touch(null)
  })

  it('빈 방 정리와 유휴 정리는 따로 센다', () => {
    const { store, advance } = makeStore({ idleMs: TEN_MIN })
    const a = store.createRoom('p1', '가')
    const b = store.createRoom('p2', '나')
    const codeA = a.ok ? a.value.code : ''
    const codeB = b.ok ? b.value.code : ''

    // A 는 계속 쓰이고, B 는 방치된다
    store.markDisconnected('p1')
    advance(TEN_MIN)
    store.touch(codeA)

    const { closedCodes, idleCodes } = store.sweep()
    assert.deepEqual(idleCodes, [codeB], '방치된 방만 유휴로 접힌다')
    assert.deepEqual(closedCodes, [codeA], '전원이 유예를 넘긴 방은 빈 방으로 접힌다')
  })
})
