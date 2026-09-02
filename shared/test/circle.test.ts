import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type Card } from '../src/cards.ts'
import { ROUNDS } from '../src/game.ts'
import { CATEGORY_LABEL, HandCategory } from '../src/handEval.ts'
import { CIRCLE_SEATS, CIRCLE_TRIPLES, CIRCLE_WILD_AT, VARIANTS } from '../src/variants.ts'

const cards = (s: string) => s.split(' ') as Card[]
const circle = VARIANTS.circle
const wild = VARIANTS.circleWild

describe('서클잭 — 원 위의 이웃', () => {
  it('붙어 있는 셋은 일곱 가지다', () => {
    assert.equal(CIRCLE_TRIPLES.length, CIRCLE_SEATS)
    // 자리마다 세 가지 이웃 셋에 든다. 어느 자리도 특별하지 않다.
    const usage = Array.from({ length: CIRCLE_SEATS }, (_, at) =>
      CIRCLE_TRIPLES.filter((triple) => triple.includes(at)).length,
    )
    assert.deepEqual(usage, [3, 3, 3, 3, 3, 3, 3])
  })

  it('끝과 끝이 이어진다', () => {
    // [5,6,0] 과 [6,0,1] 이 성립하는 것이 이 변형의 전부다.
    const wrapped = CIRCLE_TRIPLES.filter((triple) => triple.includes(6) && triple.includes(0))
    assert.equal(wrapped.length, 2)
  })

  it('떨어진 세 장은 함께 쓸 수 없다', () => {
    // 0·2·4 자리에 A·K·Q 스페이드. 이웃이 아니므로 모을 수 없다.
    const board = cards('As 2h Ks 3d Qs 4c 5h')
    assert.notEqual(circle.evaluate(cards('Js Ts'), board).category, HandCategory.StraightFlush)
  })

  it('붙어 있으면 쓸 수 있다 — 끝을 넘어가도', () => {
    // 5·6·0 자리에 A·K·Q 스페이드. 원이라 이 셋은 이웃이다.
    const board = cards('Qs 2h 3d 4c 5h As Ks')
    assert.equal(circle.evaluate(cards('Js Ts'), board).category, HandCategory.StraightFlush)
  })

  it('내 카드 두 장은 반드시 쓴다', () => {
    const board = cards('As Ks Qs 2c 3d 4c 5h')
    const mine = cards('9h 8d')
    const value = circle.evaluate(mine, board)
    assert.equal(value.cards.filter((card) => mine.includes(card)).length, 2)
  })
})

