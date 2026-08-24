import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { displayNames } from '../src/protocol.ts'

describe('겹치는 닉네임', () => {
  it('겹치지 않으면 그대로 둔다', () => {
    assert.deepEqual(displayNames(['태규', '민수', '지연']), ['태규', '민수', '지연'])
  })

  it('겹치면 들어온 순서대로 번호를 붙인다', () => {
    assert.deepEqual(displayNames(['태규', '태규', '태규']), ['태규 [1]', '태규 [2]', '태규 [3]'])
  })

  it('겹치는 이름에만 붙는다', () => {
    assert.deepEqual(displayNames(['태규', '민수', '태규']), ['태규 [1]', '민수', '태규 [2]'])
  })

  it('겹치는 무리가 여럿이면 각각 1번부터 센다', () => {
    assert.deepEqual(displayNames(['가', '나', '가', '나', '다']), [
      '가 [1]',
      '나 [1]',
      '가 [2]',
      '나 [2]',
      '다',
    ])
  })

  it('빈 자리에서도 무너지지 않는다', () => {
    assert.deepEqual(displayNames([]), [])
    assert.deepEqual(displayNames(['혼자']), ['혼자'])
  })
})
