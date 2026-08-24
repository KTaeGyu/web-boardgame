import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type Card, freshDeck, hasDuplicates, shuffle } from '../src/cards.ts'
import {
  CATEGORY_LABEL,
  HandCategory,
  compareHands,
  describeHand,
  evaluateBest,
  evaluateFive,
} from '../src/handEval.ts'

const hand = (s: string) => s.split(' ') as Card[]
const cat = (s: string) => evaluateFive(hand(s)).category
/** a 가 b 보다 강하면 양수. 테스트 가독성을 위한 래퍼. */
const cmp = (a: string, b: string) => compareHands(evaluateFive(hand(a)), evaluateFive(hand(b)))

describe('족보 판정', () => {
  it('10가지 족보를 모두 구분한다', () => {
    assert.equal(cat('As Ks Qs Js Ts'), HandCategory.StraightFlush) // 로열
    assert.equal(cat('9h 8h 7h 6h 5h'), HandCategory.StraightFlush)
    assert.equal(cat('7s 7h 7d 7c Kh'), HandCategory.FourOfAKind)
    assert.equal(cat('7s 7h 7d 4c 4h'), HandCategory.FullHouse)
    assert.equal(cat('As Js 9s 5s 2s'), HandCategory.Flush)
    assert.equal(cat('9h 8s 7d 6c 5h'), HandCategory.Straight)
    assert.equal(cat('7s 7h 7d Kc 4h'), HandCategory.ThreeOfAKind)
    assert.equal(cat('7s 7h 4d 4c Kh'), HandCategory.TwoPair)
    assert.equal(cat('7s 7h Kd 9c 4h'), HandCategory.Pair)
    assert.equal(cat('Ks Jh 9d 5c 2h'), HandCategory.HighCard)
  })

  it('족보 사이의 강약 순서가 맞다', () => {
    const ladder = [
      'Ks Jh 9d 5c 2h', // 하이카드
      '7s 7h Kd 9c 4h', // 원페어
      '7s 7h 4d 4c Kh', // 투페어
      '7s 7h 7d Kc 4h', // 트리플
      '9h 8s 7d 6c 5h', // 스트레이트
      'As Js 9s 5s 2s', // 플러시
      '7s 7h 7d 4c 4h', // 풀하우스
      '7s 7h 7d 7c Kh', // 포카드
      '9h 8h 7h 6h 5h', // 스트레이트 플러시
    ]
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(cmp(ladder[i], ladder[i - 1]) > 0, `${CATEGORY_LABEL[cat(ladder[i])]}가 더 강해야 한다`)
    }
  })
})

describe('에이스의 양면성', () => {
  it('A2345(휠)는 스트레이트이고 탑이 5다', () => {
    const wheel = evaluateFive(hand('5s 4h 3d 2c Ah'))
    assert.equal(wheel.category, HandCategory.Straight)
    assert.equal(wheel.score[1], 5)
  })

  it('휠은 가장 약한 스트레이트다', () => {
    assert.ok(cmp('6s 5h 4d 3c 2h', '5s 4h 3d 2c Ah') > 0)
  })

  it('AKQJT는 가장 강한 스트레이트다', () => {
    const broadway = evaluateFive(hand('As Kh Qd Jc Th'))
    assert.equal(broadway.category, HandCategory.Straight)
    assert.equal(broadway.score[1], 14)
  })

  it('로열은 K탑 스트레이트 플러시보다 강하다', () => {
    assert.ok(cmp('As Ks Qs Js Ts', 'Ks Qs Js Ts 9s') > 0)
  })

  it('KA234처럼 A를 사이에 끼워 이을 수는 없다', () => {
    assert.equal(cat('Kh Ah 2d 3c 4s'), HandCategory.HighCard)
  })
})

describe('키커 비교', () => {
  it('같은 원페어는 키커로 갈린다', () => {
    assert.ok(cmp('Ks Kh As 9d 4c', 'Kd Kc Qs 9h 4d') > 0)
  })

  it('키커까지 전부 같으면 무늬가 달라도 동점이다', () => {
    assert.equal(cmp('Ks Kh As 9d 4c', 'Kd Kc Ah 9s 4h'), 0)
  })

  it('투페어는 높은 페어 → 낮은 페어 → 키커 순으로 비교한다', () => {
    assert.ok(cmp('Ks Kh 4d 4c As', 'Qs Qh Js Jd Ah') > 0) // 높은 페어 우선
    assert.ok(cmp('Ks Kh 9d 9c 2s', 'Kd Kc 4h 4s Ah') > 0) // 낮은 페어에서 갈림
    assert.ok(cmp('Ks Kh 4d 4c As', 'Kd Kc 4h 4s Qh') > 0) // 키커에서 갈림
  })

  it('플러시는 높은 카드부터 차례로 비교한다', () => {
    assert.ok(cmp('As Js 9s 5s 2s', 'As Js 9s 5s 3s') < 0)
  })

  it('트리플은 같은 숫자가 나올 수 없으므로 키커로만 갈린다', () => {
    assert.ok(cmp('7s 7h 7d As 2c', '7c 7s 7h Ks Qd') > 0)
  })
})

describe('7장 중 최선의 5장', () => {
  it('스트레이트와 플러시가 동시에 가능하면 플러시를 고른다', () => {
    const best = evaluateBest(hand('9h 8h 7h 6c 5h 2h Kd'))
    assert.equal(best.category, HandCategory.Flush)
  })

  it('풀하우스 재료가 있으면 트리플에 머물지 않는다', () => {
    const best = evaluateBest(hand('7s 7h 7d 4c 4h Ks 2d'))
    assert.equal(best.category, HandCategory.FullHouse)
    assert.equal(describeHand(best), '풀하우스 7 / 4')
  })

  it('홀카드를 쓰지 않고 보드 5장이 최선일 수 있다', () => {
    const board = 'As Ks Qs Js Ts'
    const best = evaluateBest(hand(`${board} 2h 3d`))
    assert.equal(describeHand(best), '로열 스트레이트 플러시')
  })

  it('두 페어 재료가 셋이면 높은 쪽 둘만 쓴다', () => {
    const best = evaluateBest(hand('Ks Kh 9d 9c 4s 4h Ad'))
    assert.equal(best.category, HandCategory.TwoPair)
    assert.equal(describeHand(best), '투페어 K / 9')
    assert.equal(best.score[3], 14) // 키커는 A
  })
})

describe('덱', () => {
  it('52장이고 중복이 없다', () => {
    const deck = freshDeck()
    assert.equal(deck.length, 52)
    assert.equal(hasDuplicates(deck), false)
  })

  it('셔플해도 구성은 그대로다', () => {
    const deck = freshDeck()
    const shuffled = shuffle(deck, mulberry32(42))
    assert.equal(shuffled.length, 52)
    assert.equal(hasDuplicates(shuffled), false)
    assert.deepEqual(shuffled.slice().sort(), deck.slice().sort())
  })

  it('시드가 같으면 같은 딜이 나온다', () => {
    assert.deepEqual(shuffle(freshDeck(), mulberry32(7)), shuffle(freshDeck(), mulberry32(7)))
  })
})

/** 테스트 재현용 시드 난수. 실제 게임에는 쓰지 않는다. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
