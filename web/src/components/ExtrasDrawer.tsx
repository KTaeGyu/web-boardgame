import { useState } from 'react'
import {
  CHALLENGES,
  SPECIALISTS,
  SPECIALIST_NEEDS,
  rankLabel,
  type Card,
  type GameView,
} from '@the-gang/shared'

import { PlayingCard } from './PlayingCard.tsx'

interface Props {
  game: GameView
  playerId: string
  hand: Card[]
  onUse: (input: { targetId?: string; value?: number; cardIndex?: number }) => void
}

/** 두뇌가 고를 수 있는 숫자. 카드에 있는 것만 고르게 한다. */
const RANK_VALUES = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

/**
 * 이번 판에 걸린 카드들.
 *
 * 판 내내 옆에 붙어 있고 접을 수 있다. 규칙이 바뀐 채로 진행되므로 언제든 다시
 * 읽을 수 있어야 하지만, 늘 펼쳐 두면 테이블을 가린다.
 */
export function ExtrasDrawer({ game, playerId, hand, onUse }: Props) {
  const [open, setOpen] = useState(true)
  /** 쓰기 전에 한 번 묻는다. 무엇을 더 골라야 하는지는 카드가 정한다. */
  const [asking, setAsking] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [value, setValue] = useState(14)
  const [cardIndex, setCardIndex] = useState(0)

  const specialist = game.specialist === null ? null : SPECIALISTS[game.specialist]
  const needs = game.specialist === null ? null : SPECIALIST_NEEDS[game.specialist]
  const count = game.challenges.length + (specialist ? 1 : 0)
  if (count === 0) return null

  const canUse = specialist !== null && !game.specialistUsed && game.phase === 'picking'
  const others = game.players.filter((player) => player.id !== playerId)
  const ready = !needs?.target || targetId !== ''

  function start() {
    setTargetId(others[0]?.id ?? '')
    setValue(14)
    setCardIndex(0)
    setAsking(true)
  }

  function confirm() {
    onUse({
      targetId: needs?.target ? targetId : undefined,
      value: needs?.value ? value : undefined,
      cardIndex: needs?.ownCard ? cardIndex : undefined,
    })
    setAsking(false)
  }

  return (
    <aside className={`drawer ${open ? 'drawer--open' : ''}`}>
      <button type="button" className="drawer__tab" onClick={() => setOpen((on) => !on)}>
        <span className="drawer__tab-label">이번 판 규칙</span>
        <span className="drawer__tab-count">{count}</span>
        <span className="drawer__tab-arrow">{open ? '›' : '‹'}</span>
      </button>

      {open && (
        <div className="drawer__body">
          {game.challenges.map((id) => (
            <article key={`c${id}`} className="extra extra--challenge">
              <span className="extra__kind">도전자</span>
              <b className="extra__name">{CHALLENGES[id].name}</b>
              <span className="extra__text">{CHALLENGES[id].text}</span>
            </article>
          ))}

          {specialist && (
            <article
              className={`extra extra--specialist ${canUse ? 'extra--usable' : ''}`}
              onClick={canUse ? start : undefined}
              role={canUse ? 'button' : undefined}
              tabIndex={canUse ? 0 : undefined}
              onKeyDown={(event) => {
                if (canUse && (event.key === 'Enter' || event.key === ' ')) start()
              }}
            >
              <span className="extra__kind">해결사</span>
              <b className="extra__name">{specialist.name}</b>
              <span className="extra__text">{specialist.text}</span>
              <span className="extra__state">
                {game.specialistUsed ? '사용됨' : canUse ? '눌러서 사용' : '지금은 쓸 수 없음'}
              </span>
            </article>
          )}
        </div>
      )}

      {asking && specialist && (
        <div className="modal-backdrop" onClick={() => setAsking(false)} role="presentation">
          <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal__title">「{specialist.name}」을 쓰시겠습니까?</h2>
            <p className="modal__body">{specialist.text}</p>

            {needs?.target && (
              <label className="field">
                <span className="field__label">누구에게</span>
                <select
                  className="field__input"
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  {others.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {needs?.value && (
              <label className="field">
                <span className="field__label">어떤 숫자를</span>
                <select
                  className="field__input"
                  value={value}
                  onChange={(event) => setValue(Number(event.target.value))}
                >
                  {RANK_VALUES.map((rank) => (
                    <option key={rank} value={rank}>
                      {rankLabel(rank)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {needs?.ownCard && (
              <div className="field">
                <span className="field__label">보여줄 내 카드</span>
                <div className="pick-cards">
                  {hand.map((card, index) => (
                    <button
                      key={card}
                      type="button"
                      className={`pick-card ${index === cardIndex ? 'pick-card--on' : ''}`}
                      onClick={() => setCardIndex(index)}
                    >
                      <PlayingCard card={card} size="sm" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="btn-row">
              <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)}>
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={confirm} disabled={!ready}>
                사용
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
