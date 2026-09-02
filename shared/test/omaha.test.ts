import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type Card } from '../src/cards.ts'
import { ROUNDS } from '../src/game.ts'
import { CATEGORY_LABEL, HandCategory, evaluateBest, evaluateOmaha } from '../src/handEval.ts'
import { VARIANTS } from '../src/variants.ts'

const cards = (s: string) => s.split(' ') as Card[]

describe('오마하 — 홀 2장 + 공용 3장', () => {
  it('공용에 플러시가 다 깔려 있어도 내 손에 같은 무늬 두 장이 없으면 내 플러시가 아니다', () => {
    const hole = cards('Ah Kd Qc Jd')
    const community = cards('2s 7s 9s Js 4s')

    // 텍사스라면 보드의 다섯 장을 그대로 써서 플러시다.
    assert.equal(evaluateBest([...hole, ...community]).category, HandCategory.Flush)
    // 오마하는 손에서 반드시 두 장을 쓰므로 스페이드가 셋뿐이라 플러시가 서지 않는다.
    assert.notEqual(evaluateOmaha(hole, community).category, HandCategory.Flush)
  })

  it('손에 같은 무늬 두 장이 있으면 그때는 플러시가 선다', () => {
    const hole = cards('As Ks Qc Jd')
    const community = cards('2s 7s 9s Th 4d')
    const value = evaluateOmaha(hole, community)
    assert.equal(value.category, HandCategory.Flush)
    // 쓴 다섯 장은 손 둘 + 공용 셋이어야 한다.
    assert.equal(value.cards.filter((card) => hole.includes(card)).length, 2)
    assert.equal(value.cards.filter((card) => community.includes(card)).length, 3)
  })

  it('손에 포카드를 들고 있어도 두 장만 쓴다', () => {
    const hole = cards('Ah Ad Ac As')
    const community = cards('2s 7h 9d Th 4c')
    const value = evaluateOmaha(hole, community)
    // 넷을 다 쓸 수 있었다면 포카드다. 오마하에서는 원 페어에서 멈춘다.
    assert.equal(value.category, HandCategory.Pair)
  })

  it('공용의 세 장을 넘겨 쓸 수 없다', () => {
    const hole = cards('2h 3d 8c 9c')
    const community = cards('Ks Kh Kd Kc As')
    const value = evaluateOmaha(hole, community)
    // 보드의 K 네 장을 다 쓰면 포카드지만, 공용은 정확히 셋이라 트리플이 한계다.
    assert.equal(value.category, HandCategory.ThreeOfAKind)
  })

  it('룰서의 예시 — 손 두 장 + 공용 세 장으로 만드는 최선', () => {
    const hole = cards('Ts 6s 2h 3d')
    const community = cards('As Qs 7s 5d 4c')
    const value = evaluateOmaha(hole, community)
    assert.equal(CATEGORY_LABEL[value.category], CATEGORY_LABEL[HandCategory.Flush])
  })
})

describe('오마하 — 지금 내 손', () => {
  const omaha = VARIANTS.omaha

  it('프리플롭에는 두 장짜리 조합 중 최선을 말한다', () => {
    // 텍사스처럼 네 장을 통째로 보면 포카드라고 말해버린다. 오마하에서는 쓸 수 없는 손이다.
    const holding = omaha.holding(cards('Ah Ad Ac As'), [])
    assert.equal(holding?.name, CATEGORY_LABEL[HandCategory.Pair])
    assert.equal(holding?.used.length, 2)
  })

  it('짝이 없으면 가장 높은 카드로 말한다', () => {
    const holding = omaha.holding(cards('Ah 9d 5c 2s'), [])
    assert.equal(holding?.name, CATEGORY_LABEL[HandCategory.HighCard])
  })

  it('플롭이 깔리면 쇼다운과 같은 규칙으로 답한다', () => {
    const hole = cards('As Ks Qc Jd')
    const community = cards('2s 7s 9s')
    const holding = omaha.holding(hole, community)
    assert.equal(holding?.name, CATEGORY_LABEL[HandCategory.Flush])
    assert.equal(holding?.used.length, 5)
  })
})

describe('변형 표', () => {
  it('오마하는 네 장씩 받고 공용은 텍사스와 같다', () => {
    assert.equal(VARIANTS.omaha.holeCount, 4)
    assert.deepEqual(
      ROUNDS.map((round) => VARIANTS.omaha.dealt(round, 4)),
      ROUNDS.map((round) => VARIANTS.texas.dealt(round, 4)),
    )
  })

  it('정원은 덱 52장이 감당하는 만큼이다', () => {
    // 최악의 판: 보안 카메라로 홀 +1 → 감지기가 그 홀을 통째로 재배분 → 해커 한 장.
    const worst = (holeCount: number, seats: number, community: number) =>
      (holeCount + 1) * seats + community + (holeCount + 1) + 1

    for (const [name, rules] of Object.entries(VARIANTS)) {
      const used = worst(rules.holeCount, rules.maxSeats, rules.dealt(4, rules.maxSeats))
      assert.ok(used <= 52, `${name}: 정원 ${rules.maxSeats}명에서 최악 ${used}장 — 덱이 빈다`)
    }
  })
})
