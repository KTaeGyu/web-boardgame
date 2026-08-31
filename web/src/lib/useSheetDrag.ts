/**
 * 아래에서 올라온 시트를 끌어내려 닫는다.
 *
 * 작은 화면에서 뜨는 것들은 바닥에 붙는 시트가 된다. 시트는 내려서 닫는 것이 몸에
 * 익은 동작이라, 닫는 단추를 찾아 손을 옮기지 않아도 되어야 한다. 손가락을 따라
 * 내려가다 충분히 갔으면 닫고, 아니면 제자리로 돌아온다.
 *
 * **닫을 수 있는 시트에만 붙인다.** 스캔·딜 직후 단계·재경기 물음·쇼다운은 답해야
 * 넘어가는 자리라, 끌어내려 치울 수 있으면 답하지 않고 판을 세울 수 있게 된다.
 * 손잡이가 없다는 것 자체가 「여기는 닫는 것이 아니다」를 말한다.
 *
 * 대화 시트는 제 것을 따로 들고 있다(`Chat.tsx`). 그쪽은 창이 아니라 안의 목록이
 * 스크롤돼서, 머리를 잡았을 때만 받는 규칙이 이미 서 있다.
 */

import { useRef, type TouchEvent } from 'react'

/** 이만큼 내려가면 닫는다. 대화 시트가 쓰던 값과 같다 — 두 시트의 손맛이 갈리면 안 된다. */
const AWAY_PX = 90

interface Grab {
  y: number
  moved: number
  el: HTMLElement
}

/**
 * 손가락이 닿은 자리와 시트 사이에 **이미 내려가 있는 스크롤**이 있는가.
 *
 * 있으면 그 손짓은 읽던 것을 되짚는 것이지 창을 닫으려는 것이 아니다. 맨 위까지
 * 올라와 있으면 브라우저가 움직일 것이 없으므로, 그 자리를 우리가 받아도 겹치지 않는다.
 */
function alreadyScrolled(from: Element, sheet: Element): boolean {
  let node: Element | null = from
  while (node) {
    if (node.scrollTop > 0) return true
    if (node === sheet) return false
    node = node.parentElement
  }
  return false
}

export function useSheetDrag(onClose: () => void): {
  /** 시트에 함께 얹는다. 손잡이를 그리는 것도 이 클래스다. */
  className: string
  handlers: {
    onTouchStart: (event: TouchEvent<HTMLElement>) => void
    onTouchMove: (event: TouchEvent<HTMLElement>) => void
    onTouchEnd: () => void
    onTouchCancel: () => void
  }
} {
  const grab = useRef<Grab | null>(null)

  function settle(): Grab | null {
    const held = grab.current
    grab.current = null
    if (!held) return null
    held.el.style.transition = ''
    return held
  }

  return {
    className: 'sheet',
    handlers: {
      onTouchStart: (event) => {
        const sheet = event.currentTarget
        const from = event.target as Element
        /*
         * 스스로 끌리는 것 위에서는 받지 않는다. 소리 크기 손잡이를 아래로 끌면
         * 크기가 줄어야지 창이 내려가면 안 된다.
         */
        if (from.closest('input[type="range"]')) return
        if (alreadyScrolled(from, sheet)) return
        const touch = event.touches[0]
        if (!touch) return
        grab.current = { y: touch.clientY, moved: 0, el: sheet }
        // 끄는 동안에는 손가락을 그대로 따라와야 한다. 부드럽게 하면 손보다 늦는다.
        sheet.style.transition = 'none'
      },
      onTouchMove: (event) => {
        const held = grab.current
        const touch = event.touches[0]
        if (!held || !touch) return
        // 위로는 가지 않는다. 시트는 이미 바닥에 붙어 있어 올라갈 자리가 없다.
        held.moved = Math.max(0, touch.clientY - held.y)
        held.el.style.transform = `translateY(${held.moved}px)`
      },
      onTouchEnd: () => {
        const held = settle()
        if (!held) return
        // 닫기로 정해졌으면 되돌리지 않는다. 곧 사라질 것을 제자리로 보내면 한 번 튄다.
        if (held.moved > AWAY_PX) {
          onClose()
          return
        }
        held.el.style.transform = ''
      },
      onTouchCancel: () => {
        const held = settle()
        if (held) held.el.style.transform = ''
      },
    },
  }
}
