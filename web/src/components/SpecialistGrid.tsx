/**
 * 어느 판에 어떤 해결사가 나올지 짜는 표.
 *
 * 한 판에 걸리는 해결사는 하나뿐이다. 그래서 「무엇을 고를까」가 아니라
 * 「몇 번째 판에 둘까」가 물음이고, 표가 곧 답이다 — 가로 한 줄이 카드 하나,
 * 세로 한 칸이 판 하나다. 세로로는 하나만 서지만 가로로는 여럿이어도 된다:
 * 같은 카드를 1판부터 5판까지 내리 세워도 된다.
 *
 * 빈칸도 뜻이 있다. 다섯째 칸에만 하나 찍으면 앞의 네 판은 해결사 없이 지나간다.
 */

import type { CSSProperties } from 'react'

import { READY_SPECIALISTS, SPECIALISTS, type SpecialistId } from '@the-gang/shared'

import { tipPosition, useCardTip } from '../lib/tooltip.ts'

interface Props {
  /** 자리 하나가 판 하나. 길이는 서버가 정한 최대 판수와 같다. */
  rounds: readonly (SpecialistId | null)[]
  /** 맨 윗줄. 그 판의 해결사를 무작위로 뽑는가. 길이는 rounds 와 같다. */
  randomRounds: readonly boolean[]
  /** 직전 판을 졌을 때만 내보내는가. */
  onLoss: boolean
  /**
   * 뽑기에서 뺄 카드. 표의 맨 오른쪽 열이다.
   *
   * **무작위 칸을 하나라도 찍었을 때만 열이 선다** — 뽑지 않는 판에서는 뜻이 없는
   * 칸이라, 늘 세워 두면 「이건 뭘 하는 칸인가」를 매번 묻게 된다.
   */
  excluded: readonly SpecialistId[]
  disabled?: boolean
  onChange: (rounds: (SpecialistId | null)[]) => void
  onRandomChange: (randomRounds: boolean[]) => void
  onLossChange: (onLoss: boolean) => void
  onExcludedChange: (excluded: SpecialistId[]) => void
}

