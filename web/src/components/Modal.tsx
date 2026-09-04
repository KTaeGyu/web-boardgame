import { useCallback, useEffect, type ReactNode } from 'react'

import { useBackClose } from '../lib/back.ts'
import { useEscape } from '../lib/useEscape.ts'
import { useScrollLock } from '../lib/useScrollLock.ts'
import { useSheetDrag } from '../lib/useSheetDrag.ts'

interface Props {
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  /**
   * 기다리는 동안 밀고 나가는 단추에 뜨는 말.
   *
   * 기본값이 「들어가는 중…」인 것은 이 창이 방에 들어갈 때 먼저 쓰였기 때문이다.
   * 다른 일에 쓰면 그 일의 말로 바꾼다 — 사는 자리에서 「들어가는 중」은 딴소리다.
   */
  busyLabel?: string
}

/** 예/아니오 확인창. Esc 로 닫히고, 배경을 눌러도 닫힌다. */
export function ConfirmModal({
  title,
  children,
  confirmLabel = '예',
  cancelLabel = '아니오',
  onConfirm,
  onCancel,
  busy = false,
  busyLabel = '들어가는 중…',
}: Props) {
  /*
   * **일하는 동안에는 닫는 길을 전부 막는다.**
   *
   * 단추 둘만 잠그면 나머지 넷으로 새어 나간다 — Esc · 배경 클릭 · 휴대폰 뒤로가기 ·
   * 시트 끌어내림. 그 넷으로 닫아도 이미 나간 요청은 계속 돌아서, 되돌릴 수 없는 일
   * (상점의 구매가 그렇다)이라면 「취소했는데 사졌다」가 된다. 요청을 물릴 수는 없으므로
   * 막을 수 있는 것은 「취소했다」고 읽히는 길뿐이다.
   */
  const dismiss = useCallback(() => {
    if (!busy) onCancel()
  }, [busy, onCancel])

  // 휴대폰의 뒤로가기는 화면을 떠나는 것이 아니라 이 창을 닫는 것이어야 한다.
  useBackClose(dismiss)
  // 떠 있는 동안 뒤 페이지는 움직이지 않는다.
  useScrollLock()
  // 작은 화면에서는 아래에서 올라온 시트다. 끌어내려 닫는다.
  const drag = useSheetDrag(dismiss)

  // 손이 마우스로 가지 않아도 끝낼 수 있게. Esc 는 물러나기, Enter 는 밀고 나가기.
  useEscape(true, dismiss)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || busy) return
      event.preventDefault()
      onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, busy])

  return (
    <div className="modal-backdrop" onClick={dismiss} role="presentation">
      <div
        className={`modal ${drag.className}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        {...drag.handlers}
      >
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" onClick={dismiss} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 고를 것이 둘 이상인 창.
 *
 * 예/아니오가 아니라 「어느 쪽으로 할 것인가」를 묻는 자리다. 그래서 물러나기가 버튼이
 * 아니라 오른쪽 위 x 다 — 선택지 옆에 「취소」가 나란히 서면 그것도 선택지로 읽힌다.
 */
export function ChoiceModal({
  title,
  children,
  actions,
  onClose,
}: {
  title: string
  children: ReactNode
  actions: {
    label: string
    tone?: 'danger' | 'primary'
    /** 지금은 고를 수 없는 길. 지우지 않고 잠근다 — 없어지면 왜 안 되는지도 함께 사라진다. */
    disabled?: boolean
    onClick: () => void
  }[]
  onClose: () => void
}) {
  useBackClose(onClose)
  useScrollLock()
  const drag = useSheetDrag(onClose)

  useEscape(true, onClose)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal ${drag.className}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        {...drag.handlers}
      >
        <button type="button" className="modal__close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>
        <div className="btn-row">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`btn ${action.tone ? `btn--${action.tone}` : ''}`}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
