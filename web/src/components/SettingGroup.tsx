/**
 * 접었다 펴는 설정 묶음.
 *
 * 「직접 고르기」의 칸이 열이 넘는다. 다 펴 두면 방장이 아닌 사람에게는 읽을 것만
 * 길어지고, 방장에게도 지금 만지던 칸이 어디였는지 매번 다시 찾는 일이 된다.
 *
 * **접힌 채로도 무엇을 골랐는지는 보여야 한다.** 그래서 머리에 요약 한 마디가 함께
 * 선다 — 「2장」·「무작위 없음」처럼, 펴 보지 않고도 지금 값을 읽을 수 있는 말이다.
 *
 * 열림을 React 가 들고 있는 것은 이 화면이 방이 바뀔 때마다(room:updated) 다시
 * 그려지기 때문이다. `<details>` 에게 맡기면 남이 들어올 때마다 펴 둔 것이 도로 접힌다.
 */

import type { MouseEvent, ReactNode } from 'react'

export function SettingGroup({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string
  /** 접힌 채로 보여줄 지금 값. 짧을수록 좋다. */
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <details className="setting-group" open={open}>
      {/*
        브라우저가 스스로 여닫는 것을 막고 우리가 든 값으로만 움직인다. 두 곳이 같은
        것을 기억하면 다시 그릴 때마다 둘이 어긋난다.
      */}
      <summary
        className="setting-group__head"
        onClick={(event: MouseEvent) => {
          event.preventDefault()
          onToggle()
        }}
      >
        <span className="setting-group__title">{title}</span>
        <span className="setting-group__summary">{summary}</span>
      </summary>
      <div className="setting-group__body">{children}</div>
    </details>
  )
}
