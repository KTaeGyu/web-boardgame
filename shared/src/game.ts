/**
 * 게임 진행의 계약.
 *
 * 은닉 정보가 이 게임의 전부다. 그래서 공개 상태(GameView)에는 누구의 홀카드도
 * 담기지 않는다 — 본인 것조차 담지 않는다. 내 카드는 나에게만 따로 간다.
 * 쇼다운에 이르러서야 모두의 카드가 공개 상태에 실린다.
 */

import type { Card } from './cards.ts'
import type { ShowdownResult } from './showdown.ts'

/** 금고 3개면 승리, 경보 3개면 패배. 그래서 한 게임은 최대 5판이다. */
export const VAULTS_TO_WIN = 3
export const ALARMS_TO_LOSE = 3

/** 라운드는 넷. 프리플롭 → 플롭 → 턴 → 리버. */
export const ROUNDS = [1, 2, 3, 4] as const
export type Round = (typeof ROUNDS)[number]

/** 라운드가 끝났을 때 테이블에 깔려 있어야 할 커뮤니티 카드 수. */
export const COMMUNITY_BY_ROUND: Record<Round, number> = { 1: 0, 2: 3, 3: 4, 4: 5 }

export const ROUND_LABEL: Record<Round, string> = {
  1: '프리플롭',
  2: '플롭',
  3: '턴',
  4: '리버',
}

/** 라운드별 토큰 색. 화면에서 이력을 구분하는 유일한 단서다. */
export const ROUND_COLOR: Record<Round, string> = {
  1: 'white',
  2: 'yellow',
  3: 'orange',
  4: 'red',
}

/**
 * 토큰이 날아가는 동안 그 토큰만 잠긴다.
 *
 * 전역으로 잠그면 여러 명이 활발히 뺏을 때 서로의 입력을 계속 먹는다.
 * 화면 애니메이션과 같은 길이여야 손이 도착하는 순간 실제로 풀린다.
 */
export const TOKEN_LOCK_MS = 500

export type GamePhase = 'picking' | 'showdown' | 'gameOver'

export interface GamePlayerView {
  id: string
  nickname: string
  /** 화면에 부를 이름. 같은 닉네임이 여럿이면 꼬리표가 붙는다. */
  displayName: string
  connected: boolean
  /** 이번 라운드에 쥐고 있는 토큰. 아직 안 집었으면 null. */
  currentToken: number | null
  /** 지난 라운드에 확정한 토큰들. 인덱스 0 이 1라운드다. */
  history: (number | null)[]
  ready: boolean
  /** 쇼다운 전에는 언제나 null. 은닉 정보가 새는 유일한 통로라 여기만 지키면 된다. */
  hole: Card[] | null
}

export interface GameView {
  roomCode: string
  /** 몇 번째 판인가. 1부터 센다. */
  heist: number
  vaults: number
  alarms: number
  round: Round
  phase: GamePhase
  community: Card[]
  players: GamePlayerView[]
  /** 아직 아무도 가져가지 않은 이번 라운드 토큰. */
  centerTokens: number[]
  /** 지금 날아가는 중이라 만질 수 없는 토큰. */
  lockedTokens: number[]
  /** 모두가 토큰을 쥐어서 확정 버튼이 열렸는지. */
  canConfirm: boolean
  showdown: ShowdownResult | null
  /** 쇼다운을 확인하고 다음 판으로 넘어가겠다고 누른 사람들. */
  continued: string[]
  outcome: 'win' | 'lose' | null
  /** 게임이 끝난 뒤의 재경기 합의. 아무도 제안하지 않았으면 proposed 가 false 다. */
  rematch: { proposed: boolean; agreed: string[] }
}

/** 판이 끝나고 다음 판으로 넘어가기 전에 다들 결과를 볼 시간이 필요하다. */
export interface GameOverReason {
  reason: 'playerLeft' | 'hostClosed'
  message: string
}
