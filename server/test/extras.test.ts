/**
 * 도전자·해결사 카드가 규칙을 어떻게 바꾸는가.
 *
 * 어느 판에 무엇이 걸리는지는 뽑기라 그대로 테스트하기 어렵다. 대신
 * ExtraDealer 를 직접 돌려 순서를 보고, 카드 효과는 Game 안쪽 값을 손으로 세워 확인한다.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATEGORY_LABEL,
  CHALLENGES,
  READY_CHALLENGES,
  READY_SPECIALISTS,
  SPECIALISTS,
  TOKEN_LOCK_MS,
  JACK_CARD,
  bestHolding,
  evaluateBest,
  rankValueOf,
  type ChallengeId,
} from '@the-gang/shared'

/** 족보 이름 → 카테고리 번호. 스캔이 족보를 숫자로 주고받으므로 되짚을 표가 필요하다. */
const HAND_ORDER = Object.values(CATEGORY_LABEL)
const rankValue = (card: string) => rankValueOf(card as never)
import { ExtraDealer } from '@the-gang/shared/extraDealer'
import { Game, type StartingPlayer } from '@the-gang/shared/engine'

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const players: StartingPlayer[] = ['p1', 'p2', 'p3'].map((id) => ({
  id,
  nickname: id,
  connected: true,
}))

/**
 * 특정 도전자 카드가 걸린 판을 만든다.
 *
 * 뽑기로는 원하는 카드가 언제 나올지 알 수 없으므로, 더미를 대신 심는다.
 * 규칙이 무엇을 하는지 보는 것이 목적이지 뽑기를 보는 것이 아니다.
 */
function gameWith(challenges: ChallengeId[], seed = 7) {
  let clock = 1_000_000
  const game = new Game('TEST', players, {
    now: () => clock,
    rng: mulberry32(seed),
    mode: 'advanced',
  })
  const forced = { challenges, specialist: null }
  ;(game as unknown as { dealer: { next: () => unknown } }).dealer = { next: () => forced }
  // 더미를 바꾼 뒤 판을 다시 연다
  ;(game as unknown as { startHeist: () => void }).startHeist()
  return { game, advance: (ms: number) => (clock += ms) }
}

/** 세 명이 1·2·3번 토큰을 나눠 갖고 라운드를 넘긴다. */
function passRound(ctx: ReturnType<typeof gameWith>) {
  for (const [index, player] of players.entries()) {
    const taken = ctx.game.takeToken(player.id, index + 1)
    assert.equal(taken.ok, true, `${player.id} 가 ${index + 1}번을 집지 못했다`)
    ctx.advance(TOKEN_LOCK_MS)
  }
  for (const player of players) assert.equal(ctx.game.setReady(player.id, true).ok, true)
}

describe('카드 목록', () => {
  it('규칙이 붙은 카드만 더미에 들어간다', () => {
    for (const id of READY_CHALLENGES) assert.equal(CHALLENGES[id].ready, true)
    for (const id of READY_SPECIALISTS) assert.equal(SPECIALISTS[id].ready, true)
    assert.ok(READY_CHALLENGES.length > 0)
    assert.ok(READY_SPECIALISTS.length > 0)
  })

  it('모든 카드에 이름과 설명이 있다', () => {
    for (const card of [...Object.values(CHALLENGES), ...Object.values(SPECIALISTS)]) {
      assert.ok(card.name.length > 0, `${card.id} 이름 없음`)
      assert.ok(card.text.length > 5, `${card.id} 설명 없음`)
    }
  })
})

describe('모드별로 무엇이 걸리는가', () => {
  it('기본 모드는 아무것도 걸리지 않는다', () => {
    const dealer = new ExtraDealer('basic', mulberry32(1))
    assert.deepEqual(dealer.next(null), { challenges: [], specialist: null })
    assert.deepEqual(dealer.next(true), { challenges: [], specialist: null })
    assert.deepEqual(dealer.next(false), { challenges: [], specialist: null })
  })

  it('고급 모드 — 첫 판은 비어 있고, 성공하면 도전자 실패하면 해결사', () => {
    const dealer = new ExtraDealer('advanced', mulberry32(1))
    assert.deepEqual(dealer.next(null), { challenges: [], specialist: null }, '첫 판은 그대로')

    const afterWin = dealer.next(true)
    assert.equal(afterWin.challenges.length, 1)
    assert.equal(afterWin.specialist, null)

    const afterLoss = dealer.next(false)
    assert.equal(afterLoss.challenges.length, 0)
    assert.notEqual(afterLoss.specialist, null)
  })

  it('고급 모드는 더미를 한 바퀴 돌 때까지 같은 카드를 다시 내지 않는다', () => {
    const dealer = new ExtraDealer('advanced', mulberry32(1))
    dealer.next(null)
    const seen = READY_CHALLENGES.map(() => dealer.next(true).challenges[0])
    assert.equal(new Set(seen).size, READY_CHALLENGES.length)
  })

  it('프로 모드 — 한 장이 첫 판부터 끝까지 붙어 있다', () => {
    const dealer = new ExtraDealer('professional', mulberry32(3))
    const first = dealer.next(null)
    assert.equal(first.challenges.length, 1, '게임 시작부터 한 장이 걸린다')
    const permanent = first.challenges[0]

    const second = dealer.next(true)
    assert.ok(second.challenges.includes(permanent), '계속 붙어 있어야 한다')
    assert.equal(second.challenges.length, 2, '성공했으니 한 장이 더 얹힌다')

    const third = dealer.next(false)
    assert.deepEqual(third.challenges, [permanent], '실패하면 얹힌 것만 빠진다')
    assert.notEqual(third.specialist, null)
  })

  it('프로·마스터 시프에서는 「빠른 접근」이 나오지 않는다', () => {
    for (const mode of ['professional', 'masterThief'] as const) {
      const dealer = new ExtraDealer(mode, mulberry32(5))
      let selection = dealer.next(null)
      for (let i = 0; i < 30; i++) {
        assert.ok(!selection.challenges.includes(1), `${mode} 에서 빠른 접근이 나왔다`)
        selection = dealer.next(true)
      }
    }
  })

  it('마스터 시프 — 언제나 두 장이고 해결사는 없다', () => {
    const dealer = new ExtraDealer('masterThief', mulberry32(9))
    let selection = dealer.next(null)
    assert.equal(selection.challenges.length, 2)

    for (const result of [true, false, true]) {
      selection = dealer.next(result)
      assert.equal(selection.challenges.length, 2, '성공하든 실패하든 두 장')
      assert.equal(selection.specialist, null, '마스터 시프에는 해결사가 없다')
    }
  })

  it('마스터 시프는 경보 두 번이면 끝난다', () => {
    const game = new Game('TEST', players, { mode: 'masterThief', rng: mulberry32(1) })
    assert.equal(game.view().alarmsToLose, 2)

    const basic = new Game('TEST', players, { mode: 'basic', rng: mulberry32(1) })
    assert.equal(basic.view().alarmsToLose, 3)
  })
})

