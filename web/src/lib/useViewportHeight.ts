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
    const viewport = window.visualViewport
    const apply = () => {
      const height = viewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`)
    }

    apply()
    viewport?.addEventListener('resize', apply)
    viewport?.addEventListener('scroll', apply)
    window.addEventListener('orientationchange', apply)

    return () => {
      viewport?.removeEventListener('resize', apply)
      viewport?.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [])
}
