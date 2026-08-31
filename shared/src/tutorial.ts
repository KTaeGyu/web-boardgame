/**
 * 혼자 해보는 판.
 *
 * 규칙은 하나도 새로 쓰지 않는다 — 봇도 Game 안에서는 그냥 자리 하나다. 여기 있는 것은
 * 「봇이 언제 무엇을 누르는가」와 「어디서 멈춰 무엇을 알려주는가」뿐이다.
 *
 * 봇은 서로의 패를 안다. 그래서 봇끼리는 순서를 틀리지 않고, 서로의 토큰을 뺏지도 않는다.
 * 사람만이 틀릴 수 있고, 사람이 봇의 토큰을 뺏으면 봇은 군말 없이 남은 것에서 다시 고른다.
 *
 * 안내가 떠 있는 동안에는 판이 멈춘다. 읽는 사이에 봇이 움직이면 무엇을 읽었는지와
 * 화면에 무슨 일이 벌어졌는지가 어긋난다.
 */

import {
  compareHands,
  evaluateHoleAndCommunity,
  freshDeck,
  shuffle,
  type Card,
  type GameView,
} from '@the-gang/shared'

import type { Game } from './engine.ts'

/**
 * 봇이 한 번 움직이기까지 두는 사이.
 *
 * 3초로 두었더니 한 라운드에 봇 대기만 12초였다 — 집기 둘, 확정 둘. 배우는 사람이
 * 멍하니 기다리는 시간이 되어 1초로 줄였다. 「생각하고 움직인다」는 느낌은 그대로 남는다.
 */
export const BOT_DELAY_MS = 1000

/** 백분위를 어림하는 표본 수. 늘려도 판단이 크게 달라지지 않는다. */
const SAMPLES = 120

const RANK_ORDER = '23456789TJQKA'

export interface TutorialTip {
  title: string
  text: string
  /**
   * 읽고 나서 바로 할 일. 화면의 어디를 누르라는 말이다.
   *
   * 규칙만 적어두면 처음 하는 사람은 안내를 닫은 자리에서 멈춘다 — 토큰을 눌러야
   * 가져온다는 것조차 어디에도 적혀 있지 않았다.
   */
  action: string
  /** 이 안내를 띄울 때인가. 위에서부터 차례로 한 번씩만 뜬다. */
  when: (view: GameView, humanId: string) => boolean
}

/**
 * 안내 대본.
 *
 * 규칙 설명이 중심이고, 공략에서 가져온 요령은 그 규칙을 처음 쓰는 자리에 얹었다.
 * 「지금 패 기준으로 집기」는 첫 선언에, 「완성되면 올리기」는 공용 카드가 처음 깔릴 때다.
 */
export const TIPS: TutorialTip[] = [
  {
    title: '말하지 않고 맞추는 게임입니다',
    text:
      '카드 이야기는 금지입니다. 「내 거 좋아」도 안 됩니다. 할 수 있는 말은 토큰 하나뿐입니다.\n\n' +
      '지금 받은 두 장과, 곧 가운데 깔릴 공용 카드를 합쳐 가장 센 다섯 장이 내 손입니다.',
    action: '가운데 놓인 토큰 중 하나를 눌러 가져오세요.',
    when: (view) => view.round === 1,
  },
  {
    title: '토큰은 순위 선언입니다',
    text:
      '작은 번호는 「내가 제일 약하다」, 큰 번호는 「내가 제일 세다」는 뜻입니다.\n\n' +
      '지금 내 패를 기준으로 집으세요. 나중에 좋아질 것 같다고 미리 큰 번호를 집으면, ' +
      '그 선언을 믿고 자기 자리를 정한 사람들이 통째로 어긋납니다.',
    action:
      '번호를 바꾸려면 다른 토큰을 누르고, 아예 물리려면 쥔 토큰을 다시 누르세요. ' +
      '모두가 하나씩 쥐면 아래 「확정」이 열립니다.',
    when: (view, humanId) =>
      view.round === 1 &&
      view.players.some((player) => player.id === humanId && player.currentToken !== null),
  },
  {
    title: '공용 카드 세 장이 깔렸습니다',
    text:
      '라운드마다 순위를 다시 정합니다. 남이 쥔 토큰도 뺏을 수 있고, 뺏긴 사람은 남은 것에서 다시 고릅니다.\n\n' +
      '족보가 완성됐다면 숫자를 올리고, 아직이라면 그대로 두는 편이 좋습니다. ' +
      '나를 앞지른 사람이 생겼다면 하나 내려 자리를 비켜주는 것도 방법입니다.',
    action: '바꿀 번호가 있으면 그 토큰을 누르고, 그대로 갈 거면 「확정」을 누르세요.',
    when: (view) => view.round === 2,
  },
  {
    title: '네 번째 카드입니다',
    text: '남은 선언이 두 번뿐입니다. 확신이 섰다면 자리를 굳히고, 아니라면 아직 바꿀 수 있습니다.',
    action: '토큰을 정하고 「확정」을 누르세요.',
    when: (view) => view.round === 3,
  },
  {
    title: '마지막 카드입니다',
    text: '이번이 마지막 선언입니다. 모두가 확정하면 카드를 공개합니다.',
    action: '마지막 번호를 정하고 「확정」을 누르세요.',
    when: (view) => view.round === 4,
  },
  {
    title: '토큰 순서대로 공개합니다',
    text:
      '가장 작은 번호부터 한 사람씩 뒤집습니다. 약한 손에서 센 손으로 이어지면 금고가 열리고, ' +
      '한 번이라도 순서가 어긋나면 경보가 울립니다.',
    action: '안내를 닫고 공개를 지켜보세요. 다 열리면 「나가기」로 연습을 마칩니다.',
    when: (view) => view.phase !== 'picking',
  },
]

