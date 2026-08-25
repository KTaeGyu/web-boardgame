/**
 * 화면 작게 / 되돌리기.
 *
 * 작은 휴대폰을 위한 단추다. 여백·글자·카드가 한 번에 줄어 판이 한 화면에 들어온다.
 * 그림은 「누르면 무엇이 되는가」다 — 지금 큰 화면이면 안쪽 화살표(줄이기), 작은
 * 화면이면 바깥쪽 화살표(되돌리기)가 보인다.
 */

import { useDensity } from '../lib/density.ts'

export function DensityToggle() {
  const { density, toggle } = useDensity()
  const shrinking = density === 'normal'

  return (
    <button
      type="button"
      className="tool-btn"
      onClick={toggle}
      aria-pressed={density === 'compact'}
      aria-label={shrinking ? '화면 작게' : '화면 원래대로'}
      title={shrinking ? '화면 작게' : '화면 원래대로'}
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {shrinking ? (
          <>
            <path d="M9.5 4.5v5h-5" />
            <path d="M3.5 3.5l6 6" />
            <path d="M14.5 19.5v-5h5" />
            <path d="M20.5 20.5l-6-6" />
          </>
        ) : (
          <>
            <path d="M4 9V4h5" />
            <path d="M4 4l5.5 5.5" />
            <path d="M20 15v5h-5" />
            <path d="M20 20l-5.5-5.5" />
          </>
        )}
      </svg>
    </button>
  )
}
