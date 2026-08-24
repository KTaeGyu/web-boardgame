/**
 * 게임 진행. 한 방에 하나씩 살아 있다.
 *
 * 소켓도 타이머도 모른다. 시간은 주입받고, 잠금은 「언제까지 잠겼는가」로만 적는다.
 * 그래야 토큰 잠금이나 라운드 전환을 실제로 기다리지 않고 검증할 수 있다.
 *
 * 은닉 정보는 여기서 새지 않는다. view() 는 쇼다운 전까지 누구의 홀카드도 담지 않고,
 * 내 카드를 보려면 handOf() 를 따로 물어야 한다.
 *
 * 도전자·해결사 카드는 이 안에서 규칙을 바꾼다. 어느 판에 무엇이 걸리는지는
 * ExtraDealer 가 정하고, 걸린 카드가 무엇을 하는지는 여기에 있다.
 */

import {
  ALARMS_TO_LOSE,
  ALARMS_TO_LOSE_MASTER,
  COMMUNITY_BY_ROUND,
  ROUNDS,
  TOKEN_LOCK_MS,
  VAULTS_TO_WIN,
  AUTOMATIC_SPECIALISTS,
  JACK_CARD,
  SETUP_SPECIALISTS,
  SPECIALIST_NEEDS,
  bestHolding,
  evaluateHoleAndCommunity,
  displayNames,
  freshDeck,
  judgeShowdown,
  rankLabel,
  rankOf,
  rankValueOf,
  shuffle,
  type Announcement,
  type Card,
  type ChallengeId,
  type ErrorCode,
  type GameMode,
  type GamePhase,
  type GameView,
  type Result,
  type Round,
  type ScanState,
  type SetupState,
  type ShowdownEntry,
  type ShowdownResult,
  type SpecialistId,
} from '@the-gang/shared'

import { ExtraDealer } from './extras.ts'

function err<T>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, code, message }
}

const OK: Result<null> = { ok: true, value: null }

const FACE_RANKS = new Set(['J', 'Q', 'K'])

interface Seat {
  id: string
  nickname: string
  connected: boolean
  hole: Card[]
  /** 라운드별로 확정한 토큰. 인덱스 0 이 1라운드. */
  history: (number | null)[]
  ready: boolean
}

export interface GameOptions {
  now?: () => number
  rng?: () => number
  lockMs?: number
  mode?: GameMode
  /** 「직접 고르기」에서 방장이 고른 도전자 카드. */
  pickedChallenges?: readonly ChallengeId[]
}

/** 카드가 특정 한 사람에게만 알려주는 것. 드로어의 그 카드에 적힌다. */
export interface PrivateNote {
  toId: string
  heist: number
  specialist: number
  title: string
  text?: string
  cards?: Card[]
}

export interface StartingPlayer {
  id: string
  nickname: string
  connected: boolean
}

export class Game {
  readonly roomCode: string
  private readonly now: () => number
  private readonly rng: () => number
  private readonly lockMs: number
  private readonly mode: GameMode
  private readonly alarmsToLose: number
  private readonly picked: readonly ChallengeId[]
  private dealer: ExtraDealer

  private seats: Seat[] = []
  private deck: Card[] = []
  private community: Card[] = []
  private heist = 0
  private vaults = 0
  private alarms = 0
  private round: Round = 1
  private phase: GamePhase = 'picking'
  /** 토큰 번호 → 쥐고 있는 사람. 값이 없으면 중앙에 있다. */
  private holders = new Map<number, string>()
  /** 토큰 번호 → 잠금이 풀리는 시각. 날아가는 동안 아무도 만질 수 없다. */
  private lockedUntil = new Map<number, number>()
  private showdown: ShowdownResult | null = null
  private continued = new Set<string>()
  /** 재경기에 동의한 사람들. 아무도 손을 들지 않았으면 비어 있다. */
  private rematchAgreed = new Set<string>()