interface Bot {
  id: string
  /** 이번 판에서 이 봇의 손. 상대의 것도 알고 있으므로 순서를 틀리지 않는다. */
  hole: Card[]
}

export interface TutorialHooks {
  /** 봇이 무언가 눌렀다. 화면을 새로 보내야 한다. */
  onMoved: () => void
  /** 여기서 멈춘다. 사람이 닫을 때까지 봇은 움직이지 않는다. */
  onTip: (payload: { step: number; total: number; title: string; text: string; action: string }) => void
}

/**
 * 한 튜토리얼 방의 진행자.
 *
 * 스스로 판을 들여다보고 다음 한 수를 예약한다. 예약은 언제나 하나뿐이라,
 * 사람이 중간에 토큰을 뺏어도 그 다음 상태에서 다시 생각한다.
 */
export class Tutorial {
  private readonly game: Game
  private readonly bots: Bot[]
  private readonly humanId: string
  private readonly hooks: TutorialHooks
  private readonly delayMs: number

  private timer: NodeJS.Timeout | null = null
  private fired = 0
  private waiting = false
  private stopped = false

  constructor(
    game: Game,
    humanId: string,
    botIds: string[],
    hooks: TutorialHooks,
    options: { delayMs?: number } = {},
  ) {
    this.game = game
    this.humanId = humanId
    this.hooks = hooks
    this.delayMs = options.delayMs ?? BOT_DELAY_MS
    this.bots = botIds.map((id) => ({ id, hole: game.handOf(id) ?? [] }))
  }

  /** 상태가 달라졌다. 알릴 것이 있으면 멈추고, 없으면 다음 한 수를 예약한다. */
  poke(): void {
    if (this.stopped) return
    this.clear()
    // 손패는 판이 바뀌면 갈린다. 봇이 아는 것도 그때 함께 갱신한다.
    for (const bot of this.bots) bot.hole = this.game.handOf(bot.id) ?? bot.hole

    const view = this.game.view()
    const tip = TIPS[this.fired]
    if (tip && tip.when(view, this.humanId)) {
      this.fired += 1
      this.waiting = true
      this.hooks.onTip({
        step: this.fired,
        total: TIPS.length,
        title: tip.title,
        text: tip.text,
        action: tip.action,
      })
      return
    }
    if (this.waiting) return

    this.timer = setTimeout(() => {
      this.timer = null
      if (this.act()) this.hooks.onMoved()
    }, this.delayMs)
  }

  /** 안내를 닫았다. 멈춰 있던 흐름을 잇는다. */
  resume(): void {
    this.waiting = false
    this.poke()
  }

