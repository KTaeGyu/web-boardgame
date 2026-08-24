/** 카드 표현: 랭크 문자 + 무늬 문자 (예: "As", "Th", "2c") */

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUITS = ['s', 'h', 'd', 'c'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]
export type Card = `${Rank}${Suit}`

/** 랭크의 숫자값. 2가 2, A가 14. 휠 스트레이트(A2345)에서만 A를 1로 따로 취급한다. */
export const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
}

export const SUIT_LABEL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }

export function rankOf(card: Card): Rank {
  return card[0] as Rank
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit
}

export function rankValueOf(card: Card): number {
  return RANK_VALUE[rankOf(card)]
}

/** 52장 전체. 순서는 항상 같으므로 섞어서 쓴다. */
export function freshDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push(`${rank}${suit}`)
  }
  return deck
}

/**
 * Fisher-Yates. rng 를 주입받는 이유는 테스트에서 딜을 재현하기 위해서다.
 * 실제 게임에서는 crypto 기반 rng 를 넘긴다.
 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 한 판에서 같은 카드가 두 번 나오지 않는지 확인한다. 딜 직후 자기검증용. */
export function hasDuplicates(cards: readonly Card[]): boolean {
  return new Set(cards).size !== cards.length
}
