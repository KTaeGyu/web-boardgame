/**
 * 옆으로 밀어 치우기.
 *
 * 손가락을 따라 옆으로 밀고, 충분히 갔으면 치운다. 아니면 제자리로 돌아온다.
 * 대화 시트를 아래로 밀어 닫는 것과 같은 꼴이고, 방향만 가로다.
 *
 * 미는 동안 흐려진다. 얼마나 더 가야 없어지는지를 손이 알아야 하는데, 자리만
 * 움직이면 「미는 중」인지 「걸린 것」인지 알 수 없다.
 */

import { useRef, type TouchEvent } from 'react'

/** 이만큼 넘어가면 치운다. 대화 시트(90px)보다 짧다 — 알림은 작고 가볍다. */
const AWAY_PX = 64
/** 이만큼 가면 다 흐려진다. 문턱보다 넉넉해야 사라지기 직전이 보인다. */
const FADE_PX = 160

interface Grab {
  x: number
  moved: number
  el: HTMLElement
}

export interface SwipeAwayHandlers {
  onTouchStart: (event: TouchEvent<HTMLElement>) => void
  onTouchMove: (event: TouchEvent<HTMLElement>) => void
  onTouchEnd: () => void
  onTouchCancel: () => void
}

export function useSwipeAway(onAway: () => void): SwipeAwayHandlers {
  const grab = useRef<Grab | null>(null)

  /** 손을 뗐거나 밀기가 끊겼다. 자리와 흐림을 CSS 에 도로 넘긴다. */
  function settle(): Grab | null {
    const held = grab.current
    grab.current = null
    if (!held) return null
    held.el.style.transition = ''
    return held
  }

  return {
    onTouchStart: (event) => {
      const touch = event.touches[0]
      if (!touch) return
      grab.current = { x: touch.clientX, moved: 0, el: event.currentTarget }
      // 미는 동안에는 손가락을 그대로 따라와야 한다. 부드럽게 하면 손보다 늦는다.
      event.currentTarget.style.transition = 'none'
    },
    onTouchMove: (event) => {
      const held = grab.current
      const touch = event.touches[0]
      if (!held || !touch) return
      held.moved = touch.clientX - held.x
      held.el.style.transform = `translateX(${held.moved}px)`
      held.el.style.opacity = String(Math.max(0, 1 - Math.abs(held.moved) / FADE_PX))
    },
    onTouchEnd: () => {
      const held = settle()
      if (!held) return
      // 치우기로 정해졌으면 되돌리지 않는다. 곧 사라질 것을 제자리로 보내면 한 번 튄다.
      if (Math.abs(held.moved) > AWAY_PX) {
        onAway()
        return
      }
      held.el.style.transform = ''
      held.el.style.opacity = ''
    },
    onTouchCancel: () => {
      const held = settle()
      if (!held) return
      held.el.style.transform = ''
      held.el.style.opacity = ''
    },
  }
}
