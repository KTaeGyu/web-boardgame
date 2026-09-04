/**
 * 튜토리얼 안내.
 *
 * 스스로 사라지지 않는다. 닫을 때까지 서버가 봇을 멈춰 두기 때문에, 읽는 사이에 판이
 * 흘러가 무엇을 읽었는지와 화면이 어긋나는 일이 없다.
 *
 * 판을 가리지 않도록 화면 위쪽에만 앉는다 — 카드와 토큰이 보이는 채로 읽어야
 * 「이 이야기가 저것을 가리키는구나」가 이어진다.
 */

import { useBackClose } from '../lib/back.ts'
import { useEscape } from '../lib/useEscape.ts'

export interface TipPayload {
  step: number
  total: number
  title: string
  text: string
  /** 읽고 나서 바로 할 일. 없으면 처음 하는 사람은 안내를 닫은 자리에서 멈춘다. */
  action?: string
}

export function TutorialTip({ tip, onClose }: { tip: TipPayload; onClose: () => void }) {
  // 안내가 떠 있는 동안의 뒤로가기는 「알겠습니다」와 같다.
  useBackClose(onClose)
  useEscape(true, onClose)

  return (
    <aside className="tip" role="dialog" aria-live="polite" aria-label={tip.title}>
      <header className="tip__head">
        <span className="tip__step">
          {tip.step} / {tip.total}
        </span>
        <h2 className="tip__title">{tip.title}</h2>
        <button type="button" className="tip__close" onClick={onClose} aria-label="안내 닫기">
          ×
        </button>
      </header>
      <p className="tip__text">{tip.text}</p>
      {/*
        할 일은 설명과 갈라 둔다. 규칙 이야기 끝에 한 문장으로 붙이면 같이 읽히고,
        정작 무엇을 누르라는 말이 문단 속에 묻힌다.
      */}
      {tip.action && (
        <p className="tip__action">
          <span className="tip__action-label">지금 할 일</span>
          {tip.action}
        </p>
      )}
      <button type="button" className="btn btn--primary tip__ok" onClick={onClose}>
        알겠습니다
      </button>
    </aside>
  )
}
