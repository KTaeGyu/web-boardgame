/**
 * 게임 진행의 계약.
 *
 * 은닉 정보가 이 게임의 전부다. 그래서 공개 상태(GameView)에는 누구의 홀카드도
 * 담기지 않는다 — 본인 것조차 담지 않는다. 내 카드는 나에게만 따로 간다.
 * 쇼다운에 이르러서야 모두의 카드가 공개 상태에 실린다.
 */

import type { Card } from './cards.ts'
import type { ChallengeId, SpecialistId } from './extraCards.ts'
import type { GameMode, PokerVariant } from './protocol.ts'
import type { ShowdownResult } from './showdown.ts'

/** 금고 3개면 승리, 경보 3개면 패배. 그래서 한 게임은 최대 5판이다. */
export const VAULTS_TO_WIN = 3
export const ALARMS_TO_LOSE = 3
/** 마스터 시프 모드는 경보 카드 하나를 빼고 시작한다. 두 번이면 끝이다. */
export const ALARMS_TO_LOSE_MASTER = 2

/**
 * 「직접 고르기」에서는 몇 개를 열고 몇 번을 울리면 끝인지를 방장이 정한다.
 *
 * 하나 밑으로는 게임이 성립하지 않는다 — 첫 판이 곧 마지막 판이다. 위쪽은 다섯에서
 * 끊는다. 승과 패가 함께 커지면 판수가 둘의 합만큼 늘어, 배치표가 화면 밖으로 나간다.
 * 다른 모드는 원작 그대로 3 · 3 이고 마스터 시프만 경보가 2다.
 */
export const MIN_MARKS = 1
export const MAX_MARKS = 5

/**
 * 「직접 고르기」에서 무작위로 얹을 수 있는 도전자 수.
 *
 * 게임을 시작할 때 한 번 뽑아 끝까지 그대로 걸린다. 셋을 넘기면 고른 것과 합쳐
 * 한 판에 대여섯 장이 겹치는데, 그때부터는 카드끼리 서로 부딪힌다.
 */
export const MAX_RANDOM_CHALLENGES = 3

/**
 * 한 게임의 최대 판수 = 해결사를 앉힐 수 있는 자리의 수.
 *
 * 금고와 경보가 하나씩 모자란 채로 맞서면 그다음 판에서 어느 쪽이든 결판난다.
 * 그래서 자리는 딱 「승 + 패 - 1」이고, 그보다 뒤의 자리는 있어도 쓰이지 않는다.
 */
export function maxHeists(vaultsToWin: number, alarmsToLose: number): number {
  return vaultsToWin + alarmsToLose - 1
}

/** 기본 3 · 3 일 때의 자리 수(5). 설정의 기본값이 이 길이로 시작한다. */
export const SPECIALIST_ROUNDS = maxHeists(VAULTS_TO_WIN, ALARMS_TO_LOSE)

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
 * 모두가 토큰을 쥔 뒤 이만큼 지나면 다 같이 확정된다.
 *
 * 아무도 누르지 않아 판이 멈추는 자리를 없애려는 것이다 — 한 사람이 자리를 비우면
 * 나머지가 그 사람을 기다리는 것 말고 할 수 있는 일이 없었다.
 * **리버에서는 재지 않는다.** 마지막 선언은 되돌릴 수 없고 그 뒤가 곧 쇼다운이라,
 * 여기서만은 시간에 쫓겨 누르는 것보다 서로를 기다리는 편이 낫다.
 */
export const AUTO_CONFIRM_MS = 15_000

/** 남은 시간을 화면 한가운데 큰 숫자로 세는 구간. 5, 4, 3, 2, 1. */
export const AUTO_CONFIRM_COUNTDOWN_MS = 5_000

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
 * 「망막 스캔」은 숫자를, 「지문 스캔」은 족보를 묻는다. 둘 다 걸려 있으면 둘 다 맞혀야 한다 —
 * 그래서 물음이 하나가 아니라 여럿일 수 있다.
 * 지목당한 사람은 끼지 못하고, 나머지가 모두 같은 답을 고르면 그 물음이 확정된다.
 */
export interface ScanQuestion {
  kind: 'rank' | 'category'
  /** 지금까지의 표. 서로 보이므로 말 없이도 답을 맞춰갈 수 있다. */
  votes: { playerId: string; value: number }[]
  /** 만장일치로 정해진 답. 아직이면 null. */
  decided: number | null
  correct: boolean | null
}

export interface ScanState {
  /** 답을 맞혀야 하는 대상. 이 사람은 투표하지 못한다. */
  targetId: string
  questions: ScanQuestion[]
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
  /** 어떤 포커인가. 화면이 손을 어떻게 읽을지가 여기서 갈린다. */
  variant: PokerVariant
  mode: GameMode
  /** 몇 개를 열면 이기는가. 「직접 고르기」에서는 방장이 정하고, 나머지 모드는 3이다. */
  vaultsToWin: number
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
  /** 한 사람이 받은 카드 수. 포커 방식이 정하고, 「보안 카메라」가 걸리면 한 장 더다. */
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
   * 자동 확정까지 남은 시간(ms). 재고 있지 않으면 null 이다.
   *
   * 시각이 아니라 **남은 길이**로 보낸다. 절대 시각을 보내면 화면의 시계가 서버와
   * 몇 초씩 어긋나 있을 때 그 차이가 그대로 카운트다운에 실린다.
   */
  autoConfirmIn: number | null
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
