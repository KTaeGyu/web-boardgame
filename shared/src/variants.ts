/**
 * 포커 변형. 「카드를 몇 장 받고, 언제 몇 장이 열리고, 그중 무엇으로 손을 만드는가」.
 *
 * 규칙이 아니라 **규칙의 자리**다 — 판(engine)은 변형이 무엇인지 모르고, 여기서
 * 건네받은 표대로 나눠주고 열고 평가한다. 도전자·해결사 카드는 이 표 위에서 그대로
 * 돈다: 「보안 카메라」는 holeCount 에 한 장을 더하고, 「빠른 접근」·「급한 도주」는
 * 라운드를 건너뛸 뿐이라 어느 변형에서든 그 변형의 몫만큼 열린다.
 *
 * **정원(maxSeats)은 취향이 아니라 덱 52장의 산수다.** 최악의 판을 세어 둔다 —
 * 「보안 카메라」로 홀이 한 장 늘고, 감지기가 누군가의 홀을 통째로 다시 뽑고,
 * 「해커」가 한 장을 더 받는 판. 덱이 비면 draw() 가 예외를 던지는데 화면에는
 * 아무 말도 뜨지 않고 판이 선다. 방을 만들 때 막는 편이 낫다.
 */

import { rankValueOf, type Card } from './cards.ts'
import {
  bestHolding,
  combinations,
  compareHands,
  describeHand,
  evaluateBest,
  evaluateFive,
  evaluateHoleAndCommunity,
  evaluateOmaha,
  CATEGORY_LABEL,
  type HandValue,
  type Holding,
} from './handEval.ts'
import { COMMUNITY_BY_ROUND, type GameView, type Round } from './game.ts'
import type { PokerVariant } from './protocol.ts'

/**
 * 공용 카드를 어떻게 늘어놓나. 규칙이 그 모양에 기대는 경우가 있어 화면이 마음대로 못 정한다.
 *
 * `row` 는 한 줄, `grid3` 은 3×3 격자, `circle` 은 원형(가운데 한 자리),
 * `banana` 는 **자리와 카드 묶음이 번갈아 서는 원형**이다.
 * 스팟스에서 세로·대각이, 서클잭에서 「붙어 있음」이 뜻을 가지려면 화면이 실제로
 * 그 모양으로 서 있어야 한다 — 한 줄로 늘어놓으면 7번과 1번이 이웃인 것을 셀 수 없다.
 */
export type BoardLayout = 'row' | 'grid3' | 'circle' | 'banana'

export interface VariantRules {
  /** 공용 카드를 늘어놓는 모양. */
  layout: BoardLayout
  /** 사람마다 받는 홀카드 수. 「보안 카메라」가 걸리면 여기에 한 장이 더해진다. */
  holeCount: number
  /**
   * 그 라운드가 시작될 때 깔려 있어야 할 공용 카드 수.
   *
   * **인원수를 받는다.** 바나나스플릿은 자리 사이마다 카드가 놓여서 사람이 늘면
   * 판도 함께 커진다 — 나머지 넷은 인원과 무관하게 같은 수를 돌려준다.
   */
  dealt(round: Round, seats: number): number
  /**
   * 그 자리에 앉은 사람이 **쓸 수 있는** 공용 카드.
   *
   * 대개는 깔린 것 전부다. 바나나스플릿만 사람마다 다르다 — 자기 양옆 두 묶음뿐이다.
   * 판정하는 자리(쇼다운·스캔·화면)가 저마다 잘라 쓰지 않도록 여기 한 곳에 둔다.
   */
  communityFor(community: readonly Card[], at: number, seats: number): readonly Card[]
  /** 덱 52장이 감당하는 정원. 위 머리말의 산수. */
  maxSeats: number
  /** 쇼다운·스캔이 쓰는 판정. 공용 카드가 다 열린 뒤에만 불린다. */
  evaluate(hole: readonly Card[], community: readonly Card[]): HandValue
  /**
   * 「지금 내 손이 무엇인가」. 라운드 도중에도 답해야 하므로 공용이 덜 깔린 때를 견딘다.
   * 화면의 조합 보기와 해결사 「도주 운전사」가 쓴다.
   */
  holding(hole: readonly Card[], community: readonly Card[]): Holding | null
}

