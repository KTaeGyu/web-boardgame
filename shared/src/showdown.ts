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

export interface ShowdownResult {
  success: boolean
  /** 공개 순서(토큰 오름차순)대로. 화면에서 이 순서로 하나씩 뒤집으면 된다. */
  reveals: ShowdownReveal[]
}

export function judgeShowdown(entries: readonly ShowdownEntry[], community: readonly Card[]): ShowdownResult {
  if (community.length !== 5) throw new Error(`커뮤니티 카드는 5장이어야 한다: ${community.length}장 받음`)

  const tokens = entries.map((e) => e.token)
  if (new Set(tokens).size !== tokens.length) throw new Error('토큰 번호가 중복됐다')

  const ordered = entries.slice().sort((a, b) => a.token - b.token)

  let strongestSoFar: HandValue | null = null
  const reveals: ShowdownReveal[] = []

  for (const entry of ordered) {
    const value = evaluateHoleAndCommunity(entry.hole, community)
    const ok = strongestSoFar === null || compareHands(value, strongestSoFar) >= 0
    if (strongestSoFar === null || compareHands(value, strongestSoFar) > 0) strongestSoFar = value

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
