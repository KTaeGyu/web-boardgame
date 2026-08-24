/**
 * 밝은 쪽인가 어두운 쪽인가.
 *
 * 값은 늘 `<html data-theme>` 에 적혀 있고, 처음 한 벌은 index.html 이 화면이 그려지기
 * 전에 붙여 둔다. 여기서는 그 값을 읽어 쓰고, 바꿀 때 다시 적는다.
 *
 * 고른 적이 없으면 저장하지 않는다 — 저장된 값이 없다는 것이 「기기 설정을 따르는 중」이라는
 * 뜻이라, 한 번도 누르지 않은 사람은 노트북 설정이 저녁에 바뀌면 함께 바뀐다.
 */

import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'the-gang:theme'

/** 저장이 막힌 환경(시크릿 창 등)이 있다. 못 적어도 이번 화면은 바뀌어야 한다. */
function remember(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* 기억하지 못할 뿐이다 */
  }
}

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

function current(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(current)

  // 아직 고른 적이 없는 사람만 기기 설정을 따라간다. 한 번 고르면 그 뜻이 이긴다.
  useEffect(() => {
    if (saved()) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const follow = (event: MediaQueryListEvent) => {
      const next: Theme = event.matches ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [theme])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    remember(next)
    setTheme(next)
  }

  return { theme, toggle }
}
