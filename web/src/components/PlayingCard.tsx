import { RANK_VALUE, SUIT_LABEL, rankLabel, type Card, type Rank, type Suit } from '@the-gang/shared'

interface Props {
  card?: Card | null
  /** 뒷면으로 둘지. 남의 카드는 쇼다운 전까지 뒷면이다. */
  faceDown?: boolean
  size?: 'sm' | 'md'
  /** 등장 순서. 딜과 커뮤니티 공개가 한 장씩 차례로 놓이도록 늦춘다. */
  delay?: number
  /** 지금 내 족보를 이루는 카드인지. 어떤 조합인지 짚어 보여줄 때 켠다. */
  highlight?: boolean
}

const RED: Suit[] = ['h', 'd']

export function PlayingCard({ card, faceDown = false, size = 'md', delay = 0, highlight = false }: Props) {
  const classes = ['card', `card--${size}`, faceDown || !card ? 'card--back' : 'card--face']
  if (highlight) classes.push('card--highlight')

  if (faceDown || !card) {
    return <div className={classes.join(' ')} style={{ animationDelay: `${delay}ms` }} aria-label="뒷면 카드" />
  }

  const rank = card[0] as Rank
  const suit = card[1] as Suit
  const label = rankLabel(RANK_VALUE[rank])
  if (RED.includes(suit)) classes.push('card--red')

  return (
    <div className={classes.join(' ')} style={{ animationDelay: `${delay}ms` }} aria-label={`${label}${SUIT_LABEL[suit]}`}>
      <span className="card__rank">{label}</span>
      <span className="card__suit">{SUIT_LABEL[suit]}</span>
    </div>
  )
}

/** 아직 카드가 놓이지 않은 커뮤니티 자리. 다섯 칸이 처음부터 보여야 남은 라운드가 가늠된다. */
export function CardSlot() {
  return <div className="card card--slot" aria-hidden="true" />
}