/**
 * 공용이 아직 없을 때의 「지금 내 손」 — **두 장짜리 조합 중 최선.**
 *
 * 홀카드를 정확히 두 장만 쓰는 변형(오마하 · 서클잭)이 함께 쓴다. 넉 장을 그대로
 * bestHolding 에 넘기면 **쓸 수 없는 손을 말한다** — A 가 넉 장이어도 오마하에서
 * 그건 포카드가 아니라 「에이스 두 장」이다.
 */
function bestTwoHolding(hole: readonly Card[]): Holding | null {
  let best: Holding | null = null
  let bestKey = -1
  for (const [a, b] of combinations(hole, 2)) {
    const holding = bestHolding([a, b])
    if (!holding) continue
    // 짝이면 무조건 위, 그다음은 높은 쪽. 두 장으로 갈릴 수 있는 것은 이것뿐이다.
    const paired = rankValueOf(a) === rankValueOf(b) ? 100 : 0
    const key = paired + Math.max(rankValueOf(a), rankValueOf(b))
    if (key > bestKey) {
      bestKey = key
      best = holding
    }
  }
  return best
}

/** 오마하의 「지금 내 손」. 플롭이 깔리기 전에는 두 장짜리 조합으로 답한다. */
function omahaHolding(hole: readonly Card[], community: readonly Card[]): Holding | null {
  if (community.length >= 3 && hole.length >= 2) {
    const value = evaluateOmaha(hole, community)
    return { description: describeHand(value), name: CATEGORY_LABEL[value.category], used: value.cards }
  }
  return bestTwoHolding(hole)
}

/** 인원과 무관하게 같은 수를 돌려주는 변형을 위한 도우미. 넷 중 셋이 이걸 쓴다. */
function fixed(byRound: Record<Round, number>) {
  return (round: Round) => byRound[round]
}

/** 깔린 것을 모두가 함께 쓰는 변형. 바나나스플릿 말고는 전부 이렇다. */
const shared = (community: readonly Card[]) => community

/**
 * 3×3 격자의 세 장짜리 라인 여덟 개 — 가로 셋 · 세로 셋 · 대각 둘.
 *
 * 인덱스는 공용 카드 배열의 자리이고, 왼쪽 위부터 **가로로** 센다.
 * 화면의 격자도 같은 차례로 그린다 — 두 곳의 차례가 갈리면 세로 라인이
 * 화면에서는 세로가 아니게 된다.
 */
export const SPOTS_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

/**
 * 지금까지 열린 카드만으로 **완성된** 라인들.
 *
 * 가로 한 줄씩 열므로 2라운드에는 가로 하나뿐이고, 3라운드에는 가로 둘이다.
 * 세로와 대각은 셋째 줄이 열려야 비로소 선다 — 판이 마지막에 확 넓어지는 것이
 * 이 변형의 맛이고, 덜 열린 라인을 미리 세어 주면 그게 없어진다.
 */
function spotsLines(community: readonly Card[]): Card[][] {
  return SPOTS_LINES.filter((line) => line.every((at) => community[at] !== undefined)).map((line) =>
    line.map((at) => community[at]),
  )
}

/**
 * 스팟스 — **격자의 라인 하나 + 내 홀카드**로 만드는 최선의 다섯 장.
 *
 * 라인은 셋이 한 묶음이라 섞어 쓸 수 없다. 두 라인에 걸친 다섯 장은 없다.
 * 고르는 것은 「어느 라인이냐」 하나이고, 그 뒤는 일곱 장 중 다섯 장이라 텍사스와 같다.
 * 홀카드는 자연히 최소 두 장이 쓰인다 — 라인이 셋뿐이라 다섯을 채우려면 그렇게 된다.
 */
