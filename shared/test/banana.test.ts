import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type Card } from '../src/cards.ts'
import { ROUNDS } from '../src/game.ts'
import { HandCategory } from '../src/handEval.ts'
import { BANANA_GROUP, VARIANTS, bananaGroup } from '../src/variants.ts'

const cards = (s: string) => s.split(' ') as Card[]
const banana = VARIANTS.banana

/**
 * 네 자리 판 하나. 라운드마다 **묶음마다 한 장씩** 놓이므로 평평한 배열에서는
 * 첫 줄이 각 묶음의 첫 장, 둘째 줄이 둘째 장이다.
 *
 *   묶음 0   묶음 1   묶음 2   묶음 3
 *     As       2h       3d       4c     ← 2라운드
 *     Ks       5h       6d       7c     ← 3라운드
 *     Qs       8h       9d       Tc     ← 4라운드
 */
const board = cards('As 2h 3d 4c Ks 5h 6d 7c Qs 8h 9d Tc')
const SEATS = 4

describe('바나나스플릿 — 묶음은 자리 사이에 있다', () => {
  it('묶음 하나는 평평한 배열에 흩어져 있다', () => {
    assert.deepEqual(bananaGroup(board, 0, SEATS), cards('As Ks Qs'))
    assert.deepEqual(bananaGroup(board, 2, SEATS), cards('3d 6d 9d'))
  })

  it('아직 안 놓인 장은 세지 않는다', () => {
    // 2라운드 — 묶음마다 한 장씩만 놓였다.
    assert.deepEqual(bananaGroup(board.slice(0, SEATS), 1, SEATS), cards('2h'))
  })

  it('내가 쓰는 것은 왼쪽 묶음과 오른쪽 묶음, 여섯 장이다', () => {
    // 자리 1 은 묶음 0(자리 0 과의 사이)과 묶음 1(자리 2 와의 사이)을 쓴다.
    assert.deepEqual(banana.communityFor(board, 1, SEATS), cards('As Ks Qs 2h 5h 8h'))
  })

  it('첫 자리는 마지막 묶음을 왼쪽으로 쓴다 — 원이라 끝이 이어진다', () => {
    assert.deepEqual(banana.communityFor(board, 0, SEATS), cards('4c 7c Tc As Ks Qs'))
  })

  it('이웃끼리는 한 묶음을 나눠 쓴다', () => {
    const zero = new Set(banana.communityFor(board, 0, SEATS))
    const one = new Set(banana.communityFor(board, 1, SEATS))
    const together = [...zero].filter((card) => one.has(card))
    assert.deepEqual(together.sort(), cards('As Ks Qs').sort())
  })

  it('마주 보는 자리는 한 장도 겹치지 않는다', () => {
    const zero = new Set(banana.communityFor(board, 0, SEATS))
    const two = banana.communityFor(board, 2, SEATS)
    assert.equal(two.filter((card) => zero.has(card)).length, 0)
  })

  it('모든 묶음은 정확히 두 사람의 것이다', () => {
    for (let group = 0; group < SEATS; group++) {
      const card = bananaGroup(board, group, SEATS)[0]
      const owners = Array.from({ length: SEATS }, (_, at) => at).filter((at) =>
        banana.communityFor(board, at, SEATS).includes(card),
      )
      assert.equal(owners.length, 2, `묶음 ${group} 을 ${owners.length}명이 쓴다`)
    }
  })
})

describe('바나나스플릿 — 손 만들기', () => {
  it('내 두 장 + 양옆 여섯 장, 여덟 장 중 다섯 장', () => {
    // 자리 1 이 쓰는 여섯 장에 스페이드 셋(A·K·Q)이 있다. 내 J♠ T♠ 와 합쳐 로열.
    const value = banana.evaluate(cards('Js Ts'), banana.communityFor(board, 1, SEATS))
    assert.equal(value.category, HandCategory.StraightFlush)
  })

  it('남의 묶음은 내 손이 되지 못한다', () => {
    // 같은 카드를 들고도 자리 2 에서는 스페이드가 하나도 없다.
    const value = banana.evaluate(cards('Js Ts'), banana.communityFor(board, 2, SEATS))
    assert.notEqual(value.category, HandCategory.StraightFlush)
  })

  it('내 카드를 반드시 쓸 필요는 없다 — 텍사스와 같다', () => {
    // 자리 1 의 여섯 장이 그 자체로 로열이다(묶음 0 = A·K·Q♠, 묶음 1 = J·T♠ 와 8♥).
    const royal = cards('As Js 3d 4c Ks Ts 6d 7c Qs 8h 9d Tc')
    const usable = banana.communityFor(royal, 1, SEATS)
    const value = banana.evaluate(cards('2c 3h'), usable)

    assert.equal(value.category, HandCategory.StraightFlush)
    assert.ok(value.cards.every((card) => usable.includes(card)), '내 카드가 섞였다')
  })

  it('프리플롭에는 내 두 장만으로 답한다', () => {
    assert.equal(banana.holding(cards('Ah Ad'), [])?.name, '원 페어')
  })
})

describe('바나나스플릿 — 변형 표', () => {
  it('판이 인원과 함께 커진다', () => {
    assert.deepEqual(
      ROUNDS.map((round) => banana.dealt(round, 4)),
      [0, 4, 8, 12],
    )
    assert.deepEqual(
      ROUNDS.map((round) => banana.dealt(round, 6)),
      [0, 6, 12, 18],
    )
    // 인원이 몇이든 묶음 하나는 세 장이다.
    for (const seats of [3, 4, 5, 6]) {
      assert.equal(banana.dealt(4, seats), seats * BANANA_GROUP)
    }
  })

  it('쓸 수 있는 것은 인원과 무관하게 늘 여섯 장이다', () => {
    for (const seats of [3, 4, 5, 6]) {
      const full = Array.from({ length: seats * BANANA_GROUP }, (_, at) => `X${at}` as Card)
      assert.equal(banana.communityFor(full, 0, seats).length, 6)
    }
  })

  it('정원 여섯 — 덱은 여유가 있고 화면이 먼저 막는다', () => {
    assert.equal(banana.maxSeats, 6)
    const worst =
      (banana.holeCount + 1) * banana.maxSeats +
      banana.dealt(4, banana.maxSeats) +
      (banana.holeCount + 1) +
      1
    assert.ok(worst <= 52, `최악 ${worst}장 — 덱이 빈다`)
  })

  it('두 장씩 받고 자리와 묶음이 번갈아 선다', () => {
    assert.equal(banana.holeCount, 2)
    assert.equal(banana.layout, 'banana')
  })
})
