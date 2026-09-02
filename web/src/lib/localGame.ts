/**
 * 혼자 해보기를 화면 안에서 돌린다.
 *
 * 예전에는 서버에 진짜 방을 하나 만들어 봇 둘을 앉혔다. 그런데 무료 요금제는 15분
 * 동안 아무도 오지 않으면 잠들고, 다시 뜨는 데 1~2분이 걸린다. **처음 온 사람이
 * 「규칙을 읽는 것보다 한 판 해보는 게 빠르다」고 누른 그 단추가 화면을 통틀어 제일
 * 오래 기다리는 자리였다.** 여기서 돌리면 서버가 자고 있어도 그 자리에서 시작된다.
 *
 * **규칙은 한 벌뿐이다.** 서버가 쓰는 `Game`·`Tutorial` 을 그대로 들여와 쓴다 —
 * 화면판 규칙을 따로 짜면 두 벌이 갈라지고, 연습에서 배운 것이 진짜 판에서 다르게
 * 동작하게 된다. 여기 있는 것은 규칙이 아니라 **서버가 하던 배선**이다:
 * 누가 무엇을 부르면 어떤 이벤트를 누구에게 보내는가.
 *
 * `server/src/socket.ts` 의 게임 부분과 짝이다. 그쪽이 바뀌면 여기도 봐야 한다.
 */

import { Game } from '@the-gang/shared/engine'
import { Tutorial } from '@the-gang/shared/tutorial'
import { TOKEN_LOCK_MS, type Card, type Result } from '@the-gang/shared'

import { getPlayerId } from './identity.ts'

/** 이 판의 방 번호 자리. 진짜 방 번호와 섞이지 않게 네 자리 규칙을 벗어난 값을 쓴다. */
export const LOCAL_CODE = 'solo'

type Handler = (payload: unknown) => void

interface Session {
  game: Game
  tutorial: Tutorial
  humanId: string
  /** 토큰 잠금이 저절로 풀리는 시점에 상태를 한 번 더 보내려는 타이머. */
  unlock: ReturnType<typeof setTimeout> | null
}

let live: Session | null = null
const watchers = new Map<string, Set<Handler>>()

function emit(event: string, payload: unknown): void {
  for (const handler of watchers.get(event) ?? []) handler(payload)
}

export function onLocal(event: string, handler: Handler): () => void {
  const set = watchers.get(event) ?? new Set()
  set.add(handler)
  watchers.set(event, set)
  return () => set.delete(handler)
}

