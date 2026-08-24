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
  bestHolding,
  rankValueOf,
  type ChallengeId,
} from '@the-gang/shared'

/** 족보 이름 → 카테고리 번호. 스캔이 족보를 숫자로 주고받으므로 되짚을 표가 필요하다. */
const HAND_ORDER = Object.values(CATEGORY_LABEL)
const rankValue = (card: string) => rankValueOf(card as never)
import { ExtraDealer } from '../src/extras.ts'
import { Game, type StartingPlayer } from '../src/game.ts'

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

  it('아무것도 고르지 않으면 기본 모드와 같아진다', () => {
    const game = new Game('TEST', players, { mode: 'custom', pickedChallenges: [], rng: mulberry32(4) })
    assert.deepEqual(game.view().challenges, [])
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
    const result = game.voteScan('p3', 14)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /지목된 사람/)
  })

  it('답이 갈리면 확정되지 않는다', () => {
    const { game } = openScan(4)
    game.voteScan('p1', 14)
    game.voteScan('p2', 13)

    const view = game.view()
    assert.equal(view.scan?.decided, null)
    assert.equal(view.phase, 'scanning')
    assert.equal(view.scan?.votes.length, 2, '표는 서로 보인다')
  })

  it('답을 바꿔 맞추면 그때 확정된다', () => {
    const { game } = openScan(4)
    game.voteScan('p1', 14)
    game.voteScan('p2', 13)
    game.voteScan('p1', 13) // p1 이 p2 에게 맞춘다

    const view = game.view()
    assert.equal(view.scan?.decided, 13)
    assert.notEqual(view.phase, 'scanning')
  })

  it('망막 스캔 — 대상이 그 숫자를 갖고 있으면 맞다', () => {
    const ctx = openScan(4)
    const targetRank = ctx.game.handOf('p3')![0][0]
    const value = 'TJQKA'.includes(targetRank)
      ? { T: 10, J: 11, Q: 12, K: 13, A: 14 }[targetRank as 'T' | 'J' | 'Q' | 'K' | 'A']!
      : Number(targetRank)

    ctx.game.voteScan('p1', value)
    ctx.game.voteScan('p2', value)
    assert.equal(ctx.game.view().scan?.correct, true)
  })

  it('망막 스캔을 틀리면 순서가 맞아도 실패한다', () => {
    const ctx = openScan(4)
    const hole = ctx.game.handOf('p3')!
    // 대상이 갖고 있지 않은 숫자를 고른다
    const wrong = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find(
      (value) => !hole.some((card) => rankValue(card) === value),
    )!

    ctx.game.voteScan('p1', wrong)
    ctx.game.voteScan('p2', wrong)

    const view = ctx.game.view()
    assert.equal(view.scan?.correct, false)
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
    assert.equal(view.scan?.kind, 'category')

    const actual = bestHolding([...ctx.game.handOf('p3')!, ...view.community])!
    const category = HAND_ORDER.indexOf(actual.name)
    ctx.game.voteScan('p1', category)
    ctx.game.voteScan('p2', category)
    assert.equal(ctx.game.view().scan?.correct, true)
  })

  it('맞히면 순서대로 성공한다', () => {
    const ctx = openScan(9)
    const actual = bestHolding([...ctx.game.handOf('p3')!, ...ctx.game.view().community])!
    const category = HAND_ORDER.indexOf(actual.name)
    ctx.game.voteScan('p1', category)
    ctx.game.voteScan('p2', category)

    const view = ctx.game.view()
    assert.equal(view.players.find((p) => p.id === 'p3')?.hole?.length, 2, '이제 모두 공개된다')
    assert.equal(view.showdown?.reveals.length, 3)
    assert.equal(view.showdown?.success, true)
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
  })

  it('빠른 접근과 겹치면 대상을 고를 수 없어 넘어간다', () => {
    const ctx = gameWith([1, 3])
    const before = players.map((p) => ctx.game.handOf(p.id)!.join(' '))
    assert.equal(ctx.game.view().round, 2, '1라운드가 없었다')
    assert.deepEqual(
      players.map((p) => ctx.game.handOf(p.id)!.join(' ')),
      before,
      '1라운드 토큰이 없으니 아무도 바뀌지 않는다',
    )
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

    const used = game.useSpecialist('p1', { targetId: 'p2', value })
    assert.equal(used.ok, true)
    assert.match(game.view().announcements[0].text, new RegExp(`A ${expected}장`))
  })

  it('두뇌 — 대상이나 숫자를 빠뜨리면 거절한다', () => {
    const game = gameWithSpecialist(4)
    assert.equal(game.useSpecialist('p1', { value: 14 }).ok, false)
    assert.equal(game.useSpecialist('p1', { targetId: 'p2' }).ok, false)
    assert.equal(game.useSpecialist('p1', { targetId: 'p2', value: 99 }).ok, false)
    assert.equal(game.view().specialistUsed, false, '거절됐으면 쓰이지 않은 것이다')
  })

  it('정보원 — 무엇을 보여줬는지는 본 사람만 안다', () => {
    const game = gameWithSpecialist(1)
    const mine = game.handOf('p1')!

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
    assert.equal(game.useSpecialist('p1', { targetId: 'p2', cardIndex: 9 }).ok, false)
    assert.equal(game.useSpecialist('p1', { targetId: 'p2' }).ok, false)
  })

  it('근육 — 같은 족보끼리는 이긴다', () => {
    const game = gameWithSpecialist(10)
    assert.equal(game.view().muscleId, null)

    const used = game.useSpecialist('p3', {})
    assert.equal(used.ok, true)
    assert.equal(game.view().muscleId, 'p3')
  })

  it('한 판에 한 번만 쓸 수 있다', () => {
    const game = gameWithSpecialist(2)
    assert.equal(game.useSpecialist('p1', {}).ok, true)

    const again = game.useSpecialist('p2', {})
    assert.equal(again.ok, false)
    if (!again.ok) assert.match(again.message, /이미 쓴/)
  })

  it('판에 없는 사람은 쓸 수 없다', () => {
    const game = gameWithSpecialist(2)
    assert.equal(game.useSpecialist('구경꾼', {}).ok, false)
  })

  it('해결사가 없으면 아무것도 공개되지 않는다', () => {
    const { game } = gameWith([])
    assert.deepEqual(game.view().announcements, [])
    assert.equal(game.view().specialist, null)
  })
})