  stop(): void {
    this.stopped = true
    this.clear()
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /**
   * 봇 한 명이 한 번 움직인다. 언제나 센 봇이 먼저다 — 뒤에 오는 봇이 앞의 선언을 보고
   * 자기 자리를 그 아래로 잡아야 둘의 순서가 어긋나지 않는다.
   */
  private act(): boolean {
    const view = this.game.view()
    if (view.phase !== 'picking') return false

    const ordered = [...this.bots].sort((a, b) => this.strength(b, view) - this.strength(a, view))

    for (const bot of ordered) {
      const seat = view.players.find((player) => player.id === bot.id)
      if (!seat || seat.currentToken !== null) continue
      const token = this.chooseToken(view, bot, ordered)
      if (token !== null && this.game.takeToken(bot.id, token).ok) return true
    }

    // 모두 자리를 잡았으면 확정한다. 사람이 아직이면 사람을 기다리는 모양이 된다.
    if (view.canConfirm) {
      for (const bot of ordered) {
        const seat = view.players.find((player) => player.id === bot.id)
        if (seat && !seat.ready && this.game.setReady(bot.id, true).ok) return true
      }
    }
    return false
  }

  /** 지금 이 봇의 손이 얼마나 센가. 봇끼리의 순서를 정하는 데만 쓴다. */
  private strength(bot: Bot, view: GameView): number {
    if (view.community.length === 0) {
      const ranks = bot.hole.map((card) => RANK_ORDER.indexOf(card[0]))
      const pair = bot.hole.length === 2 && bot.hole[0][0] === bot.hole[1][0]
      return Math.max(0, ...ranks) + (pair ? 20 : 0)
    }
    const value = evaluateHoleAndCommunity(bot.hole, view.community)
    return value.score.reduce((acc, part, index) => acc + part / Math.pow(64, index), 0)
  }

  /**
   * 어느 번호를 집을 것인가.
   *
   * 「전체 확률 중 내 손이 어디쯤인가」를 표본으로 어림한다 — 남은 카드에서 상대 손을
   * 여러 번 뽑아 몇 번 이기는지 센다. 그 백분위를 번호로 옮기고, 가운데에 남아 있는 것
   * 중 가장 가까운 것을 집는다. 남이 쥔 것은 건드리지 않는다.
   */
  private chooseToken(view: GameView, bot: Bot, ordered: Bot[]): number | null {
    const free = view.centerTokens
    if (free.length === 0) return null

    const count = view.players.length
    const target = Math.min(count, Math.max(1, Math.ceil(this.percentile(bot, view) * count)))

    // 나보다 센 봇이 이미 자리를 잡았다면 그 아래로만 고른다. 둘의 순서는 틀리지 않는다.
    const stronger = ordered.slice(0, ordered.indexOf(bot))
    const ceiling = stronger
      .map((other) => view.players.find((player) => player.id === other.id)?.currentToken)
      .filter((token): token is number => typeof token === 'number')
      .reduce((low, token) => Math.min(low, token), Number.POSITIVE_INFINITY)

    const allowed = free.filter((token) => token < ceiling)
    const candidates = allowed.length > 0 ? allowed : free
    return candidates.reduce((best, token) =>
      Math.abs(token - target) < Math.abs(best - target) ? token : best,
    )
  }

  /** 내 손이 무작위 상대를 이길 확률. 0에 가까울수록 약하다. */
  private percentile(bot: Bot, view: GameView): number {
    const community = view.community
    if (community.length === 0) {
      // 공용 카드가 깔리기 전에는 두 장의 끗수만으로 어림한다.
      const ranks = bot.hole.map((card) => RANK_ORDER.indexOf(card[0]))
      const pair = bot.hole.length === 2 && bot.hole[0][0] === bot.hole[1][0]
      const high = Math.max(0, ...ranks) / 12
      return Math.min(0.95, pair ? 0.6 + high * 0.35 : high * 0.7)
    }

    const known = new Set<Card>([...community, ...this.bots.flatMap((other) => other.hole)])
    const unknown = shuffle(freshDeck().filter((card) => !known.has(card)))
    const mine = evaluateHoleAndCommunity(bot.hole, community)

    let wins = 0
    let played = 0
    for (let i = 0; i + 1 < unknown.length && played < SAMPLES; i += 2) {
      const theirs = evaluateHoleAndCommunity([unknown[i], unknown[i + 1]], community)
      const diff = compareHands(mine, theirs)
      wins += diff > 0 ? 1 : diff === 0 ? 0.5 : 0
      played += 1
    }
    return played === 0 ? 0.5 : wins / played
  }
}
