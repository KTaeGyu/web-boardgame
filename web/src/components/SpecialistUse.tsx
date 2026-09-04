/**
 * 해결사를 쓰는 한 벌 — 투표와 사용창.
 *
 * **누가 쓸지는 다 같이 정한다**(2026-09-03). 예전에는 먼저 「이 카드 사용」을 누른
 * 사람이 곧 쓰는 사람이었는데, 누가 쓰느냐가 판을 통째로 바꾸는 카드들이라(「정보원」을
 * 누가 누구에게, 「근육」을 누가) 그 판단이 한 사람 손에 떨어져 있었다. 카드 이야기가
 * 금지된 게임에서 **표는 말이 된다** — 스캔이 이미 그렇게 답을 맞춰간다.
 *
 * 그래서 순서가 둘이다.
 *   1. 투표 — 접속 중인 사람이 모두 같은 사람을 고르면 정해진다.
 *   2. 사용 — 뽑힌 사람만, 대상·숫자·카드를 골라 쓴다.
 *
 * 해결사 카드는 화면에 **두 군데** 선다(드로어 안, 넓은 화면에서는 테이블 옆). 둘은
 * 같은 카드여야 하므로 손잡이와 창을 여기 한 벌만 두고 화면이 두 카드에 나눠 준다.
 * 창은 화면 어디에 그려도 되지만 **한 번만** 그린다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  SPECIALISTS,
  SPECIALIST_NEEDS,
  rankLabel,
  type Card,
  type GameView,
} from '@the-gang/shared'

import { useScrollLock } from '../lib/useScrollLock.ts'
import { useBackIntercept } from '../lib/back.ts'
import { useEscape } from '../lib/useEscape.ts'
import { useSheetDrag } from '../lib/useSheetDrag.ts'
import { PlayingCard } from './PlayingCard.tsx'

const RANK_VALUES = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

export interface SpecialistUseInput {
  targetId?: string
  value?: number
  cardIndex?: number
}

interface Args {
  /** 판이 아직 안 왔을 수 있다. 훅은 조건부로 부를 수 없으므로 여기서 받는다. */
  game: GameView | null
  playerId: string
  hand: Card[]
  onVote: (pick: string) => void
  onUse: (input: SpecialistUseInput) => void
}

export interface SpecialistUse {
  /**
   * 카드에 얹을 손잡이. 지금 내가 할 일이 없으면 `undefined` 이고, 그때 카드는
   * 단추 대신 「눌러서 뒤집기」를 그린다.
   */
  start?: () => void
  /** 그 손잡이에 적을 말. 지금이 투표 자리인지 사용 자리인지가 단추에 보여야 한다. */
  label?: string
  /** 지금 떠 있는 창. 없으면 `null`. */
  ask: ReactNode
}

