import { NO_SUIT, RANK_VALUE, rankLabel, suitSymbol, type Card, type Rank, type Suit } from '@the-gang/shared'

interface Props {
  card?: Card | null
  /** 뒷면으로 둘지. 남의 카드는 쇼다운 전까지 뒷면이다. */
  faceDown?: boolean
  size?: 'sm' | 'md'
  /** 등장 순서. 딜과 커뮤니티 공개가 한 장씩 차례로 놓이도록 늦춘다. */
  delay?: number
  /** 지금 내 족보를 이루는 카드인지. 어떤 조합인지 짚어 보여줄 때 켠다. */
  highlight?: boolean
  /** 뒤로 물릴 카드인지. 족보표에서 족보를 이루지 않는 카드를 어둡게 덮는다. */
  dim?: boolean
}

const RED: Suit[] = ['h', 'd']

export function PlayingCard({
  card,
  faceDown = false,
  size = 'md',
  delay = 0,
  highlight = false,
  dim = false,
}: Props) {
  const classes = ['card', `card--${size}`, faceDown || !card ? 'card--back' : 'card--face']
  if (highlight) classes.push('card--highlight')
  if (dim) classes.push('card--dim')

  if (faceDown || !card) {
    return <div className={classes.join(' ')} style={{ animationDelay: `${delay}ms` }} aria-label="뒷면 카드" />
  }

  const rank = card[0] as Rank
  const suit = card[1] as Suit
  const label = rankLabel(RANK_VALUE[rank])
  if (RED.includes(suit)) classes.push('card--red')
  // 「잭」이 준 무늬 없는 J. 무늬가 없다는 것이 한눈에 보여야 플러시 착각을 막는다.
  if (card[1] === NO_SUIT) classes.push('card--nosuit')

  return (
    <div
      className={classes.join(' ')}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`${label}${suitSymbol(card)}`}
    >
      <span className="card__rank">{label}</span>
      <span className="card__suit">{suitSymbol(card)}</span>
    </div>
  )
}

/** 아직 카드가 놓이지 않은 커뮤니티 자리. 다섯 칸이 처음부터 보여야 남은 라운드가 가늠된다. */
export function CardSlot() {
  return <div className="card card--slot" aria-hidden="true" />
}
