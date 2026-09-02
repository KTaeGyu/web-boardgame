import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_CONFIRM_MS,
  CIRCLE_TRIPLES,
  SPOTS_LINES,
  TOKEN_LOCK_MS,
  usableCommunity,
  type PokerVariant,
} from '@the-gang/shared'
import { Game, type StartingPlayer } from '@the-gang/shared/engine'

/** 시계를 손으로 돌리는 판. 잠금과 라운드 전환을 실제로 기다리지 않는다. */
function makeGame(count = 3, options: { lockMs?: number } = {}) {
  let clock = 1_000_000
  const players: StartingPlayer[] = Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    nickname: `사람${i + 1}`,
    connected: true,
  }))
  const game = new Game('TEST', players, {
    now: () => clock,
    rng: mulberry32(1234),
    lockMs: options.lockMs ?? TOKEN_LOCK_MS,
  })
  return {
    game,
    ids: players.map((p) => p.id),
    advance: (ms: number) => {
      clock += ms
    },
  }
}

/** 잠금을 넘겨가며 토큰을 나눠 갖는다. 1번은 p1, 2번은 p2… 순으로. */
function dealTokens(ctx: ReturnType<typeof makeGame>) {
  ctx.ids.forEach((id, index) => {
    const result = ctx.game.takeToken(id, index + 1)
    assert.equal(result.ok, true, `${id} 가 ${index + 1}번을 집지 못했다`)
    ctx.advance(TOKEN_LOCK_MS)
  })
}

/** 한 라운드를 통째로 넘긴다. */
function passRound(ctx: ReturnType<typeof makeGame>) {
  dealTokens(ctx)
  for (const id of ctx.ids) assert.equal(ctx.game.setReady(id, true).ok, true)
}

describe('판 시작', () => {
  it('모두에게 두 장씩 나눠주고 1라운드로 시작한다', () => {
    const { game, ids } = makeGame(4)
    const view = game.view()
    assert.equal(view.heist, 1)
    assert.equal(view.round, 1)
    assert.equal(view.phase, 'picking')
    assert.deepEqual(view.community, [])
    for (const id of ids) assert.equal(game.handOf(id)?.length, 2)
  })

  it('토큰은 인원수만큼만 있다', () => {
    const { game } = makeGame(4)
    assert.deepEqual(game.view().centerTokens, [1, 2, 3, 4])
    assert.equal(game.takeToken('p1', 5).ok, false)
  })

  it('한 판 안에서 같은 카드가 두 번 나오지 않는다', () => {
    const ctx = makeGame(6)
    for (const round of [1, 2, 3]) {
      void round
      passRound(ctx)
    }
    dealTokens(ctx)
    for (const id of ctx.ids) ctx.game.setReady(id, true)

    const view = ctx.game.view()
    const all = [...view.community, ...view.players.flatMap((p) => p.hole ?? [])]
    assert.equal(all.length, 5 + 6 * 2)
    assert.equal(new Set(all).size, all.length)
  })
})