export function useSpecialistUse({ game, playerId, hand, onVote, onUse }: Args): SpecialistUse {
  /** 지금 무엇을 열어 두었나. 'vote' 는 누가 쓸지, 'use' 는 어떻게 쓸지. */
  const [open, setOpen] = useState<'vote' | 'use' | null>(null)
  const [targetId, setTargetId] = useState('')
  const [value, setValue] = useState(14)
  const [cardIndex, setCardIndex] = useState(0)

  const specialist = game && game.specialist !== null ? SPECIALISTS[game.specialist] : null
  const needs = game && game.specialist !== null ? SPECIALIST_NEEDS[game.specialist] : null
  const vote = game?.specialistVote ?? null
  const decided = vote?.decided ?? null

  /*
   * 지금 살아 있는 카드인가. 서버가 보는 것과 같은 조건이어야 한다(Game.voteSpecialist).
   *
   * **구경꾼에게는 열지 않는다.** 서버가 어차피 「이 판에 참여하고 있지 않습니다」로
   * 돌려보내므로, 열어두면 눌러도 아무 일이 없어 고장으로 읽힌다.
   */
  const seated = game?.players.some((player) => player.id === playerId) ?? false
  const live =
    game !== null &&
    seated &&
    specialist !== null &&
    !game.specialistUsed &&
    game.phase === 'picking'
  const myTurn = live && decided === playerId
  const voting = live && decided === null

  /*
   * 대상은 **접속 중인 사람만**이다. 자리 비운 사람을 고르면 카드는 쓰였는데
   * 알려줄 소켓이 없어 쪽지가 어디에도 닿지 않는다 — 그 판의 해결사가 그냥 사라진다.
   * 후보도 같은 이유로 접속 중인 사람만이다.
   */
  const others = (game?.players ?? []).filter(
    (player) => player.id !== playerId && player.connected,
  )
  const candidates = (game?.players ?? []).filter((player) => player.connected)
  const myPick = vote?.votes.find((one) => one.voterId === playerId)?.pick ?? null
  const ready = !needs?.target || targetId !== ''

  function openUse() {
    setTargetId(others[0]?.id ?? '')
    setValue(14)
    setCardIndex(0)
    setOpen('use')
  }

  const start = myTurn ? openUse : voting ? () => setOpen('vote') : undefined
  const label = myTurn
    ? '내가 씁니다'
    : voting
      ? vote
        ? `누가 쓸지 고르기 ${vote.votes.length}/${candidates.length}`
        : '이 카드 사용'
      : undefined

  /*
   * 내 차례가 온 것은 **저절로 떠야 한다.**
   *
   * 카드는 접힌 드로어 안에 있고, 좁은 화면에서는 테이블 옆에도 서지 않는다. 남이 연
   * 투표나 「네가 쓰기로 됐다」를 그 안에서 알아채라고 두면 아무도 모르는 채로 판이
   * 흘러간다. 대신 **닫으면 다시 뜨지 않는다** — 판이 도는 중에 창이 계속 되살아나면
   * 토큰을 집을 수 없다. 다시 열려면 카드의 단추를 누른다.
   */
  const todo = myTurn
    ? `use:${game?.heist}`
    : voting && vote && myPick === null
      ? `vote:${game?.heist}`
      : null
  const shown = useRef<string | null>(null)
  const pending = useRef(others[0]?.id ?? '')
  pending.current = others[0]?.id ?? ''
  useEffect(() => {
    if (todo === null || shown.current === todo) return
    shown.current = todo
    if (todo.startsWith('use:')) {
      setTargetId(pending.current)
      setValue(14)
      setCardIndex(0)
      setOpen('use')
    } else {
      setOpen('vote')
    }
  }, [todo])

  /*
   * 할 일이 끝난 창은 스스로 닫는다.
   *
   * 남이 뽑히면 투표는 끝났는데 창은 그대로 떠서 뒤 판을 가린다 — 「이제 뭘 하라는
   * 거지」로 읽히고, 그 사이 토큰도 집을 수 없다. 카드가 이미 쓰였을 때도 마찬가지다.
   *
   * **내가 뽑힌 경우는 여기서 닫지 않는다.** 위의 효과가 같은 순간에 사용창으로
   * 바꿔 열고 있으므로, 여기서 함께 손대면 둘 중 나중 것이 이겨 창이 사라진다.
   */
  useEffect(() => {
    if (open === 'vote' && decided !== null && decided !== playerId) setOpen(null)
    else if (open === 'vote' && !live) setOpen(null)
    else if (open === 'use' && !myTurn) setOpen(null)
  }, [open, decided, live, myTurn, playerId])

  // 창이 떠 있는 동안 뒤 판은 움직이지 않는다.
  useScrollLock(open !== null && specialist !== null)
  const drag = useSheetDrag(() => setOpen(null))
  /*
   * 배경 클릭과 끌어내림으로 이미 닫히는 창이다 — 「답해야 넘어가는 자리」가 아니므로
   * 나머지 두 길도 같이 연다. 넷 중 둘만 열려 있으면 그 둘을 모르는 사람에게는
   * 닫히지 않는 창이 된다.
   */
  const shut = useCallback(() => setOpen(null), [])
  useEscape(open !== null, shut)
  useBackIntercept(open !== null, shut)

  const shell = (title: string, body: ReactNode) => (
    <div className="modal-backdrop" onClick={() => setOpen(null)} role="presentation">
      <div
        className={`modal ${drag.className}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        {...drag.handlers}
      >
        <h2 className="modal__title">{title}</h2>
        <p className="modal__body">{specialist?.text}</p>
        {body}
      </div>
    </div>
  )

  if (!specialist || open === null) return { start, label, ask: null }

  const nameOf = (id: string) =>
    id === playerId ? '나' : (candidates.find((player) => player.id === id)?.displayName ?? '?')

  if (open === 'vote') {
    return {
      start,
      label,
      ask: shell(
        `「${specialist.name}」을 누가 쓸까요?`,
        <>
          <div className="pick-people">
            {candidates.map((player) => {
              const backers = (vote?.votes ?? []).filter((one) => one.pick === player.id)
              return (
                <button
                  key={player.id}
                  type="button"
                  className={`pick-person ${myPick === player.id ? 'pick-person--on' : ''}`}
                  onClick={() => onVote(player.id)}
                >
                  <span className="pick-person__name">
                    {player.id === playerId ? `${player.displayName} (나)` : player.displayName}
                  </span>
                  {backers.length > 0 && (
                    <span className="pick-person__backers">
                      {backers.map((one) => nameOf(one.voterId)).join(' · ')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <p className="field__note">
            모두가 같은 사람을 고르면 정해집니다 ({vote?.votes.length ?? 0}/{candidates.length}).
            고른 뒤에도 바꿀 수 있습니다.
          </p>

          <button type="button" className="btn btn--ghost btn--block" onClick={() => setOpen(null)}>
            닫기
          </button>
        </>,
      ),
    }
  }

  return {
    start,
    label,
    ask: shell(
      `「${specialist.name}」을 씁니다`,
      <>
        {needs?.target && others.length === 0 && (
          <p className="field__note">
            지금 접속 중인 사람이 없습니다. 누군가 돌아와야 쓸 수 있습니다.
          </p>
        )}

        {needs?.target && others.length > 0 && (
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
          <button type="button" className="btn btn--ghost" onClick={() => setOpen(null)}>
            나중에
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
              setOpen(null)
            }}
            disabled={!ready}
          >
            사용
          </button>
        </div>
      </>,
    ),
  }
}
