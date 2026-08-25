/**
 * 뒤로가기를 가로챈다.
 *
 * 휴대폰의 뒤로가기는 브라우저 뒤로가기와 같은 것이라, 아무것도 하지 않으면 화면이
 * 통째로 바뀐다. 덮개가 떠 있으면 덮개만 닫히는 것이 몸에 익은 동작이고, 판이 도는
 * 중이라면 그냥 나가는 것이 아니라 한 번 물어야 한다.
 *
 * 방법은 하나뿐이다 — 지킬 것이 있는 동안 히스토리에 빈 칸을 하나 쌓아 두고, 뒤로가기가
 * 그 칸을 먹을 때 우리가 대신 처리한다. 주소는 그대로다.
 *
 * 지키는 것이 여럿일 수 있다(대기실 위에 확인창처럼). 그래서 신호를 받는 자리는 하나로
 * 두고, 가장 나중에 쌓인 것 하나에만 넘긴다 — 안쪽부터 닫히는 것이 사람이 기대하는
 * 순서다. 리스너를 각자 달면 한 번의 뒤로가기를 여럿이 나눠 먹는다.
 */

import { useEffect, useRef } from 'react'

/** 우리가 쌓은 칸인지 알아보는 표시. 라우터가 쌓은 칸과 갈라야 한다. */
const MARK = 'theGangBackGuard'

interface Guard {
  onBack: () => void
  /** 처리한 뒤에도 계속 지키는가. 확인창처럼 화면이 그대로 남는 경우다. */
  keep: boolean
}

/** 지금 지키고 있는 것들. 마지막 것이 가장 안쪽이다. */
const guards: Guard[] = []

/*
 * 우리가 스스로 부른 back 이 몇 번 돌아오고 있는가.
 *
 * 칸을 걷어내려고 부른 back 도 popstate 로 돌아온다. 그 신호를 사용자가 누른 것으로
 * 받으면 엉뚱한 일이 벌어진다 — 개발 모드는 효과를 두 번 실행하므로 「쌓기 → 걷어내기
 * → 다시 쌓기」가 일어난다.
 */
let unwinding = 0
let listening = false

function push(): void {
  window.history.pushState({ [MARK]: true }, '')
}

function onPop(): void {
  // 우리가 걷어내려고 부른 back 이다. 사용자가 누른 것이 아니다.
  if (unwinding > 0) {
    unwinding -= 1
    return
  }
  const top = guards[guards.length - 1]
  if (!top) return
  // 화면이 그대로 남는다면 칸을 다시 쌓는다. 그러지 않으면 다음 뒤로가기에 그냥 나간다.
  if (top.keep) push()
  top.onBack()
}

/**
 * @param active 지금 지키고 있는가.
 * @param onBack 뒤로가기가 눌렸다. 무엇을 할지는 부르는 쪽이 정한다.
 * @param keep   처리한 뒤에도 계속 지킬 것인가.
 */
export function useBackIntercept(active: boolean, onBack: () => void, keep = false): void {
  const handler = useRef(onBack)
  handler.current = onBack

  useEffect(() => {
    if (!active) return

    const guard: Guard = { onBack: () => handler.current(), keep }
    guards.push(guard)
    push()
    if (!listening) {
      window.addEventListener('popstate', onPop)
      listening = true
    }

    return () => {
      const at = guards.lastIndexOf(guard)
      if (at >= 0) guards.splice(at, 1)
      /*
       * 단추로 닫혔으면 쌓아둔 칸을 도로 걷어낸다. 남겨두면 뒤로가기 한 번이 헛돈다.
       *
       * 라우터가 화면을 옮기면서 정리하는 경우에는 맨 위가 이미 라우터의 칸이므로
       * 건드리지 않는다 — 여기서 back 을 부르면 방금 한 이동이 취소된다.
       */
      const state = window.history.state as Record<string, unknown> | null
      if (state?.[MARK]) {
        unwinding += 1
        window.history.back()
      }
    }
  }, [active, keep])
}

/** 덮개용. 열려 있는 동안만 지키고, 뒤로가기는 닫기가 된다. */
export function useBackClose(close: () => void): void {
  useBackIntercept(true, close)
}
