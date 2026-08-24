import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
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
}: Props) {
  // 손이 마우스로 가지 않아도 끝낼 수 있게. Esc 는 물러나기, Enter 는 밀고 나가기.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key === 'Enter' && !busy) {
        event.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm, busy])

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={busy}>
            {busy ? '들어가는 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