  /** 이번 판에 걸린 카드들. */
  private challenges: ChallengeId[] = []
  private specialist: SpecialistId | null = null
  private specialistUsed = false
  /** 「근육」을 맡은 사람. 쇼다운에서 같은 족보끼리의 우열을 뒤집는다. */
  private muscleId: string | null = null
  private announcements: Announcement[] = []
  /** 직전 판의 결과. 다음 판에 무엇이 걸릴지가 여기서 갈린다. */
  private lastSuccess: boolean | null = null
  /**
   * 1라운드에 누가 몇 번을 쥐었는지. 「정전」이 이력을 지워도 이건 남아야 한다 —
   * 동작 감지기와 레이저 감지선이 이 값을 보고 대상을 고른다.
   */
  private roundOneTokens = new Map<string, number>()
  /** 딜 직후 다 같이 하는 단계. 「조율가」와 「사기꾼」이 쓴다. */
  private setup: { kind: 'pass' | 'memorize'; picks: Map<string, number>; done: Set<string> } | null = null
  /** 한 장을 더 받아 지금 버릴 카드를 고르고 있는 사람. */
  private discardingId: string | null = null

  /** 스캔이 열려 있는 동안의 상태. 답이 정해지면 쇼다운으로 넘어간다. */
  private scan: {
    kind: 'rank' | 'category'
    targetId: string
    votes: Map<string, number>
    decided: number | null
    correct: boolean | null
  } | null = null

