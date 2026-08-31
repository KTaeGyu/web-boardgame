/**
 * 카드 설명을 짚을 때만 보여주는 말풍선.
 *
 * 스무 장을 설명과 함께 늘어놓으면 화면이 한없이 길어진다. 이름만 흘려 두고, 마우스는
 * 올리면, 손가락은 누르면 뜬다. 고르는 자리마다 같은 손짓이어야 하므로 규칙을 여기
 * 한 벌만 둔다.
 *
 * **손가락은 그냥 한 번 누른다**(2026-08-31). 예전에는 400ms 길게 눌러야 떴고, 그렇게
 * 뜬 누름은 고르기로 이어지지 않았다. 규칙이 둘로 갈려 있으면 같은 자리를 눌러도 얼마나
 * 오래 눌렀느냐에 따라 다른 일이 나는데, 손가락은 그 시간을 재고 있지 않다. 지금은
 * **누르면 골라지고, 그 자리에서 설명이 잠깐 뜬다.** 누를 때마다 같은 일이다.
 *
 * 고르지 않고 읽기만 하는 길은 없어졌다. 여러 개 고르는 목록(도전자 카드 10장)에서
 * 훑으려면 켰다 꺼야 한다 — 두 번 누르는 것이, 왜 어떤 때는 안 골라지는지 모르는 것보다 낫다.
 */

import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react'

export const TIP_WIDTH = 240
const TIP_GAP = 14

/** 손가락으로 눌러 띄운 설명이 남아 있는 시간. */
const TAP_MS = 1000

/**
 * 마우스가 있는 기기인가.
 *
 * 마우스 핸들러를 기기와 무관하게 붙여 두면 모바일에서 샌다. 브라우저가 탭 뒤에
 * 가짜 마우스 이벤트를 만들어 보내는데 그것이 touchend **뒤에** 온다 — 손을 떼며
 * 지운 설명을 가짜 mousemove 가 다시 띄우고, 손가락에는 mouseleave 가 없어 그대로 남는다.
 * 「눌렀는데 설명이 안 사라진다」가 여기서 났다.
 */
const HAS_HOVER = window.matchMedia('(hover: hover)').matches

/**
 * 말풍선을 커서·손가락 옆에 붙이되 화면 밖으로 나가지 않게 한다.
 *
 * 오른쪽에 공간이 없으면 왼쪽으로 넘긴다. 드로어처럼 화면 끝에 붙은 것 옆에서는
 * 그냥 오른쪽에 두면 거의 항상 잘린다.
 */
export function tipPosition(point: { x: number; y: number }): { left: number; top: number } {
  const spillsRight = point.x + TIP_GAP + TIP_WIDTH > window.innerWidth
  return {
    left: spillsRight ? Math.max(8, point.x - TIP_GAP - TIP_WIDTH) : point.x + TIP_GAP,
    top: Math.min(point.y + TIP_GAP, window.innerHeight - 120),
  }
}

export interface CardTip {
  x: number
  y: number
  text: string
}

export interface CardTipHandlers {
  /** 마우스가 있는 기기에서만 붙는다. 없으면 React 가 그냥 건너뛴다. */
  onMouseMove?: (event: MouseEvent) => void
  onMouseLeave?: () => void
  onTouchEnd: (event: TouchEvent) => void
}

export function useCardTip(): {
  tip: CardTip | null
  /** 이 글을 보여줄 자리에 그대로 펼쳐 붙인다. */
  handlers: (text: string) => CardTipHandlers
} {
  const [tip, setTip] = useState<CardTip | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    [],
  )

  const handlers = (text: string): CardTipHandlers => ({
    onMouseMove: HAS_HOVER ? (event) => setTip({ x: event.clientX, y: event.clientY, text }) : undefined,
    onMouseLeave: HAS_HOVER ? () => setTip(null) : undefined,
    onTouchEnd: (event) => {
      /*
       * touches 는 이미 비어 있다. 방금 뗀 손가락은 changedTouches 에 있다.
       * 자리를 못 잡으면 띄우지 않는다 — 화면 왼쪽 위에 뜬금없이 뜨는 것보다 낫다.
       */
      const touch = event.changedTouches[0]
      if (!touch) return
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setTip({ x: touch.clientX, y: touch.clientY, text })
      hideTimer.current = setTimeout(() => setTip(null), TAP_MS)
    },
  })

  return { tip, handlers }
}
