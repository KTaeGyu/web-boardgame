import { CATEGORY_LABEL, RANKS, rankLabel, type GameView } from '@the-gang/shared'

interface Props {
  game: GameView
  playerId: string
  onVote: (value: number) => void
}

/** 족보를 고르게 할 때 쓸 목록. 약한 것부터 센 것 순으로 늘어놓는다. */
const CATEGORIES = Object.entries(CATEGORY_LABEL).map(([id, label]) => ({
  value: Number(id),
  label,
}))

const RANK_CHOICES = [...RANKS].reverse().map((rank, index) => ({
  value: 14 - index,
  label: rankLabel(14 - index),
}))

/**
 * 스캔. 마지막 사람이 공개되기 전에 나머지가 답을 맞힌다.
 *
 * 표가 서로 보이는 것이 핵심이다. 말을 주고받을 수 없으니, 남이 무엇을 골랐는지
 * 보면서 옮겨가야 만장일치에 닿는다.
 */
export function ScanVote({ game, playerId, onVote }: Props) {
  const scan = game.scan
  if (!scan || game.phase !== 'scanning') return null

  const target = game.players.find((player) => player.id === scan.targetId)
  const iAmTarget = scan.targetId === playerId
  const myVote = scan.votes.find((vote) => vote.playerId === playerId)?.value ?? null
  const choices = scan.kind === 'rank' ? RANK_CHOICES : CATEGORIES
  const voters = game.players.filter((player) => player.connected && player.id !== scan.targetId)
  const label = (value: number) =>
    scan.kind === 'rank' ? rankLabel(value) : (CATEGORY_LABEL[value as 0] ?? String(value))

  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide" role="dialog" aria-modal="true">
        <h2 className="modal__title">
          {scan.kind === 'rank' ? '망막 스캔' : '지문 스캔'}
        </h2>

        {iAmTarget ? (
          <p className="modal__body">
            나머지가 <strong>내 카드</strong>를 두고 답을 맞추는 중입니다. 나는 답할 수 없습니다.
          </p>
        ) : (
          <p className="modal__body">
            <strong>{target?.displayName}</strong>님이 공개되기 전에,
            {scan.kind === 'rank'
              ? ' 그 사람이 가진 카드 숫자를 하나 '
              : ' 그 사람의 족보를 '}
            골라야 합니다. 나머지 전원이 같은 답을 고르면 확정됩니다.
          </p>
        )}

        <ul className="scan-votes">
          {voters.map((voter) => {
            const vote = scan.votes.find((entry) => entry.playerId === voter.id)
            return (
              <li key={voter.id} className={vote ? 'scan-vote scan-vote--in' : 'scan-vote'}>
                <span className="scan-vote__name">{voter.displayName}</span>
                <span className="scan-vote__value">{vote ? label(vote.value) : '…'}</span>
              </li>
            )
          })}
        </ul>

        {!iAmTarget && (
          <div className="scan-choices">
            {choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={`scan-choice ${myVote === choice.value ? 'scan-choice--on' : ''}`}
                onClick={() => onVote(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