describe('토큰 집기', () => {
  it('중앙에서 집으면 내 앞으로 온다', () => {
    const { game } = makeGame(3)
    assert.equal(game.takeToken('p1', 2).ok, true)

    const view = game.view()
    assert.equal(view.players.find((p) => p.id === 'p1')?.currentToken, 2)
    assert.deepEqual(view.centerTokens, [1, 3])
  })

  it('남이 쥔 토큰도 뺏어올 수 있다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 2)
    ctx.advance(TOKEN_LOCK_MS)

    assert.equal(ctx.game.takeToken('p2', 2).ok, true)
    const view = ctx.game.view()
    assert.equal(view.players.find((p) => p.id === 'p2')?.currentToken, 2)
    assert.equal(view.players.find((p) => p.id === 'p1')?.currentToken, null)
  })

  it('내가 다른 토큰을 집으면 쥐고 있던 것은 중앙으로 돌아간다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)
    ctx.game.takeToken('p1', 3)

    const view = ctx.game.view()
    assert.equal(view.players.find((p) => p.id === 'p1')?.currentToken, 3)
    assert.ok(view.centerTokens.includes(1))
  })

  it('쥐고 있던 것을 다시 누르면 중앙으로 돌려놓는다', () => {
    // 선언을 무르는 자리다. 남의 것을 뺏어야만 내 것을 놓을 수 있으면,
    // 생각이 바뀐 사람은 남의 자리를 흔들지 않고서는 물러설 수 없다.
    const ctx = makeGame(3)
    assert.equal(ctx.game.takeToken('p1', 1).ok, true)
    ctx.advance(TOKEN_LOCK_MS)

    assert.equal(ctx.game.takeToken('p1', 1).ok, true, '다시 누르면 내려놓는다')
    const view = ctx.game.view()
    assert.equal(view.players.find((p) => p.id === 'p1')?.currentToken, null)
    assert.deepEqual(view.centerTokens, [1, 2, 3], '중앙으로 돌아간다')
  })

  it('내려놓은 토큰도 날아가는 동안은 잠긴다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)
    ctx.game.takeToken('p1', 1)

    assert.equal(ctx.game.view().lockedTokens.includes(1), true)
    assert.equal(ctx.game.takeToken('p2', 1).ok, false, '비행 중인 토큰은 낚아챌 수 없다')
    ctx.advance(TOKEN_LOCK_MS)
    assert.equal(ctx.game.takeToken('p2', 1).ok, true, '도착하면 아무나 집을 수 있다')
  })

  it('내려놓으면 확정이 풀리고 다시 확정할 수 없다', () => {
    const ctx = makeGame(3)
    dealTokens(ctx)
    for (const id of ctx.ids) assert.equal(ctx.game.setReady(id, true).ok, true, `${id} 확정`)
    // 셋이 다 확정하면 라운드가 넘어가므로, 마지막 한 명은 확정을 물려 두고 시작한다.
    assert.equal(ctx.game.setReady('p3', false).ok, true)

    assert.equal(ctx.game.takeToken('p1', 1).ok, true, '내려놓기')
    const view = ctx.game.view()
    assert.equal(view.players.every((p) => !p.ready), true, '모두의 확정이 풀린다')
    assert.equal(view.canConfirm, false, '한 자리가 비었으니 확정할 수 없다')
    assert.equal(ctx.game.setReady('p2', true).ok, false)
  })

  it('판에 없는 사람은 집을 수 없다', () => {
    const { game } = makeGame(3)
    const result = game.takeToken('구경꾼', 1)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_IN_ROOM')
  })
})

describe('뺏겼다는 알림', () => {
  it('뺏긴 사람에게만 간다 — 누가 가져갔는지 공개 상태로는 알 수 없다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 2)
    ctx.advance(TOKEN_LOCK_MS)
    ctx.game.takeToasts() // 여기까지는 아무 일도 없었다

    ctx.game.takeToken('p2', 2)

    const toasts = ctx.game.takeToasts()
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].toId, 'p1')
    assert.match(toasts[0].text, /사람2님에게 2번 토큰을 뺏겼습니다/)
  })

  it('중앙에서 집은 것은 아무에게도 알리지 않는다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    assert.deepEqual(ctx.game.takeToasts(), [])
  })

  it('한 번 가져가면 비워진다 — 같은 알림이 두 번 가지 않는다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 2)
    ctx.advance(TOKEN_LOCK_MS)
    ctx.game.takeToken('p2', 2)

    assert.equal(ctx.game.takeToasts().length, 1)
    assert.deepEqual(ctx.game.takeToasts(), [])
  })
})

