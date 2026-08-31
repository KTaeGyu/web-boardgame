import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { RoomStore } from '../src/rooms.ts'

/** 시계와 방 코드를 손으로 돌리는 저장소. 테스트는 우연에 기대지 않는다. */
function makeStore(graceMs = 30_000) {
  let clock = 1_000_000
  let counter = 0
  const store = new RoomStore({
    now: () => clock,
    makeCode: () => `R${counter++}`,
    graceMs,
  })
  return {
    store,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const nicknames = new Map([
  ['p1', '태규'],
  ['p2', '민수'],
  ['p3', '지연'],
  ['p4', '하늘'],
])

/** 방을 하나 만들고 지정한 사람들을 순서대로 넣는다. */
function seed(store: RoomStore, ids: string[]) {
  const created = store.createRoom(ids[0], nicknames.get(ids[0]) ?? ids[0])
  assert.equal(created.ok, true)
  const code = created.ok ? created.value.code : ''
  for (const id of ids.slice(1)) {
    const joined = store.joinRoom(id, nicknames.get(id) ?? id, code)
    assert.equal(joined.ok, true, `${id} 입장 실패`)
  }
  return code
}

describe('방 만들기', () => {
  it('만든 사람이 방장이고 혼자 들어가 있다', () => {
    const { store } = makeStore()
    const result = store.createRoom('p1', '태규')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.hostId, 'p1')
    assert.equal(result.value.phase, 'lobby')
    assert.deepEqual(result.value.players.map((p) => [p.nickname, p.isHost]), [['태규', true]])
  })

  it('기본 설정으로 시작한다', () => {
    const { store } = makeStore()
    const result = store.createRoom('p1', '태규')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.value.settings, {
      mode: 'basic',
      pickedChallenges: [],
      specialistRounds: [null, null, null, null, null],
      specialistRandomRounds: [false, false, false, false, false],
      specialistOnLoss: true,
      randomChallenges: 0,
      randomChallengesOnWin: false,
      randomChallengesStay: false,
      vaultsToWin: 3,
      alarmsToLose: 3,
      maxPlayers: 6,
    })
  })

  it('다른 방에 있던 사람이 방을 만들면 이전 방에서 빠진다', () => {
    const { store } = makeStore()
    const first = seed(store, ['p1', 'p2'])
    store.createRoom('p2', '민수')
    assert.equal(store.view(first)?.players.length, 1)
    assert.equal(store.codeOf('p2') !== first, true)
  })
})

describe('방 입장', () => {
  let ctx: ReturnType<typeof makeStore>
  beforeEach(() => {
    ctx = makeStore()
  })

  it('없는 방이면 거절한다', () => {
    const result = ctx.store.joinRoom('p1', '태규', 'ZZZZ')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'ROOM_NOT_FOUND')
  })

  it('방 코드는 대소문자를 가리지 않는다', () => {
    const code = seed(ctx.store, ['p1'])
    assert.equal(ctx.store.joinRoom('p2', '민수', code.toLowerCase()).ok, true)
  })

  it('정원이 차면 거절한다', () => {
    const code = seed(ctx.store, ['p1'])
    ctx.store.updateSettings('p1', { maxPlayers: 3 })
    ctx.store.joinRoom('p2', '민수', code)
    ctx.store.joinRoom('p3', '지연', code)
    const result = ctx.store.joinRoom('p4', '하늘', code)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'ROOM_FULL')
  })

  it('게임 중인 방에는 새로 들어갈 수 없다', () => {
    const code = seed(ctx.store, ['p1', 'p2', 'p3'])
    ctx.store.setPhase(code, 'playing')
    const result = ctx.store.joinRoom('p4', '하늘', code)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'ROOM_IN_GAME')
  })

  it('이미 그 방에 있던 사람은 게임 중이어도 다시 들어올 수 있다 (재접속)', () => {
    const code = seed(ctx.store, ['p1', 'p2', 'p3'])
    ctx.store.setPhase(code, 'playing')
    ctx.store.markDisconnected('p2')

    const result = ctx.store.joinRoom('p2', '민수', code)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.players.find((p) => p.id === 'p2')?.connected, true)
    assert.equal(result.value.players.length, 3)
  })

  it('재접속하면서 닉네임을 바꿔 달고 들어올 수 있다', () => {
    const code = seed(ctx.store, ['p1', 'p2'])
    const result = ctx.store.joinRoom('p2', '민수2', code)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.players.find((p) => p.id === 'p2')?.nickname, '민수2')
  })
})

