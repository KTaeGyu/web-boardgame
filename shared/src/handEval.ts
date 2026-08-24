/**
 * 포커 핸드 평가.
 *
 * 더 갱의 쇼다운은 "앞사람보다 같거나 강하면 통과"이므로, 평가 결과는
 * 우열뿐 아니라 "완전히 같음"까지 구분할 수 있어야 한다. 그래서 족보 이름이
 * 아니라 사전식으로 비교 가능한 숫자 배열(score)을 돌려준다.
 * score 가 완전히 일치하면 그것이 룰북의 true tie 다.
 */

import { type Card, RANKS, rankValueOf, suitOf } from './cards.ts'

/** 숫자가 클수록 강하다. 로열 스트레이트 플러시는 별도 카테고리가 아니라 A탑 스트레이트 플러시다. */
export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const

export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory]

export const CATEGORY_LABEL: Record<HandCategory, string> = {
  [HandCategory.HighCard]: '하이카드',
  [HandCategory.Pair]: '원페어',
  [HandCategory.TwoPair]: '투페어',
  [HandCategory.ThreeOfAKind]: '트리플',
  [HandCategory.Straight]: '스트레이트',
  [HandCategory.Flush]: '플러시',
  [HandCategory.FullHouse]: '풀하우스',
  [HandCategory.FourOfAKind]: '포카드',
  [HandCategory.StraightFlush]: '스트레이트 플러시',
}

export interface HandValue {
  category: HandCategory
  /** [카테고리, 타이브레이커...] 사전식 비교용. 길이는 카테고리마다 다르지만 같은 카테고리끼리는 항상 같다. */
  score: number[]
  /** 실제로 쓰인 5장. 쇼다운 화면에서 강조 표시하는 데 쓴다. */
  cards: Card[]
  label: string
}

const WHEEL = [14, 5, 4, 3, 2] // A2345 는 A 를 1 로 보아 탑이 5 다.

/** 내림차순 랭크값 5개가 스트레이트면 탑 랭크를, 아니면 null 을 준다. */
function straightTop(descRanks: number[]): number | null {
  if (descRanks.length !== 5) return null
  if (new Set(descRanks).size !== 5) return null
  if (descRanks.every((r, i) => r === WHEEL[i])) return 5
  return descRanks[0] - descRanks[4] === 4 ? descRanks[0] : null
}

/** 정확히 5장짜리 핸드를 평가한다. */
export function evaluateFive(hand: readonly Card[]): HandValue {
  if (hand.length !== 5) throw new Error(`5장이어야 한다: ${hand.length}장 받음`)

  const values = hand.map(rankValueOf).sort((a, b) => b - a)
  const isFlush = new Set(hand.map(suitOf)).size === 1
  const top = straightTop(values)

  // 같은 랭크끼리 묶어 (개수, 랭크) 내림차순 정렬. 포카드/풀하우스/페어류가 전부 여기서 갈린다.
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const groups = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([rank, count]) => ({ rank, count }))
  const shape = groups.map((g) => g.count).join('')
  const byGroup = groups.map((g) => g.rank)

  const build = (category: HandCategory, tiebreak: number[]): HandValue => ({
    category,
    score: [category, ...tiebreak],
    cards: hand.slice(),
    label: CATEGORY_LABEL[category],
  })

  if (isFlush && top !== null) return build(HandCategory.StraightFlush, [top])
  if (shape === '41') return build(HandCategory.FourOfAKind, byGroup)
  if (shape === '32') return build(HandCategory.FullHouse, byGroup)
  if (isFlush) return build(HandCategory.Flush, values)
  if (top !== null) return build(HandCategory.Straight, [top])
  if (shape === '311') return build(HandCategory.ThreeOfAKind, byGroup)
  if (shape === '221') return build(HandCategory.TwoPair, byGroup)
  if (shape === '2111') return build(HandCategory.Pair, byGroup)
  return build(HandCategory.HighCard, values)
}

/** 사전식 비교. a 가 강하면 양수, 약하면 음수, 완전히 같으면 0(= true tie). */
export function compareHands(a: HandValue, b: HandValue): number {
  const len = Math.max(a.score.length, b.score.length)
  for (let i = 0; i < len; i++) {
    const diff = (a.score[i] ?? 0) - (b.score[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** C(n,5) 조합을 전부 훑는다. 7장이면 21가지뿐이라 최적화보다 명확함을 택했다. */
function* fiveCardCombos(cards: readonly Card[]): Generator<Card[]> {
  const n = cards.length
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            yield [cards[a], cards[b], cards[c], cards[d], cards[e]]
}

/** 홀카드 2장 + 커뮤니티 5장 중 최선의 5장. 홀카드를 반드시 써야 한다는 제약은 없다. */
export function evaluateBest(cards: readonly Card[]): HandValue {
  if (cards.length < 5) throw new Error(`최소 5장이 필요하다: ${cards.length}장 받음`)
  let best: HandValue | null = null
  for (const combo of fiveCardCombos(cards)) {
    const value = evaluateFive(combo)
    if (best === null || compareHands(value, best) > 0) best = value
  }
  return best!
}

export function evaluateHoleAndCommunity(hole: readonly Card[], community: readonly Card[]): HandValue {
  return evaluateBest([...hole, ...community])
}

/** 화면 표기용 짧은 설명. 예: "풀하우스 (K over 7)" 대신 "풀하우스 K" 정도로 간결하게. */
export function describeHand(value: HandValue): string {
  const name = (v: number) => RANKS[v - 2] ?? String(v)
  const [, ...tb] = value.score
  switch (value.category) {
    case HandCategory.StraightFlush:
      return tb[0] === 14 ? '로열 스트레이트 플러시' : `스트레이트 플러시 ${name(tb[0])} 탑`
    case HandCategory.FourOfAKind:
      return `포카드 ${name(tb[0])}`
    case HandCategory.FullHouse:
      return `풀하우스 ${name(tb[0])} / ${name(tb[1])}`
    case HandCategory.Flush:
      return `플러시 ${name(tb[0])} 탑`
    case HandCategory.Straight:
      return `스트레이트 ${name(tb[0])} 탑`
    case HandCategory.ThreeOfAKind:
      return `트리플 ${name(tb[0])}`
    case HandCategory.TwoPair:
      return `투페어 ${name(tb[0])} / ${name(tb[1])}`
    case HandCategory.Pair:
      return `원페어 ${name(tb[0])}`
    default:
      return `하이카드 ${name(tb[0])}`
  }
}