describe('토큰 잠금', () => {
  it('방금 움직인 토큰은 잠시 아무도 만질 수 없다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 2)

    const result = ctx.game.takeToken('p2', 2)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'TOKEN_LOCKED')
    assert.deepEqual(ctx.game.view().lockedTokens, [2])
  })

  it('잠금이 풀리면 뺏을 수 있다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 2)
    ctx.advance(TOKEN_LOCK_MS)
    assert.equal(ctx.game.takeToken('p2', 2).ok, true)
  })

  it('잠금은 그 토큰에만 걸린다 — 다른 토큰은 동시에 움직일 수 있다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    assert.equal(ctx.game.takeToken('p2', 2).ok, true, '전역으로 잠그면 서로의 입력을 먹는다')
    assert.equal(ctx.game.takeToken('p3', 3).ok, true)
  })

  it('중앙으로 돌아가는 토큰도 날아가는 동안 잠긴다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)
    ctx.game.takeToken('p1', 3) // 1번이 중앙으로 되돌아간다

    assert.ok(ctx.game.view().lockedTokens.includes(1))
    const result = ctx.game.takeToken('p2', 1)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'TOKEN_LOCKED')
  })

  it('같은 토큰을 동시에 노리면 먼저 도착한 쪽이 이긴다', () => {
    const ctx = makeGame(3)
    assert.equal(ctx.game.takeToken('p2', 3).ok, true)
    assert.equal(ctx.game.takeToken('p3', 3).ok, false)
    assert.equal(ctx.game.view().players.find((p) => p.id === 'p2')?.currentToken, 3)
  })
})

describe('확정과 라운드 전환', () => {
  it('중앙에 토큰이 남아 있으면 확정할 수 없다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    assert.equal(ctx.game.view().canConfirm, false)

    const result = ctx.game.setReady('p1', true)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /모두가 토큰을/)
  })

  it('모두가 토큰을 쥐면 확정 버튼이 열린다', () => {
    const ctx = makeGame(3)
    dealTokens(ctx)
    assert.equal(ctx.game.view().canConfirm, true)
  })

  it('한 명이라도 선택을 번복하면 모두의 확정이 풀린다', () => {
    const ctx = makeGame(3)
    dealTokens(ctx)
    ctx.game.setReady('p1', true)
    ctx.game.setReady('p2', true)
    assert.equal(ctx.game.view().players.filter((p) => p.ready).length, 2)

    ctx.game.takeToken('p3', 1) // p1 것을 뺏는다
    assert.equal(ctx.game.view().players.every((p) => !p.ready), true)
  })

  it('모두 확정하면 다음 라운드가 열리고 플롭 세 장이 깔린다', () => {
    const ctx = makeGame(3)
    passRound(ctx)

    const view = ctx.game.view()
    assert.equal(view.round, 2)
    assert.equal(view.community.length, 3)
    assert.deepEqual(view.centerTokens, [1, 2, 3], '새 라운드는 토큰이 다시 중앙에 모인다')
    assert.equal(view.players.every((p) => !p.ready), true)
  })

  it('지난 라운드에 확정한 토큰이 이력으로 남는다', () => {
    const ctx = makeGame(3)
    passRound(ctx)

    const p2 = ctx.game.view().players.find((p) => p.id === 'p2')
    assert.deepEqual(p2?.history, [2, null, null, null])
  })

  it('턴과 리버는 한 장씩 깔린다', () => {
    const ctx = makeGame(3)
    passRound(ctx)
    assert.equal(ctx.game.view().community.length, 3)
    passRound(ctx)
    assert.equal(ctx.game.view().round, 3)
    assert.equal(ctx.game.view().community.length, 4)
    passRound(ctx)
    assert.equal(ctx.game.view().round, 4)
    assert.equal(ctx.game.view().community.length, 5)
  })
})

describe('은닉 정보', () => {
  it('진행 중에는 공개 상태에 누구의 홀카드도 없다 — 내 것도', () => {
    const ctx = makeGame(3)
    for (const player of ctx.game.view().players) {
      assert.equal(player.hole, null, '홀카드가 공개 상태에 실리면 게임이 성립하지 않는다')
    }
  })

  it('내 카드는 따로 물어야 나온다', () => {
    const { game } = makeGame(3)
    assert.equal(game.handOf('p1')?.length, 2)
    assert.equal(game.handOf('구경꾼'), null)
  })

  it('쇼다운에 이르러서야 모두의 카드가 공개된다', () => {
    const ctx = makeGame(3)
    for (let i = 0; i < 4; i++) passRound(ctx)

    const view = ctx.game.view()
    assert.equal(view.phase, 'showdown')
    for (const player of view.players) assert.equal(player.hole?.length, 2)
  })
})