describe('직접 고르기', () => {
  it('고른 카드가 모든 판에 그대로 걸린다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(1), [2, 8])
    for (const result of [null, true, false, true] as const) {
      const selection = dealer.next(result)
      assert.deepEqual(selection.challenges, [2, 8], '뽑기 없이 고른 것만 나온다')
      assert.equal(selection.specialist, null, '해결사는 나오지 않는다')
    }
  })

  it('첫 판부터 걸린다 — 성공을 기다리지 않는다', () => {
    const game = new Game('TEST', players, {
      mode: 'custom',
      pickedChallenges: [10],
      rng: mulberry32(2),
    })
    const view = game.view()
    assert.equal(view.heist, 1)
    assert.deepEqual(view.challenges, [10])
    assert.equal(view.holeCount, 3, '보안 카메라가 첫 판부터 먹는다')
  })

  it('여러 장을 고르면 함께 걸린다', () => {
    const game = new Game('TEST', players, {
      mode: 'custom',
      pickedChallenges: [1, 10],
      rng: mulberry32(3),
    })
    const view = game.view()
    assert.equal(view.round, 2, '빠른 접근')
    assert.equal(view.holeCount, 3, '보안 카메라')
  })

  it('해결사는 방장이 앉힌 판에 그대로 나온다', () => {
    // 「진 다음에만」을 끄면 결과와 무관하게 배치표대로 나온다.
    const dealer = new ExtraDealer('custom', mulberry32(1), [2], [3, null, 10, null, null], {
      specialistOnLoss: false,
    })
    assert.equal(dealer.next(null).specialist, 3, '첫 판')
    assert.equal(dealer.next(true).specialist, null, '둘째 판은 비워 두었다')
    assert.equal(dealer.next(false).specialist, 10, '셋째 판')
  })

  it('기본은 진 다음에만 나온다 — 첫 판에는 직전 판이 없다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(1), [], [10, 10, 10, null, null])
    assert.equal(dealer.next(null).specialist, null, '첫 판')
    assert.equal(dealer.next(true).specialist, null, '이긴 다음')
    assert.equal(dealer.next(false).specialist, 10, '진 다음')
  })

  it('빈칸만 있는 판은 해결사 없이 지나간다', () => {
    // 마지막 판에만 하나 앉히는 것이 「직접 고르기」를 만든 이유다.
    const dealer = new ExtraDealer('custom', mulberry32(1), [], [null, null, null, null, 10], {
      specialistOnLoss: false,
    })
    for (let heist = 1; heist <= 4; heist += 1) {
      assert.equal(dealer.next(heist === 1 ? null : true).specialist, null, `${heist}판`)
    }
    assert.equal(dealer.next(true).specialist, 10, '다섯째 판')
  })

  it('같은 해결사가 판마다 다시 걸린다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(1), [], [10, 10, null, null, null], {
      specialistOnLoss: false,
    })
    assert.equal(dealer.next(null).specialist, 10, '첫 판')
    assert.equal(dealer.next(true).specialist, 10, '둘째 판에도 같은 카드')
    assert.equal(dealer.next(true).specialist, null, '셋째 판은 비어 있다')
  })

  it('배치표를 넘어선 판은 해결사가 없다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(1), [], [10], { specialistOnLoss: false })
    assert.equal(dealer.next(null).specialist, 10)
    assert.equal(dealer.next(true).specialist, null)
  })

  it('해결사만 골라도 된다', () => {
    const game = new Game('TEST', players, {
      mode: 'custom',
      pickedChallenges: [],
      specialistRounds: [10],
      specialistOnLoss: false,
      rng: mulberry32(5),
    })
    const view = game.view()
    assert.deepEqual(view.challenges, [])
    assert.equal(view.specialist, 10)
  })

  it('아무것도 고르지 않으면 기본 모드와 같아진다', () => {
    const game = new Game('TEST', players, { mode: 'custom', pickedChallenges: [], rng: mulberry32(4) })
    assert.deepEqual(game.view().challenges, [])
    assert.equal(game.view().specialist, null)
  })
})