describe('서클잭 — 가운데 와일드카드', () => {
  /*
   * 「와일드」는 **자리가 자유롭다**는 뜻이다. 카드는 보이는 그대로이고 모두에게 같은
   * 한 장이며, 자유로운 것은 이웃 셋의 어느 자리에 끼우느냐다.
   */
  it('이웃 셋의 아무 자리에나 끼운다', () => {
    // 이웃 셋 A♠ K♠ 2♥ 의 2♥ 자리에 가운데 Q♠ 를 끼우면 로열이 선다.
    const board = cards('As Ks 2h 3d 4c 5h 6d Qs')
    assert.equal(wild.evaluate(cards('Js Ts'), board).category, HandCategory.StraightFlush)
    // 와일드가 없으면 스페이드가 넷뿐이라 서지 않는다.
    assert.notEqual(circle.evaluate(cards('Js Ts'), board.slice(0, 7)).category, HandCategory.StraightFlush)
  })

  it('숫자는 자유롭지 않다 — 보이는 그대로다', () => {
    /*
     * 이웃 셋 A♠ K♠ 2♥ 에 내 J♠ T♠. 로열이 되려면 Q♠ 가 있어야 하는데
     * 가운데는 9♣ 다. 숫자까지 자유로우면 여기서 로열이 서 버린다.
     */
    const board = cards('As Ks 2h 3d 4c 5h 6d 9c')
    assert.notEqual(wild.evaluate(cards('Js Ts'), board).category, HandCategory.StraightFlush)
  })

  it('쓴 다섯 장은 내 둘 + 이웃 둘 + 와일드다', () => {
    const board = cards('As Ks 2h 3d 4c 5h 6d Qs')
    const mine = cards('Js Ts')
    const value = wild.evaluate(mine, board)

    assert.equal(value.cards.filter((card) => mine.includes(card)).length, 2)
    assert.ok(value.cards.includes(board[CIRCLE_WILD_AT]), '와일드가 빠졌다')
    // 판에 없는 카드는 나오지 않는다 — 화면이 짚을 자리가 없어진다.
    for (const card of value.cards) {
      assert.ok(mine.includes(card) || board.includes(card), `${card} 는 판에 없는 카드다`)
    }
  })

  it('모두에게 같은 한 장이다', () => {
    // 같은 7♦ 를 둘이 함께 쓰되, 각자 자기 이웃 셋에 끼운다.
    const board = cards('7h Tc Jh 7s 4d 8c 4h 7d')
    for (const hole of ['As 7c', '2s 9d']) {
      const value = wild.evaluate(cards(hole), board)
      if (value.cards.includes(board[CIRCLE_WILD_AT])) {
        assert.ok(value.cards.includes('7d' as Card), '와일드가 다른 카드로 둔갑했다')
      }
    }
  })

  it('이웃 규칙은 와일드가 있어도 살아 있다', () => {
    // 0·3 자리에 A·K 스페이드 — 어떤 이웃 셋도 둘을 함께 담지 못한다.
    const apart = cards('As 2h 3d Ks 4c 5h 6d Qs')
    assert.notEqual(wild.evaluate(cards('Js Ts'), apart).category, HandCategory.StraightFlush)
  })

  it('이웃 셋이 이미 센 판에서는 할 일이 없다', () => {
    /*
     * 붙어 있는 세 자리가 K 셋. 와일드를 끼우려면 그 K 중 하나를 빼야 하므로
     * 넣으나 마나다. 내 두 장을 지키기로 한 대가이고, 알고 고른 자리다(2026-09-02).
     */
    const board = cards('Ks Kd Kh 2c 3d 4c 5h Kc')
    assert.equal(wild.evaluate(cards('Js Td'), board).category, HandCategory.ThreeOfAKind)
    assert.equal(circle.evaluate(cards('Js Td'), board.slice(0, 7)).category, HandCategory.ThreeOfAKind)
  })

  it('「보안 카메라」로 석 장을 받아도 쓰는 것은 두 장이다', () => {
    const board = cards('As Ks 2h 3d 4c 5h 6d Qs')
    const mine = cards('Js Ts 8h')
    // 예전에는 여기서 「5장이어야 한다: 6장 받음」으로 터졌다.
    const value = wild.evaluate(mine, board)
    assert.equal(value.cards.length, 5)
    assert.equal(value.cards.filter((card) => mine.includes(card)).length, 2)
  })
})

describe('서클잭 — 원이 채워지는 동안', () => {
  const board = cards('As Ks Qs Js Ts 9s 8s 7s')

  it('프리플롭에는 이웃이 없어 내 카드 둘만으로 답한다', () => {
    assert.equal(circle.holding(cards('Ah 9d'), [])?.name, CATEGORY_LABEL[HandCategory.HighCard])
  })

  it('석 장을 받았어도 두 장짜리 조합으로 답한다', () => {
    // 석 장을 그대로 세면 「트리플」이라 말하는데, 서클잭에서 쓸 수 없는 손이다.
    assert.equal(circle.holding(cards('Ah Ad Ac'), [])?.name, CATEGORY_LABEL[HandCategory.Pair])
  })

  it('세 장이 열리면 이웃 셋이 하나 선다', () => {
    assert.equal(circle.holding(cards('2h 3d'), board.slice(0, 3))?.used.length, 5)
  })

  it('여섯 장이면 아직 원이 닫히지 않아 넷뿐이다', () => {
    // 0..5 만 열린 상태에서 완성되는 이웃 셋: 012 · 123 · 234 · 345.
    const open = board.slice(0, 6)
    const done = CIRCLE_TRIPLES.filter((triple) => triple.every((at) => open[at] !== undefined))
    assert.equal(done.length, 4)
  })
})

describe('서클잭 — 변형 표', () => {
  it('두 장씩 받고 원은 세 장씩 돌다 마지막에 닫는다', () => {
    assert.equal(circle.holeCount, 2)
    assert.deepEqual(ROUNDS.map((round) => circle.dealt(round, 5)), [0, 3, 6, 7])
    assert.equal(circle.layout, 'circle')
  })

  it('와일드를 켜면 마지막에 두 장이 열린다', () => {
    assert.deepEqual(ROUNDS.map((round) => wild.dealt(round, 5)), [0, 3, 6, 8])
    assert.equal(wild.dealt(4, 5) - circle.dealt(4, 5), 1)
  })

  it('공용이 적어 정원이 줄지 않는다', () => {
    for (const rules of [circle, wild]) {
      assert.equal(rules.maxSeats, 10)
      const worst =
        (rules.holeCount + 1) * rules.maxSeats +
        rules.dealt(4, rules.maxSeats) +
        (rules.holeCount + 1) +
        1
      assert.ok(worst <= 52, `최악 ${worst}장 — 덱이 빈다`)
    }
  })
})