describe('쇼다운과 판 누적', () => {
  it('4라운드가 끝나면 빨강 토큰 순서로 판정한다', () => {
    const ctx = makeGame(3)
    for (let i = 0; i < 4; i++) passRound(ctx)

    const view = ctx.game.view()
    assert.notEqual(view.showdown, null)
    assert.deepEqual(view.showdown?.reveals.map((r) => r.token), [1, 2, 3])
    assert.equal(view.vaults + view.alarms, 1, '판마다 금고나 경보 하나가 올라간다')
  })

  it('결과를 모두 확인해야 다음 판이 시작된다', () => {
    const ctx = makeGame(3)
    for (let i = 0; i < 4; i++) passRound(ctx)
    if (ctx.game.isOver) return // 3판 안에 끝날 수 없으므로 여기 오지 않는다

    ctx.game.continueAfterHeist('p1')
    assert.equal(ctx.game.view().heist, 1, '한 명만 눌러서는 넘어가지 않는다')

    ctx.game.continueAfterHeist('p2')
    ctx.game.continueAfterHeist('p3')

    const view = ctx.game.view()
    assert.equal(view.heist, 2)
    assert.equal(view.round, 1)
    assert.deepEqual(view.community, [])
    assert.equal(view.showdown, null)
  })

  it('끊긴 사람은 기다려주지 않는다 — 남은 사람만 동의하면 넘어간다', () => {
    const ctx = makeGame(3)
    for (let i = 0; i < 4; i++) passRound(ctx)
    if (ctx.game.isOver) return

    ctx.game.setConnected('p3', false)
    ctx.game.continueAfterHeist('p1')
    ctx.game.continueAfterHeist('p2')
    assert.equal(ctx.game.view().heist, 2)
  })

  it('토큰을 집는 중에는 다음 판으로 넘어갈 수 없다', () => {
    const ctx = makeGame(3)
    const result = ctx.game.continueAfterHeist('p1')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'WRONG_PHASE')
  })

  it('쇼다운 중에는 토큰을 집을 수 없다', () => {
    const ctx = makeGame(3)
    for (let i = 0; i < 4; i++) passRound(ctx)

    const result = ctx.game.takeToken('p1', 1)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'WRONG_PHASE')
  })
})

describe('게임 종료', () => {
  /** 결과를 원하는 대로 만들기 위해 판을 끝까지 돌리고 결과에 따라 세어 나간다. */
  function playUntilOver(count = 3) {
    const ctx = makeGame(count)
    let guard = 0
    while (!ctx.game.isOver && guard++ < 10) {
      for (let i = 0; i < 4; i++) passRound(ctx)
      if (ctx.game.isOver) break
      for (const id of ctx.ids) ctx.game.continueAfterHeist(id)
    }
    return ctx
  }

  it('금고 3개나 경보 3개에서 끝난다', () => {
    const ctx = playUntilOver()
    const view = ctx.game.view()
    assert.equal(view.phase, 'gameOver')
    assert.ok(view.vaults === 3 || view.alarms === 3, `금고 ${view.vaults} 경보 ${view.alarms}`)
    assert.equal(view.outcome, view.vaults === 3 ? 'win' : 'lose')
  })

  it('한 게임은 다섯 판을 넘지 않는다', () => {
    const view = playUntilOver().game.view()
    assert.ok(view.heist <= 5, `${view.heist}판까지 갔다`)
  })

  it('끝난 뒤에는 더 진행되지 않는다', () => {
    const ctx = playUntilOver()
    assert.equal(ctx.game.continueAfterHeist('p1').ok, false)
    assert.equal(ctx.game.takeToken('p1', 1).ok, false)
  })
})

