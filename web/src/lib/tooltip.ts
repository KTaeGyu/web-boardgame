/**
 * 카드 설명을 짚을 때만 보여주는 말풍선.
 *
 * 스무 장을 설명과 함께 늘어놓으면 화면이 한없이 길어진다. 이름만 흘려 두고
 * 마우스는 올리면, 손가락은 길게 누르면 뜬다. 고르는 자리마다 같은 손짓이어야
 * 하므로 규칙을 여기 한 벌만 둔다.
 */

import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react'

export const TIP_WIDTH = 240
const TIP_GAP = 14

/** 길게 누른 것으로 볼 시간. 짧으면 그냥 고르려던 손짓까지 설명으로 새어 나간다. */
const LONG_PRESS_MS = 400
/** 손을 뗀 뒤에도 잠시 남겨 둔다. 떼자마자 사라지면 읽을 수 없다. */
const LINGER_MS = 1600

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
  onMouseMove: (event: MouseEvent) => void
  onMouseLeave: () => void
  onTouchStart: (event: TouchEvent) => void
  onTouchEnd: () => void
}

export function useCardTip(): {
  tip: CardTip | null
  /** 이 글을 보여줄 자리에 그대로 펼쳐 붙인다. */
  handlers: (text: string) => CardTipHandlers
  /**
   * 방금의 누름이 「설명을 읽으려던 것」이었는지 묻고 표시를 지운다.
   * 길게 눌러 설명을 본 손가락이 떼는 순간 고르기까지 이어지면 안 된다.
   */
  wasReading: () => boolean
} {
  const [tip, setTip] = useState<CardTip | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readingByTouch = useRef(false)

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current)
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
    },
    [],
  )

  const handlers = (text: string): CardTipHandlers => ({
    onMouseMove: (event) => setTip({ x: event.clientX, y: event.clientY, text }),
    onMouseLeave: () => setTip(null),
    onTouchStart: (event) => {
      if (pressTimer.current) clearTimeout(pressTimer.current)
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
      readingByTouch.current = false
      const touch = event.touches[0]
      if (!touch) return
      pressTimer.current = setTimeout(() => {
        readingByTouch.current = true
        setTip({ x: touch.clientX, y: touch.clientY, text })
      }, LONG_PRESS_MS)
    },
    onTouchEnd: () => {
      if (pressTimer.current) clearTimeout(pressTimer.current)
      if (readingByTouch.current) {
        lingerTimer.current = setTimeout(() => setTip(null), LINGER_MS)
      } else {
        setTip(null)
      }
    },
  })

  const wasReading = () => {
    if (!readingByTouch.current) return false
    readingByTouch.current = false
    return true
  }

  return { tip, handlers, wasReading }
}
