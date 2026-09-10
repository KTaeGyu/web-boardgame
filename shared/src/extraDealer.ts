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
  conflictsWith,
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
   * 「누적」으로 두었을 때, 지난 판에 나와 그대로 남아 있는 무작위 도전자.
   *
   * 누적이 아니면 비어 있다 — 그때는 뽑은 카드가 그 판에서만 산다.
   */
  private readonly kept: ChallengeId[] = []
  /** 「직접 고르기」의 뽑기 규칙. 판마다 이 값들을 보고 몇 장을 뽑을지 정한다. */
  private readonly custom: {
    random: number
    onWin: boolean
    stay: boolean
    specialistRandom: readonly boolean[]
    specialistOnLoss: boolean
    /** 무작위로는 뽑지 않을 도전자. 해결사 쪽은 뭉치를 만들 때 이미 빠져 있다. */
    skipChallenges: readonly ChallengeId[]
  }
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
    options: {
      random?: number
      onWin?: boolean
      stay?: boolean
      specialistRandom?: readonly boolean[]
      specialistOnLoss?: boolean
      excludedChallenges?: readonly ChallengeId[]
      excludedSpecialists?: readonly SpecialistId[]
    } = {},
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
    /*
     * 뽑기에서 뺀 해결사는 뭉치에 아예 넣지 않는다. 뽑고 나서 거르면 그 자리가 비어
     * 「이번 판은 없음」이 되는데, 그건 방장이 말한 것과 다르다.
     *
     * **「직접 고르기」에서만 뺀다.** 제외는 그 모드의 설정이라, 원작 모드는 표대로 다 돈다.
     */
    this.specialists = new Stack(
      mode === 'custom'
        ? READY_SPECIALISTS.filter((id) => !(options.excludedSpecialists ?? []).includes(id))
        : READY_SPECIALISTS,
    )

    this.custom = {
      random: options.random ?? 0,
      onWin: options.onWin ?? false,
      stay: options.stay ?? false,
      specialistRandom: options.specialistRandom ?? [],
      specialistOnLoss: options.specialistOnLoss ?? true,
      skipChallenges: options.excludedChallenges ?? [],
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

    /*
     * 직접 고르기.
     *
     * 고른 카드는 조건 없이 늘 걸린다 — 그것이 「고정」의 뜻이다. 그 위에 무작위 몫이
     * 판마다 새로 얹히고, 해결사는 배치표에서 이번 판 자리를 읽는다.
     */
    if (this.mode === 'custom') {
      const standing: ChallengeId[] = [...this.picked, ...this.kept]
      const rolled = this.rollChallenges(standing, lastSuccess)
      // 누적이면 이번에 나온 것이 다음 판에도 남는다.
      if (this.custom.stay) this.kept.push(...rolled)

      return {
        challenges: [...standing, ...rolled],
        specialist: this.pickSpecialist(lastSuccess),
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

    return this.classic(lastSuccess)
  }

  /**
   * 이번 판에 새로 뽑는 무작위 도전자.
   *
   * 이미 걸려 있는 것(고른 것 + 누적된 것)은 다시 뽑지 않는다. 지난 판에 나왔다가
   * 사라진 카드는 다시 나올 수 있다 — 매 판 달라지는 것이 이 설정의 뜻이다.
   * 함께 걸면 어긋나는 짝(빠른 접근 ↔ 감지기)은 뽑는 자리에서 미리 뺀다.
   */
  private rollChallenges(standing: readonly ChallengeId[], lastSuccess: boolean | null): ChallengeId[] {
    if (this.custom.random <= 0) return []
    // 「이겼을 때만」이면 첫 판(직전 결과 없음)에는 뽑지 않는다.
    if (this.custom.onWin && lastSuccess !== true) return []

    const rest = READY_CHALLENGES.filter(
      (id) =>
        !standing.includes(id) &&
        // 뽑지 않기로 한 것. 「고른 것」의 반대편이라 후보에서 먼저 빠진다.
        !this.custom.skipChallenges.includes(id) &&
        !conflictsWith(id).some((other) => standing.includes(other)),
    )
    const rolled: ChallengeId[] = []
    for (let i = 0; i < this.custom.random && rest.length > 0; i += 1) {
      const [drawn] = rest.splice(Math.floor(this.rng() * rest.length), 1)
      rolled.push(drawn)
      // 방금 뽑은 것과 부딪히는 카드도 뺀다. 무작위끼리 어긋나도 판은 똑같이 이상해진다.
      for (const other of conflictsWith(drawn)) {
        const at = rest.indexOf(other)
        if (at >= 0) rest.splice(at, 1)
      }
    }
    return rolled
  }

  /**
   * 이번 판의 해결사. 배치표에서 자리를 읽되, 「진 다음에만」이면 결과를 먼저 본다.
   *
   * 맨 윗줄(무작위)을 찍은 판은 그 자리에서 한 장을 뽑는다. 한 판에 해결사는 하나뿐이라
   * 지정 카드와 무작위가 같은 칸에 함께 서는 일은 없다 — 표가 그것을 막는다.
   */
  private pickSpecialist(lastSuccess: boolean | null): SpecialistId | null {
    if (this.custom.specialistOnLoss && lastSuccess !== false) return null
    const at = this.heist - 1
    /*
     * 제외는 **뽑는 자리에만** 걸린다. 손으로 세워 둔 카드는 표시가 있어도 그대로
     * 나온다 — 「이 판에 이것」이라고 짚은 것은 뽑은 것이 아니다.
     * 뽑을 것이 하나도 안 남았으면 그 판은 해결사 없이 지나간다(drawRandom 이 null).
     */
    if (this.custom.specialistRandom[at]) return this.specialists.drawRandom(this.rng)
    return this.specialistRounds[at] ?? null
  }

  /** 원작 모드들. 성공하면 도전자, 실패하면 해결사. */
  private classic(lastSuccess: boolean | null): ExtraSelection {
    const base: ChallengeId[] = this.permanent === null ? [] : [this.permanent]
    if (lastSuccess === null) return { challenges: base, specialist: null }

    if (lastSuccess) {
      const drawn = this.challenges.draw()
      return { challenges: drawn === null ? base : [...base, drawn], specialist: null }
    }
    return { challenges: base, specialist: this.specialists.draw() }
  }
}
