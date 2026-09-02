import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type Card } from '../src/cards.ts'
import { ROUNDS } from '../src/game.ts'
import { CATEGORY_LABEL, HandCategory, evaluateBest } from '../src/handEval.ts'
import { SPOTS_LINES, VARIANTS } from '../src/variants.ts'

const cards = (s: string) => s.split(' ') as Card[]
const spots = VARIANTS.spots

/**
 * 격자를 눈에 보이는 대로 적기 위한 헬퍼. 왼쪽 위부터 가로로 아홉 장이다.
 *
 *   As Ks Qs
 *   2h 7d 9c
 *   3h 4d 5c
 */
const grid = (...rows: string[]) => cards(rows.join(' '))

describe('스팟스 — 3×3 라인', () => {
  it('라인은 여덟 개다 — 가로 셋 · 세로 셋 · 대각 둘', () => {
    assert.equal(SPOTS_LINES.length, 8)
    // 아홉 자리가 저마다 몇 개의 라인에 드는지: 가운데 4, 모서리 3, 변 2.
    const usage = Array.from({ length: 9 }, (_, at) => SPOTS_LINES.filter((l) => l.includes(at)).length)
    assert.deepEqual(usage, [3, 2, 3, 2, 4, 2, 3, 2, 3])
  })

  it('세로 줄은 열린 카드가 아니라 자리로 정해진다', () => {
    // 가운데 세로줄(1·4·7)이 스페이드 셋. 한 줄로 늘어놓으면 안 보이는 줄이다.
    const board = grid('2h As 3d', '4c Ks 5d', '6h Qs 7d')
    const hole = cards('Js Ts 8c 9d')
    const value = spots.evaluate(hole, board)
    assert.equal(value.category, HandCategory.StraightFlush)
  })

  it('두 줄에 걸친 다섯 장은 만들 수 없다', () => {
    // 첫 줄에 A·K·Q, 둘째 줄에 J·T — 다 모으면 로열이지만 줄을 섞을 수 없다.
    const board = grid('As Ks Qs', 'Js Ts 2h', '3d 4c 5h')
    const hole = cards('7d 8c 9h 2c')
    const value = spots.evaluate(hole, board)
    assert.notEqual(value.category, HandCategory.StraightFlush)
    // 한 줄(A·K·Q 스페이드)만으로는 플러시도 못 세운다 — 손에 스페이드가 없다.
    assert.ok(value.category < HandCategory.Flush)
  })

  it('한 줄 셋에 내 카드 둘을 얹어 플러시를 만든다', () => {
    const board = grid('As Ks Qs', '2h 3d 4c', '5h 6d 7c')
    const hole = cards('Js Ts 8h 9d')
    const value = spots.evaluate(hole, board)
    assert.equal(value.category, HandCategory.StraightFlush)
    assert.equal(value.cards.filter((card) => hole.includes(card)).length, 2)
  })

  it('내 카드 넷에 줄에서 한 장만 가져오는 손도 성립한다', () => {
    const board = grid('Ah 2c 3d', '4c 5d 6h', '7c 8d 9h')
    const hole = cards('As Ad Ac 2h')
    const value = spots.evaluate(hole, board)
    // 손의 A 셋 + 보드의 A 하나 = 포카드. 홀카드를 넷 다 쓰는 셈이다.
    assert.equal(value.category, HandCategory.FourOfAKind)
  })
})

describe('스팟스 — 줄이 하나씩 열린다', () => {
  const board = grid('As Ks Qs', 'Js Ts 9s', '8s 7s 6s')
  const hole = cards('2h 3d 4c 5h')

  it('프리플롭에는 줄이 없어 내 카드만으로 답한다', () => {
    const holding = spots.holding(hole, [])
    assert.equal(holding?.name, CATEGORY_LABEL[HandCategory.HighCard])
  })

  it('2라운드에는 가로 한 줄뿐이다', () => {
    const first = board.slice(0, 3)
    const holding = spots.holding(hole, first)
    // 그 한 줄 + 내 카드 넷, 일곱 장 중 다섯 장. 텍사스의 플롭과 같은 셈이다.
    assert.deepEqual(holding?.used.length, 5)
    assert.equal(spots.evaluate(hole, first).score.join(), evaluateBest([...hole, ...first]).score.join())
  })

  it('3라운드에도 세로·대각은 서지 않는다', () => {
    /*
     * 가운데 세로줄(1·4·7)에 다이아 A·K·Q 를 세워 둔다. 내 손의 J·T 와 합치면
     * 로열이지만, 그 줄은 셋째 가로줄이 열려야 완성된다.
     */
    const late = grid('2h Ad 3c', '4h Kd 5c', '6h Qd 7c')
    const mine = cards('Jd Td 8s 9s')

    assert.notEqual(spots.evaluate(mine, late.slice(0, 6)).category, HandCategory.StraightFlush)
    assert.equal(spots.evaluate(mine, late).category, HandCategory.StraightFlush)
  })

  it('마지막 줄이 열려야 여덟 줄이 다 선다', () => {
    const holding = spots.holding(hole, board)
    assert.equal(holding?.used.length, 5)
  })
})

describe('스팟스 — 변형 표', () => {
  it('네 장씩 받고 공용은 세 장씩 세 걸음으로 아홉 장', () => {
    assert.equal(spots.holeCount, 4)
    assert.deepEqual(ROUNDS.map((round) => spots.dealt(round, 5)), [0, 3, 6, 9])
    assert.equal(spots.layout, 'grid3')
  })

  it('정원은 일곱이다 — 아홉 장이 판에 깔리는 만큼 자리가 준다', () => {
    assert.equal(spots.maxSeats, 7)
    const worst = (spots.holeCount + 1) * spots.maxSeats + 9 + (spots.holeCount + 1) + 1
    assert.ok(worst <= 52, `최악 ${worst}장 — 덱이 빈다`)
  })
})
