import { useEffect } from 'react'

/**
 * Esc 로 한 걸음 물러난다.
 *
 * 모달이 열려 있을 때는 모달이 Esc 를 가져가야 하므로, 그때는 꺼둔다.
 * 그러지 않으면 모달을 닫는 Esc 가 곧바로 화면을 벗어나게 만든다.
 */
export function useEscape(enabled: boolean, run: () => void): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, run])
}
