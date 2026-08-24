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

describe('완전히 같은 손끼리는 순서가 자유롭다', () => {
  // 보드: 2♠ 3♥ 4♦ A♣ 9♠
  // 갑·을: 투 페어(3, 2) + A 키커 — 무늬만 다를 뿐 세기가 완전히 같다
  // 병: 2-3-4-5-6 스트레이트 — 둘보다 세다
  const board = cards('2s 3h 4d Ac 9s')
  const 갑 = '2h 3d'
  const 을 = '2d 3c'
  const 병 = '5d 6c'

  it('전제 확인 — 갑과 을은 정말 같고, 병이 더 세다', () => {
    const result = judgeShowdown(
      [entry('갑', 1, 갑), entry('을', 2, 을), entry('병', 3, 병)],
      board,
    )
    const [a, b, c] = result.reveals
    assert.equal(a.description, '투 페어(3, 2)')
    assert.equal(b.description, '투 페어(3, 2)')
    assert.equal(c.description, '스트레이트(6)')
    assert.deepEqual(a.value.score, b.value.score, '키커까지 같아야 진짜 동률이다')
  })

  it('동률인 둘은 2등 3등이든 3등 2등이든 성공한다', () => {
    const 갑먼저 = judgeShowdown(
      [entry('갑', 1, 갑), entry('을', 2, 을), entry('병', 3, 병)],
      board,
    )
    const 을먼저 = judgeShowdown(
      [entry('을', 1, 을), entry('갑', 2, 갑), entry('병', 3, 병)],
      board,
    )
    assert.equal(갑먼저.success, true)
    assert.equal(을먼저.success, true)
  })

  it('이름이 같아도 키커가 다르면 동률이 아니다', () => {
    // 보드 2♠ 2♥ 5♦ 9♣ 7♠ — 둘 다 「원 페어(2)」지만 키커가 갈린다.
    const 높은키커 = 'Ad Kh' // 키커 A K 9
    const 낮은키커 = 'Qd Jh' // 키커 Q J 9

    const 본다 = judgeShowdown(
      [entry('낮음', 1, 낮은키커), entry('높음', 2, 높은키커)],
      cards('2s 2h 5d 9c 7s'),
    )
    const [약, 강] = 본다.reveals
    assert.equal(약.description, '원 페어(2)')
    assert.equal(강.description, '원 페어(2)', '이름은 똑같이 나온다')
    assert.notDeepEqual(약.value.score, 강.value.score, '그래도 세기는 다르다')
    assert.equal(약.value.score[2], 12, '키커 Q')
    assert.equal(강.value.score[2], 14, '키커 A')
    assert.equal(본다.success, true, '약한 쪽이 앞이면 성공')
  })

  it('키커가 낮은 사람이 뒤에 서면 실패한다', () => {
    const 뒤집힘 = judgeShowdown(
      [entry('높음', 1, 'Ad Kh'), entry('낮음', 2, 'Qd Jh')],
      cards('2s 2h 5d 9c 7s'),
    )
    assert.equal(뒤집힘.success, false, '2 2 3 3 A 가 2 2 3 3 6 보다 세다는 것이 순서에 반영돼야 한다')
    assert.deepEqual(뒤집힘.reveals.map((r) => r.ok), [true, false])
  })

  it('그래도 센 쪽과의 순서는 지켜야 한다', () => {
    const 병이먼저 = judgeShowdown(
      [entry('병', 1, 병), entry('갑', 2, 갑), entry('을', 3, 을)],
      board,
    )
    assert.equal(병이먼저.success, false)

    const 병이가운데 = judgeShowdown(
      [entry('갑', 1, 갑), entry('병', 2, 병), entry('을', 3, 을)],
      board,
    )
    assert.equal(병이가운데.success, false, '동률인 둘 사이에 센 사람이 끼면 안 된다')
  })
})

describe('근육 — 같은 족보끼리는 이긴다', () => {
  // 보드 2♠ 2♥ 5♦ 9♣ 7♠ — 둘 다 원 페어(2)지만 키커가 갈린다.
  const board = cards('2s 2h 5d 9c 7s')
  const 센손 = 'Ad Kh'
  const 약한손 = 'Qd Jh'

  it('근육이 없으면 키커가 낮은 쪽이 뒤에 설 수 없다', () => {
    const result = judgeShowdown([entry('강', 1, 센손), entry('약', 2, 약한손)], board)
    assert.equal(result.success, false)
  })

  it('근육을 쥐면 같은 족보를 뒤집는다', () => {
    const result = judgeShowdown([entry('강', 1, 센손), entry('약', 2, 약한손)], board, {
      muscleId: '약',
    })
    assert.equal(result.success, true, '약한 원 페어가 근육 덕에 더 세진다')
  })

  it('족보가 다르면 근육도 소용없다', () => {
    // 병은 트리플이라 원 페어보다 세다. 근육이 있어도 족보를 넘지 못한다.
    const result = judgeShowdown(
      [entry('트리플', 1, '2c Kd'), entry('페어', 2, 약한손)],
      board,
      { muscleId: '페어' },
    )
    assert.equal(result.reveals[0].description, '트리플(2)')
    assert.equal(result.reveals[1].description, '원 페어(2)')
    assert.equal(result.success, false, '근육은 같은 족보끼리만 통한다')
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