describe('겹치는 닉네임', () => {
  it('같은 이름끼리 들어온 순서대로 번호가 붙는다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    store.joinRoom('p2', '태규', code)
    store.joinRoom('p3', '태규', code)

    assert.deepEqual(store.view(code)?.players.map((p) => p.displayName), ['태규 [1]', '태규 [2]', '태규 [3]'])
  })

  it('먼저 들어온 사람이 나가면 남은 사람들이 다시 매겨진다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    store.joinRoom('p2', '태규', code)
    store.joinRoom('p3', '태규', code)
    store.leaveRoom('p1')

    assert.deepEqual(store.view(code)?.players.map((p) => p.displayName), ['태규 [1]', '태규 [2]'])
  })

  it('겹치지 않게 되면 꼬리표가 사라진다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    store.joinRoom('p2', '태규', code)
    store.leaveRoom('p2')

    assert.deepEqual(store.view(code)?.players.map((p) => p.displayName), ['태규'])
  })

  it('방 목록의 방장 이름에도 같은 규칙이 적용된다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    store.joinRoom('p2', '태규', code)
    assert.equal(store.list()[0].hostNickname, '태규 [1]')
  })
})

describe('방 나가기와 방장 인계', () => {
  it('나가면 자리가 즉시 빈다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.leaveRoom('p2')
    assert.deepEqual(store.view(code)?.players.map((p) => p.id), ['p1'])
  })

  it('방장이 나가면 가장 먼저 들어온 남은 사람에게 넘어간다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    const { room } = store.leaveRoom('p1')
    assert.equal(room?.hostId, 'p2')
    assert.equal(store.view(code)?.players.find((p) => p.isHost)?.id, 'p2')
  })

  it('접속 중인 사람이 끊긴 사람보다 우선해서 방장이 된다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2', 'p3'])
    store.markDisconnected('p2') // 먼저 들어왔지만 지금 끊겨 있다
    const { room } = store.leaveRoom('p1')
    assert.equal(room?.hostId, 'p3')
  })

  it('마지막 사람이 나가면 방이 사라진다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    const { room, closedCode } = store.leaveRoom('p1')
    assert.equal(room, null)
    assert.equal(closedCode, code)
    assert.equal(store.size, 0)
    assert.equal(store.view(code), null)
  })

  it('방에 없는 사람이 나가도 아무 일도 없다', () => {
    const { store } = makeStore()
    assert.deepEqual(store.leaveRoom('없는사람'), { room: null, closedCode: null })
  })
})

describe('끊김과 재접속 유예', () => {
  it('끊겨도 자리는 남고 흐리게 표시된다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p2')
    const view = store.view(code)
    assert.equal(view?.players.length, 2)
    assert.equal(view?.players.find((p) => p.id === 'p2')?.connected, false)
  })

  it('유예 시간 안에는 아무도 치우지 않는다', () => {
    const { store, advance } = makeStore(30_000)
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p2')
    advance(29_999)
    assert.deepEqual(store.sweep(), { changed: [], closedCodes: [], idleCodes: [] })
    assert.equal(store.view(code)?.players.length, 2)
  })

  it('유예를 넘기면 자리를 비운다', () => {
    const { store, advance } = makeStore(30_000)
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p2')
    advance(30_000)

    const { changed, closedCodes } = store.sweep()
    assert.equal(closedCodes.length, 0)
    assert.deepEqual(changed.map((r) => r.code), [code])
    assert.deepEqual(store.view(code)?.players.map((p) => p.id), ['p1'])
    assert.equal(store.codeOf('p2'), null)
  })

  it('유예 안에 돌아오면 그대로 복구된다', () => {
    const { store, advance } = makeStore(30_000)
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p2')
    advance(20_000)
    store.joinRoom('p2', '민수', code)
    advance(20_000) // 끊긴 시점부터는 40초가 지났지만 이미 돌아왔다

    assert.deepEqual(store.sweep(), { changed: [], closedCodes: [], idleCodes: [] })
    assert.equal(store.view(code)?.players.length, 2)
  })

  it('유예를 넘긴 사람이 방장이었으면 방장도 넘어간다', () => {
    const { store, advance } = makeStore(30_000)
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p1')
    advance(30_000)
    store.sweep()
    assert.equal(store.view(code)?.hostId, 'p2')
  })

  it('전원이 유예를 넘기면 방이 사라진다', () => {
    const { store, advance } = makeStore(30_000)
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p1')
    store.markDisconnected('p2')
    advance(30_000)

    const { changed, closedCodes } = store.sweep()
    assert.deepEqual(closedCodes, [code])
    assert.equal(changed.length, 0)
    assert.equal(store.size, 0)
  })
})

