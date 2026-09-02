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
  /**
   * 목록 전체에 대한 안내. **제목을 짚으면 뜬다** — 목록 위에 깔아 두면 카드 이름보다
   * 안내가 먼저 눈에 들고, 좁은 화면에서는 그것만으로 한 판이 찬다.
   */
  hint?: string
  options: readonly PickOption[]
  picked: readonly (number | string)[]
  disabled?: boolean
  onToggle: (id: number | string) => void
}

/**
 * 카드 고르기.
 *
 * 이름만 칩으로 흘려 두고 설명은 짚을 때만 보여준다 — 손짓의 규칙은 useCardTip 에 있다.
 * **여럿 고르는 목록만 남았다**(도전자 카드). 하나만 고르는 자리는 PickList 로 갔다.
 *
 * **잠긴 칩에 `disabled` 를 걸지 않는다.** 브라우저는 disabled 인 버튼에 마우스 이벤트를
 * 아예 보내지 않아서, 방장이 아닌 사람은 설명을 하나도 볼 수 없었다 — 짚어도 금지 표시만
 * 떴다(2026-09-03). `aria-disabled` 로 같은 뜻을 전하고 누름만 막는다.
 */
export function CardPicker({ label, hint, options, picked, disabled, onToggle }: Props) {
  const { tip, handlers } = useCardTip()

  return (
    <div className="setting">
      <span className="setting__label" {...(hint ? handlers(hint) : {})}>
        {label}
        {hint && (
          <i className="setting__more" aria-hidden="true">
            ?
          </i>
        )}
      </span>

      <div className="pick-chips">
        {options.map((option) => {
          const on = picked.includes(option.id)
          const locked = disabled || option.locked
          return (
            <button
              key={option.id}
              type="button"
              className={`pick-chip ${on ? 'pick-chip--on' : ''}`}
              aria-disabled={locked || undefined}
              aria-pressed={on}
              {...handlers(option.text)}
              onClick={() => {
                if (!locked) onToggle(option.id)
              }}
            >
              <span className="pick-chip__mark" aria-hidden="true" />
              {option.name}
            </button>
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
