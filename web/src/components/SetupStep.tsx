import { useState } from 'react'
import type { Card, GameView } from '@the-gang/shared'

import { PlayingCard } from './PlayingCard.tsx'

interface Props {
  game: GameView
  playerId: string
  hand: Card[]
  onSubmit: (cardIndex?: number) => void
  onDiscard: (cardIndex: number) => void
}

/**
 * 카드를 받자마자 한 번씩 움직여야 하는 순간들.
 *
 * 「조율가」는 넘길 카드를, 「사기꾼」은 외웠다는 확인을, 「해커」·「잭」은 버릴 카드를 받는다.
 * 셋 다 「내 카드 중 하나를 고른다」는 같은 모양이라 한 자리에서 처리한다.
 */
export function SetupStep({ game, playerId, hand, onSubmit, onDiscard }: Props) {
  const [picked, setPicked] = useState(0)

  const discarding = game.discardingId === playerId
  const setup = game.phase === 'setup' ? game.setup : null
  if (!discarding && !setup) return null

  const iAmDone = setup?.done.includes(playerId) ?? false
  const waiting = game.players.filter(
    (player) => player.connected && !(setup?.done.includes(player.id) ?? true),
  )

  if (discarding) {
    return (
      <Panel title="버릴 카드를 고르세요" hint="한 장을 더 받았습니다. 남길 두 장만 고르는 셈입니다.">
        <Cards hand={hand} picked={picked} onPick={setPicked} />
        <button type="button" className="btn btn--primary btn--block" onClick={() => onDiscard(picked)}>
          이 카드 버리기
        </button>
      </Panel>
    )
  }

  if (setup?.kind === 'memorize') {
    return (
      <Panel
        title="내 카드를 외워 두세요"
        hint="모두 확인하면 전원의 카드를 모아 섞어 다시 나눕니다. 지금 본 두 장은 누군가의 손으로 갑니다."
      >
        <Cards hand={hand} picked={-1} onPick={() => {}} />
        {iAmDone ? (
          <p className="setup__waiting">
            {waiting.map((player) => player.displayName).join(', ')}님을 기다리는 중…
          </p>
        ) : (
          <button type="button" className="btn btn--primary btn--block" onClick={() => onSubmit()}>
            외웠습니다
          </button>
        )}
      </Panel>
    )
  }

  return (
    <Panel
      title="왼쪽 사람에게 넘길 카드를 고르세요"
      hint="모두 고르면 한꺼번에 넘어갑니다. 먼저 골랐다고 먼저 가지 않습니다."
    >
      <Cards hand={hand} picked={iAmDone ? -1 : picked} onPick={setPicked} />
      {iAmDone ? (
        <p className="setup__waiting">
          {waiting.map((player) => player.displayName).join(', ')}님을 기다리는 중…
        </p>
      ) : (
        <button type="button" className="btn btn--primary btn--block" onClick={() => onSubmit(picked)}>
          이 카드 넘기기
        </button>
      )}
    </Panel>
  )
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h2 className="modal__title">{title}</h2>
        <p className="modal__body">{hint}</p>
        {children}
      </div>
    </div>
  )
}

function Cards({
  hand,
  picked,
  onPick,
}: {
  hand: Card[]
  picked: number
  onPick: (index: number) => void
}) {
  return (
    <div className="pick-cards pick-cards--center">
      {hand.map((card, index) => (
        <button
          key={card}
          type="button"
          className={`pick-card ${index === picked ? 'pick-card--on' : ''}`}
          onClick={() => onPick(index)}
          disabled={picked === -1}
        >
          <PlayingCard card={card} />
        </button>
      ))}
    </div>
  )
}