describe('도전자 카드 효과', () => {
  it('빠른 접근 — 1라운드 없이 플롭부터 시작한다', () => {
    const { game } = gameWith([1])
    const view = game.view()
    assert.equal(view.round, 2)
    assert.equal(view.community.length, 3)
  })

  it('보안 카메라 — 카드를 세 장씩 받는다', () => {
    const { game } = gameWith([10])
    assert.equal(game.view().holeCount, 3)
    for (const player of players) assert.equal(game.handOf(player.id)?.length, 3)
  })

  it('보안 카메라가 없으면 두 장이다', () => {
    const { game } = gameWith([])
    assert.equal(game.view().holeCount, 2)
    assert.equal(game.handOf('p1')?.length, 2)
  })

  it('소음 감지기 — 1번 토큰은 한 번 정해지면 뺏을 수 없다', () => {
    const ctx = gameWith([2])
    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)

    const stolen = ctx.game.takeToken('p2', 1)
    assert.equal(stolen.ok, false)
    if (!stolen.ok) assert.match(stolen.message, /바꿀 수 없습니다/)

    const escaped = ctx.game.takeToken('p1', 3)
    assert.equal(escaped.ok, false, '쥔 사람도 내려놓을 수 없다')
    assert.ok(ctx.game.view().lockedTokens.includes(1), '화면에도 잠긴 것으로 보인다')
  })

  it('소음 감지기 — 막힌 세 가지 시도 모두 이유를 알려준다', () => {
    const ctx = gameWith([2])
    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)
    ctx.game.takeToasts() // 집을 때의 「되돌려 놓을 수 없습니다」는 여기서 비운다

    ctx.game.takeToken('p2', 1)
    const stealing = ctx.game.takeToasts()
    assert.equal(stealing.length, 1)
    assert.equal(stealing[0].toId, 'p2', '뺏으려던 사람만 궁금하다')
    assert.match(stealing[0].text, /소음 감지기.*뺏어갈 수 없습니다/)

    ctx.game.takeToken('p1', 3)
    const swapping = ctx.game.takeToasts()
    assert.equal(swapping.length, 1)
    assert.equal(swapping[0].toId, 'p1')
    assert.match(swapping[0].text, /내려놓을 수 없습니다/)

    ctx.game.takeToken('p1', 1)
    const putting = ctx.game.takeToasts()
    assert.equal(putting.length, 1, '쥔 것을 다시 누르는 것도 내려놓으려는 시도다')
    assert.match(putting[0].text, /내려놓을 수 없습니다/)
  })

  it('환기구 — 막힌 이유로 환기구를 댄다', () => {
    const ctx = gameWith([6])
    ctx.game.takeToken('p1', 3) // 세 명이면 3번이 붙박이다
    const taking = ctx.game.takeToasts()
    assert.equal(taking.length, 1)
    assert.match(taking[0].text, /환기구.*되돌려 놓을 수 없습니다/)
  })

  it('붙박이 토큰은 집기 전부터 표시된다', () => {
    const { game } = gameWith([2])
    assert.deepEqual(game.view().stuckTokens, [1], '중앙에 있어도 미리 보여야 한다')

    const ventilation = gameWith([6]).game
    assert.deepEqual(ventilation.view().stuckTokens, [3], '세 명이면 3번이 가장 크다')

    const both = gameWith([2, 6]).game
    assert.deepEqual(both.view().stuckTokens, [1, 3])

    assert.deepEqual(gameWith([]).game.view().stuckTokens, [], '카드가 없으면 붙박이도 없다')
  })

  it('붙박이 표시는 4라운드에 사라진다', () => {
    const ctx = gameWith([2])
    for (let round = 0; round < 3; round++) passRound(ctx)
    assert.equal(ctx.game.view().round, 4)
    assert.deepEqual(ctx.game.view().stuckTokens, [])
  })

  it('소음 감지기 — 다른 토큰은 평소대로 오간다', () => {
    const ctx = gameWith([2])
    ctx.game.takeToken('p1', 2)
    ctx.advance(TOKEN_LOCK_MS)
    assert.equal(ctx.game.takeToken('p2', 2).ok, true)
  })

  it('환기구 — 가장 큰 번호 토큰이 붙박이가 된다', () => {
    const ctx = gameWith([6])
    ctx.game.takeToken('p1', 3) // 세 명이므로 3번이 가장 크다
    ctx.advance(TOKEN_LOCK_MS)

    const stolen = ctx.game.takeToken('p2', 3)
    assert.equal(stolen.ok, false)
    assert.equal(ctx.game.takeToken('p2', 1).ok, true, '1번은 평소대로')
  })

  it('붙박이는 4라운드에는 풀린다', () => {
    const ctx = gameWith([2])
    for (let round = 0; round < 3; round++) passRound(ctx)
    assert.equal(ctx.game.view().round, 4)

    ctx.game.takeToken('p1', 1)
    ctx.advance(TOKEN_LOCK_MS)
    assert.equal(ctx.game.takeToken('p2', 1).ok, true, '마지막 라운드는 자유롭다')
  })

  it('급한 도주 — 2라운드 다음이 곧바로 4라운드다', () => {
    const ctx = gameWith([5])
    passRound(ctx) // 1 → 2
    assert.equal(ctx.game.view().round, 2)

    passRound(ctx) // 2 → 4
    const view = ctx.game.view()
    assert.equal(view.round, 4)
    assert.equal(view.community.length, 5, '건너뛴 라운드의 카드도 함께 열린다')
  })

  it('급한 도주 — 3라운드 이력은 비어 있다', () => {
    const ctx = gameWith([5])
    passRound(ctx)
    passRound(ctx)
    const p1 = ctx.game.view().players.find((p) => p.id === 'p1')
    assert.equal(p1?.history[2], null, '3라운드는 아무도 토큰을 쥐지 않았다')
  })

  it('정전 — 라운드가 넘어가면 지난 토큰이 사라진다', () => {
    const ctx = gameWith([8])
    passRound(ctx)
    assert.deepEqual(
      ctx.game.view().players.find((p) => p.id === 'p2')?.history,
      [null, null, null, null],
      '1라운드 이력이 치워져야 한다',
    )

    passRound(ctx)
    assert.deepEqual(ctx.game.view().players.find((p) => p.id === 'p2')?.history, [
      null,
      null,
      null,
      null,
    ])
  })

  it('정전이 없으면 이력이 남는다', () => {
    const ctx = gameWith([])
    passRound(ctx)
    assert.equal(ctx.game.view().players.find((p) => p.id === 'p2')?.history[0], 2)
  })

  it('정전이어도 쇼다운은 마지막 토큰으로 판정한다', () => {
    const ctx = gameWith([8])
    for (let round = 0; round < 4; round++) passRound(ctx)

    const view = ctx.game.view()
    assert.notEqual(view.showdown, null)
    assert.deepEqual(view.showdown?.reveals.map((r) => r.token), [1, 2, 3])
  })
})

