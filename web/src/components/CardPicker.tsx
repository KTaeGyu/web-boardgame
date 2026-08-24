import { useRef, useState } from 'react'

import { tipPosition } from '../lib/tooltip.ts'

export interface PickOption {
  id: number | string
  name: string
  /** 설명. 목록을 짧게 두려고 화면에 늘어놓지 않고 짚을 때만 보여준다. */
  text: string
}

interface Props {
  label: string
  /** 목록 위에 한 줄로 두는 안내. 설명과 달리 늘 보인다. */
  hint?: string
  options: readonly PickOption[]
  picked: readonly (number | string)[]
  single?: boolean
  disabled?: boolean
  onToggle: (id: number | string) => void
}

/** 길게 누른 것으로 볼 시간. 짧으면 그냥 고르려던 손짓까지 설명으로 새어 나간다. */
const LONG_PRESS_MS = 400
/** 손을 뗀 뒤에도 잠시 남겨 둔다. 떼자마자 사라지면 읽을 수 없다. */
const LINGER_MS = 1600

/**
 * 카드 고르기.
 *
 * 스무 장을 설명과 함께 늘어놓으면 화면이 한없이 길어진다. 이름만 칩으로 흘려 두고
 * 설명은 짚을 때만 보여준다 — 마우스는 올리면, 손가락은 길게 누르면 뜬다.
 */
export function CardPicker({ label, hint, options, picked, single, disabled, onToggle }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 길게 눌러 설명을 본 것이면 고르기까지 이어지지 않게 막는다. */
  const readingByTouch = useRef(false)

  function clearTimers() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (lingerTimer.current) clearTimeout(lingerTimer.current)
  }

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
              disabled={disabled}
              aria-pressed={on}
              title={option.text}
              onMouseMove={(event) => setTip({ x: event.clientX, y: event.clientY, text: option.text })}
              onMouseLeave={() => setTip(null)}
              onTouchStart={(event) => {
                clearTimers()
                readingByTouch.current = false
                const touch = event.touches[0]
                pressTimer.current = setTimeout(() => {
                  readingByTouch.current = true
                  setTip({ x: touch.clientX, y: touch.clientY, text: option.text })
                }, LONG_PRESS_MS)
              }}
              onTouchEnd={() => {
                if (pressTimer.current) clearTimeout(pressTimer.current)
                if (readingByTouch.current) {
                  lingerTimer.current = setTimeout(() => setTip(null), LINGER_MS)
                } else {
                  setTip(null)
                }
              }}
              onClick={() => {
                if (readingByTouch.current) {
                  readingByTouch.current = false
                  return
                }
                onToggle(option.id)
              }}
            >
              <span className={`pick-chip__mark ${single ? 'pick-chip__mark--single' : ''}`} aria-hidden="true" />
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
