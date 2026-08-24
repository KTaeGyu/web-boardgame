import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { TOKEN_LOCK_MS } from '@the-gang/shared'
import { Game, type StartingPlayer } from '../src/game.ts'

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

  it('이미 쥐고 있는 토큰은 다시 집을 수 없다', () => {
    const ctx = makeGame(3)
    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)
    assert.equal(ctx.game.takeToken('p1', 1).ok, false)
  })

  it('판에 없는 사람은 집을 수 없다', () => {
    const { game } = makeGame(3)
    const result = game.takeToken('구경꾼', 1)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'NOT_IN_ROOM')
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
