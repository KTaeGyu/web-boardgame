/**
 * 화면을 통째로 작게.
 *
 * 작은 휴대폰에서는 여백과 글자가 조금씩 커서 판이 화면 밖으로 밀린다. 값을 하나씩
 * 줄여 잡으면 규칙이 수십 개로 늘고 어디 하나는 반드시 어긋나므로, 뿌리에서 한 번에 줄인다.
 *
 * 값은 늘 `<html data-density>` 에 적혀 있고, 처음 한 벌은 index.html 이 화면이 그려지기
 * 전에 붙여 둔다 — 뒤늦게 붙이면 한 칠은 큰 채로 나왔다가 작아진다. 테마와 같은 방식이다.
 */

import { useEffect, useState } from 'react'

export type Density = 'normal' | 'compact'

const KEY = 'the-gang:density'

function remember(density: Density): void {
  try {
    localStorage.setItem(KEY, density)
  } catch {
    /* 기억하지 못할 뿐이다 */
  }
}

function current(): Density {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'normal'
}

export function useDensity(): { density: Density; toggle: () => void } {
  const [density, setDensity] = useState<Density>(current)

  // 다른 탭에서 바꾼 것도 따라간다. 같은 사람이 두 창을 띄워 놓는 일이 흔하다.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== KEY) return
      const next: Density = event.newValue === 'compact' ? 'compact' : 'normal'
      document.documentElement.dataset.density = next
      setDensity(next)
    }
    window.addEventListener('storage', follow)
    return () => window.removeEventListener('storage', follow)
  }, [])

  const toggle = () => {
    const next: Density = density === 'compact' ? 'normal' : 'compact'
    document.documentElement.dataset.density = next
    remember(next)
    setDensity(next)
  }

  return { density, toggle }
}
