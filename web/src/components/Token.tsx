import { ROUND_COLOR, type Round } from '@the-gang/shared'

interface Props {
  value: number
  round: Round
  locked?: boolean
  /** 한 번 정해지면 주인이 바뀌지 않는 토큰. 집기 전부터 알아야 한다. */
  stuck?: boolean
  onClick?: () => void
  /** 지난 라운드에 확정된 토큰. 눌리지 않고 작게 표시한다. */
  settled?: boolean
  innerRef?: (node: HTMLElement | null) => void
}

/**
 * 토큰. 숫자가 클수록 「내 손이 세다」는 선언이다.
 *
 * 라운드마다 색이 다르고, 그 색이 이력에서 몇 라운드의 판단이었는지 알려주는 유일한 단서다.
 */
export function Token({
  value,
  round,
  locked = false,
  stuck = false,
  onClick,
  settled = false,
  innerRef,
}: Props) {
  const classes = [
    'token',
    `token--${ROUND_COLOR[round]}`,
    settled ? 'token--settled' : '',
    stuck ? 'token--stuck' : '',
    locked ? 'token--locked' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (settled || !onClick) {
    return (
      <span
        className={classes}
        ref={innerRef}
        aria-label={`${round}라운드 ${value}번 토큰${stuck ? ' (한 번 정해지면 바뀌지 않음)' : ''}`}
      >
        {value}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      ref={innerRef as (node: HTMLButtonElement | null) => void}
      onClick={onClick}
      disabled={locked}
      aria-label={`${value}번 토큰 가져오기${stuck ? ' — 한 번 정해지면 바뀌지 않습니다' : ''}`}
      title={stuck ? '한 번 정해지면 바뀌지 않는 토큰입니다' : undefined}
    >
      {value}
    </button>
  )
}

/** 아직 아무 판단도 하지 않은 라운드 자리. 이력의 길이를 일정하게 유지한다. */
export function TokenBlank({ round }: { round: Round }) {
  return <span className={`token token--blank token--${ROUND_COLOR[round]}`} aria-hidden="true" />
}