describe('자동 확정', () => {
  /*
   * 서버는 무엇이 바뀌든 곧바로 상태를 내보낸다. 그 자리에서 시계가 맞춰지므로,
   * 여기서도 토큰을 집을 때마다 상태를 한 번 본다 — 보지 않고 시간만 돌리면
   * 시계가 나중에 시작해 남은 시간이 실제보다 길게 잡힌다.
   */
  function fillTokens(ctx: ReturnType<typeof makeGame>) {
    ctx.ids.forEach((id, index) => {
      assert.equal(ctx.game.takeToken(id, index + 1).ok, true)
      ctx.game.view()
      if (index < ctx.ids.length - 1) ctx.advance(TOKEN_LOCK_MS)
    })
  }

  it('모두가 토큰을 쥐기 전에는 시계가 돌지 않는다', () => {
    const ctx = makeGame(3)
    assert.equal(ctx.game.view().autoConfirmIn, null)
    ctx.game.takeToken('p1', 1)
    assert.equal(ctx.game.view().autoConfirmIn, null)
  })

  it('모두가 쥐면 15초를 잰다', () => {
    const ctx = makeGame(3)
    fillTokens(ctx)
    assert.equal(ctx.game.view().autoConfirmIn, AUTO_CONFIRM_MS)
  })

  it('시간이 되기 전에는 넘어가지 않는다', () => {
    const ctx = makeGame(3)
    fillTokens(ctx)
    ctx.advance(AUTO_CONFIRM_MS - 1)
    assert.equal(ctx.game.autoConfirm(), false)
    assert.equal(ctx.game.view().round, 1)
    assert.equal(ctx.game.view().autoConfirmIn, 1)
  })

  it('시간이 다 되면 아무도 누르지 않아도 다음 라운드로 간다', () => {
    const ctx = makeGame(3)
    fillTokens(ctx)
    // 한 명만 「확정」을 눌러 둔 채로 나머지가 가만히 있어도 다 같이 넘어간다.
    assert.equal(ctx.game.setReady('p1', true).ok, true)
    ctx.advance(AUTO_CONFIRM_MS)

    assert.equal(ctx.game.autoConfirm(), true)
    const view = ctx.game.view()
    assert.equal(view.round, 2)
    assert.equal(view.community.length, 3)
    // 쥐고 있던 것이 이력으로 굳는다. 사람이 눌러 넘어간 것과 같은 결과여야 한다.
    assert.deepEqual(
      view.players.map((player) => player.history[0]),
      [1, 2, 3],
    )
    assert.equal(view.autoConfirmIn, null)
  })

  it('토큰이 다시 오가면 시계도 처음부터다', () => {
    const ctx = makeGame(3)
    fillTokens(ctx)
    ctx.advance(3_000)
    assert.equal(ctx.game.view().autoConfirmIn, AUTO_CONFIRM_MS - 3_000)

    // 쥐고 있던 것을 다시 누르면 내려놓는 것이다. 한 사람의 손이 비는 동안은 재지 않는다.
    assert.equal(ctx.game.takeToken('p3', 3).ok, true)
    assert.equal(ctx.game.view().autoConfirmIn, null)

    ctx.advance(TOKEN_LOCK_MS)
    assert.equal(ctx.game.takeToken('p3', 3).ok, true)
    assert.equal(ctx.game.view().autoConfirmIn, AUTO_CONFIRM_MS)
  })

  it('리버에서는 재지 않는다', () => {
    const ctx = makeGame(3)
    passRound(ctx)
    passRound(ctx)
    passRound(ctx)
    assert.equal(ctx.game.view().round, 4)

    fillTokens(ctx)
    assert.equal(ctx.game.view().canConfirm, true)
    assert.equal(ctx.game.view().autoConfirmIn, null)

    ctx.advance(AUTO_CONFIRM_MS * 2)
    assert.equal(ctx.game.autoConfirm(), false)
    assert.equal(ctx.game.view().phase, 'picking')
  })

  it('꺼 두면 아예 재지 않는다', () => {
    const game = new Game(
      'TEST',
      [
        { id: 'p1', nickname: '가', connected: true },
        { id: 'p2', nickname: '나', connected: true },
      ],
      { now: () => 1_000_000, rng: mulberry32(1), autoConfirmMs: 0 },
    )
    assert.equal(game.takeToken('p1', 1).ok, true)
    assert.equal(game.takeToken('p2', 2).ok, true)
    assert.equal(game.view().canConfirm, true)
    assert.equal(game.view().autoConfirmIn, null)
  })
})