function evaluateSpots(hole: readonly Card[], community: readonly Card[]): HandValue {
  const lines = spotsLines(community)
  if (lines.length === 0) throw new Error('완성된 라인이 하나도 없다 — 아직 판정할 수 없다')

  let best: HandValue | null = null
  for (const line of lines) {
    const value = evaluateBest([...hole, ...line])
    if (best === null || compareHands(value, best) > 0) best = value
  }
  return best!
}

/**
 * 스팟스의 「지금 내 손」.
 *
 * 프리플롭에는 라인이 없어 홀카드만으로 답한다. 그대로 세도 되는 것이,
 * 쇼다운에서 홀 넉 장을 다 쓰는 손(라인에서 한 장만 가져오는 손)이 성립하기 때문이다.
 */
function spotsHolding(hole: readonly Card[], community: readonly Card[]): Holding | null {
  if (spotsLines(community).length === 0) return bestHolding(hole)
  const value = evaluateSpots(hole, community)
  return { description: describeHand(value), name: CATEGORY_LABEL[value.category], used: value.cards }
}

/** 원형에 놓이는 자리 수. 가운데 와일드는 여기에 들지 않는다. */
export const CIRCLE_SEATS = 7
/** 가운데 와일드카드가 놓이는 자리 — 공용 배열의 여덟째. */
export const CIRCLE_WILD_AT = 7

/**
 * 원 위에서 **붙어 있는 세 자리**. 일곱 가지이고, 끝과 끝이 이어진다.
 *
 * `[5,6,0]` 이 성립하는 것이 이 변형의 전부다. 화면이 진짜 원으로 서 있어야
 * 그 이웃 관계가 눈에 들어온다 — 한 줄로 펴면 마지막과 처음이 남남처럼 보인다.
 * 가운데 와일드카드는 원에 들지 않으므로 여기에도 없다.
 */
export const CIRCLE_TRIPLES: readonly (readonly [number, number, number])[] = Array.from(
  { length: CIRCLE_SEATS },
  (_, at) => [at, (at + 1) % CIRCLE_SEATS, (at + 2) % CIRCLE_SEATS] as const,
)

/** 지금까지 열린 카드만으로 완성된 이웃 셋. 원이 반쯤 채워진 동안에는 몇 가지뿐이다. */
function circleTriples(community: readonly Card[]): Card[][] {
  return CIRCLE_TRIPLES.filter((triple) => triple.every((at) => community[at] !== undefined)).map(
    (triple) => triple.map((at) => community[at]),
  )
}

/**
 * 서클잭 — **홀 2장 + 원에서 붙어 있는 3장.**
 *
 * 가운데 와일드카드를 켜면 **이웃 세 자리 중 한 자리를 그 카드로 바꿔** 쓸 수 있다.
 *
 * 🔴 **여기서 「와일드」는 숫자가 아니라 자리가 자유롭다는 뜻이다.** 카드는 7♦ 이면
 * 끝까지 7♦ 이고 **모두에게 같은 한 장**이다. 자유로운 것은 「원의 어느 자리에 끼우느냐」다.
 * 내 카드 두 장은 반드시 쓴다 — 원작의 「내 두 장 + 붙어 있는 세 장」 그대로다.
 *
 * 하루 동안 이것을 **숫자가 자유로운 와일드**(사람마다 아무 카드로)로 두었다가
 * 걷어냈다(2026-09-02). 두 가지가 걸렸다 — 손이 전반적으로 세져 여러 사람이 같은 손을
 * 잡았고(토큰으로 세기를 선언하는 놀이가 물러진다), 무엇보다 **화면에 찍힌 숫자가
 * 거짓말**이 됐다. 뜻 없는 7 을 크게 그려 놓고 옆에 「와일드」라고 적어 둔 꼴이라,
 * 보는 사람은 당연히 7 로 읽는다.
 *
 * 「보안 카메라」로 홀이 석 장이어도 **쓰는 것은 두 장**이다. 고를 폭만 넓어진다.
 */