describe('스캔 — 마지막 사람 차례에 답을 맞힌다', () => {
  /** 4라운드까지 끝내 스캔이 열린 판을 만든다. */
  function openScan(challenge: 4 | 9) {
    const ctx = gameWith([challenge])
    for (let round = 0; round < 4; round++) passRound(ctx)
    return ctx
  }

  it('마지막 사람은 아직 공개되지 않는다', () => {
    const { game } = openScan(4)
    const view = game.view()

    assert.equal(view.phase, 'scanning')
    assert.equal(view.scan?.targetId, 'p3', '3번 토큰을 쥔 사람이 대상이다')
    assert.equal(view.players.find((p) => p.id === 'p3')?.hole, null, '대상의 카드는 나가지 않는다')
    assert.equal(view.players.find((p) => p.id === 'p1')?.hole?.length, 2, '나머지는 공개된다')
    assert.equal(view.showdown?.reveals.length, 2, '먼저 공개되는 둘만 판정한다')
  })

  it('지목된 사람은 답할 수 없다', () => {
    const { game } = openScan(4)
    const result = game.voteScan('p3', 'rank', 14)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /지목된 사람/)
  })

  it('답이 갈리면 확정되지 않는다', () => {
    const { game } = openScan(4)
    game.voteScan('p1', 'rank', 14)
    game.voteScan('p2', 'rank', 13)

    const view = game.view()
    assert.equal(view.scan?.questions[0].decided, null)
    assert.equal(view.phase, 'scanning')
    assert.equal(view.scan?.questions[0].votes.length, 2, '표는 서로 보인다')
  })

  it('답을 바꿔 맞추면 그때 확정된다', () => {
    const { game } = openScan(4)
    game.voteScan('p1', 'rank', 14)
    game.voteScan('p2', 'rank', 13)
    game.voteScan('p1', 'rank', 13) // p1 이 p2 에게 맞춘다

    const view = game.view()
    assert.equal(view.scan?.questions[0].decided, 13)
    assert.notEqual(view.phase, 'scanning')
  })

  it('망막 스캔 — 대상이 그 숫자를 갖고 있으면 맞다', () => {
    const ctx = openScan(4)
    const targetRank = ctx.game.handOf('p3')![0][0]
    const value = 'TJQKA'.includes(targetRank)
      ? { T: 10, J: 11, Q: 12, K: 13, A: 14 }[targetRank as 'T' | 'J' | 'Q' | 'K' | 'A']!
      : Number(targetRank)

    ctx.game.voteScan('p1', 'rank', value)
    ctx.game.voteScan('p2', 'rank', value)
    assert.equal(ctx.game.view().scan?.questions[0].correct, true)
  })

  it('망막 스캔을 틀리면 순서가 맞아도 실패한다', () => {
    const ctx = openScan(4)
    const hole = ctx.game.handOf('p3')!
    // 대상이 갖고 있지 않은 숫자를 고른다
    const wrong = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find(
      (value) => !hole.some((card) => rankValue(card) === value),
    )!

    ctx.game.voteScan('p1', 'rank', wrong)
    ctx.game.voteScan('p2', 'rank', wrong)

    const view = ctx.game.view()
    assert.equal(view.scan?.questions[0].correct, false)
    assert.equal(view.showdown?.success, false, '스캔을 틀리면 판이 실패한다')
    assert.deepEqual(
      view.showdown?.reveals.map((r) => r.ok),
      [true, true, true],
      '순서 자체는 맞았다는 것이 보여야 한다',
    )
  })

  it('지문 스캔 — 대상의 족보를 맞혀야 한다', () => {
    const ctx = openScan(9)
    const view = ctx.game.view()
    assert.equal(view.scan?.questions[0].kind, 'category')

    const actual = bestHolding([...ctx.game.handOf('p3')!, ...view.community])!
    const category = HAND_ORDER.indexOf(actual.name)
    ctx.game.voteScan('p1', 'category', category)
    ctx.game.voteScan('p2', 'category', category)
    assert.equal(ctx.game.view().scan?.questions[0].correct, true)
  })

  it('맞히면 순서대로 성공한다', () => {
    const ctx = openScan(9)
    const actual = bestHolding([...ctx.game.handOf('p3')!, ...ctx.game.view().community])!
    const category = HAND_ORDER.indexOf(actual.name)
    ctx.game.voteScan('p1', 'category', category)
    ctx.game.voteScan('p2', 'category', category)

    const view = ctx.game.view()
    assert.equal(view.players.find((p) => p.id === 'p3')?.hole?.length, 2, '이제 모두 공개된다')
    assert.equal(view.showdown?.reveals.length, 3)
    assert.equal(view.showdown?.success, true)
  })

  it('둘 다 걸리면 둘 다 물어야 한다', () => {
    const ctx = gameWith([4, 9])
    for (let round = 0; round < 4; round++) passRound(ctx)

    const view = ctx.game.view()
    assert.deepEqual(view.scan?.questions.map((q) => q.kind), ['rank', 'category'])

    // 숫자만 맞혀서는 넘어가지 않는다
    const hole = ctx.game.handOf('p3')!
    const rank = rankValue(hole[0])
    ctx.game.voteScan('p1', 'rank', rank)
    ctx.game.voteScan('p2', 'rank', rank)
    assert.equal(ctx.game.view().phase, 'scanning', '남은 물음이 있으면 그대로다')
    assert.equal(ctx.game.view().scan?.questions[0].correct, true)

    const actual = bestHolding([...hole, ...view.community])!
    const category = HAND_ORDER.indexOf(actual.name)
    ctx.game.voteScan('p1', 'category', category)
    ctx.game.voteScan('p2', 'category', category)

    const after = ctx.game.view()
    assert.notEqual(after.phase, 'scanning')
    assert.equal(after.showdown?.success, true, '둘 다 맞혔으니 순서대로면 성공이다')
  })

  it('하나만 틀려도 판은 실패한다', () => {
    const ctx = gameWith([4, 9])
    for (let round = 0; round < 4; round++) passRound(ctx)

    const hole = ctx.game.handOf('p3')!
    const wrongRank = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find(
      (value) => !hole.some((card) => rankValue(card) === value),
    )!
    ctx.game.voteScan('p1', 'rank', wrongRank)
    ctx.game.voteScan('p2', 'rank', wrongRank)

    const actual = bestHolding([...hole, ...ctx.game.view().community])!
    const category = HAND_ORDER.indexOf(actual.name)
    ctx.game.voteScan('p1', 'category', category)
    ctx.game.voteScan('p2', 'category', category)

    const after = ctx.game.view()
    assert.deepEqual(after.scan?.questions.map((q) => q.correct), [false, true])
    assert.equal(after.showdown?.success, false)
  })

  it('이미 정해진 물음에는 다시 답할 수 없다', () => {
    const ctx = gameWith([4])
    for (let round = 0; round < 4; round++) passRound(ctx)
    ctx.game.voteScan('p1', 'rank', 5)
    ctx.game.voteScan('p2', 'rank', 5)
    assert.equal(ctx.game.voteScan('p1', 'rank', 6).ok, false)
  })

  it('스캔이 없으면 바로 쇼다운이다', () => {
    const ctx = gameWith([])
    for (let round = 0; round < 4; round++) passRound(ctx)
    assert.equal(ctx.game.view().scan, null)
    assert.notEqual(ctx.game.view().phase, 'scanning')
  })
})

