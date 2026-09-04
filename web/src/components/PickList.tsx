/**
 * 하나만 고르는 목록 — 눌러서 펼친다.
 *
 * 칩으로 늘어놓으면 다섯씩 둘이 화면 한 판을 먹는다. 그렇다고 `<select>` 로 두면
 * **설명을 붙일 자리가 없다** — 네이티브 목록은 브라우저가 그리는 것이라 말풍선도
 * `title` 도 붙지 않고, 휴대폰에서는 아예 방법이 없다. 처음 보는 포커 다섯 개를 고르는
 * 자리라 그게 크다.
 *
 * 그래서 직접 만든다. **닫혀 있으면 한 줄, 펼치면 이름만** 선다. 설명은 다른 설정과
 * 같은 손짓으로 읽는다 — 마우스는 올리면, 손가락은 누르면 뜬다(useCardTip).
 * 목록 안에 설명을 깔면 다섯 줄이 열다섯 줄이 되어, 펼치는 뜻이 반쯤 사라진다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { useBackIntercept } from '../lib/back.ts'
import { useEscape } from '../lib/useEscape.ts'

import { tipPosition, useCardTip } from '../lib/tooltip.ts'

export interface PickListOption {
  id: string
  name: string
  /** 설명. 짚을 때만 뜬다. */
  text: string
}

interface Props {
  label: string
  /** 이 설정이 무엇인지. 제목을 짚으면 뜬다. */
  hint?: string
  options: readonly PickListOption[]
  picked: string
  disabled?: boolean
  onPick: (id: string) => void
}

export function PickList({ label, hint, options, picked, disabled, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { tip, handlers, hide } = useCardTip()
  const current = options.find((option) => option.id === picked) ?? options[0]

  /*
   * Esc 는 **줄에 세워서** 받는다(`useEscape`). 전에는 여기서 문서에 직접 매달아,
   * 화면이 매단 것과 함께 울려 목록이 닫히면서 「방을 나가시겠습니까?」가 떴다.
   */
  useEscape(open, useCallback(() => setOpen(false), []))
  useBackIntercept(open, useCallback(() => setOpen(false), []))

  /*
   * 바깥을 누르면 닫는다.
   *
   * 문서에 한 번만 매단다 — 열려 있을 때만 붙이므로, 닫혀 있는 목록이 여럿이어도
   * 듣는 자리는 늘 하나뿐이다. `mousedown` 인 것은 `click` 이면 바깥의 단추가
   * 눌리기 전에 목록이 닫히지 않아 그 한 번이 헛도는 탓이다.
   */
  useEffect(() => {
    if (!open) return

    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => {
      document.removeEventListener('mousedown', away)
    }
  }, [open])

  // 방장이 아니게 되는 순간(방장을 넘겨줬을 때) 펼쳐둔 채로 남지 않게 한다.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

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

      <div className={`picklist ${open ? 'picklist--open' : ''}`} ref={box}>
        {/*
          펼쳐 놓은 동안에는 단추의 설명을 붙이지 않는다. 목록이 그 자리를 덮고 있어
          읽을 것은 행마다 따로 있고, 단추 설명이 그 위에 겹치면 둘 다 못 읽는다.
        */}
        <button
          type="button"
          className="picklist__button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-disabled={disabled || undefined}
          {...(current && !open ? handlers(current.text) : {})}
          onClick={() => {
            if (disabled) return
            // 펼치는 순간 떠 있던 말풍선을 지운다. 이 단추에서 마우스가 나간 적이 없어
            // mouseleave 가 오지 않는다 — 그냥 두면 목록 위에 남는다.
            hide()
            setOpen((was) => !was)
          }}
        >
          <span className="picklist__now">{current?.name}</span>
          <span className="picklist__caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <ul className="picklist__menu" role="listbox" aria-label={label}>
            {options.map((option) => {
              const on = option.id === picked
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`picklist__item ${on ? 'picklist__item--on' : ''}`}
                    role="option"
                    aria-selected={on}
                    {...handlers(option.text)}
                    onClick={() => {
                      onPick(option.id)
                      setOpen(false)
                    }}
                  >
                    {option.name}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {tip && (
          <div className="card-tip" style={tipPosition(tip)}>
            {tip.text}
          </div>
        )}
      </div>
    </div>
  )
}