function circleEvaluate(hole: readonly Card[], community: readonly Card[], wild: boolean): HandValue {
  const triples = circleTriples(community)
  if (triples.length === 0) throw new Error('아직 이웃 셋이 완성되지 않았다 — 판정할 수 없다')

  const wildCard = wild ? community[CIRCLE_WILD_AT] : undefined
  let best: HandValue | null = null
  const keep = (value: HandValue) => {
    if (best === null || compareHands(value, best) > 0) best = value
  }

  for (const two of combinations(hole, 2)) {
    for (const three of triples) {
      // 와일드를 안 쓰는 경우. 켜져 있어도 쓰지 않는 편이 나을 수 있다.
      keep(evaluateFive([...two, ...three]))
      if (wildCard === undefined) continue

      // 바꿀 수 있는 것은 **이웃 셋 안에서만**이다. 내 두 장은 자리를 지킨다.
      for (let at = 0; at < three.length; at++) {
        keep(evaluateFive([...two, ...three.filter((_, index) => index !== at), wildCard]))
      }
    }
  }
  return best!
}

function circleHolding(
  hole: readonly Card[],
  community: readonly Card[],
  wild: boolean,
): Holding | null {
  // 아직 이웃 셋이 없으면 두 장짜리 조합으로 답한다 — 쓰는 것은 언제나 두 장이다.
  if (circleTriples(community).length === 0) return bestTwoHolding(hole)
  const value = circleEvaluate(hole, community, wild)
  return { description: describeHand(value), name: CATEGORY_LABEL[value.category], used: value.cards }
}

/** 바나나스플릿 — 자리와 자리 사이에 놓이는 카드 묶음 하나의 크기. */
export const BANANA_GROUP = 3

/**
 * 묶음 하나의 카드. **평평한 배열에 흩어져 있다.**
 *
 * 라운드마다 **묶음마다 한 장씩** 놓이므로, 인원이 N 이면 `0..N-1` 이 각 묶음의 첫 장,
 * `N..2N-1` 이 둘째 장이다. 곧 묶음 g 는 `g`, `N+g`, `2N+g` 자리에 있다.
 * 이 셈 덕분에 공용 카드를 여전히 **배열 하나**로 들고 다닐 수 있다.
 */
export function bananaGroup(community: readonly Card[], at: number, seats: number): Card[] {
  const cards: Card[] = []
  for (let round = 0; round < BANANA_GROUP; round++) {
    const card = community[round * seats + at]
    if (card !== undefined) cards.push(card)
  }
  return cards
}

/**
 * 그 자리의 사람이 쓸 수 있는 여섯 장 — **왼쪽 묶음과 오른쪽 묶음.**
 *
 * 묶음 g 는 자리 g 와 자리 g+1 **사이**에 있다. 그래서 자리 i 의 사람에게는
 * 앞의 묶음(i-1)과 자기 묶음(i) 둘이 걸린다. 이웃끼리는 한 묶음을 나눠 쓰지만
 * 테이블 전체가 같은 카드를 보는 것은 아니다 — 그것이 이 변형의 전부다.
 */
function bananaCommunityFor(community: readonly Card[], at: number, seats: number): Card[] {
  const left = (at - 1 + seats) % seats
  return [...bananaGroup(community, left, seats), ...bananaGroup(community, at, seats)]
}

