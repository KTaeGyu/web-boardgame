/**
 * 밝은 쪽·어두운 쪽 바꾸기.
 *
 * 화면마다 두면 자리를 찾느라 눈이 헤매므로 어디서든 오른쪽 위 같은 자리에 붙박이로 둔다.
 * 그림은 「누르면 무엇이 되는가」다 — 어두운 화면에서는 해가, 밝은 화면에서는 달이 보인다.
 */

import { useTheme } from '../lib/theme.ts'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const goingLight = theme === 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={goingLight ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기'}
    >
      <svg
        className="theme-toggle__icon"
        // 그림이 바뀔 때 다시 돌며 나타나도록 열쇠를 준다.
        key={theme}
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {goingLight ? (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
          </>
        ) : (
          <path d="M20.2 14.4A8.4 8.4 0 1 1 9.6 3.8a6.6 6.6 0 0 0 10.6 10.6Z" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  )
}