describe('방 목록', () => {
  it('접속 중인 인원수와 방장 닉네임을 보여준다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    assert.deepEqual(store.list(), [
      { code, hostNickname: '태규', playerCount: 3, maxPlayers: 6, phase: 'lobby', spectatorCount: 0 },
    ])
  })

  it('끊긴 사람은 인원수에서 빠진다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2'])
    store.markDisconnected('p2')
    assert.equal(store.list()[0].playerCount, 1)
  })

  it('아무도 접속해 있지 않은 방은 목록에서 감춘다', () => {
    const { store } = makeStore()
    seed(store, ['p1'])
    store.markDisconnected('p1')
    assert.deepEqual(store.list(), [])
  })

  it('게임 중인 방도 보이되 단계가 함께 나간다 — 화면이 입장을 막을 수 있도록', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    store.setPhase(code, 'playing')
    assert.equal(store.list()[0].phase, 'playing')
  })
})

describe('방 설정', () => {
  let ctx: ReturnType<typeof makeStore>
  let code: string
  beforeEach(() => {
    ctx = makeStore()
    code = seed(ctx.store, ['p1', 'p2'])
  })

  it('방장만 바꿀 수 있다', () => {
    const result = ctx.store.updateSettings('p2', { maxPlayers: 4 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_HOST')
  })

  it('방에 없는 사람은 바꿀 수 없다', () => {
    const result = ctx.store.updateSettings('없는사람', { maxPlayers: 4 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_IN_ROOM')
  })

  it('일부만 넘겨도 나머지는 유지된다', () => {
    const result = ctx.store.updateSettings('p1', { mode: 'advanced' })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.settings.mode, 'advanced')
    assert.equal(result.value.settings.maxPlayers, 6)
  })

  it('최대 인원은 3~10명이다', () => {
    for (const bad of [2, 11, 5.5]) {
      const result = ctx.store.updateSettings('p1', { maxPlayers: bad })
      assert.equal(result.ok, false, `${bad}명이 통과했다`)
      if (!result.ok) assert.equal(result.code, 'INVALID_SETTINGS')
    }
    assert.equal(ctx.store.updateSettings('p1', { maxPlayers: 3 }).ok, true)
    assert.equal(ctx.store.updateSettings('p1', { maxPlayers: 10 }).ok, true)
  })

  it('이미 들어와 있는 인원보다 적게 줄일 수 없다', () => {
    ctx.store.joinRoom('p3', '지연', code)
    ctx.store.joinRoom('p4', '하늘', code)
    const result = ctx.store.updateSettings('p1', { maxPlayers: 3 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /적게 줄일 수 없습니다/)
  })

  it('모르는 모드나 패널티는 거절한다', () => {
    assert.equal(ctx.store.updateSettings('p1', { mode: 'ultra' as never }).ok, false)
    assert.equal(ctx.store.updateSettings('p1', { pickedChallenges: [99 as never] }).ok, false)
  })

  it('같은 도전자 카드를 여러 번 넣어도 한 번만 남는다', () => {
    const result = ctx.store.updateSettings('p1', { pickedChallenges: [2, 2, 5] })
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value.settings.pickedChallenges, [2, 5])
  })

  it('해결사는 판마다 자리를 잡는다 — 빈칸도 그대로 남는다', () => {
    const rounds = [null, 3, null, null, 10] as const
    const picked = ctx.store.updateSettings('p1', { mode: 'custom', specialistRounds: [...rounds] })
    assert.equal(picked.ok, true)
    // id 순으로 정렬하면 몇 번째 판인지가 사라진다. 자리는 넣은 그대로여야 한다.
    if (picked.ok) assert.deepEqual(picked.value.settings.specialistRounds, [...rounds])
  })

  it('자리 수가 판 수와 다르거나 없는 카드면 막는다', () => {
    const bad = (rounds: unknown) =>
      ctx.store.updateSettings('p1', { specialistRounds: rounds as never }).ok

    assert.equal(bad([3, null, null]), false, '자리가 모자람')
    assert.equal(bad([99, null, null, null, null]), false, '없는 카드')
  })

  it('같은 해결사를 여러 판에 세울 수 있다', () => {
    // 카드가 판마다 새로 걸리므로 「썼는가」가 앞 판에서 넘어오지 않는다.
    const rounds = [10, 10, 10, null, null] as const
    const result = ctx.store.updateSettings('p1', { mode: 'custom', specialistRounds: [...rounds] })
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value.settings.specialistRounds, [...rounds])
  })

  it('직접 고르기로 옮기는 것 자체는 막지 않는다', () => {
    // 고르는 도중에는 비어 있는 것이 자연스럽다. 막는 것은 시작하는 순간이다.
    const empty = ctx.store.updateSettings('p1', { mode: 'custom', pickedChallenges: [] })
    assert.equal(empty.ok, true)
    if (empty.ok) assert.deepEqual(empty.value.settings.pickedChallenges, [])

    assert.equal(ctx.store.updateSettings('p1', { pickedChallenges: [8] }).ok, true)
  })

  it('돌려주는 설정은 복사본이라 밖에서 고쳐도 방이 오염되지 않는다', () => {
    const result = ctx.store.updateSettings('p1', { pickedChallenges: [2] })
    assert.equal(result.ok, true)
    if (!result.ok) return
    result.value.settings.pickedChallenges.push(5)
    assert.deepEqual(ctx.store.view(code)?.settings.pickedChallenges, [2])
  })

  it('무작위를 찍은 판에서는 지정한 해결사가 물러난다', () => {
    // 한 판에 해결사는 하나뿐이다. 표가 막지만 계약은 방에 있다.
    ctx.store.updateSettings('p1', { mode: 'custom', specialistRounds: [10, 3, null, null, null] })
    const result = ctx.store.updateSettings('p1', {
      specialistRandomRounds: [true, false, false, false, false],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.value.settings.specialistRounds, [null, 3, null, null, null])
    assert.deepEqual(result.value.settings.specialistRandomRounds, [true, false, false, false, false])
  })

  it('무작위 줄도 승·패 수를 따라 길이가 바뀐다', () => {
    ctx.store.updateSettings('p1', {
      mode: 'custom',
      specialistRandomRounds: [false, false, false, false, true],
    })
    const grown = ctx.store.updateSettings('p1', { vaultsToWin: 4 })
    assert.equal(grown.ok, true)
    if (!grown.ok) return
    assert.deepEqual(grown.value.settings.specialistRandomRounds, [false, false, false, false, true, false])
  })

  it('빠른 접근과 감지기는 함께 걸 수 없다', () => {
    // 빠른 접근이 1라운드를 건너뛰면 감지기가 보는 「처음 선언」이 2라운드가 된다.
    // 규칙대로 돌아도 「두 번 집은 뒤에 감지가 왔다」로 읽힌다.
    for (const sensor of [3, 7] as const) {
      const clash = ctx.store.updateSettings('p1', { pickedChallenges: [1, sensor] })
      assert.equal(clash.ok, false, `빠른 접근 + ${sensor}`)
      if (!clash.ok) assert.equal(clash.code, 'INVALID_SETTINGS')
    }
    assert.equal(ctx.store.updateSettings('p1', { pickedChallenges: [3, 7] }).ok, true, '감지기끼리는 된다')
    assert.equal(ctx.store.updateSettings('p1', { pickedChallenges: [1, 2] }).ok, true, '다른 카드와는 된다')
  })

  it('금고와 경보는 1~5 사이다', () => {
    for (const bad of [0, 6, 2.5]) {
      assert.equal(ctx.store.updateSettings('p1', { vaultsToWin: bad }).ok, false, `금고 ${bad}`)
      assert.equal(ctx.store.updateSettings('p1', { alarmsToLose: bad }).ok, false, `경보 ${bad}`)
    }
    assert.equal(ctx.store.updateSettings('p1', { vaultsToWin: 1, alarmsToLose: 5 }).ok, true)
  })

  it('무작위 도전자는 0~3장이다', () => {
    for (const bad of [-1, 4, 1.5]) {
      assert.equal(ctx.store.updateSettings('p1', { randomChallenges: bad }).ok, false, `${bad}장`)
    }
    assert.equal(ctx.store.updateSettings('p1', { randomChallenges: 3 }).ok, true)
  })

  it('승·패 수를 늘리면 해결사 자리도 함께 늘어난다', () => {
    // 자리 수는 승 + 패 - 1 이다. 표를 다시 보내라고 하는 대신 서버가 길이를 맞춘다.
    const result = ctx.store.updateSettings('p1', { mode: 'custom', vaultsToWin: 4 })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.settings.specialistRounds.length, 6)
    assert.deepEqual(result.value.settings.specialistRounds, [null, null, null, null, null, null])
  })

  it('승·패 수를 줄이면 없어질 판에 서 있던 해결사가 사라진다', () => {
    ctx.store.updateSettings('p1', { mode: 'custom', specialistRounds: [null, null, null, null, 10] })
    const result = ctx.store.updateSettings('p1', { vaultsToWin: 2 })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.value.settings.specialistRounds, [null, null, null, null], '다섯째 판 자체가 없다')
  })

  it('배치표는 그때의 자리 수로만 보낼 수 있다', () => {
    ctx.store.updateSettings('p1', { mode: 'custom', vaultsToWin: 4 })
    const stale = ctx.store.updateSettings('p1', { specialistRounds: [null, null, null, null, 10] })
    assert.equal(stale.ok, false, '다섯 칸짜리 옛 표')
    assert.equal(
      ctx.store.updateSettings('p1', { specialistRounds: [null, null, null, null, null, 10] }).ok,
      true,
    )
  })
})

describe('대화', () => {
  it('남긴 말에는 자리에 붙는 이름과 같은 이름이 달린다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])

    const said = store.addChat('p2', '  왼쪽부터 갈까  ')
    assert.ok(said)
    assert.equal(said.playerId, 'p2')
    assert.equal(said.name, '민수')
    assert.equal(said.text, '왼쪽부터 갈까', '앞뒤 공백은 걸러 낸다')
    assert.deepEqual(
      store.chatOf(code).map((message) => message.text),
      ['왼쪽부터 갈까'],
    )
  })

  it('빈 말은 남지 않는다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    assert.equal(store.addChat('p1', '   '), null)
    assert.deepEqual(store.chatOf(code), [])
  })

  it('방에 없는 사람은 남길 수 없다', () => {
    const { store } = makeStore()
    seed(store, ['p1'])
    assert.equal(store.addChat('구경꾼', '안녕'), null)
  })

  it('번호는 방마다 따로 센다 — 옆 방이 번호를 가져가면 사이가 빠진 것처럼 보인다', () => {
    const { store } = makeStore()
    const first = seed(store, ['p1'])
    const second = seed(store, ['p2'])

    store.addChat('p1', '가')
    store.addChat('p2', '나')
    store.addChat('p1', '다')

    assert.deepEqual(
      store.chatOf(first).map((message) => message.id),
      [1, 2],
      '한 방 안에서는 번호가 이어져야 「사이가 빠졌다」를 알아볼 수 있다',
    )
    assert.deepEqual(
      store.chatOf(second).map((message) => message.id),
      [1],
    )
  })

  it('같은 말을 두 번 해도 번호로 갈린다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    store.addChat('p1', '음')
    store.addChat('p1', '음')
    const ids = store.chatOf(code).map((message) => message.id)
    assert.equal(new Set(ids).size, 2)
  })

  it('오래된 말은 흘려보낸다 — 방이 무한히 무거워지지 않는다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    for (let i = 0; i < 60; i++) store.addChat('p1', `${i}`)

    const kept = store.chatOf(code)
    assert.equal(kept.length, 50)
    assert.equal(kept[0].text, '10', '앞에서부터 밀려난다')
    assert.equal(kept[kept.length - 1].text, '59')
  })

  it('방이 닫히면 말도 함께 사라진다', () => {
    const ctx = makeStore()
    const code = seed(ctx.store, ['p1'])
    ctx.store.addChat('p1', '먼저 들어가 있을게')

    ctx.store.markDisconnected('p1')
    ctx.advance(30_000)
    ctx.store.sweep()

    assert.deepEqual(ctx.store.chatOf(code), [], '방이 없으면 지난 말도 없다')
  })
})

