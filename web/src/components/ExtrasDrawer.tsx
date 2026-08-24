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

/** 카드가 나에게만 알려준 것. 드로어의 그 카드에 적힌다. */
export interface CardNote {
  specialist: number
  title: string
  text?: string
  cards?: Card[]
}

interface Props {
  game: GameView
  playerId: string
  hand: Card[]
  /** 이번 판에 내가 받은 쪽지들. 카드를 눌러 다시 볼 수 있다. */
  notes: CardNote[]
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
export function ExtrasDrawer({ game, playerId, hand, notes, onUse }: Props) {
  const [open, setOpen] = useState(true)
  /** 쓰기 전에 한 번 묻는다. 무엇을 더 골라야 하는지는 카드가 정한다. */
  const [asking, setAsking] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [value, setValue] = useState(14)
  const [cardIndex, setCardIndex] = useState(0)
  /** 쪽지를 펼쳐 보고 있는 카드. */
  const [reading, setReading] = useState<CardNote | null>(null)

  const specialist = game.specialist === null ? null : SPECIALISTS[game.specialist]
  const needs = game.specialist === null ? null : SPECIALIST_NEEDS[game.specialist]
  const count = game.challenges.length + (specialist ? 1 : 0)
  if (count === 0) return null

  const canUse = specialist !== null && !game.specialistUsed && game.phase === 'picking'
  const myNote = notes.find((note) => note.specialist === game.specialist) ?? null
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
              className={`extra extra--specialist ${canUse || myNote ? 'extra--usable' : ''}`}
              onClick={canUse ? start : myNote ? () => setReading(myNote) : undefined}
              role={canUse || myNote ? 'button' : undefined}
              tabIndex={canUse || myNote ? 0 : undefined}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                if (canUse) start()
                else if (myNote) setReading(myNote)
              }}
            >
              <span className="extra__kind">해결사</span>
              <b className="extra__name">{specialist.name}</b>
              <span className="extra__text">{specialist.text}</span>
              <span className="extra__state">
                {myNote
                  ? '눌러서 다시 보기'
                  : game.specialistUsed
                    ? '사용됨'
                    : canUse
                      ? '눌러서 사용'
                      : '지금은 쓸 수 없음'}
              </span>
            </article>
          )}
        </div>
      )}

      {reading && <NoteCard note={reading} onClose={() => setReading(null)} />}

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

/** 카드가 나에게만 알려준 것. 처음 도착했을 때 한 번 뜨고, 뒤에는 눌러서 본다. */
export function NoteCard({ note, onClose }: { note: CardNote; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="modal__title">{note.title}</h2>
        {note.text && <p className="modal__body">{note.text}</p>}
        {note.cards && note.cards.length > 0 && (
          <div className="note-cards">
            {note.cards.map((card) => (
              <PlayingCard key={card} card={card} />
            ))}
          </div>
        )}
        <p className="note-hint">나만 볼 수 있습니다. 드로어의 카드를 눌러 다시 볼 수 있습니다.</p>
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  )
}
