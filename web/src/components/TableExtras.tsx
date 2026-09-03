/**
 * 테이블 옆에 세워 두는 이번 판의 카드.
 *
 * 왼쪽에 해결사, 오른쪽에 도전자. 드로어는 접어 두어도 규칙이 바뀐 채로 판이 도는데,
 * 무엇이 걸렸는지 매번 열어 확인하게 두면 잊은 채로 두는 쪽을 고르게 된다.
 *
 * 넓은 화면에서만 선다. 좁은 화면에서는 테이블이 이미 자리를 다 쓰고 있어, 옆에 세우면
 * 정작 봐야 할 공용 카드가 줄어든다 — 그쪽은 드로어가 맡는다.
 *
 * 도전자는 여러 장이 걸릴 수 있어 한 장씩 넘겨 본다. 넘기는 화살표는 평소에 숨어 있다가
 * 그 자리에 손이 갈 때 드러난다. 카드가 한 장뿐이면 아예 없다.
 */

import { useState } from 'react'
import { CHALLENGES, SPECIALISTS, type GameView } from '@the-gang/shared'

import { ExtraTile, challengeStatus, specialistStatus, type CardNote } from './ExtrasDrawer.tsx'

/**
 * 여기 서는 해결사는 **드로어 안의 그 카드와 같은 한 벌**이다 — 같은 `ExtraTile`,
 * 같은 상태 문구, 같은 사용 손잡이(`useSpecialistUse`). 넓은 화면에서는 이쪽이
 * 눈에 먼저 들어오므로, 여기에 사용 단추가 없으면 못 쓰는 카드로 읽힌다.
 */
export function TableSpecialist({
  game,
  note,
  onUse,
  useLabel,
}: {
  game: GameView
  note: CardNote | null
  onUse?: () => void
  useLabel?: string
}) {
  if (game.specialist === null) return null
  const card = SPECIALISTS[game.specialist]

  return (
    <aside className="table-side table-side--left" aria-label="이번 판 해결사">
      <span className="table-side__label">해결사</span>
      <ExtraTile
        kind="specialist"
        card={card}
        status={specialistStatus(game, note)}
        note={note}
        onUse={onUse}
        useLabel={useLabel}
      />
    </aside>
  )
}

export function TableChallenges({ game }: { game: GameView }) {
  const [index, setIndex] = useState(0)
  if (game.challenges.length === 0) return null

  // 카드가 줄어드는 판도 있다(마스터 시프). 보고 있던 자리가 사라지면 마지막 장을 본다.
  const at = Math.min(index, game.challenges.length - 1)
  const id = game.challenges[at]
  const many = game.challenges.length > 1

  return (
    <aside className="table-side table-side--right" aria-label="이번 판 도전자">
      <span className="table-side__label">
        도전자{many && <span className="table-side__count">{at + 1} / {game.challenges.length}</span>}
      </span>

      <div className="table-side__deck">
        {many && (
          <button
            type="button"
            className="table-side__arrow table-side__arrow--prev"
            onClick={() => setIndex((at + game.challenges.length - 1) % game.challenges.length)}
            aria-label="앞의 카드"
          >
            ‹
          </button>
        )}

        <ExtraTile kind="challenge" card={CHALLENGES[id]} status={challengeStatus(game, id)} />

        {many && (
          <button
            type="button"
            className="table-side__arrow table-side__arrow--next"
            onClick={() => setIndex((at + 1) % game.challenges.length)}
            aria-label="다음 카드"
          >
            ›
          </button>
        )}
      </div>
    </aside>
  )
}