export function SpecialistGrid({
  rounds,
  randomRounds,
  onLoss,
  excluded,
  disabled,
  onChange,
  onRandomChange,
  onLossChange,
  onExcludedChange,
}: Props) {
  const { tip, handlers } = useCardTip()
  /** 몇 판이 채워졌나. 같은 카드가 여러 판에 설 수 있으므로 「장」이 아니라 「판」이다. */
  const filled = rounds.filter((id, at) => id !== null || randomRounds[at]).length
  /** 뽑는 판이 하나라도 있나. 제외 열은 그때만 뜻이 있다. */
  const drawing = randomRounds.some(Boolean)

  function toggle(id: SpecialistId, at: number) {
    const next = [...rounds]
    // 그 판에 있던 카드는 자리를 내준다 — 한 판에 둘이 설 수는 없다.
    // 반대로 이 카드가 다른 판에 서 있는 것은 그대로 둔다.
    next[at] = next[at] === id ? null : id
    onChange(next)
    // 무작위를 찍어둔 판에 카드를 세우면 무작위가 자리를 내준다. 한 판에 하나뿐이다.
    if (next[at] !== null && randomRounds[at]) {
      onRandomChange(randomRounds.map((on, index) => (index === at ? false : on)))
    }
  }

  /** 뽑기에서 뺄 카드. 판에 손으로 세워 둔 카드는 이 표시가 있어도 그대로 나온다. */
  function toggleSkip(id: SpecialistId) {
    onExcludedChange(
      excluded.includes(id) ? excluded.filter((one) => one !== id) : [...excluded, id],
    )
  }

  function toggleRandom(at: number) {
    const next = randomRounds.map((on, index) => (index === at ? !on : on))
    onRandomChange(next)
    // 반대 방향도 같다 — 무작위가 서면 그 칸의 지정 카드는 물러난다.
    if (next[at] && rounds[at] !== null) {
      onChange(rounds.map((id, index) => (index === at ? null : id)))
    }
  }

  return (
    <div className="setting">
      <span
        className="setting__label"
        {...handlers(
          '몇 번째 판에 나올지 정합니다. 한 판에 한 장이고, 같은 카드를 여러 판에 둬도 됩니다. 비워 둔 판은 해결사 없이 지나갑니다.',
        )}
      >
        해결사 카드 ({filled}판)
        <i className="setting__more" aria-hidden="true">
          ?
        </i>
      </span>

      <div
        className={`slot-grid ${drawing ? 'slot-grid--skip' : ''}`}
        style={{ '--rounds': rounds.length } as CSSProperties}
      >
        <div className="slot-row slot-row--head">
          <span />
          {rounds.map((_, index) => (
            <span key={index} className="slot-row__round">
              {index + 1}판
            </span>
          ))}
          {drawing && (
            <span className="slot-row__round slot-cell--skip" {...handlers(
              '무작위로 뽑을 때 이 카드는 나오지 않습니다. 판에 직접 세워 둔 카드는 그대로 나옵니다.',
            )}>
              제외
            </span>
          )}
        </div>

        {/*
          맨 윗줄은 카드가 아니라 뽑기다. 찍어둔 판에서는 그 자리에서 한 장을 뽑는다 —
          무엇이 나올지 모르는 채로 판을 짜고 싶을 때 쓴다.
        */}
        <div className={`slot-row slot-row--random ${randomRounds.some(Boolean) ? 'slot-row--on' : ''}`}>
          <span className="slot-row__name">무작위</span>
          {rounds.map((_, index) => (
            <button
              key={index}
              type="button"
              className={`slot-cell ${randomRounds[index] ? 'slot-cell--on' : ''}`}
              disabled={disabled}
              aria-pressed={randomRounds[index] === true}
              aria-label={`무작위 해결사 — ${index + 1}판`}
              onClick={() => toggleRandom(index)}
            >
              <span className="slot-cell__mark" aria-hidden="true" />
            </button>
          ))}
          {/* 뽑기 줄에는 제외 칸이 없다 — 뽑기를 뽑기에서 뺄 수는 없다. */}
          {drawing && <span className="slot-cell--skip" />}
        </div>

        {READY_SPECIALISTS.map((id) => {
          const at = rounds.indexOf(id)
          return (
            <div
              key={id}
              className={`slot-row ${at >= 0 ? 'slot-row--on' : ''} ${
                excluded.includes(id) ? 'slot-row--out' : ''
              }`}
            >
              {/* 이름을 짚으면 무슨 카드인지 뜬다. 스무 장을 설명과 함께 늘어놓지 않으려는 것이다. */}
              <span className="slot-row__name" {...handlers(SPECIALISTS[id].text)}>
                {SPECIALISTS[id].name}
              </span>
              {rounds.map((held, index) => (
                <button
                  key={index}
                  type="button"
                  className={`slot-cell ${held === id ? 'slot-cell--on' : ''}`}
                  disabled={disabled}
                  aria-pressed={held === id}
                  aria-label={`${SPECIALISTS[id].name} — ${index + 1}판`}
                  onClick={() => toggle(id, index)}
                >
                  <span className="slot-cell__mark" aria-hidden="true" />
                </button>
              ))}
              {drawing && (
                <button
                  type="button"
                  className={`slot-cell slot-cell--skip ${
                    excluded.includes(id) ? 'slot-cell--out' : ''
                  }`}
                  disabled={disabled}
                  aria-pressed={excluded.includes(id)}
                  aria-label={`${SPECIALISTS[id].name} — 뽑기에서 제외`}
                  onClick={() => toggleSkip(id)}
                >
                  <span className="slot-cell__mark" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={onLoss}
          disabled={disabled}
          onChange={(event) => onLossChange(event.target.checked)}
        />
        <span {...handlers('끄면 결과와 상관없이 표대로 나옵니다. 켜면 첫 판에는 나오지 않습니다.')}>
          진 다음 판에만 나오기
          <i className="setting__more" aria-hidden="true">
            ?
          </i>
        </span>
      </label>

      {tip && (
        <div className="card-tip" style={tipPosition(tip)}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
