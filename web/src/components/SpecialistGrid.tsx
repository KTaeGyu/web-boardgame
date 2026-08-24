/**
 * 어느 판에 어떤 해결사가 나올지 짜는 표.
 *
 * 한 판에 걸리는 해결사는 하나뿐이다. 그래서 「무엇을 고를까」가 아니라
 * 「몇 번째 판에 둘까」가 물음이고, 표가 곧 답이다 — 가로 한 줄이 카드 하나,
 * 세로 한 칸이 판 하나이며 어느 쪽으로도 하나씩만 찍힌다.
 *
 * 빈칸도 뜻이 있다. 다섯째 칸에만 하나 찍으면 앞의 네 판은 해결사 없이 지나간다.
 */

import type { CSSProperties } from 'react'

import { READY_SPECIALISTS, SPECIALISTS, type SpecialistId } from '@the-gang/shared'

import { tipPosition, useCardTip } from '../lib/tooltip.ts'

interface Props {
  /** 자리 하나가 판 하나. 길이는 서버가 정한 최대 판수와 같다. */
  rounds: readonly (SpecialistId | null)[]
  disabled?: boolean
  onChange: (rounds: (SpecialistId | null)[]) => void
}

export function SpecialistGrid({ rounds, disabled, onChange }: Props) {
  const { tip, handlers, wasReading } = useCardTip()
  const placed = rounds.filter((id) => id !== null).length

  function toggle(id: SpecialistId, at: number) {
    const next = [...rounds]
    if (next[at] === id) {
      next[at] = null
    } else {
      // 한 장은 한 판에만 선다. 다른 판에 있었다면 그 자리를 비우고 옮겨온다.
      const was = next.indexOf(id)
      if (was >= 0) next[was] = null
      // 그 판에 있던 카드는 자리를 내준다 — 한 판에 둘이 설 수는 없다.
      next[at] = id
    }
    onChange(next)
  }

  return (
    <div className="setting">
      <span className="setting__label">해결사 카드 ({placed}장)</span>
      <span className="pick-hint">
        몇 번째 판에 나올지 정합니다. 한 판에 한 장이고, 비워 둔 판은 해결사 없이 지나갑니다.
      </span>

      <div className="slot-grid" style={{ '--rounds': rounds.length } as CSSProperties}>
        <div className="slot-row slot-row--head">
          <span />
          {rounds.map((_, index) => (
            <span key={index} className="slot-row__round">
              {index + 1}판
            </span>
          ))}
        </div>

        {READY_SPECIALISTS.map((id) => {
          const at = rounds.indexOf(id)
          return (
            <div key={id} className={`slot-row ${at >= 0 ? 'slot-row--on' : ''}`}>
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
                  onClick={() => {
                    if (wasReading()) return
                    toggle(id, index)
                  }}
                >
                  <span className="slot-cell__mark" aria-hidden="true" />
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {tip && (
        <div className="card-tip" style={tipPosition(tip)}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
