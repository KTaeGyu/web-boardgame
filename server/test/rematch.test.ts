import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { TOKEN_LOCK_MS } from '@the-gang/shared'
import { Game } from '../src/game.ts'

/** 게임이 끝난 판을 만든다. 결과가 승이든 패든 재경기 규칙은 같다. */
function finishedGame() {
  let clock = 1_000_000
  const ids = ['p1', 'p2', 'p3']
  const game = new Game(
    'TEST',
    ids.map((id) => ({ id, nickname: id, connected: true })),
    { now: () => clock, rng: mulberry32(99), lockMs: TOKEN_LOCK_MS },
  )

  let guard = 0
  while (!game.isOver && guard++ < 12) {
    for (let round = 0; round < 4; round++) {
      ids.forEach((id, index) => {
        game.takeToken(id, index + 1)
        clock += TOKEN_LOCK_MS
      })
      for (const id of ids) game.setReady(id, true)
    }
    if (!game.isOver) for (const id of ids) game.continueAfterHeist(id)
  }
  assert.equal(game.isOver, true, '게임이 끝나지 않았다')
  return { game, ids }
}

describe('재경기', () => {
  it('게임이 끝나기 전에는 제안할 수 없다', () => {
    const game = new Game('TEST', [
      { id: 'p1', nickname: '가', connected: true },
      { id: 'p2', nickname: '나', connected: true },
      { id: 'p3', nickname: '다', connected: true },
    ])
    const result = game.proposeRematch('p1', true)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'WRONG_PHASE')
  })

  it('한 명이 동의하면 나머지에게 물음이 뜬다', () => {
    const { game } = finishedGame()
    const result = game.proposeRematch('p1', true)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 'pending')

    const view = game.view()
    assert.equal(view.rematch.proposed, true)
    assert.deepEqual(view.rematch.agreed, ['p1'])
    assert.equal(view.phase, 'gameOver', '아직 다시 시작하지 않는다')
  })

  it('모두 동의하면 처음부터 다시 시작한다', () => {
    const { game, ids } = finishedGame()
    for (const id of ids.slice(0, 2)) game.proposeRematch(id, true)
    const last = game.proposeRematch(ids[2], true)
    assert.equal(last.ok, true)
    if (last.ok) assert.equal(last.value, 'restart')

    const view = game.view()
    assert.equal(view.heist, 1)
    assert.equal(view.round, 1)
    assert.equal(view.vaults, 0)
    assert.equal(view.alarms, 0)
    assert.equal(view.phase, 'picking')
    assert.deepEqual(view.community, [])
    assert.equal(view.rematch.proposed, false)
  })

  it('거절은 그대로 전달된다 — 방을 닫는 판단은 바깥에서 한다', () => {
    const { game } = finishedGame()
    game.proposeRematch('p1', true)
    const result = game.proposeRematch('p2', false)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 'declined')
  })

  it('끊긴 사람은 기다려주지 않는다', () => {
    const { game } = finishedGame()
    game.setConnected('p3', false)
    game.proposeRematch('p1', true)
    const result = game.proposeRematch('p2', true)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 'restart')
  })

  it('다시 시작한 판에도 새 카드가 돌아간다', () => {
    const { game, ids } = finishedGame()
    const before = game.handOf('p1')
    for (const id of ids) game.proposeRematch(id, true)
    assert.notDeepEqual(game.handOf('p1'), before)
  })
})

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
