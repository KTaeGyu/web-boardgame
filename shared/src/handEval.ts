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
  [HandCategory.Pair]: '원 페어',
  [HandCategory.TwoPair]: '투 페어',
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

/**
 * 사람이 읽는 족보 이름. `이름(인자)` 형태로 통일한다.
 *
 * 인자는 그 족보를 결정지은 숫자다 — 투 페어는 높은 쪽부터, 풀하우스는
 * 트리플이 먼저다. 로열은 인자가 없어도 무엇인지 분명하다.
 */
export function describeHand(value: HandValue): string {
  const name = (v: number) => RANKS[v - 2] ?? String(v)
  const [, ...tb] = value.score
  const label = CATEGORY_LABEL[value.category]

  switch (value.category) {
    case HandCategory.StraightFlush:
      return tb[0] === 14 ? '로열 스트레이트 플러시' : `${label}(${name(tb[0])})`
    case HandCategory.FullHouse:
    case HandCategory.TwoPair:
      return `${label}(${name(tb[0])}, ${name(tb[1])})`
    default:
      // 나머지는 최상위 숫자 하나로 충분하다. 플러시와 스트레이트는 탑 카드다.
      return `${label}(${name(tb[0])})`
  }
}

export interface Holding {
  description: string
  /** 그 족보를 이루는 카드들. 화면에서 어떤 조합인지 짚어 보여주는 데 쓴다. */
  used: Card[]
}

/**
 * 지금 손에 잡힌 최선의 족보와, 그것을 이루는 카드들. 카드가 몇 장이든 답한다.
 *
 * 프리플롭에는 홀카드 두 장뿐이라 5장 평가기를 쓸 수 없다. 그때도
 * "원 페어인지 하이카드인지"는 말할 수 있어야 해서 따로 센다.
 */
export function bestHolding(cards: readonly Card[]): Holding | null {
  if (cards.length < 2) return null
  if (cards.length >= 5) {
    const value = evaluateBest(cards)
    return { description: describeHand(value), used: value.cards }
  }

  const name = (v: number) => RANKS[v - 2] ?? String(v)
  const byRank = new Map<number, Card[]>()
  for (const card of cards) {
    const rank = rankValueOf(card)
    byRank.set(rank, [...(byRank.get(rank) ?? []), card])
  }
  const groups = [...byRank.entries()]
    .map(([rank, members]) => ({ rank, members }))
    .sort((a, b) => b.members.length - a.members.length || b.rank - a.rank)

  const [first, second] = groups
  const label = (category: HandCategory) => CATEGORY_LABEL[category]

  if (first.members.length === 4) {
    return { description: `${label(HandCategory.FourOfAKind)}(${name(first.rank)})`, used: first.members }
  }
  if (first.members.length === 3) {
    return { description: `${label(HandCategory.ThreeOfAKind)}(${name(first.rank)})`, used: first.members }
  }
  if (first.members.length === 2 && second?.members.length === 2) {
    return {
      description: `${label(HandCategory.TwoPair)}(${name(first.rank)}, ${name(second.rank)})`,
      used: [...first.members, ...second.members],
    }
  }
  if (first.members.length === 2) {
    return { description: `${label(HandCategory.Pair)}(${name(first.rank)})`, used: first.members }
  }

  const top = groups.reduce((best, group) => (group.rank > best.rank ? group : best))
  return { description: `${label(HandCategory.HighCard)}(${name(top.rank)})`, used: top.members }
}

/** 이름만 필요할 때. */
export function describeHolding(cards: readonly Card[]): string | null {
  return bestHolding(cards)?.description ?? null
}
