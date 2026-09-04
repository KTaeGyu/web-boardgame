/**
 * 포커 족보표.
 *
 * 판이 도는 중에 「이게 플러시를 이기나」가 급해지는데, 그때 물어볼 곳이 없었다.
 * 대화로 물으면 카드 이야기가 되어 규칙에 걸린다 — 그래서 화면이 답해야 한다.
 *
 * 강한 것이 위다. 줄마다 예시 다섯 장을 놓고, **족보를 이루는 카드만 남기고
 * 나머지는 흐린다.** 이름만 늘어놓으면 「투 페어가 뭐였더라」에 다시 답이 안 되고,
 * 다섯 장을 다 진하게 두면 어디까지가 족보인지가 안 보인다.
 *
 * 이름은 CATEGORY_LABEL 을 그대로 쓴다. 화면이 부르는 이름과 쇼다운이 부르는 이름이
 * 갈리면 표를 보고도 제 결과를 못 찾는다.
 */

import { useEffect, useState } from 'react'
import { CATEGORY_LABEL, HandCategory, type Card } from '@the-gang/shared'

import { useBackClose } from '../lib/back.ts'
import { useScrollLock } from '../lib/useScrollLock.ts'
import { useEscape } from '../lib/useEscape.ts'
import { useSheetDrag } from '../lib/useSheetDrag.ts'
import { PlayingCard } from './PlayingCard.tsx'

interface Rank {
  name: string
  /** 예시 다섯 장. 족보를 이루는 것이 앞에 온다. */
  cards: Card[]
  /** 앞에서 몇 장이 족보를 이루는가. 나머지는 흐려진다. */
  used: number
}

/*
 * 로열 스트레이트 플러시는 따로 세는 족보가 아니라 스트레이트 플러시 중 제일 높은
 * 것이다(코드에도 갈래가 하나뿐이다). 그래도 줄을 나눠 둔 것은, 이것이 나올 수 있는
 * 가장 센 손이라는 것을 표에서 바로 보이게 하려는 것이다.
 */
const RANKS: Rank[] = [
  { name: '로열 스트레이트 플러시', cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'], used: 5 },
  { name: CATEGORY_LABEL[HandCategory.StraightFlush], cards: ['9h', '8h', '7h', '6h', '5h'], used: 5 },
  { name: CATEGORY_LABEL[HandCategory.FourOfAKind], cards: ['Ks', 'Kh', 'Kd', 'Kc', '7s'], used: 4 },
  { name: CATEGORY_LABEL[HandCategory.FullHouse], cards: ['Qs', 'Qh', 'Qd', '4s', '4h'], used: 5 },
  { name: CATEGORY_LABEL[HandCategory.Flush], cards: ['Ad', 'Jd', '8d', '5d', '3d'], used: 5 },
  { name: CATEGORY_LABEL[HandCategory.Straight], cards: ['Tc', '9d', '8s', '7h', '6c'], used: 5 },
  { name: CATEGORY_LABEL[HandCategory.ThreeOfAKind], cards: ['8s', '8h', '8d', 'Kc', '4s'], used: 3 },
  { name: CATEGORY_LABEL[HandCategory.TwoPair], cards: ['Js', 'Jh', '6d', '6c', '9s'], used: 4 },
  { name: CATEGORY_LABEL[HandCategory.Pair], cards: ['As', 'Ah', 'Qd', '8c', '3s'], used: 2 },
  { name: CATEGORY_LABEL[HandCategory.HighCard], cards: ['As', 'Qh', '9d', '6c', '3s'], used: 1 },
]

export function HandRanks() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="tool-btn"
        onClick={() => setOpen(true)}
        aria-label="포커 족보"
        title="포커 족보"
      >
        {/* 스페이드 하나. 카드 이야기라는 것을 그림 하나로 말한다. */}
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M12 3.5c-2.2 2.7-6.5 5-6.5 8.6a3.4 3.4 0 0 0 5.8 2.4c-.2 2-.8 3.4-1.8 4.5h5c-1-1.1-1.6-2.5-1.8-4.5a3.4 3.4 0 0 0 5.8-2.4c0-3.6-4.3-5.9-6.5-8.6z"
            fill="currentColor"
          />
        </svg>
      </button>

      {open && <RanksModal onClose={() => setOpen(false)} />}
    </>
  )
}

function RanksModal({ onClose }: { onClose: () => void }) {
  // 휴대폰의 뒤로가기는 화면을 떠나는 것이 아니라 이 창을 닫는 것이어야 한다.
  useBackClose(onClose)
  useScrollLock()
  const drag = useSheetDrag(onClose)

  useEscape(true, onClose)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal modal--wide modal--tall ${drag.className}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="포커 족보"
        {...drag.handlers}
      >
        <button type="button" className="modal__close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <h2 className="modal__title">포커 족보</h2>
        <p className="modal__body">위가 셉니다. 진한 카드가 족보를 이루는 카드입니다.</p>

        <ol className="ranks">
          {RANKS.map((rank) => (
            <li key={rank.name} className="ranks__row">
              <span className="ranks__cards">
                {rank.cards.map((card, at) => (
                  <PlayingCard key={`${card}-${at}`} card={card} dim={at >= rank.used} />
                ))}
              </span>
              <span className="ranks__name">{rank.name}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