/** 변형 하나로 도는 판. 시계는 손으로 돌린다. */
function variantGame(variant: PokerVariant, count = 4) {
  let clock = 1_000_000
  const players: StartingPlayer[] = Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    nickname: `사람${i + 1}`,
    connected: true,
  }))
  const game = new Game('TEST', players, { variant, now: () => clock, rng: mulberry32(99) })
  return {
    game,
    ids: players.map((p) => p.id),
    advance: (ms: number) => {
      clock += ms
    },
  }
}

/** 라운드 넷을 끝까지 밀어 쇼다운까지 간다. */
function playToShowdown(ctx: ReturnType<typeof variantGame>) {
  for (let round = 0; round < 4; round++) {
    dealTokens(ctx)
    for (const id of ctx.ids) assert.equal(ctx.game.setReady(id, true).ok, true)
  }
}

describe('오마하로 도는 판', () => {
  const omahaGame = (count = 4) => variantGame('omaha', count)

  it('네 장씩 나눠준다', () => {
    const { game, ids } = omahaGame()
    assert.equal(game.view().variant, 'omaha')
    assert.equal(game.view().holeCount, 4)
    for (const id of ids) assert.equal(game.handOf(id)?.length, 4)
  })

  it('공용 카드는 텍사스와 같은 걸음으로 열린다', () => {
    const ctx = omahaGame()
    const quota = [0, 3, 4, 5]
    for (const expected of quota) {
      assert.equal(ctx.game.view().community.length, expected)
      if (expected === 5) break
      dealTokens(ctx)
      for (const id of ctx.ids) ctx.game.setReady(id, true)
    }
  })

  it('쇼다운까지 간다 — 판정이 오마하 규칙으로 선다', () => {
    const ctx = omahaGame()
    playToShowdown(ctx)
    const view = ctx.game.view()
    assert.equal(view.phase, 'showdown')
    assert.equal(view.showdown?.reveals.length, ctx.ids.length)
    // 쓴 다섯 장은 언제나 손 둘 + 공용 셋이다.
    for (const reveal of view.showdown!.reveals) {
      const fromHole = reveal.value.cards.filter((card) => reveal.hole.includes(card))
      assert.equal(fromHole.length, 2, `${reveal.playerId} 가 손에서 ${fromHole.length}장을 썼다`)
    }
  })
})

describe('스팟스로 도는 판', () => {
  it('네 장씩 나눠주고 공용은 세 장씩 세 걸음으로 아홉 장', () => {
    const ctx = variantGame('spots')
    assert.equal(ctx.game.view().holeCount, 4)

    for (const expected of [0, 3, 6, 9]) {
      assert.equal(ctx.game.view().community.length, expected)
      if (expected === 9) break
      dealTokens(ctx)
      for (const id of ctx.ids) ctx.game.setReady(id, true)
    }
  })

  it('쇼다운까지 간다 — 쓴 다섯 장은 한 줄 안에서만 나온다', () => {
    const ctx = variantGame('spots')
    playToShowdown(ctx)

    const view = ctx.game.view()
    assert.equal(view.phase, 'showdown')
    for (const reveal of view.showdown!.reveals) {
      const fromBoard = reveal.value.cards.filter((card) => view.community.includes(card))
      // 줄은 셋뿐이라 보드에서 넷 이상을 가져올 수 없다.
      assert.ok(fromBoard.length <= 3, `${reveal.playerId} 가 보드에서 ${fromBoard.length}장을 썼다`)
      // 그 카드들이 실제로 한 줄 안에 있어야 한다.
      const at = fromBoard.map((card) => view.community.indexOf(card))
      const onOneLine = SPOTS_LINES.some((line) => at.every((index) => line.includes(index)))
      assert.ok(onOneLine, `${reveal.playerId} 의 보드 카드가 한 줄에 있지 않다: ${at.join()}`)
    }
  })

  it('감지기는 첫 줄을 본다 — 텍사스의 플롭 자리와 같다', () => {
    // 「동작 감지기」는 2라운드에 열린 카드에 그림카드가 있는지로 친다.
    // 스팟스에서 그 자리는 격자의 첫 가로줄(0·1·2)이고, community.slice(0, 3) 그대로다.
    const ctx = variantGame('spots')
    dealTokens(ctx)
    for (const id of ctx.ids) ctx.game.setReady(id, true)
    assert.equal(ctx.game.view().community.length, 3)
  })
})

