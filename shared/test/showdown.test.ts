import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { Card } from '../src/cards.ts'
import { judgeShowdown, type ShowdownEntry } from '../src/showdown.ts'

const cards = (s: string) => s.split(' ') as Card[]

/** "닉:토큰:홀카드" 형태로 간결하게 적는다. */
const entry = (playerId: string, token: number, hole: string): ShowdownEntry => ({
  playerId,
  token,
  hole: cards(hole),
})

describe('쇼다운 판정', () => {
  const board = cards('Ks 9h 4d 2c 7s')

  it('약한 순서대로면 성공한다', () => {
    const result = judgeShowdown(
      [
        entry('약', 1, 'Jh 5c'), // 하이카드
        entry('중', 2, '9d 3c'), // 원페어 9
        entry('강', 3, 'Kh Kd'), // 트리플 K
      ],
      board,
    )
    assert.equal(result.success, true)
    assert.deepEqual(result.reveals.map((r) => r.playerId), ['약', '중', '강'])
    assert.deepEqual(result.reveals.map((r) => r.ok), [true, true, true])
  })

  it('순서가 뒤집히면 실패하고, 사슬을 끊은 사람이 지목된다', () => {
    const result = judgeShowdown(
      [
        entry('강', 1, 'Kh Kd'), // 트리플인데 1번을 집었다
        entry('약', 2, 'Jh 5c'),
      ],
      board,
    )
    assert.equal(result.success, false)
    assert.deepEqual(result.reveals.map((r) => r.ok), [true, false])
    assert.equal(result.reveals.find((r) => !r.ok)?.playerId, '약')
  })

  it('토큰 번호가 아니라 입력 순서를 무시하고 토큰 오름차순으로 공개한다', () => {
    const result = judgeShowdown(
      [entry('강', 3, 'Kh Kd'), entry('약', 1, 'Jh 5c'), entry('중', 2, '9d 3c')],
      board,
    )
    assert.deepEqual(result.reveals.map((r) => r.token), [1, 2, 3])
    assert.equal(result.success, true)
  })

  it('같은 세기면 통과한다 — 등호가 허용된다', () => {
    // 둘 다 A 키커 원페어 K 로 완전히 동일
    const result = judgeShowdown([entry('a', 1, 'Kh Ac'), entry('b', 2, 'Kd Ah')], board)
    assert.equal(result.success, true)
  })

  it('true tie 는 어느 순서로 놓아도 성공한다 (보드가 최선인 경우)', () => {
    // 보드에 로열이 깔려 홀카드가 무의미하다
    const royalBoard = cards('As Ks Qs Js Ts')
    const forward = judgeShowdown([entry('a', 1, '2h 3d'), entry('b', 2, '4c 5h')], royalBoard)
    const backward = judgeShowdown([entry('a', 2, '2h 3d'), entry('b', 1, '4c 5h')], royalBoard)
    assert.equal(forward.success, true)
    assert.equal(backward.success, true)
  })

  it('동점자 셋 사이의 순서는 무관하지만 바깥과의 순서는 지켜야 한다', () => {
    // 보드 자체가 9탑 스트레이트다. 약한 홀카드 둘은 보드 그대로라 완전 동점이고,
    // JT 를 든 사람만 J탑 스트레이트로 한 칸 위다. (포켓 99 였다면 트리플이 아니라 여전히 보드 스트레이트다)
    const straightBoard = cards('9h 8s 7d 6c 5h')
    const ok = judgeShowdown(
      [entry('동1', 1, '2h 3d'), entry('동2', 2, '2c 3s'), entry('센놈', 3, 'Jd Th')],
      straightBoard,
    )
    assert.equal(ok.success, true)

    const bad = judgeShowdown(
      [entry('센놈', 1, 'Jd Th'), entry('동1', 2, '2h 3d'), entry('동2', 3, '2c 3s')],
      straightBoard,
    )
    assert.equal(bad.success, false)
  })

  it('각 공개마다 사람이 읽을 수 있는 족보 설명이 붙는다', () => {
    const result = judgeShowdown([entry('a', 1, 'Kh Kd')], board)
    assert.equal(result.reveals[0].description, '트리플(K)')
  })
})

describe('쇼다운 입력 검증', () => {
  it('커뮤니티가 5장이 아니면 거부한다', () => {
    assert.throws(() => judgeShowdown([entry('a', 1, 'Kh Kd')], cards('Ks 9h 4d')), /5장/)
  })

  it('토큰이 중복되면 거부한다', () => {
    assert.throws(
      () => judgeShowdown([entry('a', 1, 'Kh Kd'), entry('b', 1, 'Jh 5c')], cards('Ks 9h 4d 2c 7s')),
      /중복/,
    )
  })
})
