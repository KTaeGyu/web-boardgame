/**
 * 뒤로가기를 가로챈다.
 *
 * 휴대폰의 뒤로가기는 브라우저 뒤로가기와 같은 것이라, 아무것도 하지 않으면 화면이
 * 통째로 바뀐다. 덮개가 떠 있으면 덮개만 닫히는 것이 몸에 익은 동작이고, 판이 도는
 * 중이라면 그냥 나가는 것이 아니라 한 번 물어야 한다.
 *
 * 방법은 하나뿐이다 — 지킬 것이 있는 동안 히스토리에 빈 칸을 하나 쌓아 두고, 뒤로가기가
 * 그 칸을 먹을 때 우리가 대신 처리한다. 주소는 그대로다.
 */

import { useEffect, useRef } from 'react'

/** 우리가 쌓은 칸인지 알아보는 표시. 라우터가 쌓은 칸과 갈라야 한다. */
const MARK = 'theGangBackGuard'

/**
 * @param active 지금 지키고 있는가.
 * @param onBack 뒤로가기가 눌렸다. 무엇을 할지는 부르는 쪽이 정한다.
 * @param keep   처리한 뒤에도 계속 지킬 것인가. 확인창처럼 화면이 그대로 남는 경우에 켠다.
 */
export function useBackIntercept(active: boolean, onBack: () => void, keep = false): void {
  const handler = useRef(onBack)
  handler.current = onBack

  useEffect(() => {
    if (!active) return

    let armed = true
    const push = () => window.history.pushState({ [MARK]: true }, '')
    push()

    const onPop = () => {
      if (!armed) return
      // 화면이 그대로 남는다면 칸을 다시 쌓는다. 그러지 않으면 다음 뒤로가기에 그냥 나간다.
      if (keep) push()
      handler.current()
    }

    window.addEventListener('popstate', onPop)
    return () => {
      armed = false
      window.removeEventListener('popstate', onPop)
      /*
       * 단추로 닫혔으면 쌓아둔 칸을 도로 걷어낸다. 남겨두면 뒤로가기 한 번이 헛돈다.
       *
       * 라우터가 화면을 옮기면서 정리하는 경우에는 맨 위가 이미 라우터의 칸이므로
       * 건드리지 않는다 — 여기서 back 을 부르면 방금 한 이동이 취소된다.
       */
      const state = window.history.state as Record<string, unknown> | null
      if (state?.[MARK]) window.history.back()
    }
  }, [active, keep])
}

/** 덮개용. 열려 있는 동안만 지키고, 뒤로가기는 닫기가 된다. */
export function useBackClose(close: () => void): void {
  useBackIntercept(true, close)
}
