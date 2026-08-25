/**
 * 어느 판에 어떤 카드가 걸리는가.
 *
 * 규칙 자체(카드가 무엇을 하는가)는 Game 안에 있고, 여기서는 순서만 정한다.
 * 성공하면 도전자, 실패하면 해결사 — 그 위에 모드별 예외가 얹힌다.
 */

import {
  QUICK_ACCESS,
  READY_CHALLENGES,
  READY_SPECIALISTS,
  type ChallengeId,
  type GameMode,
  type SpecialistId,
} from '@the-gang/shared'

/** 이번 판에 걸리는 것들. */
export interface ExtraSelection {
  challenges: ChallengeId[]
  specialist: SpecialistId | null
}

/**
 * 카드 더미. 룰북대로 1번부터 차례로 나오고, 쓴 카드는 맨 아래로 돌아간다.
 * 그래서 한 게임 안에서 같은 카드가 두 번 나오기 전에 나머지를 다 본다.
 */
class Stack<T> {
  private order: T[]

  constructor(items: readonly T[]) {
    this.order = [...items]
  }

  get size(): number {
    return this.order.length
  }

  draw(): T | null {
    const next = this.order.shift()
    if (next === undefined) return null
    this.order.push(next)
    return next
  }

  /** 무작위로 한 장. 프로·마스터 시프 모드가 게임 시작 때 쓴다. */
  drawRandom(rng: () => number): T | null {
    if (this.order.length === 0) return null
    const index = Math.floor(rng() * this.order.length)
    const [picked] = this.order.splice(index, 1)
    this.order.push(picked)
    return picked
  }
}

export class ExtraDealer {
  private readonly mode: GameMode
  private readonly rng: () => number
  private readonly challenges: Stack<ChallengeId>
  private readonly specialists: Stack<SpecialistId>
  /** 프로 모드에서 게임 내내 유지되는 한 장. */
  private permanent: ChallengeId | null = null
  /** 마스터 시프 모드에서 늘 두 장이 걸려 있다. */
  private standing: ChallengeId[] = []
  /** 「직접 고르기」에서 방장이 고른 도전자. 모든 판에 그대로 걸린다. */
  private readonly picked: ChallengeId[]
  /**
   * 「직접 고르기」에서 무작위로 얹힌 도전자.
   *
   * 게임을 시작할 때 한 번 뽑고 그대로 둔다 — 판마다 다시 뽑으면 무엇이 걸릴지
   * 매번 달라져, 방장이 짜 둔 판의 모양이 뽑기에 묻힌다. 고른 것과 겹치지 않게 뽑는다.
   * 겹치면 두 장이 한 장으로 합쳐지는 셈이라 얹은 만큼 안 얹힌다.
   */
  private readonly rolled: ChallengeId[] = []
  /**
   * 「직접 고르기」에서 방장이 짠 배치. 자리 하나가 판 하나다.
   * 비어 있는 판은 해결사 없이 지나간다 — 빈칸도 뜻이 있다.
   */
  private readonly specialistRounds: readonly (SpecialistId | null)[]
  /** 지금 몇 번째 판인가. 배치표에서 자리를 짚는 데만 쓴다. */
  private heist = 0

  constructor(
    mode: GameMode,
    rng: () => number,
    picked: readonly ChallengeId[] = [],
    specialistRounds: readonly (SpecialistId | null)[] = [],
    options: { random?: number } = {},
  ) {
    this.mode = mode
    this.rng = rng
    this.picked = [...picked]
    this.specialistRounds = [...specialistRounds]

    // 프로·마스터 시프에서는 「빠른 접근」을 쓰지 않는다. 라운드를 통째로 건너뛰어
    // 다른 카드와 겹칠 때 규칙이 서로 부딪히기 때문이다.
    const pool =
      mode === 'professional' || mode === 'masterThief'
        ? READY_CHALLENGES.filter((id) => id !== QUICK_ACCESS)
        : READY_CHALLENGES
    this.challenges = new Stack(pool)
    this.specialists = new Stack(READY_SPECIALISTS)

    // 무작위로 얹을 몫은 여기서 다 뽑아 둔다. 남은 더미에서 골라야 고른 것과 겹치지 않는다.
    if (mode === 'custom') {
      const rest = READY_CHALLENGES.filter((id) => !this.picked.includes(id))
      const count = Math.min(options.random ?? 0, rest.length)
      for (let i = 0; i < count; i += 1) {
        const [drawn] = rest.splice(Math.floor(rng() * rest.length), 1)
        this.rolled.push(drawn)
      }
    }

    if (mode === 'professional') this.permanent = this.challenges.drawRandom(rng)
    if (mode === 'masterThief') {
      this.standing = [this.challenges.drawRandom(rng), this.challenges.drawRandom(rng)].filter(
        (id): id is ChallengeId => id !== null,
      )
    }
  }

  /**
   * 다음 판에 걸릴 것들.
   *
   * @param lastSuccess 직전 판의 결과. 첫 판이면 null 이고 아무것도 걸리지 않는다.
   */
  next(lastSuccess: boolean | null): ExtraSelection {
    this.heist += 1
    if (this.mode === 'basic') return { challenges: [], specialist: null }

    // 직접 고르기는 판마다 뽑지 않는다. 도전자는 고른 것과 시작할 때 뽑아 둔 것이
    // 처음부터 끝까지 함께 걸리고, 해결사는 방장이 짠 배치표에서 이번 판 자리를 읽는다.
    if (this.mode === 'custom') {
      return {
        challenges: [...this.picked, ...this.rolled],
        specialist: this.specialistRounds[this.heist - 1] ?? null,
      }
    }

    if (this.mode === 'masterThief') {
      // 매 판 가장 오래된 한 장을 버리고 새 한 장을 받는다. 늘 두 장이다.
      if (lastSuccess !== null) {
        this.standing.shift()
        const fresh = this.challenges.draw()
        if (fresh !== null) this.standing.push(fresh)
      }
      return { challenges: [...this.standing], specialist: null }
    }

    const base: ChallengeId[] = this.permanent === null ? [] : [this.permanent]
    if (lastSuccess === null) return { challenges: base, specialist: null }

    if (lastSuccess) {
      const drawn = this.challenges.draw()
      return { challenges: drawn === null ? base : [...base, drawn], specialist: null }
    }
    return { challenges: base, specialist: this.specialists.draw() }
  }
}
