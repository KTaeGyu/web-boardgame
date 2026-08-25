import { tipPosition, useCardTip } from '../lib/tooltip.ts'

export interface PickOption {
  id: number | string
  name: string
  /** 설명. 목록을 짧게 두려고 화면에 늘어놓지 않고 짚을 때만 보여준다. */
  text: string
  /** 이 카드만 잠근다. 이미 고른 것과 함께 걸 수 없을 때다 — 이유는 hint 에 적는다. */
  locked?: boolean
}

interface Props {
  label: string
  /** 목록 위에 한 줄로 두는 안내. 설명과 달리 늘 보인다. */
  hint?: string
  options: readonly PickOption[]
  picked: readonly (number | string)[]
  single?: boolean
  /** 고른 것의 설명을 목록 아래에 붙박이로 둔다. 늘 하나가 골라져 있는 목록에서만 뜻이 있다. */
  describePicked?: boolean
  disabled?: boolean
  onToggle: (id: number | string) => void
}

/**
 * 카드 고르기.
 *
 * 이름만 칩으로 흘려 두고 설명은 짚을 때만 보여준다 — 손짓의 규칙은 useCardTip 에 있다.
 */
export function CardPicker({ label, hint, options, picked, single, describePicked, disabled, onToggle }: Props) {
  const { tip, handlers, wasReading } = useCardTip()
  const pickedOption = describePicked ? options.find((option) => picked.includes(option.id)) : undefined

  return (
    <div className="setting">
      <span className="setting__label">{label}</span>
      {hint && <span className="pick-hint">{hint}</span>}

      <div className="pick-chips">
        {options.map((option) => {
          const on = picked.includes(option.id)
          return (
            <button
              key={option.id}
              type="button"
              className={`pick-chip ${on ? 'pick-chip--on' : ''}`}
              disabled={disabled || option.locked}
              aria-pressed={on}
              {...handlers(option.text)}
              onClick={() => {
                if (wasReading()) return
                onToggle(option.id)
              }}
            >
              <span className={`pick-chip__mark ${single ? 'pick-chip__mark--single' : ''}`} aria-hidden="true" />
              {option.name}
            </button>
          )
        })}
      </div>

      {pickedOption && (
        <p className="pick-picked" key={pickedOption.id}>
          {pickedOption.text}
        </p>
      )}

      {tip && (
        <div className="card-tip" style={tipPosition(tip)}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
