/**
 * 쇼다운 판정.
 *
 * 룰북: 빨강 토큰 1번부터 오름차순으로 공개하며, 앞서 공개된 어떤 핸드보다도
 * 약하지 않아야 한다("equal or stronger"). 완전히 같은 핸드(true tie)끼리는
 * 순서가 어떻든 정답이므로, 등호를 허용하는 것만으로 자연스럽게 처리된다.
 */

import type { Card } from './cards.ts'
import { compareHands, describeHand, evaluateHoleAndCommunity, type HandValue } from './handEval.ts'

export interface ShowdownEntry {
  playerId: string
  /** 4라운드(빨강) 토큰 번호. 1이 가장 약하다는 선언. */
  token: number
  hole: Card[]
}

export interface ShowdownReveal {
  playerId: string
  token: number
  hole: Card[]
  value: HandValue
  description: string
  /** 이 사람이 공개하는 순간 사슬이 끊겼는지. false 인 사람이 실패의 원인이다. */
  ok: boolean
}

export interface ShowdownOptions {
  /** 「근육」을 가진 사람. 같은 족보끼리는 이 사람이 이긴다. */
  muscleId?: string | null
}

export interface ShowdownResult {
  success: boolean
  /** 공개 순서(토큰 오름차순)대로. 화면에서 이 순서로 하나씩 뒤집으면 된다. */
  reveals: ShowdownReveal[]
}

export function judgeShowdown(
  entries: readonly ShowdownEntry[],
  community: readonly Card[],
  options: ShowdownOptions = {},
): ShowdownResult {
  if (community.length !== 5) throw new Error(`커뮤니티 카드는 5장이어야 한다: ${community.length}장 받음`)

  const tokens = entries.map((e) => e.token)
  if (new Set(tokens).size !== tokens.length) throw new Error('토큰 번호가 중복됐다')

  const ordered = entries.slice().sort((a, b) => a.token - b.token)

  /**
   * 지금까지 나온 가장 센 손. 「근육」이 걸리면 같은 족보끼리의 우열이 뒤집히므로,
   * 값만이 아니라 그것이 근육의 손이었는지도 함께 들고 다녀야 한다.
   */
  let strongestSoFar: { value: HandValue; muscle: boolean } | null = null
  const reveals: ShowdownReveal[] = []

  for (const entry of ordered) {
    const value = evaluateHoleAndCommunity(entry.hole, community)
    const mine = { value, muscle: entry.playerId === options.muscleId }
    const diff = strongestSoFar === null ? 1 : compareWithMuscle(mine, strongestSoFar)
    const ok = diff >= 0
    if (strongestSoFar === null || diff > 0) strongestSoFar = mine

    reveals.push({
      playerId: entry.playerId,
      token: entry.token,
      hole: entry.hole,
      value,
      description: describeHand(value),
      ok,
    })
  }

  return { success: reveals.every((r) => r.ok), reveals }
}

/** 족보가 같을 때만 근육이 끼어든다. 족보가 다르면 평소대로다. */
function compareWithMuscle(
  a: { value: HandValue; muscle: boolean },
  b: { value: HandValue; muscle: boolean },
): number {
  if (a.value.category === b.value.category && a.muscle !== b.muscle) return a.muscle ? 1 : -1
  return compareHands(a.value, b.value)
}