describe('내보내기', () => {
  it('방장만 내보낼 수 있다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2', 'p3'])
    const notHost = store.kick('p2', 'p3')
    assert.equal(notHost.ok, false)
    if (!notHost.ok) assert.equal(notHost.code, 'NOT_HOST')
  })

  it('자기 자신은 내보낼 수 없다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2'])
    assert.equal(store.kick('p1', 'p1').ok, false)
  })

  it('내보내면 자리가 비고 남은 사람은 그대로다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    const result = store.kick('p1', 'p2')
    assert.equal(result.ok, true)
    assert.deepEqual(store.view(code)?.players.map((p) => p.id), ['p1', 'p3'])
    assert.equal(store.codeOf('p2'), null, '어느 방에도 속하지 않는다')
  })

  it('그냥 내보내면 다시 들어올 수 있다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.kick('p1', 'p2')

    assert.equal(store.joinRoom('p2', '민수', code).ok, true, '차단을 고르지 않았다')
  })

  it('차단하고 내보내면 번호를 알아도 다시 못 들어온다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.kick('p1', 'p2', true)

    const again = store.joinRoom('p2', '민수', code)
    assert.equal(again.ok, false, '차단이 뜻을 잃으면 고를 이유가 없다')
  })

  it('막는 것은 그 방뿐이다 — 다른 방에는 들어갈 수 있다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2'])
    store.kick('p1', 'p2', true)

    const other = seed(store, ['p3'])
    assert.equal(store.joinRoom('p2', '민수', other).ok, true)
  })
})

