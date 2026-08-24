import { CATEGORY_LABEL, RANKS, rankLabel, type GameView, type ScanQuestion } from '@the-gang/shared'

interface Props {
  game: GameView
  playerId: string
  onVote: (kind: 'rank' | 'category', value: number) => void
}

const CATEGORIES = Object.entries(CATEGORY_LABEL).map(([id, label]) => ({
  value: Number(id),
  label,
}))

const RANK_CHOICES = [...RANKS].reverse().map((_, index) => ({
  value: 14 - index,
  label: rankLabel(14 - index),
}))

const QUESTION_LABEL: Record<'rank' | 'category', string> = {
  rank: '망막 스캔 — 가진 카드 숫자',
  category: '지문 스캔 — 족보',
}

function label(kind: 'rank' | 'category', value: number): string {
  return kind === 'rank' ? rankLabel(value) : (CATEGORY_LABEL[value as 0] ?? String(value))
}

/**
 * 스캔. 마지막 사람이 공개되기 전에 나머지가 답을 맞힌다.
 *
 * 표가 서로 보이는 것이 핵심이다. 말을 주고받을 수 없으니, 남이 무엇을 골랐는지
 * 보면서 옮겨가야 만장일치에 닿는다. 물음이 둘이면 둘 다 맞혀야 넘어간다.
 */
export function ScanVote({ game, playerId, onVote }: Props) {
  const scan = game.scan
  if (!scan || game.phase !== 'scanning') return null

  const target = game.players.find((player) => player.id === scan.targetId)
  const iAmTarget = scan.targetId === playerId
  const voters = game.players.filter((player) => player.connected && player.id !== scan.targetId)

  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide modal--tall" role="dialog" aria-modal="true">
        <h2 className="modal__title">
          {scan.questions.length > 1 ? '스캔' : QUESTION_LABEL[scan.questions[0].kind].split(' — ')[0]}
        </h2>

        {iAmTarget ? (
          <p className="modal__body">
            나머지가 <strong>내 카드</strong>를 두고 답을 맞추는 중입니다. 나는 답할 수 없습니다.
          </p>
        ) : (
          <p className="modal__body">
            <strong>{target?.displayName}</strong>님이 공개되기 전에 답을 맞혀야 합니다.
            {scan.questions.length > 1 && ' 두 가지 모두 맞혀야 합니다.'} 나머지 전원이 같은 답을
            고르면 확정됩니다.
          </p>
        )}

        {scan.questions.map((question) => (
          <Question
            key={question.kind}
            question={question}
            voters={voters}
            playerId={playerId}
            canVote={!iAmTarget}
            onVote={onVote}
          />
        ))}
      </div>
    </div>
  )
}

function Question({
  question,
  voters,
  playerId,
  canVote,
  onVote,
}: {
  question: ScanQuestion
  voters: GameView['players']
  playerId: string
  canVote: boolean
  onVote: (kind: 'rank' | 'category', value: number) => void
}) {
  const myVote = question.votes.find((vote) => vote.playerId === playerId)?.value ?? null
  const choices = question.kind === 'rank' ? RANK_CHOICES : CATEGORIES

  return (
    <section className="scan-block">
      <h3 className="scan-block__title">{QUESTION_LABEL[question.kind]}</h3>

      {question.decided !== null ? (
        <p className={`scan-block__done ${question.correct ? 'scan-block__done--ok' : 'scan-block__done--bad'}`}>
          「{label(question.kind, question.decided)}」로 확정했습니다
        </p>
      ) : (
        <>
          <ul className="scan-votes">
            {voters.map((voter) => {
              const vote = question.votes.find((entry) => entry.playerId === voter.id)
              return (
                <li key={voter.id} className={vote ? 'scan-vote scan-vote--in' : 'scan-vote'}>
                  <span className="scan-vote__name">{voter.displayName}</span>
                  <span className="scan-vote__value">
                    {vote ? label(question.kind, vote.value) : '…'}
                  </span>
                </li>
              )
            })}
          </ul>

          {canVote && (
            <div className="scan-choices">
              {choices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`scan-choice ${myVote === choice.value ? 'scan-choice--on' : ''}`}
                  onClick={() => onVote(question.kind, choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