describe('카드를 새로 받게 만드는 감지기', () => {
  /** 플롭에 그림카드가 있는지 없는지에 따라 갈리므로, 그 조건이 맞는 판을 찾는다. */
  /** 여러 장을 함께 건 판. 감지기 둘이 같이 걸린 자리를 보려면 이쪽이 필요하다. */
  function findFlopWith(challenges: ChallengeId[], wantFace: boolean) {
    for (let seed = 1; seed < 400; seed++) {
      const ctx = gameWith(challenges, seed)
      passRound(ctx)
      const flop = ctx.game.view().community.slice(0, 3)
      const hasFace = flop.some((card) => ['J', 'Q', 'K'].includes(card[0]))
      if (hasFace === wantFace) return ctx
    }
    throw new Error('조건에 맞는 판을 못 찾았다')
  }

  function findFlop(challenge: ChallengeId, wantFace: boolean) {
    for (let seed = 1; seed < 400; seed++) {
      const ctx = gameWith([challenge], seed)
      const before = new Map(players.map((p) => [p.id, ctx.game.handOf(p.id)!.join(' ')]))
      passRound(ctx)
      const flop = ctx.game.view().community.slice(0, 3)
      const hasFace = flop.some((card) => ['J', 'Q', 'K'].includes(card[0]))
      if (hasFace === wantFace) return { ctx, before }
    }
    throw new Error('조건에 맞는 판을 못 찾았다')
  }

  it('동작 감지기 — 그림카드가 있으면 1번 토큰이 카드를 새로 받는다', () => {
    const { ctx, before } = findFlop(3, true)
    const changed = players.filter((p) => ctx.game.handOf(p.id)!.join(' ') !== before.get(p.id))
    assert.deepEqual(changed.map((p) => p.id), ['p1'], '1번을 쥔 p1 만 바뀐다')
    assert.equal(ctx.game.handOf('p1')?.length, 2, '장수는 그대로다')
  })

  it('감지기가 작동하면 그 사실이 남는다', () => {
    const { ctx } = findFlop(3, true)
    const view = ctx.game.view()
    assert.deepEqual(view.sensor, { challenge: 3, playerId: 'p1' })
    assert.ok(
      view.announcements.some((a) => a.playerId === 'p1' && a.text.includes('새로 받았습니다')),
      '누가 새로 받았는지 모두에게 알려야 한다',
    )
  })

  it('둘 다 걸려도 친 것은 하나다 — 그림카드가 없으면 레이저 감지선', () => {
    // 「3이 걸려 있으면 3」으로 적으면 레이저가 친 판에서도 동작 감지기라고 말한다.
    const ctx = findFlopWith([3, 7], false)
    assert.deepEqual(ctx.game.view().sensor, { challenge: 7, playerId: 'p3' }, '가장 큰 토큰을 친다')
  })

  it('둘 다 걸리고 그림카드가 있으면 동작 감지기다', () => {
    const ctx = findFlopWith([3, 7], true)
    assert.deepEqual(ctx.game.view().sensor, { challenge: 3, playerId: 'p1' }, '1번 토큰을 친다')
  })

  it('동작 감지기 — 그림카드가 없으면 아무 일도 없다', () => {
    const { ctx, before } = findFlop(3, false)
    for (const p of players) assert.equal(ctx.game.handOf(p.id)!.join(' '), before.get(p.id))
  })

  it('레이저 감지선 — 그림카드가 없으면 가장 큰 토큰이 카드를 새로 받는다', () => {
    const { ctx, before } = findFlop(7, false)
    const changed = players.filter((p) => ctx.game.handOf(p.id)!.join(' ') !== before.get(p.id))
    assert.deepEqual(changed.map((p) => p.id), ['p3'], '3번을 쥔 p3 만 바뀐다')
  })

  it('레이저 감지선 — 그림카드가 있으면 아무 일도 없다', () => {
    const { ctx, before } = findFlop(7, true)
    for (const p of players) assert.equal(ctx.game.handOf(p.id)!.join(' '), before.get(p.id))
    assert.equal(ctx.game.view().sensor, null, '작동하지 않았으면 알릴 것도 없다')
  })

  it('빠른 접근과 겹쳐도 작동한다 — 토큰을 처음 나눈 라운드를 기준으로', () => {
    // 「빠른 접근」이 1라운드를 없애므로 처음 선언은 2라운드다.
    // 그 선언이 끝난 뒤에 감지기가 친다.
    for (let seed = 1; seed < 400; seed++) {
      const ctx = gameWith([1, 3], seed)
      assert.equal(ctx.game.view().round, 2, '1라운드가 없었다')
      const flop = ctx.game.view().community.slice(0, 3)
      if (!flop.some((card) => 'JQK'.includes(card[0]))) continue

      const before = new Map(players.map((p) => [p.id, ctx.game.handOf(p.id)!.join(' ')]))
      assert.deepEqual(
        players.map((p) => ctx.game.handOf(p.id)!.join(' ')),
        [...before.values()],
        '선언이 끝나기 전에는 아무 일도 없다',
      )

      passRound(ctx) // 2라운드 선언 완료
      const changed = players.filter((p) => ctx.game.handOf(p.id)!.join(' ') !== before.get(p.id))
      assert.deepEqual(changed.map((p) => p.id), ['p1'], '1번을 쥔 사람이 새로 받는다')
      assert.deepEqual(ctx.game.view().sensor, { challenge: 3, playerId: 'p1' })
      return
    }
    throw new Error('조건에 맞는 판을 못 찾았다')
  })

  it('빠른 접근 + 레이저 감지선도 같다', () => {
    for (let seed = 1; seed < 400; seed++) {
      const ctx = gameWith([1, 7], seed)
      const flop = ctx.game.view().community.slice(0, 3)
      if (flop.some((card) => 'JQK'.includes(card[0]))) continue

      const before = new Map(players.map((p) => [p.id, ctx.game.handOf(p.id)!.join(' ')]))
      passRound(ctx)
      const changed = players.filter((p) => ctx.game.handOf(p.id)!.join(' ') !== before.get(p.id))
      assert.deepEqual(changed.map((p) => p.id), ['p3'], '가장 큰 토큰을 쥔 사람이 새로 받는다')
      return
    }
    throw new Error('조건에 맞는 판을 못 찾았다')
  })
})

