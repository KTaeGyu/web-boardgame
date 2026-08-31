import { useLayoutEffect, useRef } from 'react'

/**
 * 토큰이 실제로 날아가게 한다.
 *
 * 토큰은 중앙과 각자의 자리를 오가는데, 부모가 바뀌면 React 는 요소를 지웠다 새로 만든다.
 * 그래서 「같은 요소를 움직인다」로는 애니메이션이 안 붙는다. 대신 그리기 직전에
 * 옛 위치를 기억해 두었다가, 새 위치에 나타난 요소를 옛 위치에서 출발시킨다.
 * (FLIP: First-Last-Invert-Play)
 *
 * 서버의 토큰 잠금과 같은 길이여야 손이 도착하는 순간 실제로 잠금이 풀린다.
 *
 * **자리가 바뀔 때만 다시 잰다.** 예전에는 그릴 때마다 쟀는데, 알림 한 줄이나 남의 채팅에도
 * 다시 그려지고 그때 날아가는 중인 토큰의 위치를 재 버렸다. 재는 값에는 애니메이션의
 * 이동량이 섞여 있어서, 다음 계산이 어긋나며 한 번 갈 길을 두세 번 나눠 가는 것처럼 보였다.
 */
export function useTokenFlight(durationMs: number, layoutKey: string) {
  const nodes = useRef(new Map<number, HTMLElement>())
  const lastRects = useRef(new Map<number, DOMRect>())
  /** 지금 날아가는 중인 것들. 자리가 또 바뀌면 이전 비행은 무효가 된다. */
  const flights = useRef(new Map<number, Animation>())

  useLayoutEffect(() => {
    for (const [token, node] of nodes.current) {
      /*
       * 아직 날아가는 중이면 먼저 접는다. 접지 않고 재면 재는 값에 이동량이 섞인다 —
       * 그 값으로 다음 출발점을 잡으면 엉뚱한 곳에서 날아온다.
       */
      const flying = flights.current.get(token)
      if (flying) {
        flying.cancel()
        flights.current.delete(token)
      }

      const next = node.getBoundingClientRect()
      const previous = lastRects.current.get(token)
      lastRects.current.set(token, next)

      if (!previous) continue
      const dx = previous.left - next.left
      const dy = previous.top - next.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue

      /*
       * 날아가는 동안만 한 층 올린다. 그러지 않으면 지나는 자리의 카드·자리 밑으로 파고든다.
       *
       * **20 이 아니라 8 이다.** 20 은 화면 위에 뜨는 것들(모달 10 · 대화 12)보다 높아,
       * 대화창을 열어둔 채 토큰을 집으면 칩이 창 위를 가로질러 날아갔다.
       * 8 은 판 안의 무엇보다는 높고(드로어 6 · 알림 7), 덮고 서는 것들보다는 낮다.
       */
      const animation = node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 8 },
          { transform: 'translate(0, 0)', zIndex: 8 },
        ],
        { duration: durationMs, easing: 'cubic-bezier(0.22, 0.9, 0.28, 1)' },
      )
      flights.current.set(token, animation)
      // 끝난 비행은 잊는다. 남겨두면 다음 이동에서 멀쩡한 것을 접는다.
      animation.finished
        .then(() => {
          if (flights.current.get(token) === animation) flights.current.delete(token)
        })
        .catch(() => {
          /* 중간에 접힌 비행이다. 이미 지워졌다 */
        })
    }

    // 사라진 토큰의 옛 위치는 잊는다. 다음 라운드에 엉뚱한 곳에서 날아오지 않도록.
    for (const token of [...lastRects.current.keys()]) {
      if (!nodes.current.has(token)) {
        lastRects.current.delete(token)
        flights.current.delete(token)
      }
    }
  }, [durationMs, layoutKey])

  /**
   * 토큰마다 이 ref 를 달아 준다.
   *
   * 정리 함수를 돌려주는 이유가 있다. 토큰이 중앙에서 누군가의 자리로 옮겨가면
   * 옛 요소가 사라지고 새 요소가 생기는데, 정리가 나중에 불리면 방금 등록한
   * 새 요소를 지워 버린다. 내가 등록한 것이 맞을 때만 지운다.
   */
  return (token: number) => (node: HTMLElement | null) => {
    if (!node) return
    nodes.current.set(token, node)
    return () => {
      if (nodes.current.get(token) === node) nodes.current.delete(token)
    }
  }
}