/*
 * 방장이 자리를 비우면 방이 멈춘다 — 시작은 전원이 있어야 하고 설정은 방장만 바꾼다.
 * 유예 10분을 기다리는 대신, 남은 사람이 방장을 넘겨받을 수 있다.
 */
describe('자리를 비운 방장 넘겨받기', () => {
  it('자리를 비운 방장은 방장이 아닌 사람도 내보낼 수 있다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    store.markDisconnected('p1')

    const result = store.kick('p2', 'p1')
    assert.equal(result.ok, true)
    assert.deepEqual(store.view(code)?.players.map((p) => p.id), ['p2', 'p3'])
  })

  it('먼저 내보낸 사람이 방장이 된다 — 입장 순서가 아니다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    store.markDisconnected('p1')

    // p2 가 먼저 들어왔지만 부른 것은 p3 다.
    assert.equal(store.kick('p3', 'p1').ok, true)
    assert.equal(store.view(code)?.hostId, 'p3')
  })

  it('두 번째로 부른 사람은 방장을 뺏지 못한다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    store.markDisconnected('p1')
    assert.equal(store.kick('p2', 'p1').ok, true)

    // 이미 나간 사람이라 대상이 없다. 방장은 그대로 p2 다.
    assert.equal(store.kick('p3', 'p1').ok, false)
    assert.equal(store.view(code)?.hostId, 'p2')
  })

  it('자리에 있는 방장은 아무도 못 내보낸다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2'])

    const result = store.kick('p2', 'p1')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_HOST')
  })

  it('돌아온 방장은 다시 못 내보낸다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p1')
    store.joinRoom('p1', '태규', code) // 재접속

    assert.equal(store.kick('p2', 'p1').ok, false)
    assert.equal(store.view(code)?.hostId, 'p1')
  })

  it('넘겨받는 길은 방장이 아닌 사람까지 열어주지 않는다', () => {
    const { store } = makeStore()
    seed(store, ['p1', 'p2', 'p3'])
    store.markDisconnected('p1')

    // 방장이 자리를 비웠다고 해서 남들끼리 서로 내보낼 수 있는 것은 아니다.
    const result = store.kick('p2', 'p3')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_HOST')
  })

  it('구경꾼은 넘겨받을 수 없다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    assert.equal(store.spectate('p9', '구경', code).ok, true)
    store.markDisconnected('p1')

    const result = store.kick('p9', 'p1')
    assert.equal(result.ok, false, '구경하는 사람은 방장이 될 수 없다')
    assert.equal(store.view(code)?.hostId, 'p1')
  })

  it('넘겨받으면서 차단할 수는 없다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.markDisconnected('p1')
    assert.equal(store.kick('p2', 'p1', true).ok, true)

    assert.equal(store.joinRoom('p1', '태규', code).ok, true, '돌아올 길은 남겨둔다')
  })
})