  constructor(roomCode: string, players: StartingPlayer[], options: GameOptions = {}) {
    this.roomCode = roomCode
    this.now = options.now ?? Date.now
    this.rng = options.rng ?? Math.random
    this.lockMs = options.lockMs ?? TOKEN_LOCK_MS
    this.mode = options.mode ?? 'basic'
    this.alarmsToLose = this.mode === 'masterThief' ? ALARMS_TO_LOSE_MASTER : ALARMS_TO_LOSE
    this.picked = options.pickedChallenges ?? []
    this.dealer = new ExtraDealer(this.mode, this.rng, this.picked)
    this.seats = players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      connected: player.connected,
      hole: [],
      history: [],
      ready: false,
    }))
    this.startHeist()
  }

  /** 토큰 번호는 1..인원수. 원작에서 인원수보다 큰 별의 칩을 상자에 도로 넣는 것과 같다. */
  private get tokenNumbers(): number[] {
    return this.seats.map((_, index) => index + 1)
  }

  private has(challenge: ChallengeId): boolean {
    return this.challenges.includes(challenge)
  }

  // ── 판 열기 ─────────────────────────────────────────────

  private startHeist(): void {
    this.heist += 1
    const selection = this.dealer.next(this.lastSuccess)
    this.challenges = selection.challenges
    this.specialist = selection.specialist

    this.phase = 'picking'
    this.community = []
    this.showdown = null
    this.announcements = []
    // 저절로 발동하는 카드는 「쓸지 말지」를 물을 것이 없으니 이미 쓴 것으로 둔다.
    this.specialistUsed =
      this.specialist === null || AUTOMATIC_SPECIALISTS.includes(this.specialist)
    this.muscleId = null
    this.holders.clear()
    this.lockedUntil.clear()
    this.continued.clear()
    this.roundOneTokens.clear()
    this.scan = null
    this.setup = null
    this.discardingId = null

    // 한 판 안에서 같은 카드가 두 번 나오지 않도록 매 판 새 덱을 섞는다.
    this.deck = shuffle(freshDeck(), this.rng)
    const holeCount = this.holeCount
    for (const seat of this.seats) {
      seat.hole = Array.from({ length: holeCount }, () => this.draw())
      seat.history = []
      seat.ready = false
    }

    this.tellWhatTheySee()

    // 「빠른 접근」은 1라운드를 통째로 건너뛴다. 카드만 받고 바로 플롭이다.
    this.round = this.has(1) ? 2 : 1
    this.fillCommunity()

    // 다 같이 한 번씩 움직여야 하는 해결사가 있으면 토큰보다 그것이 먼저다.
    const setupKind = this.specialist === null ? undefined : SETUP_SPECIALISTS[this.specialist]
    if (setupKind) {
      this.setup = { kind: setupKind, picks: new Map(), done: new Set() }
      this.phase = 'setup'
    }
  }

  /**
   * 딜 직후 단계에서 내 몫을 마친다.
   *
   * 「조율가」는 넘길 카드를, 「사기꾼」은 「봤다」는 사실만 보낸다.
   * 전원이 마쳐야 한꺼번에 처리된다 — 먼저 낸 사람의 카드가 먼저 움직이면
   * 누가 무엇을 넘겼는지 순서로 새어 나간다.
   */
  submitSetup(playerId: string, cardIndex?: number): Result<{ notes: PrivateNote[] }> {
    if (this.phase !== 'setup' || !this.setup) return err('WRONG_PHASE', '지금 할 일이 아닙니다.')
    const seat = this.seats.find((s) => s.id === playerId)
    if (!seat) return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')

    if (this.setup.kind === 'pass') {
      if (cardIndex === undefined || cardIndex < 0 || cardIndex >= seat.hole.length) {
        return err('INVALID_TOKEN', '넘길 카드를 골라 주세요.')
      }
      this.setup.picks.set(playerId, cardIndex)
    }
    this.setup.done.add(playerId)

    const waiting = this.seats.filter((s) => s.connected && !this.setup!.done.has(s.id))
    if (waiting.length > 0) return { ok: true, value: { notes: [] } }

    const notes = this.setup.kind === 'pass' ? this.runPass() : this.runShuffle()
    this.setup = null
    this.phase = 'picking'
    return { ok: true, value: { notes } }
  }

  /** 각자 고른 한 장이 동시에 왼쪽으로 간다. */
  private runPass(): PrivateNote[] {
    const given = this.seats.map((seat) => {
      const index = this.setup!.picks.get(seat.id) ?? 0
      return seat.hole[index]
    })
    // 먼저 빼두고 한꺼번에 넣는다. 하나씩 옮기면 앞사람 자리가 어긋난다.
    this.seats.forEach((seat, index) => {
      seat.hole = seat.hole.filter((card) => card !== given[index])
    })
    return this.seats.map((seat, index) => {
      const from = (index - 1 + this.seats.length) % this.seats.length
      seat.hole.push(given[from])
      return {
        toId: seat.id,
        heist: this.heist,
        specialist: 6,
        title: '조율가',
        text: `${this.nameOf(this.seats[(index + 1) % this.seats.length].id)}에게 넘겼고, ${this.nameOf(this.seats[from].id)}에게서 받았습니다`,
        cards: [given[index], given[from]],
      }
    })
  }

  /** 전원의 카드를 모아 섞어 다시 나눈다. 외워 둔 두 장이 어딘가에 있다. */
  private runShuffle(): PrivateNote[] {
    const before = this.seats.map((seat) => [...seat.hole])
    const pool = shuffle(this.seats.flatMap((seat) => seat.hole), this.rng)

    let cursor = 0
    for (const seat of this.seats) {
      const count = seat.hole.length
      seat.hole = pool.slice(cursor, cursor + count)
      cursor += count
    }

    return this.seats.map((seat, index) => ({
      toId: seat.id,
      heist: this.heist,
      specialist: 9,
      title: '사기꾼 — 섞이기 전 내 카드',
      text: '이 카드들은 지금 누군가의 손에 있습니다.',
      cards: before[index],
    }))
  }

  /** 한 장을 더 받은 사람이 버릴 카드를 고른다. */
  discard(playerId: string, cardIndex: number): Result<{ note: PrivateNote | null }> {
    if (this.discardingId !== playerId) return err('WRONG_PHASE', '버릴 카드를 고를 차례가 아닙니다.')
    const seat = this.seats.find((s) => s.id === playerId)
    if (!seat) return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')
    if (cardIndex < 0 || cardIndex >= seat.hole.length) return err('INVALID_TOKEN', '버릴 카드를 골라 주세요.')

    seat.hole = seat.hole.filter((_, index) => index !== cardIndex)
    this.discardingId = null
    return {
      ok: true,
      value: {
        note: {
          toId: playerId,
          heist: this.heist,
          specialist: this.specialist ?? 0,
          title: '내 카드',
          cards: [...seat.hole],
        },
      },
    }
  }

  /** 「보안 카메라」가 걸리면 세 장씩 받는다. */
  private get holeCount(): number {
    return this.has(10) ? 3 : 2
  }

  private draw(): Card {
    const card = this.deck.pop()
    if (!card) throw new Error('덱이 비었다 — 인원수 계산이 잘못됐다')
    return card
  }

  private fillCommunity(): void {
    while (this.community.length < COMMUNITY_BY_ROUND[this.round]) this.community.push(this.draw())
  }

  /** 카드를 받자마자 저절로 밝혀지는 해결사 효과. */
  private tellWhatTheySee(): void {
    if (this.specialist !== 3 && this.specialist !== 8) return
    const names = displayNames(this.seats.map((seat) => seat.nickname))

    this.announcements = this.seats.map((seat, index) => {
      if (this.specialist === 3) {
        const faces = seat.hole.filter((card) => FACE_RANKS.has(rankOf(card))).length
        return { playerId: seat.id, text: `${names[index]} — 그림카드 ${faces}장` }
      }
      // 계산가: 2~10 은 그대로, J·Q·K 는 10, A 는 11.
      const sum = seat.hole.reduce((total, card) => {
        const value = rankValueOf(card)
        return total + (value === 14 ? 11 : Math.min(value, 10))
      }, 0)
      return { playerId: seat.id, text: `${names[index]} — 합 ${sum}` }
    })
  }

  /** 화면에 부를 이름. 여러 곳에서 같은 이름을 써야 한다. */
  private nameOf(playerId: string): string {
    const names = displayNames(this.seats.map((seat) => seat.nickname))
    const index = this.seats.findIndex((seat) => seat.id === playerId)
    return index < 0 ? '?' : names[index]
  }

  /**
   * 해결사 카드를 쓴다. 누른 사람이 곧 쓰는 사람이다.
   *
   * 원작은 「누가 언제 쓸지 다 같이 정한다」인데, 말을 주고받을 수 없는 자리에서는
   * 합의 절차를 따로 만들어야 한다. 지금은 먼저 누른 사람이 쓰고 한 판에 한 번만 쓰인다.
   * 결과로 무엇을 밖에 알려야 하는지 돌려준다 — 몰래 보여주는 카드가 있기 때문이다.
   */
  useSpecialist(
    playerId: string,
    input: { targetId?: string; value?: number; cardIndex?: number },
  ): Result<{ note: PrivateNote | null }> {
    if (this.phase !== 'picking') return err('WRONG_PHASE', '지금은 쓸 수 없습니다.')
    if (this.specialist === null) return err('WRONG_PHASE', '이번 판에는 해결사 카드가 없습니다.')
    if (this.specialistUsed) return err('WRONG_PHASE', '이미 쓴 카드입니다.')

    const actor = this.seats.find((s) => s.id === playerId)
    if (!actor) return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')

    const needs = SPECIALIST_NEEDS[this.specialist]
    const target = needs.target ? this.seats.find((s) => s.id === input.targetId) : undefined
    if (needs.target && !target) return err('INVALID_TOKEN', '대상을 골라 주세요.')
    if (needs.value && (input.value === undefined || input.value < 2 || input.value > 14)) {
      return err('INVALID_TOKEN', '숫자를 골라 주세요.')
    }
    const cardIndex = input.cardIndex ?? -1
    if (needs.ownCard && (cardIndex < 0 || cardIndex >= actor.hole.length)) {
      return err('INVALID_TOKEN', '보여줄 카드를 골라 주세요.')
    }

    let note: PrivateNote | null = null
    const say = (text: string) => this.announcements.push({ playerId, text })

    switch (this.specialist) {
      case 1: {
        // 무엇을 보여줬는지는 본 사람만 안다. 모두에게는 「보여줬다」는 사실만 남는다.
        note = {
          toId: target!.id,
          heist: this.heist,
          specialist: 1,
          title: `${this.nameOf(playerId)}의 카드`,
          cards: [actor.hole[cardIndex]],
        }
        say(`${this.nameOf(playerId)} → ${this.nameOf(target!.id)}에게 카드 한 장을 보여줬습니다`)
        break
      }
      case 2: {
        // 족보 이름만. 「원 페어」까지고 무슨 페어인지는 밝히지 않는다.
        const holding = bestHolding([...actor.hole, ...this.community])
        say(`${this.nameOf(playerId)} — ${holding?.name ?? '알 수 없음'}`)
        break
      }
      case 4: {
        const count = target!.hole.filter((card) => rankValueOf(card) === input.value).length
        say(`${this.nameOf(target!.id)} — ${rankLabel(input.value!)} ${count}장`)
        break
      }
      case 5: {
        // 한 장을 더 받는다. 무엇을 버릴지는 새 카드를 보고 나서 고른다.
        actor.hole.push(this.draw())
        this.discardingId = playerId
        note = {
          toId: playerId,
          heist: this.heist,
          specialist: 5,
          title: '해커 — 한 장을 더 받았습니다',
          text: '이 중 한 장을 버립니다.',
          cards: [...actor.hole],
        }
        say(`${this.nameOf(playerId)}가 카드를 한 장 더 받았습니다`)
        break
      }
      case 7: {
        actor.hole.push(JACK_CARD)
        this.discardingId = playerId
        note = {
          toId: playerId,
          heist: this.heist,
          specialist: 7,
          title: '잭 — 무늬 없는 J 를 받았습니다',
          text: '이 중 한 장을 버립니다. 무늬가 없어 플러시에는 쓸 수 없습니다.',
          cards: [...actor.hole],
        }
        say(`${this.nameOf(playerId)}가 무늬 없는 J 를 받았습니다`)
        break
      }
      case 10: {
        this.muscleId = playerId
        say(`${this.nameOf(playerId)}가 근육을 맡았습니다 — 같은 족보끼리는 이깁니다`)
        break
      }
      default:
        return err('WRONG_PHASE', '아직 쓸 수 없는 카드입니다.')
    }

    this.specialistUsed = true
    return { ok: true, value: { note } }
  }

  // ── 사람의 입력 ──────────────────────────────────────────

  /**
   * 토큰을 집는다. 중앙에서 집든 남에게서 뺏든 같은 동작이다.
   *
   * 순서는 도착 순이 곧 정답이다. Node 가 한 번에 하나씩 처리하므로
   * 먼저 도착한 요청이 이기고, 진 쪽은 잠금에 걸려 거절된다.
   */
  takeToken(playerId: string, token: number): Result<null> {
    if (this.phase !== 'picking') return err('WRONG_PHASE', '지금은 토큰을 집을 수 없습니다.')

    const seat = this.seats.find((s) => s.id === playerId)
    if (!seat) return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')
    if (!this.tokenNumbers.includes(token)) return err('INVALID_TOKEN', '없는 토큰입니다.')

    const now = this.now()
    if (this.isLocked(token, now)) return err('TOKEN_LOCKED', '방금 움직인 토큰입니다.')

    const holder = this.holders.get(token)
    if (holder === playerId) return err('INVALID_TOKEN', '이미 쥐고 있는 토큰입니다.')

    // 붙박이 토큰은 한 번 주인이 정해지면 그 판단을 되돌릴 수 없다.
    const stuck = this.stuckTokens()
    if (holder !== undefined && stuck.includes(token)) {
      return err('TOKEN_LOCKED', '이 토큰은 한 번 정해지면 바꿀 수 없습니다.')
    }

    // 내가 쥐고 있던 토큰은 중앙으로 돌아간다. 그것도 날아가는 중이라 함께 잠근다.
    const mine = this.tokenOf(playerId)
    if (mine !== null) {
      if (stuck.includes(mine)) {
        return err('TOKEN_LOCKED', '쥐고 있는 토큰이 붙박이라 다른 토큰을 집을 수 없습니다.')
      }
      if (this.isLocked(mine, now)) return err('TOKEN_LOCKED', '방금 움직인 토큰입니다.')
      this.holders.delete(mine)
      this.lockedUntil.set(mine, now + this.lockMs)
    }

    this.holders.set(token, playerId)
    this.lockedUntil.set(token, now + this.lockMs)

    // 배치가 바뀌면 모두의 확정이 풀린다. 남의 판단이 달라졌을 수 있기 때문이다.
    for (const s of this.seats) s.ready = false
    return OK
  }

  setReady(playerId: string, ready: boolean): Result<null> {
    if (this.phase !== 'picking') return err('WRONG_PHASE', '지금은 확정할 수 없습니다.')

    const seat = this.seats.find((s) => s.id === playerId)
    if (!seat) return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')
    if (ready && !this.everyoneHasToken()) {
      return err('WRONG_PHASE', '모두가 토큰을 가져가야 확정할 수 있습니다.')
    }
    if (ready && this.discardingId !== null) {
      return err('WRONG_PHASE', '버릴 카드를 고르는 사람이 있습니다.')
    }

    seat.ready = ready
    if (this.seats.every((s) => s.ready)) this.advanceRound()
    return OK
  }

  /** 쇼다운을 다 본 뒤 다음 판으로. 접속 중인 사람이 모두 눌러야 넘어간다. */
  continueAfterHeist(playerId: string): Result<null> {
    if (this.phase !== 'showdown') return err('WRONG_PHASE', '아직 판이 끝나지 않았습니다.')
    if (!this.seats.some((s) => s.id === playerId)) {
      return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')
    }

    this.continued.add(playerId)
    const waiting = this.seats.filter((s) => s.connected && !this.continued.has(s.id))
    if (waiting.length === 0) this.startHeist()
    return OK
  }

  /**
   * 재경기 합의. 처음 동의한 사람이 제안자가 되고, 나머지에게 물음이 뜬다.
   * 한 명이라도 거절하면 방을 닫는다 — 그 판단은 소켓 계층이 실행한다.
   */
  proposeRematch(playerId: string, agree: boolean): Result<'pending' | 'restart' | 'declined'> {
    if (this.phase !== 'gameOver') return err('WRONG_PHASE', '아직 게임이 끝나지 않았습니다.')
    if (!this.seats.some((s) => s.id === playerId)) {
      return err('NOT_IN_ROOM', '이 게임에 참여하고 있지 않습니다.')
    }
    if (!agree) return { ok: true, value: 'declined' }

    this.rematchAgreed.add(playerId)
    const waiting = this.seats.filter((s) => s.connected && !this.rematchAgreed.has(s.id))
    if (waiting.length > 0) return { ok: true, value: 'pending' }

    this.restart()
    return { ok: true, value: 'restart' }
  }

  /** 같은 사람들로 처음부터. 금고와 경보를 지우고 카드 더미도 새로 쌓는다. */
  private restart(): void {
    this.heist = 0
    this.vaults = 0
    this.alarms = 0
    this.lastSuccess = null
    this.rematchAgreed.clear()
    this.dealer = new ExtraDealer(this.mode, this.rng, this.picked)
    this.startHeist()
  }

  /** 끊긴 사람이 있으면 라운드가 넘어가지 않는다. 그 사실이 화면에 보여야 한다. */
  setConnected(playerId: string, connected: boolean): void {
    const seat = this.seats.find((s) => s.id === playerId)
    if (seat) seat.connected = connected
  }

  // ── 진행 ────────────────────────────────────────────────

  private advanceRound(): void {
    const finished = this.round

    // 이번 라운드에 쥔 토큰을 이력으로 굳힌다. 다음 라운드는 새 색으로 다시 시작한다.
    for (const seat of this.seats) {
      seat.history[finished - 1] = this.tokenOf(seat.id)
      seat.ready = false
    }
    if (finished === 1) {
      this.roundOneTokens = new Map(this.seats.map((seat) => [seat.id, this.tokenOf(seat.id) ?? 0]))
    }

    if (finished === 4) {
      // 스캔이 걸려 있으면 마지막 사람이 공개하기 전에 답을 정해야 한다.
      const scanning = this.has(4) ? 'rank' : this.has(9) ? 'category' : null
      if (scanning) this.beginScan(scanning)
      else this.runShowdown()
      return
    }

    // 「급한 도주」는 3라운드의 토큰 배분을 건너뛴다. 카드만 열리고 마지막 라운드로.
    this.round = (finished === 2 && this.has(5) ? 4 : finished + 1) as Round
    this.holders.clear()
    this.lockedUntil.clear()
    this.fillCommunity()

    // 「정전」은 지난 라운드 토큰을 치운다. 이력이 남지 않아 기억에 기대야 한다.
    if (this.has(8)) {
      for (const seat of this.seats) {
        for (let round = 1; round < this.round && round <= 3; round++) seat.history[round - 1] = null
      }
    }

    if (this.round === 2) this.checkSensors()
  }

  /**
   * 2라운드에 열린 카드를 보고 누군가의 손을 갈아엎는다.
   *
   * 동작 감지기는 그림카드가 있을 때 가장 약하다고 말한 사람을,
   * 레이저 감지선은 그림카드가 없을 때 가장 세다고 말한 사람을 친다.
   * 1라운드가 통째로 없었다면(빠른 접근) 대상을 고를 수 없으므로 아무 일도 없다.
   */
  private checkSensors(): void {
    if (this.roundOneTokens.size === 0) return

    const flopHasFace = this.community.slice(0, 3).some((card) => FACE_RANKS.has(rankOf(card)))
    let target: number | null = null
    if (this.has(3) && flopHasFace) target = 1
    if (this.has(7) && !flopHasFace) target = this.seats.length
    if (target === null) return

    const victimId = [...this.roundOneTokens].find(([, token]) => token === target)?.[0]
    const victim = this.seats.find((seat) => seat.id === victimId)
    if (!victim) return
    victim.hole = victim.hole.map(() => this.draw())
  }

  /**
   * 마지막 사람을 빼고 먼저 공개한다.
   *
   * 대상의 카드는 답이 정해질 때까지 어디로도 나가지 않는다. 미리 보낸 뒤에
   * 화면에서만 가리면, 통신을 들여다보는 것만으로 답을 알 수 있게 된다.
   */
  private beginScan(kind: 'rank' | 'category'): void {
    const ordered = [...this.seats].sort((a, b) => (a.history[3] ?? 0) - (b.history[3] ?? 0))
    const target = ordered[ordered.length - 1]

    this.scan = { kind, targetId: target.id, votes: new Map(), decided: null, correct: null }
    this.phase = 'scanning'
    // 먼저 공개되는 사람들끼리의 순서는 이 시점에 이미 판정할 수 있다.
    this.showdown = judgeShowdown(
      ordered.slice(0, -1).map((seat) => ({
        playerId: seat.id,
        token: seat.history[3] ?? 0,
        hole: seat.hole,
      })),
      this.community,
      { muscleId: this.muscleId },
    )
  }

  /** 스캔에 답한다. 대상을 뺀 접속자 전원이 같은 답을 고르면 확정된다. */
  voteScan(playerId: string, value: number): Result<null> {
    if (this.phase !== 'scanning' || !this.scan) return err('WRONG_PHASE', '지금은 답할 수 없습니다.')
    if (playerId === this.scan.targetId) {
      return err('WRONG_PHASE', '지목된 사람은 답할 수 없습니다.')
    }
    if (!this.seats.some((s) => s.id === playerId)) {
      return err('NOT_IN_ROOM', '이 판에 참여하고 있지 않습니다.')
    }
    if (!Number.isInteger(value)) return err('INVALID_TOKEN', '답을 골라 주세요.')

    this.scan.votes.set(playerId, value)

    const voters = this.seats.filter((s) => s.connected && s.id !== this.scan!.targetId)
    const answers = voters.map((s) => this.scan!.votes.get(s.id))
    const allIn = answers.every((answer) => answer !== undefined)
    const agreed = allIn && new Set(answers).size === 1
    if (agreed) this.settleScan(answers[0]!)
    return OK
  }

  private settleScan(value: number): void {
    if (!this.scan) return
    const target = this.seats.find((s) => s.id === this.scan!.targetId)
    if (!target) return

    this.scan.decided = value
    this.scan.correct =
      this.scan.kind === 'rank'
        ? target.hole.some((card) => rankValueOf(card) === value)
        : evaluateHoleAndCommunity(target.hole, this.community).category === value

    this.runShowdown()
  }

  private runShowdown(): void {
    const entries: ShowdownEntry[] = this.seats.map((seat) => ({
      playerId: seat.id,
      token: seat.history[3] ?? 0,
      hole: seat.hole,
    }))

    const judged = judgeShowdown(entries, this.community, { muscleId: this.muscleId })
    // 스캔을 틀리면 순서가 맞았어도 그 판은 실패다.
    const scanOk = this.scan === null || this.scan.correct === true
    this.showdown = { ...judged, success: judged.success && scanOk }
    this.lastSuccess = this.showdown.success
    if (this.showdown.success) this.vaults += 1
    else this.alarms += 1

    this.phase =
      this.vaults >= VAULTS_TO_WIN || this.alarms >= this.alarmsToLose ? 'gameOver' : 'showdown'
  }

  // ── 상태 읽기 ───────────────────────────────────────────

  /** 한 번 주인이 정해지면 바뀌지 않는 토큰. 1~3라운드에만 있다. */
  private stuckTokens(): number[] {
    if (this.round > 3) return []
    const stuck: number[] = []
    if (this.has(2)) stuck.push(1)
    if (this.has(6)) stuck.push(this.seats.length)
    return stuck
  }

  private isLocked(token: number, now: number): boolean {
    return (this.lockedUntil.get(token) ?? 0) > now
  }

  private tokenOf(playerId: string): number | null {
    for (const [token, holder] of this.holders) {
      if (holder === playerId) return token
    }
    return null
  }

  private everyoneHasToken(): boolean {
    return this.seats.every((seat) => this.tokenOf(seat.id) !== null)
  }

  get isOver(): boolean {
    return this.phase === 'gameOver'
  }

  get outcome(): 'win' | 'lose' | null {
    if (this.vaults >= VAULTS_TO_WIN) return 'win'
    if (this.alarms >= this.alarmsToLose) return 'lose'
    return null
  }

  /** 나에게만 가는 내 카드. 이 통로 말고는 홀카드가 밖으로 나가지 않는다. */
  handOf(playerId: string): Card[] | null {
    const seat = this.seats.find((s) => s.id === playerId)
    return seat ? [...seat.hole] : null
  }

  private setupView(): SetupState | null {
    if (!this.setup) return null
    return { kind: this.setup.kind, done: [...this.setup.done] }
  }

  private scanView(): ScanState | null {
    if (!this.scan) return null
    return {
      kind: this.scan.kind,
      targetId: this.scan.targetId,
      votes: [...this.scan.votes].map(([playerId, value]) => ({ playerId, value })),
      decided: this.scan.decided,
      correct: this.scan.correct,
    }
  }

  /** 모두가 보는 상태. 쇼다운 전에는 어떤 홀카드도 담지 않는다. */
  view(): GameView {
    const now = this.now()
    const revealed = this.phase !== 'picking'
    const names = displayNames(this.seats.map((seat) => seat.nickname))
    const stuck = this.stuckTokens()

    return {
      roomCode: this.roomCode,
      mode: this.mode,
      alarmsToLose: this.alarmsToLose,
      challenges: [...this.challenges],
      specialist: this.specialist,
      specialistUsed: this.specialistUsed,
      muscleId: this.muscleId,
      announcements: [...this.announcements],
      holeCount: this.holeCount,
      heist: this.heist,
      vaults: this.vaults,
      alarms: this.alarms,
      round: this.round,
      phase: this.phase,
      community: [...this.community],
      players: this.seats.map((seat, index) => ({
        id: seat.id,
        nickname: seat.nickname,
        displayName: names[index],
        connected: seat.connected,
        currentToken: this.tokenOf(seat.id),
        history: ROUNDS.map((round) => seat.history[round - 1] ?? null),
        ready: seat.ready,
        // 스캔 중에는 지목된 사람의 카드가 아직 아무 데도 나가지 않는다.
        hole:
          revealed && !(this.phase === 'scanning' && seat.id === this.scan?.targetId)
            ? [...seat.hole]
            : null,
      })),
      centerTokens: this.tokenNumbers.filter((token) => !this.holders.has(token)),
      // 붙박이 토큰은 주인이 정해진 뒤로는 만질 수 없으니 잠긴 것으로 보인다.
      lockedTokens: this.tokenNumbers.filter(
        (token) => this.isLocked(token, now) || (stuck.includes(token) && this.holders.has(token)),
      ),
      canConfirm: this.phase === 'picking' && this.everyoneHasToken(),
      setup: this.setupView(),
      discardingId: this.discardingId,
      scan: this.scanView(),
      showdown: this.showdown,
      continued: [...this.continued],
      outcome: this.outcome,
      rematch: { proposed: this.rematchAgreed.size > 0, agreed: [...this.rematchAgreed] },
    }
  }
}