describe('서클잭으로 도는 판', () => {
  it('두 장씩 나눠주고 원은 3 → 6 → 7 로 채워진다', () => {
    const ctx = variantGame('circle')
    assert.equal(ctx.game.view().holeCount, 2)

    for (const expected of [0, 3, 6, 7]) {
      assert.equal(ctx.game.view().community.length, expected)
      if (expected === 7) break
      dealTokens(ctx)
      for (const id of ctx.ids) ctx.game.setReady(id, true)
    }
  })

  it('와일드를 켜면 마지막에 여덟째가 함께 열린다', () => {
    const ctx = variantGame('circleWild')
    for (const expected of [0, 3, 6, 8]) {
      assert.equal(ctx.game.view().community.length, expected)
      if (expected === 8) break
      dealTokens(ctx)
      for (const id of ctx.ids) ctx.game.setReady(id, true)
    }
  })

  it('쇼다운까지 간다 — 보드에서 쓴 카드는 이웃한 세 자리 안이다', () => {
    const ctx = variantGame('circle')
    playToShowdown(ctx)

    const view = ctx.game.view()
    assert.equal(view.phase, 'showdown')
    for (const reveal of view.showdown!.reveals) {
      const at = reveal.value.cards
        .filter((card) => view.community.includes(card))
        .map((card) => view.community.indexOf(card))
      assert.ok(at.length <= 3, `${reveal.playerId} 가 보드에서 ${at.length}장을 썼다`)
      const neighbours = CIRCLE_TRIPLES.some((triple) => at.every((index) => triple.includes(index)))
      assert.ok(neighbours, `${reveal.playerId} 의 보드 카드가 이웃이 아니다: ${at.join()}`)
    }
  })

  it('와일드 판의 쇼다운에서도 판에 없는 카드는 나오지 않는다', () => {
    const ctx = variantGame('circleWild')
    playToShowdown(ctx)

    const view = ctx.game.view()
    for (const reveal of view.showdown!.reveals) {
      for (const card of reveal.value.cards) {
        const onTable = reveal.hole.includes(card) || view.community.includes(card)
        assert.ok(onTable, `${card} 는 판에 없는 카드다 — 화면이 짚을 자리가 없다`)
      }
    }
  })
})

describe('바나나스플릿으로 도는 판', () => {
  it('두 장씩 나눠주고 판이 인원과 함께 커진다', () => {
    const ctx = variantGame('banana', 5)
    assert.equal(ctx.game.view().holeCount, 2)

    // 자리 다섯이면 묶음도 다섯. 라운드마다 묶음마다 한 장씩.
    for (const expected of [0, 5, 10, 15]) {
      assert.equal(ctx.game.view().community.length, expected)
      if (expected === 15) break
      dealTokens(ctx)
      for (const id of ctx.ids) ctx.game.setReady(id, true)
    }
  })

  it('쇼다운 — 사람마다 자기 양옆 여섯 장으로만 판정된다', () => {
    const ctx = variantGame('banana', 5)
    playToShowdown(ctx)

    const view = ctx.game.view()
    assert.equal(view.phase, 'showdown')
    for (const reveal of view.showdown!.reveals) {
      const at = view.players.findIndex((player) => player.id === reveal.playerId)
      const usable = usableCommunity(view, reveal.playerId)
      assert.equal(usable.length, 6, `${reveal.playerId} 가 ${usable.length}장을 본다`)

      for (const card of reveal.value.cards) {
        const ok = reveal.hole.includes(card) || usable.includes(card)
        assert.ok(ok, `자리 ${at} 가 남의 묶음(${card})으로 손을 만들었다`)
      }
    }
  })

  it('마주 보는 자리끼리는 공용이 한 장도 겹치지 않는다', () => {
    const ctx = variantGame('banana', 4)
    playToShowdown(ctx)

    const view = ctx.game.view()
    const zero = new Set(usableCommunity(view, view.players[0].id))
    const two = usableCommunity(view, view.players[2].id)
    assert.equal(two.filter((card) => zero.has(card)).length, 0)
  })
})

/** 테스트 재현용 시드 난수. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
