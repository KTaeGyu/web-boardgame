import { useEffect } from 'react'

/**
 * 지금 실제로 보이는 높이를 `--app-height` 로 내려준다.
 *
 * 모바일에서 키보드가 올라오면 화면의 절반이 가려지는데, `100vh` 는 그걸 모른다.
 * `100dvh` 도 브라우저 주소창까지만 셈에 넣을 뿐 키보드는 빼지 않는 경우가 있다.
 * visualViewport 는 키보드가 먹은 자리까지 반영하므로, 이 값을 쓰면
 * 아래에 붙인 버튼이 키보드 위로 따라 올라온다.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport

    /*
     * 화면을 줄여 둔 만큼 되돌려 넣는다.
     *
     * 「화면 작게」는 뿌리에 zoom 을 건다. 그 아래에서는 px 하나가 0.85px 로 그려지므로,
     * 실제 높이를 그대로 내려주면 페이지가 화면보다 짧아진다 — 아래가 비고 바닥에
     * 붙어 있던 단추가 그만큼 위로 뛴다. 배율은 CSS 가 --zoom 으로 알려준다.
     */
    const apply = () => {
      const height = viewport?.height ?? window.innerHeight
      const zoom = Number(getComputedStyle(root).getPropertyValue('--zoom')) || 1
      root.style.setProperty('--app-height', `${Math.round(height / zoom)}px`)
    }

    apply()
    viewport?.addEventListener('resize', apply)
    viewport?.addEventListener('scroll', apply)
    window.addEventListener('orientationchange', apply)
    // 「화면 작게」를 누르면 배율이 바뀐다. 그때도 다시 잰다.
    const watchDensity = new MutationObserver(apply)
    watchDensity.observe(root, { attributes: true, attributeFilter: ['data-density'] })

    return () => {
      viewport?.removeEventListener('resize', apply)
      viewport?.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
      watchDensity.disconnect()
    }
  }, [])
}
