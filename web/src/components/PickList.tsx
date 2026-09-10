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

  /**
   * 펼친 목록이 설 자리. 화면 좌표다.
   *
   * **흐름이 아니라 화면에 띄운다**(position: fixed). 넓은 화면의 대기실은 설정 카드가
   * 제 안에서 스크롤하는데(`.room-body > .panel { overflow-y: auto }`), 목록을 카드
   * 안에 두면 두 가지가 한꺼번에 난다 — 카드 밖으로 나가지 못해 잘리고, 카드의 스크롤
   * 길이를 늘려 고를 때마다 없던 스크롤바가 생긴다.
   *
   * 말풍선(card-tip)이 이미 같은 이유로 화면 좌표를 쓴다. 같은 어법을 따른다.
   */
  const [spot, setSpot] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(
    null,
  )

  const place = useCallback(() => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom
    // 아래가 좁고 위가 더 넓으면 위로 편다. 목록이 길 때 화면 밖으로 흘러내리지 않게.
    const flip = below < 220 && rect.top > below
    setSpot({
      left: rect.left,
      width: rect.width,
      ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    })
  }, [])

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

  /*
   * 펼쳐 둔 동안 자리를 따라다닌다.
   *
   * 스크롤은 **capture 로** 듣는다 — 밀리는 것이 창이 아니라 설정 카드일 수 있고,
   * 그 스크롤은 window 까지 올라오지 않는다. 자리를 안 고치면 목록만 제자리에 남아
   * 엉뚱한 곳에 뜬 채로 있는다.
   */
  useEffect(() => {
    if (!open) return
    place()
    const again = () => place()
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [open, place])

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

        {open && spot && (
          <ul className="picklist__menu" role="listbox" aria-label={label} style={spot}>
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