describe('방이 열린 시각', () => {
  it('번호가 같아도 다른 방이면 시각이 다르다', () => {
    const ctx = makeStore()
    const first = seed(ctx.store, ['p1'])
    const openedFirst = ctx.store.openedAt(first)

    // 마지막 사람이 나가면 방이 닫히고, 그 번호는 다시 쓰일 수 있다.
    ctx.store.leaveRoom('p1')
    assert.equal(ctx.store.openedAt(first), 0, '없는 방은 0 이다')

    ctx.advance(60_000)
    const created = ctx.store.createRoom('p2', '민수')
    assert.equal(created.ok, true)

    const second = created.ok ? created.value.code : ''
    assert.notEqual(ctx.store.openedAt(second), openedFirst, '시각이 같으면 창이 두 방을 구별하지 못한다')
  })
})

/*
 * 관전. 자리와 다른 것이라 규칙도 따로다 —
 * 시작 인원에 들지 않고, 지켜줄 자리가 없어 끊기면 그 자리에서 빠진다.
 */
describe('관전', () => {
  it('다섯까지만 본다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    for (let i = 0; i < 5; i += 1) {
      assert.equal(store.spectate(`w${i}`, `구경${i}`, code).ok, true, `${i + 1}번째`)
    }
    const sixth = store.spectate('w5', '구경5', code)
    assert.equal(sixth.ok, false)
    if (!sixth.ok) assert.equal(sixth.code, 'ROOM_FULL')
  })

  it('앉아 있던 사람은 스스로 물러날 수 있다 — 대기실에서만', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    const stepped = store.spectate('p2', '민수', code)
    assert.equal(stepped.ok, true)
    if (!stepped.ok) return
    assert.deepEqual(stepped.value.players.map((p) => p.id), ['p1'])
    assert.deepEqual(stepped.value.spectators.map((w) => w.id), ['p2'])
  })

  it('판이 도는 중에는 자리에서 물러날 수 없다', () => {
    // 자리가 비면 라운드가 끝나지 않아 판이 통째로 접힌다. 화면은 이 거절을 보고
    // 「관전이 아니라 제자리로 돌아갈 사람」이라고 판단한다.
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2', 'p3'])
    store.setPhase(code, 'playing')
    const result = store.spectate('p2', '민수', code)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'WRONG_PHASE')
  })

  it('혼자 있는 방에서는 물러날 수 없다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1'])
    assert.equal(store.spectate('p1', '태규', code).ok, false)
  })

  it('방장이 물러나면 앉아 있는 사람에게 넘어간다 — 구경꾼은 방장이 되지 않는다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.spectate('w0', '구경', code)
    const result = store.spectate('p1', '태규', code)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.hostId, 'p2')
  })

  it('구경을 마치면 관전 목록에서 빠진다 — 자리처럼 지켜주지 않는다', () => {
    // 화면이 목록으로 나가면서 이것을 부르지 않으면, 방에 있는 사람들에게는
    // 아직 보고 있는 것처럼 「관전 1명」이 남는다.
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.spectate('w0', '구경', code)
    assert.equal(store.view(code)?.spectators.length, 1)

    const left = store.leaveRoom('w0')
    assert.equal(left.closedCode, null, '구경꾼이 나갔다고 방이 닫히지는 않는다')
    assert.deepEqual(left.room?.spectators, [])
    assert.equal(store.view(code)?.players.length, 2, '자리는 그대로다')
  })

  it('차단당한 사람은 보러 올 수도 없다', () => {
    const { store } = makeStore()
    const code = seed(store, ['p1', 'p2'])
    store.kick('p1', 'p2', true)
    assert.equal(store.spectate('p2', '민수', code).ok, false)
  })

  it('혼자 해보는 방은 보러 갈 수 없다', () => {
    const { store } = makeStore()
    const made = store.createTutorialRoom('p1', '태규', [{ id: 'b1', nickname: '봇1' }])
    assert.equal(made.ok, true)
    if (!made.ok) return
    assert.equal(store.spectate('w0', '구경', made.value.code).ok, false)
  })
})
