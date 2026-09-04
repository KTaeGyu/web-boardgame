/**
 * Esc 로 한 걸음 물러난다.
 *
 * **맨 위 하나만 받는다.** 뒤로가기(`back.ts`)와 같은 어법이다 — 그쪽 주석의
 * 「리스너를 각자 달면 한 번의 뒤로가기를 여럿이 나눠 먹는다」가 여기서도 그대로
 * 참이었다. 전에는 덮개마다 제 리스너를 창에 달고 페이지도 따로 달아서, Esc 한 번을
 * **모두가 함께 받았다.** 족보표를 닫으려고 누르면 족보표가 닫히면서 그 자리에
 * 「방을 나가시겠습니까?」가 들어섰다.
 *
 * 그것을 막는 방법이 「페이지 쪽에서 덮개 이름을 나열해 꺼두기」였는데
 * (`!confirmLeave && !confirmWatch`), 덮개가 늘 때마다 조용히 빠졌다. 세는 자리를
 * 하나로 모으면 나열할 것이 없어진다.
 *
 * **층이 둘이다.**
 *
 * - `useEscape` — 덮개. 여럿이 겹칠 수 있고 **가장 나중에 열린 것**이 받는다.
 * - `useEscapeFallback` — 화면. **덮개가 하나도 없을 때만** 받는다.
 *
 * 층을 가르는 것은 등록 순서를 믿을 수 없어서다. React 는 자식 효과를 부모보다 먼저
 * 돌리므로, 화면과 덮개가 같은 번에 뜨면 덮개가 먼저 쌓여 화면이 맨 위가 된다 —
 * 순서로만 가리면 그 한 번에 거꾸로 뒤집힌다. 화면은 층이 아니라 바닥이다.
 */

import { useEffect, useRef } from 'react'

interface Layer {
  run: () => void
}

/** 지금 열려 있는 덮개들. 마지막 것이 가장 안쪽이다. */
const layers: Layer[] = []
/** 덮개가 하나도 없을 때 받는 자리. 화면 하나당 하나뿐이다. */
let bare: Layer | null = null
let listening = false

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = layers[layers.length - 1] ?? bare
  if (!top) return
  event.preventDefault()
  top.run()
}

/** 받는 자리가 하나라도 생기면 켜고, 다 사라지면 끈다. */
function tune(): void {
  const need = layers.length > 0 || bare !== null
  if (need === listening) return
  if (need) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
  listening = need
}

/**
 * 덮개 하나를 Esc 줄에 세운다.
 *
 * @param enabled 지금 떠 있는가. 꺼져 있는 동안에는 줄에서 빠진다.
 * @param run     Esc 를 받았다. 보통은 닫기다.
 */
export function useEscape(enabled: boolean, run: () => void): void {
  const handler = useRef(run)
  handler.current = run

  useEffect(() => {
    if (!enabled) return
    const layer: Layer = { run: () => handler.current() }
    layers.push(layer)
    tune()
    return () => {
      const at = layers.lastIndexOf(layer)
      if (at >= 0) layers.splice(at, 1)
      tune()
    }
  }, [enabled])
}

/**
 * Esc 를 여기서 멈춘다. **아무 일도 하지 않는다.**
 *
 * 답해야 넘어가는 자리에 쓴다 — 스캔 · 딜 직후 단계 · 재경기 물음. 이 창들은 닫는 길이
 * 하나도 없는데(`useSheetDrag` 주석의 「닫을 수 있는 시트에만 붙인다」), 그렇다고
 * 그냥 두면 Esc 가 밑으로 흘러 화면의 바닥이 받아 「나가시겠습니까?」를 띄운다.
 * 닫히지는 않으니 규칙이 깨지는 것은 아니지만, 답을 기다리는 자리에 뜨는 잡음이다.
 *
 * **뒤로가기는 막지 않는다.** 휴대폰에서 뒤로가기가 아무 반응이 없으면 고장으로 읽히고,
 * 그 신호가 화면까지 가서 「나가시겠습니까?」가 되는 것은 잡음이 아니라 제 일이다 —
 * 판을 떠나려는 사람에게 물어보는 것이 맞다.
 */
export function useEscapeBlock(enabled: boolean): void {
  useEscape(enabled, noop)
}

/** 층 하나를 세우되 아무것도 하지 않는다. 매번 새로 만들면 효과가 다시 돈다. */
function noop(): void {}

/**
 * 화면의 바닥. **덮개가 하나도 없을 때만** 받는다.
 *
 * 덮개 이름을 나열할 필요가 없다 — 무엇이 떠 있든 그쪽이 먼저 받고, 다 닫힌 뒤에야
 * 이리로 온다. 화면 하나당 하나이므로 나중에 부른 쪽이 앞의 것을 대신한다.
 */
export function useEscapeFallback(enabled: boolean, run: () => void): void {
  const handler = useRef(run)
  handler.current = run

  useEffect(() => {
    if (!enabled) return
    const floor: Layer = { run: () => handler.current() }
    bare = floor
    tune()
    return () => {
      // 다음 화면이 이미 제 것을 깔았으면 그것을 걷어내지 않는다.
      if (bare === floor) bare = null
      tune()
    }
  }, [enabled])
}
