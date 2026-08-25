/**
 * 혼자 해보기 — 봇 둘과 한 판.
 *
 * 규칙은 Game 이 지키므로 여기서 보는 것은 진행자뿐이다. 봇이 스스로 움직이는가,
 * 안내가 떠 있는 동안 멈추는가, 사람이 닫으면 다시 흐르는가.
 *
 * 실제 서버에서는 봇이 한 수 둘 때마다 화면을 새로 보내고 그 자리에서 다시 생각한다
 * (sendGame → poke). 여기서도 onMoved 에서 poke 를 불러 같은 고리를 만든다.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Game, type StartingPlayer } from '../src/game.ts'
import { TIPS, Tutorial } from '../src/tutorial.ts'

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const players: StartingPlayer[] = [
  { id: 'human', nickname: '나', connected: true },
  { id: 'bot1', nickname: '봇1', connected: true },
  { id: 'bot2', nickname: '봇2', connected: true },
]

/** 봇이 기다리지 않는 판. 사이를 0 으로 두어 예약이 곧바로 돌아온다. */
function makeTutorial(seed = 3) {
  const game = new Game('TUTO', players, { mode: 'basic', rng: mulberry32(seed), lockMs: 0 })
  const tips: { title: string; action: string }[] = []
  let moves = 0
  const tutorial = new Tutorial(
    game,
    'human',
    ['bot1', 'bot2'],
    {
      onMoved: () => {
        moves += 1
        tutorial.poke()
      },
      onTip: (tip) => tips.push(tip),
    },
    { delayMs: 0 },
  )
  return { game, tutorial, tips, moves: () => moves }
}

/** 예약해 둔 한 수가 돌아올 때까지 기다린다. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('혼자 해보기', () => {
  it('안내마다 지금 할 일이 적혀 있다', () => {
    // 규칙만 적어두면 처음 하는 사람은 안내를 닫은 자리에서 멈춘다.
    for (const tip of TIPS) {
      assert.ok(tip.action.length > 5, `${tip.title} — 할 일이 없다`)
    }
    assert.match(TIPS[0].action, /토큰/, '첫 안내는 토큰을 눌러 가져오라고 말해야 한다')
  })

  it('판이 열리면 첫 안내부터 뜬다', async () => {
    const ctx = makeTutorial()
    ctx.tutorial.poke()
    await settle()

    assert.equal(ctx.tips.length, 1)
    assert.equal(ctx.tips[0].title, TIPS[0].title)
    assert.equal(ctx.tips[0].action, TIPS[0].action, '할 일까지 화면으로 나간다')
    assert.equal(ctx.moves(), 0, '읽는 동안 봇은 움직이지 않는다')
    assert.deepEqual(ctx.game.view().centerTokens, [1, 2, 3], '토큰도 그대로 가운데 있다')
    ctx.tutorial.stop()
  })

  it('안내를 닫으면 봇이 스스로 토큰을 집는다', async () => {
    const ctx = makeTutorial()
    ctx.tutorial.poke()
    await settle()

    ctx.tutorial.resume()
    await settle()

    const bots = ctx.game.view().players.filter((player) => player.id !== 'human')
    assert.ok(
      bots.every((bot) => bot.currentToken !== null),
      `봇이 아직 집지 않았다: ${bots.map((b) => b.currentToken).join(',')}`,
    )
    ctx.tutorial.stop()
  })

  it('봇은 사람이 쥔 토큰을 뺏지 않는다', async () => {
    const ctx = makeTutorial()
    ctx.tutorial.poke()
    await settle()
    ctx.tutorial.resume()
    await settle()

    // 봇이 자리를 잡은 뒤 사람이 남은 하나를 집는다. 그 뒤로 봇을 계속 돌려도 그대로여야 한다.
    const free = ctx.game.view().centerTokens
    assert.equal(free.length, 1, '셋 중 둘은 봇이 가져갔다')
    assert.equal(ctx.game.takeToken('human', free[0]).ok, true)

    ctx.tutorial.poke()
    await settle()
    const me = ctx.game.view().players.find((player) => player.id === 'human')
    assert.equal(me?.currentToken, free[0], '사람이 쥔 번호는 그대로다')
    ctx.tutorial.stop()
  })

  it('사람이 선언하면 그 자리에서 다음 안내가 뜬다', async () => {
    const ctx = makeTutorial()
    ctx.tutorial.poke()
    await settle()
    ctx.tutorial.resume()
    await settle()

    const free = ctx.game.view().centerTokens
    ctx.game.takeToken('human', free[0])
    ctx.tutorial.poke()
    await settle()

    assert.equal(ctx.tips.length, 2, '토큰을 집은 순간의 안내')
    assert.equal(ctx.tips[1].title, TIPS[1].title)
    ctx.tutorial.stop()
  })

  it('멈춘 뒤에는 아무리 찔러도 움직이지 않는다', async () => {
    const ctx = makeTutorial()
    ctx.tutorial.poke()
    await settle()
    ctx.tutorial.resume()
    await settle()

    const before = ctx.moves()
    ctx.tutorial.stop()
    ctx.tutorial.poke()
    await settle()
    assert.equal(ctx.moves(), before, '사람이 나간 방에서 봇만 계속 두면 안 된다')
  })

  it('안내는 대본 순서대로 한 번씩만 뜬다', async () => {
    const ctx = makeTutorial()
    ctx.tutorial.poke()
    await settle()
    // 같은 상태에서 여러 번 찔러도 첫 안내가 두 번 뜨지 않는다.
    ctx.tutorial.poke()
    ctx.tutorial.poke()
    await settle()
    assert.equal(ctx.tips.length, 1)
    ctx.tutorial.stop()
  })
})
