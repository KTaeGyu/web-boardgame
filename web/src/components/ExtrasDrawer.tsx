import { useState } from 'react'
import {
  CATEGORY_LABEL,
  CHALLENGES,
  SPECIALISTS,
  rankLabel,
  type Card,
  type ExtraCard,
  type GameView,
} from '@the-gang/shared'

import { useBackIntercept } from '../lib/back.ts'
import { useScrollLock } from '../lib/useScrollLock.ts'
import { useSheetDrag } from '../lib/useSheetDrag.ts'
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
  /** 이번 판에 내가 받은 쪽지들. */
  notes: CardNote[]
  /**
   * 해결사를 쓰는 손잡이(`useSpecialistUse`). 쓸 수 없으면 넘기지 않는다 —
   * 그때는 카드가 단추 대신 「눌러서 뒤집기」를 그린다. 물음창은 이 드로어가 아니라
   * 훅을 든 쪽이 그린다. 테이블 옆에 선 같은 카드와 한 벌을 나눠 쓰기 때문이다.
   */
  onUse?: () => void
  /** 그 손잡이에 적을 말. 투표 자리와 사용 자리가 단추에 갈려 보여야 한다. */
  useLabel?: string
}

/**
 * 이번 판에 걸린 카드들.
 *
 * 판 내내 옆에 붙어 있고 접을 수 있다. 규칙이 바뀐 채로 진행되므로 언제든 다시
 * 읽을 수 있어야 하지만, 늘 펼쳐 두면 테이블을 가린다.
 */
export function ExtrasDrawer({ game, notes, onUse, useLabel }: Props) {
  // 접힌 채로 시작한다. 펼쳐 두면 테이블을 가리고, 대개는 걸린 것을 이미 옆에서 보고 있다.
  const [open, setOpen] = useState(false)
  // 펼쳐 둔 채 뒤로가기를 누르면 판을 떠나는 것이 아니라 서랍을 접는다.
  useBackIntercept(open, () => setOpen(false))

  const specialist = game.specialist === null ? null : SPECIALISTS[game.specialist]
  const count = game.challenges.length + (specialist ? 1 : 0)
  if (count === 0) return null

  const myNote = notes.find((note) => note.specialist === game.specialist) ?? null

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
              status={specialistStatus(game, myNote)}
              note={myNote}
              onUse={onUse}
              useLabel={useLabel}
            />
          )}
        </div>
      )}
    </aside>
  )
}

/**
 * 해결사 카드가 지금 어떤 상태인지.
 *
 * 드로어와 테이블 옆이 같은 카드를 그리므로 이 말도 한 곳에서 나와야 한다 —
 * 「사용됨」과 「사용됨 — 아래에 결과가 있습니다」가 자리마다 다르면 같은 카드로 읽히지 않는다.
 */
export function specialistStatus(game: GameView, note: CardNote | null): string {
  if (game.specialistUsed) return note ? '사용됨 — 아래에 결과가 있습니다' : '사용됨'

  const vote = game.specialistVote
  if (!vote) return '아직 쓰지 않았습니다'
  const nameOf = (id: string) =>
    game.players.find((player) => player.id === id)?.displayName ?? '누군가'
  if (vote.decided) return `${nameOf(vote.decided)}님이 쓸 차례입니다`
  const voters = game.players.filter((player) => player.connected).length
  return `누가 쓸지 고르는 중 (${vote.votes.length}/${voters})`
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
  useLabel?: string
}

/**
 * 카드 한 장.
 *
 * 앞면은 이름만 두어 한눈에 몇 장인지 보이게 하고, 마우스를 올리면 설명이 커서 옆에 뜬다.
 * 눌러서 뒤집으면 설명과 지금까지의 결과가 나온다 — 길어질 수 있어 뒷면은 스크롤된다.
 *
 * **쓸 수 있는 카드는 앞면에서도 바로 쓴다**(2026-09-03). 뒤집어야만 단추가 나오면
 * 「해결사를 어떻게 쓰나」가 한 번 더 물어야 하는 물음이 된다. 그 자리에 있던
 * 「눌러서 뒤집기」는 단추에 내준다 — 쓰기 전에 확인창이 카드 설명을 다시 보여주므로,
 * 뒤집지 않고 눌러도 무엇을 하는 카드인지 모르고 쓰게 되지는 않는다.
 */
export function ExtraTile({ kind, card, status, note, onUse, useLabel = '이 카드 사용' }: TileProps) {
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
            {onUse ? (
              <button
                type="button"
                className="btn btn--primary extra-card__use extra-card__use--front"
                onClick={(event) => {
                  // 이 누름은 뒤집기가 아니다. 부모까지 올라가면 카드가 함께 돌아간다.
                  event.stopPropagation()
                  onUse()
                }}
              >
                {useLabel}
              </button>
            ) : (
              <span className="extra-card__hint">눌러서 뒤집기</span>
            )}
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
                {useLabel}
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
  useScrollLock()
  const drag = useSheetDrag(onClose)
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal ${drag.className}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        {...drag.handlers}
      >
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