describe('해결사 카드 효과', () => {
  /** 해결사는 실패한 다음 판에 나온다. 여기서는 카드를 직접 심어 확인한다. */
  function gameWithSpecialist(id: number, seed = 11) {
    let clock = 1_000_000
    const game = new Game('TEST', players, {
      now: () => clock,
      rng: mulberry32(seed),
      mode: 'advanced',
    })
    const forced = { challenges: [], specialist: id }
    ;(game as unknown as { dealer: { next: () => unknown } }).dealer = { next: () => forced }
    ;(game as unknown as { startHeist: () => void }).startHeist()
    return game
  }

  /**
   * 「누가 쓸까」를 정해 둔다.
   *
   * 쓰는 사람은 **투표로 정해진다**(2026-09-03). 카드 효과를 보려면 표가 먼저 한 사람으로
   * 모여 있어야 하므로, 여기서는 셋이 같은 사람을 고른 상태를 만들어 둔다.
   */
  function elect(game: Game, who: string) {
    for (const player of players) {
      const voted = game.voteSpecialist(player.id, who)
      assert.equal(voted.ok, true, `${player.id} 의 표가 들어가지 않았다`)
    }
    assert.equal(game.view().specialistVote?.decided, who, '만장일치가 되지 않았다')
  }

  it('투자자 — 각자의 그림카드 수가 모두에게 공개된다', () => {
    const game = gameWithSpecialist(3)
    const view = game.view()
    assert.equal(view.specialist, 3)
    assert.equal(view.announcements.length, 3)

    for (const player of players) {
      const said = view.announcements.find((a) => a.playerId === player.id)
      const actual = game.handOf(player.id)!.filter((c) => 'JQK'.includes(c[0])).length
      assert.match(said!.text, new RegExp(`그림카드 ${actual}장`))
    }
  })

  it('계산가 — 각자의 카드 합이 모두에게 공개된다', () => {
    const game = gameWithSpecialist(8)
    const view = game.view()

    for (const player of players) {
      const hole = game.handOf(player.id)!
      const expected = hole.reduce((sum, card) => {
        const rank = card[0]
        if (rank === 'A') return sum + 11
        if ('TJQK'.includes(rank)) return sum + 10
        return sum + Number(rank)
      }, 0)
      const said = view.announcements.find((a) => a.playerId === player.id)
      assert.match(said!.text, new RegExp(`합 ${expected}$`))
    }
  })

  it('저절로 발동하는 카드는 「쓸지 말지」를 묻지 않는다', () => {
    const game = gameWithSpecialist(3)
    assert.equal(game.view().specialistUsed, true, '이미 쓴 것으로 둔다')
    const again = game.useSpecialist('p1', {})
    assert.equal(again.ok, false)
  })

  it('도주 운전사 — 족보 이름만 알린다. 무슨 페어인지는 밝히지 않는다', () => {
    const game = gameWithSpecialist(2)
    assert.equal(game.view().specialistUsed, false, '누군가 눌러야 쓰인다')

    elect(game, 'p1')
    const used = game.useSpecialist('p1', {})
    assert.equal(used.ok, true)

    const said = game.view().announcements[0].text
    assert.doesNotMatch(said, /\(/, '괄호 안 숫자가 새면 안 된다')
    assert.match(said, /하이카드|원 페어|투 페어|트리플|스트레이트|플러시|풀하우스|포카드/)
  })

  it('두뇌 — 고른 사람이 그 숫자를 몇 장 가졌는지 알린다', () => {
    const game = gameWithSpecialist(4)
    const hole = game.handOf('p2')!
    const value = 14 // A
    const expected = hole.filter((card) => card[0] === 'A').length

    elect(game, 'p1')
    const used = game.useSpecialist('p1', { targetId: 'p2', value })
    assert.equal(used.ok, true)
    assert.match(game.view().announcements[0].text, new RegExp(`A ${expected}장`))
  })

  it('두뇌 — 대상이나 숫자를 빠뜨리면 거절한다', () => {
    const game = gameWithSpecialist(4)
    elect(game, 'p1')
    assert.equal(game.useSpecialist('p1', { value: 14 }).ok, false)
    assert.equal(game.useSpecialist('p1', { targetId: 'p2' }).ok, false)
    assert.equal(game.useSpecialist('p1', { targetId: 'p2', value: 99 }).ok, false)
    assert.equal(game.view().specialistUsed, false, '거절됐으면 쓰이지 않은 것이다')
  })

  it('정보원 — 무엇을 보여줬는지는 본 사람만 안다', () => {
    const game = gameWithSpecialist(1)
    const mine = game.handOf('p1')!

    elect(game, 'p1')
    const used = game.useSpecialist('p1', { targetId: 'p2', cardIndex: 1 })
    assert.equal(used.ok, true)
    if (!used.ok) return

    assert.deepEqual(used.value.note, {
      toId: 'p2',
      heist: game.view().heist,
      specialist: 1,
      title: 'p1의 카드',
      cards: [mine[1]],
    })
    const said = game.view().announcements[0].text
    assert.match(said, /보여줬습니다/)
    assert.doesNotMatch(said, new RegExp(mine[1]), '공개 문구에 카드가 새면 안 된다')
  })

  it('정보원 — 없는 카드를 고르면 거절한다', () => {
    const game = gameWithSpecialist(1)
    elect(game, 'p1')
    assert.equal(game.useSpecialist('p1', { targetId: 'p2', cardIndex: 9 }).ok, false)
    assert.equal(game.useSpecialist('p1', { targetId: 'p2' }).ok, false)
  })

  it('근육 — 같은 족보끼리는 이긴다', () => {
    const game = gameWithSpecialist(10)
    assert.equal(game.view().muscleId, null)

    elect(game, 'p3')
    const used = game.useSpecialist('p3', {})
    assert.equal(used.ok, true)
    assert.equal(game.view().muscleId, 'p3')
  })

  it('한 판에 한 번만 쓸 수 있다', () => {
    const game = gameWithSpecialist(2)
    elect(game, 'p1')
    assert.equal(game.useSpecialist('p1', {}).ok, true)

    const again = game.useSpecialist('p2', {})
    assert.equal(again.ok, false)
    if (!again.ok) assert.match(again.message, /이미 쓴/)
  })

  it('누가 쓸지 정해지기 전에는 아무도 쓸 수 없다', () => {
    const game = gameWithSpecialist(2)
    const early = game.useSpecialist('p1', {})
    assert.equal(early.ok, false)
    if (!early.ok) assert.match(early.message, /아직 정해지지 않았습니다/)
  })

  it('표가 갈리면 정해지지 않는다', () => {
    const game = gameWithSpecialist(2)
    assert.equal(game.voteSpecialist('p1', 'p1').ok, true)
    assert.equal(game.voteSpecialist('p2', 'p1').ok, true)
    assert.equal(game.voteSpecialist('p3', 'p2').ok, true)
    assert.equal(game.view().specialistVote?.decided, null, '한 사람으로 모이지 않았다')
    assert.equal(game.useSpecialist('p1', {}).ok, false)
  })

  it('표는 정해지기 전까지 바꿀 수 있다', () => {
    const game = gameWithSpecialist(2)
    game.voteSpecialist('p1', 'p1')
    game.voteSpecialist('p2', 'p2')
    game.voteSpecialist('p3', 'p2')
    assert.equal(game.view().specialistVote?.decided, null)

    // p1 이 마음을 바꾸면 그 자리에서 만장일치가 된다.
    game.voteSpecialist('p1', 'p2')
    assert.equal(game.view().specialistVote?.decided, 'p2')
  })

  it('표는 서로 보인다 — 말 없이 한 사람으로 모아가는 것이 이 투표다', () => {
    const game = gameWithSpecialist(2)
    game.voteSpecialist('p1', 'p3')
    assert.deepEqual(game.view().specialistVote?.votes, [{ voterId: 'p1', pick: 'p3' }])
  })

  it('정해진 뒤에는 뽑힌 사람만 쓴다', () => {
    const game = gameWithSpecialist(2)
    elect(game, 'p2')
    const other = game.useSpecialist('p1', {})
    assert.equal(other.ok, false)
    if (!other.ok) assert.match(other.message, /p2님이 쓸 차례/)
    assert.equal(game.useSpecialist('p2', {}).ok, true)
  })

  it('정해진 뒤에는 표를 다시 낼 수 없다', () => {
    const game = gameWithSpecialist(2)
    elect(game, 'p2')
    const again = game.voteSpecialist('p1', 'p1')
    assert.equal(again.ok, false)
    if (!again.ok) assert.match(again.message, /이미 p2님으로 정해졌습니다/)
  })

  it('자리를 비운 사람은 고를 수 없다', () => {
    const game = gameWithSpecialist(2)
    game.setConnected('p3', false)
    const voted = game.voteSpecialist('p1', 'p3')
    assert.equal(voted.ok, false)
    if (!voted.ok) assert.match(voted.message, /자리를 비운/)
  })

  it('끊긴 사람은 표를 기다려주지 않는다', () => {
    const game = gameWithSpecialist(2)
    game.setConnected('p3', false)
    game.voteSpecialist('p1', 'p1')
    game.voteSpecialist('p2', 'p1')
    assert.equal(game.view().specialistVote?.decided, 'p1', '접속 중인 둘이 모이면 정해진다')
  })

  it('뽑힌 사람이 자리를 비우면 투표를 다시 연다', () => {
    const game = gameWithSpecialist(2)
    elect(game, 'p2')
    game.setConnected('p2', false)
    assert.equal(game.view().specialistVote, null, '그 사람만 쓸 수 있는 채로 굳으면 아무도 못 쓴다')
    assert.equal(game.useSpecialist('p1', {}).ok, false, '다시 정해야 한다')
  })

  it('판에 없는 사람은 투표할 수 없다', () => {
    const game = gameWithSpecialist(2)
    assert.equal(game.voteSpecialist('구경꾼', 'p1').ok, false)
    assert.equal(game.voteSpecialist('p1', '구경꾼').ok, false)
  })

  it('저절로 발동하는 카드는 투표도 열리지 않는다', () => {
    const game = gameWithSpecialist(3)
    const voted = game.voteSpecialist('p1', 'p1')
    assert.equal(voted.ok, false)
    if (!voted.ok) assert.match(voted.message, /이미 쓴/)
  })

  it('판에 없는 사람은 쓸 수 없다', () => {
    const game = gameWithSpecialist(2)
    assert.equal(game.useSpecialist('구경꾼', {}).ok, false)
  })

  it('해커 — 한 장을 더 받고 한 장을 버린다', () => {
    const game = gameWithSpecialist(5)
    const before = game.handOf('p1')!

    elect(game, 'p1')
    const used = game.useSpecialist('p1', {})
    assert.equal(used.ok, true)
    assert.equal(game.handOf('p1')?.length, 3, '먼저 늘어난다')
    assert.equal(game.view().discardingId, 'p1')

    // 고르는 동안에는 라운드가 넘어가지 않는다
    const blocked = game.setReady('p1', true)
    assert.equal(blocked.ok, false)

    const dropped = game.discard('p1', 0)
    assert.equal(dropped.ok, true)
    const after = game.handOf('p1')!
    assert.equal(after.length, 2)
    assert.equal(after.includes(before[0]), false, '고른 카드가 빠져야 한다')
    assert.equal(game.view().discardingId, null)
  })

  it('해커 — 차례가 아닌 사람은 버릴 수 없다', () => {
    const game = gameWithSpecialist(5)
    elect(game, 'p1')
    game.useSpecialist('p1', {})
    assert.equal(game.discard('p2', 0).ok, false)
    assert.equal(game.discard('p1', 9).ok, false)
  })

  it('잭 — 무늬 없는 J 가 손에 들어온다', () => {
    const game = gameWithSpecialist(7)
    elect(game, 'p2')
    assert.equal(game.useSpecialist('p2', {}).ok, true)

    const hand = game.handOf('p2')!
    assert.equal(hand.length, 3)
    assert.ok(hand.includes(JACK_CARD), '무늬 없는 J 가 있어야 한다')
    assert.equal(game.discard('p2', 0).ok, true)
    assert.ok(game.handOf('p2')!.includes(JACK_CARD), '버린 것은 원래 카드다')
  })

  it('잭 — 무늬가 없어 플러시에 끼지 못한다', () => {
    const flush = evaluateBest(['2s', '5s', '9s', 'Js', 'Ks'] as never)
    assert.equal(flush.label, '플러시')

    // 스페이드 넷에 무늬 없는 J 를 얹어도 플러시가 되지 않는다
    const withJack = evaluateBest(['2s', '5s', '9s', 'Ks', JACK_CARD] as never)
    assert.notEqual(withJack.label, '플러시')
  })

  it('잭 — 진짜 J 넷과 만나면 J 포카드에 J 키커다', () => {
    const five = evaluateBest(['Js', 'Jh', 'Jd', 'Jc', JACK_CARD] as never)
    assert.equal(five.label, '포카드')
    assert.deepEqual(five.score.slice(1), [11, 11], 'J 포카드에 J 키커')
  })

  it('조율가 — 전원이 고른 뒤에 한꺼번에 왼쪽으로 넘어간다', () => {
    const game = gameWithSpecialist(6)
    assert.equal(game.view().phase, 'setup')
    assert.equal(game.view().setup?.kind, 'pass')

    const before = new Map(players.map((p) => [p.id, [...game.handOf(p.id)!]]))
    assert.equal(game.submitSetup('p1', 0).ok, true)
    assert.equal(game.view().phase, 'setup', '한 명이 냈다고 움직이지 않는다')
    assert.deepEqual(game.handOf('p1'), before.get('p1'), '아직 그대로다')

    game.submitSetup('p2', 0)
    const done = game.submitSetup('p3', 0)
    assert.equal(done.ok, true)
    if (!done.ok) return

    assert.equal(game.view().phase, 'picking')
    assert.equal(done.value.notes.length, 3, '각자 무엇을 주고받았는지 알려준다')

    // p1 이 낸 카드는 p2 에게 가 있다
    assert.ok(game.handOf('p2')!.includes(before.get('p1')![0]))
    assert.equal(game.handOf('p1')!.includes(before.get('p1')![0]), false)
    for (const p of players) assert.equal(game.handOf(p.id)?.length, 2, '장수는 그대로다')
  })

  /*
   * 딜 직후 단계는 「아직 아무것도 안 벌어진 자리」다. 그런데 공개 여부를 「picking 이
   * 아니면 공개」로 재던 시절에는 이 단계가 공개 쪽에 들어가, 넘길 카드를 고르는 동안
   * 전원의 홀카드가 모두에게 나갔다. 카드 한 장 값이 아니라 판 전체가 무너지는 자리다.
   */
  it('조율가 — 카드를 고르는 동안 남의 홀카드가 공개 상태에 실리지 않는다', () => {
    const game = gameWithSpecialist(6)
    assert.equal(game.view().phase, 'setup')
    for (const seat of game.view().players) assert.equal(seat.hole, null, `${seat.id} 의 카드가 샜다`)

    // 한 명이 낸 뒤에도 마찬가지다 — 그 사이에도 상태는 계속 나간다.
    game.submitSetup('p1', 0)
    for (const seat of game.view().players) assert.equal(seat.hole, null)
  })

  it('사기꾼 — 외우는 동안에도 남의 홀카드는 나가지 않는다', () => {
    const game = gameWithSpecialist(9)
    assert.equal(game.view().phase, 'setup')
    for (const seat of game.view().players) assert.equal(seat.hole, null, `${seat.id} 의 카드가 샜다`)
  })

  it('조율가 — 카드를 고르지 않으면 거절한다', () => {
    const game = gameWithSpecialist(6)
    assert.equal(game.submitSetup('p1').ok, false)
    assert.equal(game.submitSetup('p1', 9).ok, false)
  })

  it('사기꾼 — 전원이 확인하면 섞여서 다시 나뉜다', () => {
    const game = gameWithSpecialist(9)
    assert.equal(game.view().setup?.kind, 'memorize')

    const before = players.flatMap((p) => game.handOf(p.id)!)
    game.submitSetup('p1')
    game.submitSetup('p2')
    const done = game.submitSetup('p3')
    assert.equal(done.ok, true)
    if (!done.ok) return

    const after = players.flatMap((p) => game.handOf(p.id)!)
    assert.equal(game.view().phase, 'picking')
    assert.deepEqual([...after].sort(), [...before].sort(), '카드 구성은 그대로고 자리만 바뀐다')
    assert.equal(done.value.notes.length, 3)
    assert.equal(done.value.notes[0].title.includes('섞이기 전'), true)
  })

  it('딜 직후 단계에서는 토큰을 집을 수 없다', () => {
    const game = gameWithSpecialist(6)
    assert.equal(game.takeToken('p1', 1).ok, false)
  })

  it('해결사가 없으면 아무것도 공개되지 않는다', () => {
    const { game } = gameWith([])
    assert.deepEqual(game.view().announcements, [])
    assert.equal(game.view().specialist, null)
  })
})

describe('직접 고르기 — 무작위 도전자', () => {
  it('판마다 새로 뽑는다 — 고른 것은 그대로 남는다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(5), [2], [], { random: 2 })
    const seen: string[] = []
    for (const result of [null, true, false, true] as const) {
      const challenges = dealer.next(result).challenges
      assert.equal(challenges.length, 3, '고른 하나 + 무작위 둘')
      assert.equal(challenges[0], 2, '고른 것은 늘 걸린다')
      assert.equal(new Set(challenges).size, 3, '한 판 안에서는 겹치지 않는다')
      seen.push(challenges.slice(1).join(','))
    }
    // 매 판 다시 뽑으므로 네 판이 모두 같을 수는 없다. 지난 판과 겹치는 것 자체는 막지 않는다.
    assert.ok(new Set(seen).size > 1, `판마다 달라져야 한다: ${seen.join(' / ')}`)
  })

  it('누적으로 두면 한 번 나온 것이 그대로 남는다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(5), [2], [], { random: 1, stay: true })
    let before = dealer.next(null).challenges
    assert.equal(before.length, 2, '고른 하나 + 무작위 하나')

    for (const result of [true, false] as const) {
      const now = dealer.next(result).challenges
      assert.equal(now.length, before.length + 1, '판마다 한 장씩 쌓인다')
      for (const id of before) assert.ok(now.includes(id), `${id} 가 사라졌다`)
      assert.equal(new Set(now).size, now.length, '쌓인 것과 새로 뽑은 것이 겹치지 않는다')
      before = now
    }
  })

  it('「이겼을 때만」이면 진 다음과 첫 판에는 뽑지 않는다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(5), [2], [], { random: 2, onWin: true })
    assert.deepEqual(dealer.next(null).challenges, [2], '첫 판 — 직전 판이 없다')
    assert.deepEqual(dealer.next(false).challenges, [2], '진 다음')
    assert.equal(dealer.next(true).challenges.length, 3, '이긴 다음에는 얹힌다')
  })

  it('무작위 해결사는 찍은 판에서 한 장 뽑는다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(7), [], [null, null, null, null, null], {
      specialistRandom: [true, false, false, false, false],
      specialistOnLoss: false,
    })
    const first = dealer.next(null).specialist
    assert.ok(first !== null && READY_SPECIALISTS.includes(first), `뽑힌 것: ${first}`)
    assert.equal(dealer.next(true).specialist, null, '찍지 않은 판은 그대로 비어 있다')
  })

  it('고른 카드와 겹치지 않고, 무작위끼리도 겹치지 않는다', () => {
    // 겹치면 두 장이 한 장으로 합쳐지는 셈이라 얹은 만큼 안 얹힌다. 씨앗을 바꿔가며 본다.
    for (let seed = 1; seed <= 30; seed += 1) {
      const picked: ChallengeId[] = [2, 8]
      const rolled = new ExtraDealer('custom', mulberry32(seed), picked, [], { random: 3 })
        .next(null)
        .challenges
      assert.equal(rolled.length, 5, `씨앗 ${seed}`)
      assert.equal(new Set(rolled).size, 5, `씨앗 ${seed} — 같은 카드가 두 번 걸렸다`)
    }
  })

  it('남은 카드보다 많이 달라고 해도 있는 만큼만 얹는다', () => {
    const picked = READY_CHALLENGES.slice(0, READY_CHALLENGES.length - 1)
    const dealer = new ExtraDealer('custom', mulberry32(1), picked, [], { random: 3 })
    assert.equal(dealer.next(null).challenges.length, READY_CHALLENGES.length, '더미가 바닥나면 거기까지')
  })

  it('고른 것과 부딪히는 카드는 무작위로도 오지 않는다', () => {
    // 방장이 감지기를 골랐는데 무작위가 빠른 접근을 얹으면, 막아둔 조합이 뒷문으로 든다.
    for (let seed = 1; seed <= 40; seed += 1) {
      const rolled = new ExtraDealer('custom', mulberry32(seed), [3], [], { random: 3 })
        .next(null)
        .challenges
      assert.equal(rolled.includes(1), false, `씨앗 ${seed} — 빠른 접근이 얹혔다`)
    }
  })

  it('무작위끼리도 부딪히지 않는다', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const rolled = new ExtraDealer('custom', mulberry32(seed), [], [], { random: 3 }).next(null).challenges
      const quick = rolled.includes(1)
      const sensor = rolled.some((id) => id === 3 || id === 7)
      assert.equal(quick && sensor, false, `씨앗 ${seed} — ${rolled.join(',')}`)
    }
  })

  it('무작위 0장이면 고른 것만 걸린다', () => {
    const dealer = new ExtraDealer('custom', mulberry32(1), [2], [], { random: 0 })
    assert.deepEqual(dealer.next(null).challenges, [2])
  })

  it('다른 모드는 무작위 몫을 받지 않는다', () => {
    const dealer = new ExtraDealer('advanced', mulberry32(1), [], [], { random: 3 })
    assert.deepEqual(dealer.next(null), { challenges: [], specialist: null })
  })
})

