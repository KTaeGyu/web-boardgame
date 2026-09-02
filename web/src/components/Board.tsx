import type { CSSProperties } from 'react'

import {
  BANANA_GROUP,
  CIRCLE_SEATS,
  CIRCLE_WILD_AT,
  VARIANTS,
  bananaGroup,
  type GameView,
} from '@the-gang/shared'

import { CardSlot, PlayingCard } from './PlayingCard.tsx'

/**
 * 공용 카드를 그 포커 방식의 모양대로 늘어놓는다.
 *
 * **세 군데가 이것 하나를 쓴다** — 테이블 · 쇼다운 모달 · 스캔 창. 각자 그리게 두었더니
 * 스팟스의 격자가 두 곳에서만 서고 모달에서는 한 줄로 펴졌다(2026-09-02). 모양이 곧
 * 규칙인 변형에서는 그게 「어느 줄로 만든 손인지 알 수 없음」이 된다.
 *
 * 모양은 화면이 정하지 않는다. `VARIANTS[변형].layout` 이 정본이다.
 */
interface Props {
  game: GameView
  size?: 'sm' | 'md'
  /** 아직 안 나온 자리를 빈 칸으로 그릴지. 남은 라운드를 가늠하게 하는 테이블만 그린다. */
  slots?: boolean
  /** 지금 짚고 있는 조합. 그 카드만 밝힌다. */
  lit?: Set<string>
  /** 한 장씩 놓이는 느낌을 주는 간격(ms). */
  delayStep?: number
  /** 바깥 칸의 클래스. 자리에 따라 여백과 테두리가 다르다. */
  base: string
  /**
   * 보는 사람. **「나」라고 적을 자리**를 정할 뿐이고 판을 돌리지는 않는다.
   *
   * 둘을 한 값으로 묶어 두었더니, 쇼다운에서 남을 짚어 판이 그쪽으로 돌 때
   * **그 사람 자리에 「나」가 적혔다** — 돌아간 것이 아니라 내가 거기 있는 것처럼 읽혔다.
   */
  me?: string
  /**
   * 어느 자리를 아래로 돌릴까. **바나나스플릿에서만 뜻이 있다** — 그 자리의 사람이
   * 쓸 수 있는 두 묶음이 진해진다. 없으면 보는 사람 자리이고, 그것도 없으면 0번이 아래다.
   */
  focus?: string
}

export function CommunityBoard({
  game,
  size = 'md',
  slots = false,
  lit,
  delayStep = 90,
  base,
  me,
  focus,
}: Props) {
  const rules = VARIANTS[game.variant]
  const total = rules.dealt(4, game.players.length)
  const classes = `${base} ${base}--${rules.layout}`

  const card = (index: number) => {
    const value = game.community[index]
    if (!value) return slots ? <CardSlot key={`slot-${index}`} /> : null
    return (
      <PlayingCard
        key={value}
        card={value}
        size={size}
        delay={index * delayStep}
        highlight={lit?.has(value) ?? false}
      />
    )
  }

  if (rules.layout === 'banana') {
    const seats = game.players.length
    /*
     * 내 자리를 늘 아래(180°)로 돌린다. 같은 판이라도 사람마다 다르게 서지만
     * 이웃 관계는 그대로다 — 「내 양옆」을 세려면 내가 어디 있는지가 고정이어야 한다.
     */
    const at = Math.max(
      game.players.findIndex((player) => player.id === (focus ?? me)),
      0,
    )
    const turn = (index: number) => `${((index - at) / seats) * 360 + 180}deg`
    // 묶음 g 는 자리 g 와 g+1 **사이**에 있다. 그래서 반 칸 어긋난 각도다.
    const mineGroups = new Set([at, (at - 1 + seats) % seats])

    return (
      <div className={classes}>
        <div className="board-banana">
          {game.players.map((player, index) => (
            <span
              key={player.id}
              className={`board-banana__seat ${player.id === me ? 'is-me' : ''}`}
              style={{ '--turn': turn(index) } as CSSProperties}
            >
              {player.id === me ? '나' : player.displayName}
            </span>
          ))}
          {Array.from({ length: seats }, (_, group) => {
            const cards = bananaGroup(game.community, group, seats)
            return (
              <span
                key={`g${group}`}
                className={`board-banana__group ${mineGroups.has(group) ? 'is-mine' : ''}`}
                style={{ '--turn': turn(group + 0.5) } as CSSProperties}
              >
                {Array.from({ length: BANANA_GROUP }, (_, at) => {
                  const value = cards[at]
                  if (!value) return slots ? <CardSlot key={`s${group}-${at}`} /> : null
                  return (
                    <PlayingCard
                      key={value}
                      card={value}
                      size={size}
                      delay={at * delayStep}
                      highlight={lit?.has(value) ?? false}
                    />
                  )
                })}
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  if (rules.layout !== 'circle') {
    return <div className={classes}>{Array.from({ length: total }, (_, index) => card(index))}</div>
  }

  /*
   * 자리는 각도로 잡는다. 감싸는 칸이 자리를 잡고 카드는 자기 transform 을 그대로 쓴다 —
   * 카드에 직접 걸면 등장 애니메이션·강조와 서로를 지운다.
   */
  const ring = { '--seats': CIRCLE_SEATS } as CSSProperties
  return (
    <div className={classes}>
      <div className={`board-circle ${size === 'sm' ? 'board-circle--sm' : ''}`} style={ring}>
        {Array.from({ length: total }, (_, index) => {
          const drawn = card(index)
          if (!drawn) return null
          const center = index === CIRCLE_WILD_AT
          return (
            <span
              key={index}
              className={`board-circle__slot ${center ? 'board-circle__slot--center' : ''}`}
              style={{ '--at': index } as CSSProperties}
            >
              {drawn}
            </span>
          )
        })}
        {/*
          원에 들지 않는 한 장이라 무엇을 할 수 있는지 적어 둔다. **자리가 자유롭다는
          뜻이지 숫자가 자유롭다는 뜻이 아니다** — 그 말이 없으면 찍힌 숫자를 장식으로 읽는다.
        */}
        {game.variant === 'circleWild' && game.community[CIRCLE_WILD_AT] && (
          <span className="board-circle__wild">✦ 와일드 — 이웃 아무 자리에나</span>
        )}
      </div>
    </div>
  )
}