export const VARIANTS: Record<PokerVariant, VariantRules> = {
  texas: {
    layout: 'row',
    holeCount: 2,
    dealt: fixed(COMMUNITY_BY_ROUND),
    communityFor: shared,
    // 2N + 5 에 최악(홀 +1 · 감지기 재배분 · 해커)을 얹어도 3·10 + 6 + 3 + 1 = 40.
    maxSeats: 10,
    evaluate: evaluateHoleAndCommunity,
    holding: (hole, community) => bestHolding([...hole, ...community]),
  },
  omaha: {
    layout: 'row',
    holeCount: 4,
    // 텍사스와 같은 흐름이다. 홀카드 수와 조합 규칙만 다르다.
    dealt: fixed(COMMUNITY_BY_ROUND),
    communityFor: shared,
    // 5N + 5 + 5 + 1 ≤ 52 → 8명. 9명이면 최악의 판에서 덱이 빈다.
    maxSeats: 8,
    evaluate: evaluateOmaha,
    holding: omahaHolding,
  },
  spots: {
    layout: 'grid3',
    holeCount: 4,
    /*
     * 가로 한 줄씩 연다. 원작은 사람이 돌아가며 뒷면 한 장을 골라 뒤집는데,
     * 아홉 장이면 아홉 번이라 판 하나가 너무 길어진다. 줄 단위로 묶어 네 걸음에 끝낸다.
     */
    dealt: fixed({ 1: 0, 2: 3, 3: 6, 4: 9 }),
    communityFor: shared,
    // 5N + 9 + 5 + 1 ≤ 52 → 7명. 아홉 장이 판에 깔리는 만큼 자리가 줄어든다.
    maxSeats: 7,
    evaluate: evaluateSpots,
    holding: spotsHolding,
  },
  /*
   * 서클잭은 가운데 와일드카드를 켜고 끄는 두 벌이다.
   *
   * 켜면 공용이 한 장 늘고 손을 만드는 법이 달라진다 — 곧 다른 표다.
   * 방 설정에는 한 줄로 보이고(「서클잭」 + 체크칸), 계약에는 이렇게 둘로 남는다.
   */
  circle: {
    layout: 'circle',
    holeCount: 2,
    // 원을 따라 세 장씩 돌다가 마지막 한 장으로 닫는다.
    dealt: fixed({ 1: 0, 2: 3, 3: 6, 4: 7 }),
    communityFor: shared,
    maxSeats: 10,
    evaluate: (hole, community) => circleEvaluate(hole, community, false),
    holding: (hole, community) => circleHolding(hole, community, false),
  },
  circleWild: {
    layout: 'circle',
    holeCount: 2,
    // 마지막에 두 장이 열린다 — 원의 일곱째와 가운데 와일드카드.
    dealt: fixed({ 1: 0, 2: 3, 3: 6, 4: 8 }),
    communityFor: shared,
    maxSeats: 10,
    evaluate: (hole, community) => circleEvaluate(hole, community, true),
    holding: (hole, community) => circleHolding(hole, community, true),
  },
  banana: {
    layout: 'banana',
    holeCount: 2,
    /*
     * 자리 사이마다 한 장씩, 세 걸음. 그래서 판이 인원과 함께 커진다 —
     * 여기가 `dealt` 이 인원수를 받는 유일한 이유다.
     */
    dealt: (round, seats) => (round - 1) * seats,
    communityFor: bananaCommunityFor,
    /*
     * 정원 6. 규칙보다 화면이 먼저 막는다 — 자리와 묶음이 번갈아 서는 원이라
     * 사람이 늘면 한 바퀴에 열두 덩이가 되고, 그때부터는 「내 양옆」이 눈에 안 들어온다.
     * 덱은 여유가 있다: 3·6 + 18 + 3 + 1 = 40장.
     */
    maxSeats: 6,
    // 내 두 장 + 양옆 여섯 장, 여덟 장 중 최선의 다섯 장. 텍사스처럼 제약이 없다.
    evaluate: (hole, community) => evaluateBest([...hole, ...community]),
    holding: (hole, community) => bestHolding([...hole, ...community]),
  },
}

/**
 * 공개 상태에서 **그 사람이 쓸 수 있는 공용 카드**를 자른다.
 *
 * 판(engine)에는 같은 일을 하는 자리가 따로 있다. 화면은 공개 상태만 들고 있어서
 * 여기를 지난다 — 「지금 내 손」·조합 보기·쇼다운이 저마다 통째 공용을 보면
 * 바나나스플릿에서 **남의 묶음으로 답한다.**
 */
export function usableCommunity(view: GameView, playerId: string): readonly Card[] {
  const at = view.players.findIndex((player) => player.id === playerId)
  return VARIANTS[view.variant].communityFor(view.community, Math.max(at, 0), view.players.length)
}