describe('직접 고르기 — 승·패 수', () => {
  /**
   * 판을 끝까지 돌린다. 결과가 무엇이든 금고나 경보가 하나씩 쌓인다.
   *
   * 성공하느냐 실패하느냐는 나눠진 카드에 달렸으므로 씨앗으로 고른다 —
   * 11 은 첫 판이 성공하는 패, 1 은 실패하는 패다.
   */
  function playUntilOver(options: { vaultsToWin?: number; alarmsToLose?: number; seed?: number }) {
    const { seed = 11, ...rules } = options
    let clock = 1_000_000
    const game = new Game('TEST', players, {
      now: () => clock,
      rng: mulberry32(seed),
      mode: 'custom',
      pickedChallenges: [],
      ...rules,
    })
    const ctx = { game, advance: (ms: number) => (clock += ms) }
    let guard = 0
    while (!game.isOver && guard++ < 20) {
      for (let round = 0; round < 4; round += 1) passRound(ctx)
      if (game.isOver) break
      for (const player of players) game.continueAfterHeist(player.id)
    }
    return game.view()
  }

  it('금고 하나면 첫 성공에서 끝난다', () => {
    const view = playUntilOver({ vaultsToWin: 1, alarmsToLose: 5 })
    assert.equal(view.phase, 'gameOver')
    assert.equal(view.vaults, 1)
    assert.equal(view.outcome, 'win')
    assert.equal(view.heist, 1, '첫 판에서 갈린다')
  })

  it('경보 하나면 첫 실패에서 끝난다', () => {
    const view = playUntilOver({ vaultsToWin: 5, alarmsToLose: 1, seed: 1 })
    assert.equal(view.phase, 'gameOver')
    assert.equal(view.alarms, 1)
    assert.equal(view.outcome, 'lose')
    assert.equal(view.heist, 1)
  })

  it('정한 수가 화면으로 그대로 나간다 — 눈금을 그 수만큼 그려야 한다', () => {
    const game = new Game('TEST', players, {
      mode: 'custom',
      rng: mulberry32(1),
      vaultsToWin: 4,
      alarmsToLose: 2,
    })
    assert.equal(game.view().vaultsToWin, 4)
    assert.equal(game.view().alarmsToLose, 2)
  })

  it('마스터 시프의 경보 2는 설정보다 앞선다', () => {
    const game = new Game('TEST', players, { mode: 'masterThief', rng: mulberry32(1), alarmsToLose: 5 })
    assert.equal(game.view().alarmsToLose, 2)
  })
})