/** 지금 화면 안에서 판이 돌고 있는가. 통로가 어디로 갈지 이걸로 가른다. */
export function localRunning(): boolean {
  return live !== null
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

function gone<T>(): Result<T> {
  return { ok: false, code: 'GAME_NOT_RUNNING', message: '진행 중인 판이 없습니다.' }
}

/** 공개 상태는 판 전체에, 손패는 나에게. 서버의 sendGame 과 같은 구분이다. */
function sendGame(options: { hands?: boolean } = {}): void {
  if (!live) return
  const view = live.game.view()
  emit('game:state', view)
  sendToasts()
  // 봇이 다음 한 수를 생각한다. 예약은 늘 최신 상태 기준이다.
  live.tutorial.poke()
  if (options.hands) sendHand()
  scheduleUnlock()
}

/**
 * 「방금 나에게 벌어진 일」. 거절된 동작에도 알릴 것이 있어 상태 전송과 따로 부를 수 있다 —
 * 붙박이 토큰은 눌러도 오지 않는데, 그 이유가 공개 상태 어디에도 없다.
 */
function sendToasts(): void {
  if (!live) return
  for (const toast of live.game.takeToasts()) {
    // 봇에게 가는 것은 버린다. 읽을 사람이 없다.
    if (toast.toId !== live.humanId) continue
    emit('game:toast', { text: toast.text, tone: toast.tone })
  }
}

function sendHand(): void {
  if (!live) return
  const hole = live.game.handOf(live.humanId)
  if (!hole) return
  emit('game:hand', { heist: live.game.view().heist, hole })
}

/**
 * 잠금은 시간이 지나면 저절로 풀리는데, 아무도 알려주지 않으면 화면에는 잠긴 채로 남는다.
 * 풀리는 시점에 상태를 한 번 더 보낸다.
 */
function scheduleUnlock(): void {
  if (!live || live.unlock) return
  if (live.game.view().lockedTokens.length === 0) return
  live.unlock = setTimeout(() => {
    if (!live) return
    live.unlock = null
    emit('game:state', live.game.view())
    scheduleUnlock()
  }, TOKEN_LOCK_MS + 20)
}

/** 카드가 나에게만 알려주는 것. 봇 몫은 버린다. */
function deliver(notes: { toId: string; heist: number; specialist: number; title: string; text?: string; cards?: Card[] }[]): void {
  if (!live) return
  for (const note of notes) {
    if (note.toId !== live.humanId) continue
    emit('game:note', note)
  }
}

/** 연습판을 연다. 도전자·해결사 없는 기본 진행 — 처음 배우는 자리에 예외 규칙을 얹지 않는다. */
export function startLocal(nickname: string): void {
  stopLocal()
  const humanId = getPlayerId()
  const seats = [
    { id: humanId, nickname, connected: true },
    { id: 'bot1', nickname: '봇1', connected: true },
    { id: 'bot2', nickname: '봇2', connected: true },
  ]
  const game = new Game(LOCAL_CODE, seats, {
    mode: 'basic',
    pickedChallenges: [],
    specialistRounds: [null, null, null, null, null],
    /*
     * 자동 확정을 끈다. 그래서 서버에 있는 예약(scheduleAutoConfirm)의 짝이 여기엔 없다.
     *
     * 안내가 떠 있는 동안 봇은 멈추지만 시계는 멈추지 않는다. 읽는 사이에 라운드가
     * 넘어가면 방금 읽은 것과 화면이 어긋나고, 배우러 온 자리에서 그게 제일 나쁘다.
     */
    autoConfirmMs: 0,
  })
  const tutorial = new Tutorial(game, humanId, ['bot1', 'bot2'], {
    onMoved: () => sendGame(),
    onTip: (tip) => emit('tutorial:tip', tip),
  })
  live = { game, tutorial, humanId, unlock: null }
}

export function stopLocal(): void {
  if (!live) return
  live.tutorial.stop()
  if (live.unlock) clearTimeout(live.unlock)
  live = null
}

/**
 * 화면이 부르던 것들. 서버의 socket.on 자리와 하나씩 짝이다.
 *
 * 없는 이름은 「진행 중인 판이 없습니다」로 돌려보낸다 — 연습판에 없는 기능(대화·관전)이
 * 조용히 성공한 척하면, 눌러도 아무 일이 없는 단추가 된다.
 */
export function localCall<T>(event: string, payload: Record<string, unknown> = {}): Promise<Result<T>> {
  return Promise.resolve(handle(event, payload) as Result<T>)
}

function handle(event: string, payload: Record<string, unknown>): Result<unknown> {
  if (!live) return gone()
  const { game, humanId } = live

  switch (event) {
    /* 들어오기. 진짜 방이 없으므로 이 화면이 알아야 할 것만 지어서 돌려준다. */
    case 'room:join':
      // 첫 상태와 손패를 곧바로 건넨다. 서버도 들어온 사람에게 그렇게 한다.
      queueMicrotask(() => sendGame({ hands: true }))
      return ok({ hostId: humanId, phase: 'playing', tutorial: true })

    case 'room:leave':
      stopLocal()
      return ok(null)

    case 'tutorial:next':
      live.tutorial.resume()
      return ok(null)

    case 'game:take': {
      const result = game.takeToken(humanId, Number(payload.token))
      // 붙박이에 막힌 것은 거절이지만 알려줄 것이 있다. 흔들림만으로는 이유가 없다.
      if (result.ok) sendGame()
      else sendToasts()
      return result
    }

    case 'game:ready': {
      const before = game.view().round
      const result = game.setReady(humanId, Boolean(payload.ready))
      // 라운드가 넘어갈 때는 손패도 함께. 감지기가 카드를 갈아엎었을 수 있다.
      if (result.ok) sendGame({ hands: game.view().round !== before })
      return result
    }

    case 'game:continue': {
      const before = game.view().heist
      const result = game.continueAfterHeist(humanId)
      if (result.ok) sendGame({ hands: game.view().heist !== before })
      return result
    }

    case 'game:setupCard': {
      const result = game.submitSetup(humanId, payload.cardIndex as number | undefined)
      if (!result.ok) return result
      deliver(result.value.notes)
      sendGame({ hands: result.value.notes.length > 0 })
      return ok(null)
    }

    case 'game:discard': {
      const result = game.discard(humanId, Number(payload.cardIndex))
      if (!result.ok) return result
      if (result.value.note) deliver([result.value.note])
      sendGame()
      sendHand()
      return ok(null)
    }

    case 'game:scanVote': {
      const result = game.voteScan(humanId, payload.kind as 'rank' | 'category', Number(payload.value))
      if (result.ok) sendGame()
      return result
    }

    case 'game:useSpecialist': {
      const result = game.useSpecialist(humanId, payload as never)
      if (!result.ok) return result
      if (result.value.note) deliver([result.value.note])
      sendGame()
      // 「해커」·「잭」은 손패가 늘어난다. 쓴 사람에게 새 손패를 보낸다.
      sendHand()
      return ok(null)
    }

    /*
     * 연습판에는 없는 것들. 다시 하기도 로비로 가기도 여기서는 뜻이 없다 —
     * 판이 끝나면 화면이 「처음으로」를 보인다.
     */
    default:
      return gone()
  }
}
