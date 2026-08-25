/**
 * 효과음 켜기 / 끄기.
 *
 * 그림은 옆의 두 단추와 같은 규칙이다 — 「누르면 무엇이 되는가」. 지금 소리가 나고
 * 있으면 음소거 그림이, 꺼져 있으면 음파 그림이 보인다. 셋이 나란히 있는데 하나만
 * 현재 상태를 보이면 무엇을 뜻하는 줄에 서 있는지 헷갈린다.
 */

import { useSound } from '../lib/sfx.ts'

export function SoundToggle() {
  const { on, toggle } = useSound()

  return (
    <button
      type="button"
      className="tool-btn"
      onClick={toggle}
      aria-pressed={!on}
      aria-label={on ? '소리 끄기' : '소리 켜기'}
      title={on ? '소리 끄기' : '소리 켜기'}
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
        <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
        {on ? (
          <path d="M16.5 9.2l4 5.6M20.5 9.2l-4 5.6" />
        ) : (
          <>
            <path d="M15.8 9.4a3.4 3.4 0 0 1 0 5.2" />
            <path d="M18.6 7.2a6.8 6.8 0 0 1 0 9.6" />
          </>
        )}
      </svg>
    </button>
  )
}
