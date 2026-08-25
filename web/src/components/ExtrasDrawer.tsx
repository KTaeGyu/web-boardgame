import { useState } from 'react'
import {
  CATEGORY_LABEL,
  CHALLENGES,
  SPECIALISTS,
  SPECIALIST_NEEDS,
  rankLabel,
  type Card,
  type ExtraCard,
  type GameView,
} from '@the-gang/shared'

import { useBackIntercept } from '../lib/back.ts'
import { tipPosition } from '../lib/tooltip.ts'
import { PlayingCard } from './PlayingCard.tsx'

/** 카드가 나에게만 알려준 것. 드로어의 그 카드 뒷면에 적힌다. */
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
  /** 이번 판에 내가 받은 쪽지들. */
  notes: CardNote[]
  onUse: (input: { targetId?: string; value?: number; cardIndex?: number }) => void
}

const RANK_VALUES = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

/**
 * 이번 판에 걸린 카드들.
 *
 * 판 내내 옆에 붙어 있고 접을 수 있다. 규칙이 바뀐 채로 진행되므로 언제든 다시
 * 읽을 수 있어야 하지만, 늘 펼쳐 두면 테이블을 가린다.
 */
export function ExtrasDrawer({ game, playerId, hand, notes, onUse }: Props) {
  // 접힌 채로 시작한다. 펼쳐 두면 테이블을 가리고, 대개는 걸린 것을 이미 옆에서 보고 있다.
  const [open, setOpen] = useState(false)
  // 펼쳐 둔 채 뒤로가기를 누르면 판을 떠나는 것이 아니라 서랍을 접는다.
  useBackIntercept(open, () => setOpen(false))
  const [asking, setAsking] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [value, setValue] = useState(14)
  const [cardIndex, setCardIndex] = useState(0)

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
            <ExtraTile
              key={`c${id}`}
              kind="challenge"
              card={CHALLENGES[id]}
              status={challengeStatus(game, id)}
            />
          ))}

          {specialist && (
            <ExtraTile
              kind="specialist"
              card={specialist}
              status={
                game.specialistUsed ? (myNote ? '사용됨 — 아래에 결과가 있습니다' : '사용됨') : '아직 쓰지 않았습니다'
              }
              note={myNote}
              onUse={canUse ? start : undefined}
            />
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
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  onUse({
                    targetId: needs?.target ? targetId : undefined,
                    value: needs?.value ? value : undefined,
                    cardIndex: needs?.ownCard ? cardIndex : undefined,
                  })
                  setAsking(false)
                }}
                disabled={!ready}
              >
                사용
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

/** 도전자 카드가 지금 어떤 상태인지. 스캔처럼 결과가 남는 카드가 있다. */
export function challengeStatus(game: GameView, id: number): string {
  const kind = id === 4 ? 'rank' : id === 9 ? 'category' : null
  const question = kind ? game.scan?.questions.find((q) => q.kind === kind) : null
  if (question) {
    if (question.decided === null) return '답을 모으는 중입니다'
    const answer =
      question.kind === 'rank'
        ? rankLabel(question.decided)
        : (CATEGORY_LABEL[question.decided as 0] ?? String(question.decided))
    return `「${answer}」로 답했고, ${question.correct ? '맞혔습니다' : '틀렸습니다'}`
  }
  return '이번 판 내내 적용됩니다'
}

interface TileProps {
  kind: 'challenge' | 'specialist'
  card: ExtraCard
  status: string
  note?: CardNote | null
  onUse?: () => void
}

/**
 * 카드 한 장.
 *
 * 앞면은 이름만 두어 한눈에 몇 장인지 보이게 하고, 마우스를 올리면 설명이 커서 옆에 뜬다.
 * 눌러서 뒤집으면 설명과 지금까지의 결과가 나온다 — 길어질 수 있어 뒷면은 스크롤된다.
 */
export function ExtraTile({ kind, card, status, note, onUse }: TileProps) {
  const [flipped, setFlipped] = useState(false)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <div
        className={`extra-card extra-card--${kind} ${flipped ? 'extra-card--flipped' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => setFlipped((on) => !on)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setFlipped((on) => !on)
          }
        }}
        onMouseMove={(event) => !flipped && setTip({ x: event.clientX, y: event.clientY })}
        onMouseLeave={() => setTip(null)}
      >
        <div className="extra-card__inner">
          <div className="extra-card__face extra-card__front">
            <span className="extra-card__kind">{kind === 'challenge' ? '도전자' : '해결사'}</span>
            <b className="extra-card__name">{card.name}</b>
            <span className="extra-card__hint">눌러서 뒤집기</span>
          </div>

          <div className="extra-card__face extra-card__back">
            <b className="extra-card__name">{card.name}</b>
            <p className="extra-card__text">{card.text}</p>
            <p className="extra-card__status">{status}</p>

            {note && (
              <div className="extra-card__note">
                <span className="extra-card__note-title">{note.title}</span>
                {note.text && <span className="extra-card__note-text">{note.text}</span>}
                {note.cards && note.cards.length > 0 && (
                  <div className="extra-card__note-cards">
                    {note.cards.map((item) => (
                      <PlayingCard key={item} card={item} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            )}

            {onUse && (
              <button
                type="button"
                className="btn btn--primary btn--block extra-card__use"
                onClick={(event) => {
                  event.stopPropagation()
                  onUse()
                }}
              >
                이 카드 사용
              </button>
            )}
          </div>
        </div>
      </div>

      {tip && (
        <div className="card-tip" style={tipPosition(tip)}>
          {card.text}
        </div>
      )}
    </>
  )
}

/** 카드가 나에게만 알려준 것. 처음 도착했을 때 한 번 뜨고, 뒤에는 드로어에서 본다. */
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
        <p className="note-hint">나만 볼 수 있습니다. 드로어의 카드를 뒤집어 다시 볼 수 있습니다.</p>
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  )
}
