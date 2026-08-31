/**
 * 덮개가 떠 있는 동안 뒤 페이지를 잠근다.
 *
 * 화면을 덮는 창이 떠 있는데 배경이 움직이면, 창을 닫았을 때 읽던 자리가 달라져 있다.
 * 내가 하지 않은 이동이라 되짚을 실마리가 없다. 스캔 창이 공용 카드와 선언 이력을
 * 창 안에 다시 그려 넣은 것도 같은 판단에서다 — 뒤를 봐야 한다면 그렇게 만들 이유가 없었다.
 *
 * **세는 방식이다.** 덮개는 겹친다(모달 위에 확인창, 쇼다운 위에 재경기 물음).
 * 안쪽 창이 닫혔다고 잠금을 풀면 아직 떠 있는 바깥 창 뒤가 움직인다. 뒤로가기 가드를
 * 쌓아 세는 `back.ts` 와 같은 꼴이고, 이유도 같다.
 *
 * **자리를 손으로 저장하고 되돌린다.** iOS 사파리는 `overflow: hidden` 만으로는 잠기지
 * 않아 body 를 fixed 로 만드는데, 그 순간 스크롤이 0 으로 튄다. 그래서 잠글 때 얼마나
 * 내려와 있었는지를 적어 두고(위로 그만큼 끌어올려 제자리처럼 보이게 한다), 풀 때
 * 그 값으로 되돌린다.
 */

import { useEffect } from 'react'

/** 지금 몇 겹이 잠그고 있는가. 0 이 될 때에만 실제로 푼다. */
let depth = 0
/** 잠그기 직전에 얼마나 내려와 있었는가. 가장 바깥 덮개가 뜰 때 한 번만 적는다. */
let saved = 0
/**
 * 그때 어느 화면이었는가.
 *
 * 덮개 안에서 화면을 옮기는 길이 있다 — 「방 나가기」를 물어보는 창이 그렇다. 그러면
 * 화면이 먼저 바뀌고 그 뒤에 잠금이 풀리는데, 옛 화면에서 내려와 있던 만큼을 새 화면에
 * 되돌려 넣게 된다. 처음 보는 목록이 저 아래에서 시작한다. 화면이 그대로일 때만 되돌린다.
 */
let savedPath = ''

function lock(): void {
  depth += 1
  if (depth > 1) return
  saved = window.scrollY
  savedPath = window.location.pathname
  document.documentElement.style.setProperty('--locked-top', `-${saved}px`)
  document.body.classList.add('scroll-locked')
}

function unlock(): void {
  depth -= 1
  if (depth > 0) return
  depth = 0
  document.body.classList.remove('scroll-locked')
  document.documentElement.style.removeProperty('--locked-top')
  /*
   * 되돌리는 것은 브라우저에 맡기지 않는다. body 가 fixed 에서 풀리는 순간
   * 브라우저는 맨 위를 보여주므로, 우리가 적어둔 자리로 다시 데려가야 한다.
   *
   * 화면이 바뀌었으면 되돌리지 않는다. 그 자리는 새 화면의 것이 아니다.
   */
  if (window.location.pathname === savedPath) window.scrollTo(0, saved)
}

/**
 * @param active 지금 덮고 있는가. 조건부로 뜨는 덮개(서버 덮개처럼)는 이 값으로 가른다 —
 *               훅은 조건부로 부를 수 없다.
 */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return
    lock()
    return unlock
  }, [active])
}
