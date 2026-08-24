/**
 * 게임 진행. 한 방에 하나씩 살아 있다.
 *
 * 소켓도 타이머도 모른다. 시간은 주입받고, 잠금은 「언제까지 잠겼는가」로만 적는다.
 * 그래야 토큰 잠금이나 라운드 전환을 실제로 기다리지 않고 검증할 수 있다.
 *
 * 은닉 정보는 여기서 새지 않는다. view() 는 쇼다운 전까지 누구의 홀카드도 담지 않고,
 * 내 카드를 보려면 handOf() 를 따로 물어야 한다.
 */

import {
  ALARMS_TO_LOSE,
  COMMUNITY_BY_ROUND,
  ROUNDS,
  TOKEN_LOCK_MS,
  VAULTS_TO_WIN,
  freshDeck,
  judgeShowdown,
  shuffle,
  type Card,
  type ErrorCode,
  type GamePhase,
  type GameView,
  type Result,
  type Round,
  type ShowdownEntry,
  type ShowdownResult,
} from '@the-gang/shared'

function err<T>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, code, message }
}

const OK: Result<null> = { ok: true, value: null }

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

  constructor(roomCode: string, players: StartingPlayer[], options: GameOptions = {}) {
    this.roomCode = roomCode
    this.now = options.now ?? Date.now
    this.rng = options.rng ?? Math.random
    this.lockMs = options.lockMs ?? TOKEN_LOCK_MS
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

  private startHeist(): void {
    this.heist += 1
    this.round = 1
    this.phase = 'picking'
    this.community = []
    this.showdown = null
    this.holders.clear()
    this.lockedUntil.clear()
    this.continued.clear()

    // 한 판 안에서 같은 카드가 두 번 나오지 않도록 매 판 새 덱을 섞는다.
    this.deck = shuffle(freshDeck(), this.rng)
    for (const seat of this.seats) {
      seat.hole = [this.draw(), this.draw()]
      seat.history = []
      seat.ready = false
    }
  }

  private draw(): Card {
    const card = this.deck.pop()
    if (!card) throw new Error('덱이 비었다 — 인원수 계산이 잘못됐다')
    return card
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

    // 내가 쥐고 있던 토큰은 중앙으로 돌아간다. 그것도 날아가는 중이라 함께 잠근다.
    const mine = this.tokenOf(playerId)
    if (mine !== null) {
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

  /** 같은 사람들로 처음부터. 금고와 경보를 지우고 첫 판을 다시 연다. */
  private restart(): void {
    this.heist = 0
    this.vaults = 0
    this.alarms = 0
    this.rematchAgreed.clear()
    this.startHeist()
  }

  /** 끊긴 사람이 있으면 라운드가 넘어가지 않는다. 그 사실이 화면에 보여야 한다. */
  setConnected(playerId: string, connected: boolean): void {
    const seat = this.seats.find((s) => s.id === playerId)
    if (seat) seat.connected = connected
  }

  // ── 진행 ────────────────────────────────────────────────

  private advanceRound(): void {
    // 이번 라운드에 쥔 토큰을 이력으로 굳힌다. 다음 라운드는 새 색으로 다시 시작한다.
    for (const seat of this.seats) {
      seat.history[this.round - 1] = this.tokenOf(seat.id)
      seat.ready = false
    }

    if (this.round === 4) {
      this.runShowdown()
      return
    }

    this.round = (this.round + 1) as Round
    this.holders.clear()
    this.lockedUntil.clear()

    // 라운드가 열릴 때 커뮤니티 카드가 깔린다. 플롭은 세 장, 턴과 리버는 한 장씩.
    while (this.community.length < COMMUNITY_BY_ROUND[this.round]) this.community.push(this.draw())
  }

  private runShowdown(): void {
    const entries: ShowdownEntry[] = this.seats.map((seat) => ({
      playerId: seat.id,
      token: seat.history[3] ?? 0,
      hole: seat.hole,
    }))

    this.showdown = judgeShowdown(entries, this.community)
    if (this.showdown.success) this.vaults += 1
    else this.alarms += 1

    this.phase = this.vaults >= VAULTS_TO_WIN || this.alarms >= ALARMS_TO_LOSE ? 'gameOver' : 'showdown'
  }

  // ── 상태 읽기 ───────────────────────────────────────────

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
    if (this.alarms >= ALARMS_TO_LOSE) return 'lose'
    return null
  }

  /** 나에게만 가는 내 카드. 이 통로 말고는 홀카드가 밖으로 나가지 않는다. */
  handOf(playerId: string): Card[] | null {
    const seat = this.seats.find((s) => s.id === playerId)
    return seat ? [...seat.hole] : null
  }

  /** 모두가 보는 상태. 쇼다운 전에는 어떤 홀카드도 담지 않는다. */
  view(): GameView {
    const now = this.now()
    const revealed = this.phase !== 'picking'

    return {
      roomCode: this.roomCode,
      heist: this.heist,
      vaults: this.vaults,
      alarms: this.alarms,
      round: this.round,
      phase: this.phase,
      community: [...this.community],
      players: this.seats.map((seat) => ({
        id: seat.id,
        nickname: seat.nickname,
        connected: seat.connected,
        currentToken: this.tokenOf(seat.id),
        history: ROUNDS.map((round) => seat.history[round - 1] ?? null),
        ready: seat.ready,
        hole: revealed ? [...seat.hole] : null,
      })),
      centerTokens: this.tokenNumbers.filter((token) => !this.holders.has(token)),
      lockedTokens: this.tokenNumbers.filter((token) => this.isLocked(token, now)),
      canConfirm: this.phase === 'picking' && this.everyoneHasToken(),
      showdown: this.showdown,
      continued: [...this.continued],
      outcome: this.outcome,
      rematch: { proposed: this.rematchAgreed.size > 0, agreed: [...this.rematchAgreed] },
    }
  }
}
