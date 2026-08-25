import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { Card } from '../src/cards.ts'
import { bestHolding, orderForReading } from '../src/handEval.ts'

const cards = (s: string) => s.split(' ') as Card[]
const used = (s: string) => bestHolding(cards(s))?.used.slice().sort()

describe('족보를 이루는 카드', () => {
  it('프리플롭 페어는 그 두 장을 짚는다', () => {
    assert.deepEqual(used('3s 3h'), ['3h', '3s'])
  })

  it('프리플롭 하이카드는 높은 한 장만 짚는다', () => {
    assert.deepEqual(used('Ks 9h'), ['Ks'])
  })

  it('투 페어는 네 장을 짚는다 — 남는 페어가 있어도 높은 둘만', () => {
    const holding = bestHolding(cards('Ks Kh 9d 9c 4s 4h Ad'))
    assert.equal(holding?.description, '투 페어(K, 9)')
    assert.deepEqual(holding?.used.slice().sort(), ['9c', '9d', 'Ad', 'Kh', 'Ks'])
  })

  it('다섯 장을 쓰는 족보는 키커까지 함께 짚는다', () => {
    const holding = bestHolding(cards('7s 7h 7d 4c 4h Ks 2d'))
    assert.equal(holding?.description, '풀하우스(7, 4)')
    assert.equal(holding?.used.length, 5)
    assert.deepEqual(holding?.used.slice().sort(), ['4c', '4h', '7d', '7h', '7s'])
  })

  it('짚은 카드는 언제나 내가 가진 카드 안에서 나온다', () => {
    const all = cards('9h 8h 7h 6c 5h 2h Kd')
    const holding = bestHolding(all)
    assert.equal(holding?.description, '플러시(9)')
    for (const card of holding?.used ?? []) assert.ok(all.includes(card), `${card} 는 갖고 있지 않다`)
  })

  it('10 은 T 가 아니라 10 으로 적는다', () => {
    assert.equal(bestHolding(cards('Ts 9h'))?.description, '하이카드(10)')
    assert.equal(bestHolding(cards('Ts Th'))?.description, '원 페어(10)')
    assert.equal(bestHolding(cards('Ts 9h 8c 7d 6s 2h 3d'))?.description, '스트레이트(10)')
  })

  it('카드가 없으면 짚을 것도 없다', () => {
    assert.equal(bestHolding([]), null)
    assert.equal(bestHolding(cards('Ks')), null)
  })
})

describe('읽는 차례로 늘어놓기', () => {
  it('페어가 앞에 서고 나머지는 높은 것부터다', () => {
    // 딜 순서대로 오면 무엇이 짝인지 눈으로 세어야 한다.
    assert.deepEqual(orderForReading(['7h', 'Kd', '7s', '2c', 'As']), ['7h', '7s', 'As', 'Kd', '2c'])
  })

  it('투 페어는 높은 쪽 페어부터, 그다음이 키커다', () => {
    assert.deepEqual(orderForReading(['4d', 'Qs', '4c', 'Qh', '9s']), ['Qs', 'Qh', '4d', '4c', '9s'])
  })

  it('트리플은 셋이 함께 앞에 선다', () => {
    assert.deepEqual(orderForReading(['5h', 'Jd', '5s', '5c', 'Ah']), ['5h', '5s', '5c', 'Ah', 'Jd'])
  })

  it('짝이 없으면 그냥 높은 순이다 — A · K · Q …', () => {
    assert.deepEqual(orderForReading(['3c', 'Ks', 'Ah', '9d', 'Qs']), ['Ah', 'Ks', 'Qs', '9d', '3c'])
  })

  it('휠은 A 를 맨 뒤에 둔다 — 여기서 A 는 1이다', () => {
    assert.deepEqual(orderForReading(['Ah', '4d', '2s', '5c', '3h']), ['5c', '4d', '3h', '2s', 'Ah'])
  })

  it('A 부터 이어지는 스트레이트는 그대로 높은 순이다', () => {
    assert.deepEqual(orderForReading(['Ts', 'Ah', 'Jd', 'Kc', 'Qs']), ['Ah', 'Kc', 'Qs', 'Jd', 'Ts'])
  })

  it('원래 배열을 건드리지 않는다', () => {
    const cards = ['7h', 'Kd', '7s'] as const
    const before = [...cards]
    orderForReading(cards)
    assert.deepEqual([...cards], before)
  })
})
