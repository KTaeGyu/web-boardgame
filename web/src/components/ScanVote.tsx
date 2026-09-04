import { CATEGORY_LABEL, RANKS, ROUNDS, rankLabel, type GameView, type ScanQuestion } from '@the-gang/shared'

import { CommunityBoard } from './Board.tsx'

import { useEscapeBlock } from '../lib/useEscape.ts'
import { useScrollLock } from '../lib/useScrollLock.ts'
import { Token, TokenBlank } from './Token.tsx'

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
  // 훅은 조건부로 부를 수 없다. 이른 return 앞에서 「지금 덮고 있는가」로 가른다.
  useScrollLock(scan !== null && game.phase === 'scanning')
  // 답해야 넘어가는 자리다. Esc 가 밑으로 흘러 「나가시겠습니까?」가 되지 않게 여기서 멈춘다.
  useEscapeBlock(scan !== null && game.phase === 'scanning')
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

        {/*
          답을 맞히려면 판이 보여야 한다.

          이 창이 테이블을 덮으므로 여기에 다시 그린다 — 공용 카드 다섯 장과, 누가 어느
          번호를 거쳐 지금 자리에 섰는지. 지목된 사람의 손을 어림하는 단서가 그 둘뿐이다.
        */}
        <div className="scan-board">
          {/* 테이블과 같은 모양으로. 펴지면 어느 줄·어느 이웃인지 셀 수 없다. */}
          {/*
            바나나스플릿은 사람마다 쓰는 카드가 다르다. 어림해야 할 것은 **지목된 사람의**
            손이므로 그쪽으로 돌려 세운다 — 내 자리를 아래에 두면 남의 묶음을 보고 답하게 된다.
          */}
          <CommunityBoard
            game={game}
            size="sm"
            delayStep={50}
            base="scan-board__cards"
            me={playerId}
            focus={scan.targetId}
          />

          <ul className="scan-board__tracks">
            {game.players.map((player) => (
              <li
                key={player.id}
                className={`scan-track ${player.id === scan.targetId ? 'scan-track--target' : ''}`}
              >
                <span className="scan-track__name">
                  {player.displayName}
                  {player.id === scan.targetId && <span className="scan-track__badge">스캔 대상</span>}
                </span>
                <span className="scan-track__tokens">
                  {ROUNDS.map((round) => {
                    const token = player.history[round - 1]
                    return token === null || token === undefined ? (
                      <TokenBlank key={round} round={round} />
                    ) : (
                      <Token key={round} value={token} round={round} settled />
                    )
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>

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
