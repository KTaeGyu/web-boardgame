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
 */
export function useTokenFlight(durationMs: number) {
  const nodes = useRef(new Map<number, HTMLElement>())
  const lastRects = useRef(new Map<number, DOMRect>())

  useLayoutEffect(() => {
    for (const [token, node] of nodes.current) {
      const next = node.getBoundingClientRect()
      const previous = lastRects.current.get(token)
      lastRects.current.set(token, next)

      if (!previous) continue
      const dx = previous.left - next.left
      const dy = previous.top - next.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue

      node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 20 },
          { transform: 'translate(0, 0)', zIndex: 20 },
        ],
        { duration: durationMs, easing: 'cubic-bezier(0.22, 0.9, 0.28, 1)' },
      )
    }

    // 사라진 토큰의 옛 위치는 잊는다. 다음 라운드에 엉뚱한 곳에서 날아오지 않도록.
    for (const token of [...lastRects.current.keys()]) {
      if (!nodes.current.has(token)) lastRects.current.delete(token)
    }
  })

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
