/**
 * 잠깐 뜨는 알림 하나.
 *
 * 스스로 3.8초 뒤에 사라지지만, 그전에 치울 수 있어야 한다 — 판을 덮고 있는데
 * 없앨 길이 없으면 기다리는 수밖에 없다. 눌러서 없애고, 손가락으로는 옆으로 민다.
 *
 * 컴포넌트를 따로 둔 것은 손짓 훅 때문이다. 알림마다 제 자리와 흐림을 들고 있어야
 * 하는데, 훅은 목록을 돌며 부를 수 없다.
 */

import { useSwipeAway } from '../lib/useSwipeAway.ts'

/**
 * 알림 하나가 떠 있는 시간.
 *
 * 부르는 쪽이 저마다 숫자를 고르면 화면을 옮길 때마다 뜨는 길이가 달라진다 —
 * 같은 알림이 판에서는 4초, 대기실에서는 2초면 그것부터 눈에 띈다.
 */
export const TOAST_MS = 3800

export function Toast({
  text,
  tone,
  onAway,
}: {
  text: string
  tone: 'info' | 'warn'
  onAway: () => void
}) {
  const swipe = useSwipeAway(onAway)

  return (
    <button
      type="button"
      className={`toast toast--${tone}`}
      /* 눌러도 된다는 것을 알 길이 커서밖에 없었다. 마우스에는 이 한 줄이 더 확실하다. */
      title="눌러서 닫기"
      onClick={onAway}
      {...swipe}
    >
      {text}
    </button>
  )
}
