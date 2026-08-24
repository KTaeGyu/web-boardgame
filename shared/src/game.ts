/**
 * 게임 진행의 계약.
 *
 * 은닉 정보가 이 게임의 전부다. 그래서 공개 상태(GameView)에는 누구의 홀카드도
 * 담기지 않는다 — 본인 것조차 담지 않는다. 내 카드는 나에게만 따로 간다.
 * 쇼다운에 이르러서야 모두의 카드가 공개 상태에 실린다.
 */

import type { Card } from './cards.ts'
import type { ChallengeId, SpecialistId } from './extraCards.ts'
import type { GameMode } from './protocol.ts'
import type { ShowdownResult } from './showdown.ts'

/** 금고 3개면 승리, 경보 3개면 패배. 그래서 한 게임은 최대 5판이다. */
export const VAULTS_TO_WIN = 3
export const ALARMS_TO_LOSE = 3
/** 마스터 시프 모드는 경보 카드 하나를 빼고 시작한다. 두 번이면 끝이다. */
export const ALARMS_TO_LOSE_MASTER = 2

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

export type GamePhase = 'setup' | 'picking' | 'scanning' | 'showdown' | 'gameOver'

/**
 * 카드를 받자마자 다 같이 한 번씩 움직여야 하는 단계.
 *
 * 「조율가」는 넘길 카드를 각자 고르고, 「사기꾼」은 각자 자기 카드를 외운 뒤 확인한다.
 * 전원이 마쳐야 다음으로 넘어가므로, 누가 아직인지 보여야 한다.
 */
export interface SetupState {
  kind: 'pass' | 'memorize'
  /** 이미 마친 사람들. */
  done: string[]
}

/**
 * 스캔. 마지막 사람이 공개하기 전에 나머지가 답을 맞혀야 하는 상황.
 *
 * 「망막 스캔」은 숫자를, 「지문 스캔」은 족보를 묻는다. 지목당한 사람은 끼지 못하고,
 * 나머지가 모두 같은 답을 고르면 확정된다. 틀리면 순서가 맞았어도 그 판은 실패다.
 */
export interface ScanState {
  kind: 'rank' | 'category'
  /** 답을 맞혀야 하는 대상. 이 사람은 투표하지 못한다. */
  targetId: string
  /** 지금까지의 표. 서로 보이므로 말 없이도 답을 맞춰갈 수 있다. */
  votes: { playerId: string; value: number }[]
  /** 만장일치로 정해진 답. 아직이면 null. */
  decided: number | null
  correct: boolean | null
}

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

/** 해결사 카드가 카드를 나눠주자마자 알려주는 정보. */
export interface Announcement {
  playerId: string
  text: string
}

export interface GameView {
  roomCode: string
  mode: GameMode
  /** 모드에 따라 다르다. 마스터 시프는 2다. */
  alarmsToLose: number
  /** 이번 판에 걸려 있는 도전자 카드. 프로 모드는 판 내내 유지되는 것이 하나 더 있다. */
  challenges: ChallengeId[]
  /** 이번 판에 쓸 수 있는 해결사 카드. */
  specialist: SpecialistId | null
  /** 이미 썼는가. 한 판에 한 번뿐이다. */
  specialistUsed: boolean
  /** 「근육」을 맡은 사람. 같은 족보끼리는 이 사람이 이긴다. */
  muscleId: string | null
  /** 해결사가 공개한 정보. 판이 바뀌면 사라진다. */
  announcements: Announcement[]
  /** 한 사람이 받은 카드 수. 「보안 카메라」가 걸리면 3장이다. */
  holeCount: number
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
  /**
   * 한 번 주인이 정해지면 바뀌지 않는 토큰. 「소음 감지기」와 「환기구」가 만든다.
   * 집기 전부터 알아야 판단이 달라지므로, 아직 중앙에 있어도 표시된다.
   */
  stuckTokens: number[]
  /** 모두가 토큰을 쥐어서 확정 버튼이 열렸는지. */
  canConfirm: boolean
  /**
   * 감지기가 누군가의 손을 갈아엎었다는 사실. 판이 바뀌면 사라진다.
   * 조용히 바뀌면 아무도 눈치채지 못하므로 화면에 크게 알린다.
   */
  sensor: { challenge: ChallengeId; playerId: string } | null
  /** 딜 직후 다 같이 하는 단계. 끝나면 null 이 된다. */
  setup: SetupState | null
  /** 한 장을 더 받아 지금 버릴 카드를 고르고 있는 사람. */
  discardingId: string | null
  /** 스캔이 걸린 판이면 마지막 사람 차례에 이것이 열린다. */
  scan: ScanState | null
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
