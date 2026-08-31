/**
 * 계정. 서버 메모리에만 있고, 하는 일은 이름을 붙들어 두는 것과 전적을 세는 것이다.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Accounts } from '../src/accounts.ts'

function makeOne(name = '태규', password = 'pass1234') {
  const accounts = new Accounts()
  const made = accounts.signup(name, password)
  assert.equal(made.ok, true)
  return { accounts, session: made.ok ? made.value : null! }
}

describe('계정 만들기', () => {
  it('만들면 그 자리에서 로그인된 상태다', () => {
    const { session } = makeOne()
    assert.equal(session.name, '태규')
    assert.deepEqual(session.record, { played: 0, wins: 0, losses: 0, quits: 0 })
    assert.equal(session.token.length > 0, true)
  })

  it('같은 이름은 두 번 만들 수 없다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.signup('태규', 'other123').ok, false)
  })

  /* 「태규」와 「 태규 」가 다른 계정이 되면 이름을 붙들어 두는 뜻이 없다. */
  it('여백과 대소문자가 달라도 같은 이름이다', () => {
    const { accounts } = makeOne('Kim', 'pass1234')
    assert.equal(accounts.signup(' kim ', 'pass1234').ok, false)
    assert.equal(accounts.taken('KIM'), true)
  })

  it('짧은 비밀번호는 받지 않는다', () => {
    const accounts = new Accounts()
    assert.equal(accounts.signup('태규', 'ab').ok, false)
  })
})

describe('로그인', () => {
  it('맞으면 들어가고 틀리면 막힌다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.login('태규', 'pass1234').ok, true)
    assert.equal(accounts.login('태규', 'nope1234').ok, false)
  })

  /* 갈라 말하면 어느 이름이 쓰이고 있는지 물어보는 것만으로 알 수 있다. */
  it('없는 이름과 틀린 비밀번호를 같은 말로 돌려보낸다', () => {
    const { accounts } = makeOne()
    const wrongName = accounts.login('없는사람', 'pass1234')
    const wrongPass = accounts.login('태규', 'nope1234')
    assert.equal(wrongName.ok, false)
    assert.equal(wrongPass.ok, false)
    if (!wrongName.ok && !wrongPass.ok) {
      assert.equal(wrongName.code, wrongPass.code)
      assert.equal(wrongName.message, wrongPass.message)
    }
  })

  it('표로 돌아올 수 있고, 나가면 그 표는 죽는다', () => {
    const { accounts, session } = makeOne()
    assert.equal(accounts.resume(session.token).ok, true)
    accounts.logout(session.token)
    assert.equal(accounts.resume(session.token).ok, false)
  })

  /* 창 여럿으로 같은 계정에 붙어 볼 수 있어야 한다. 자리를 묶는 것은 이름이지 표가 아니다. */
  it('두 번 로그인하면 표가 둘이고 둘 다 산다', () => {
    const { accounts, session } = makeOne()
    const again = accounts.login('태규', 'pass1234')
    assert.equal(again.ok, true)
    if (!again.ok) return
    assert.notEqual(again.value.token, session.token)
    assert.equal(accounts.resume(session.token).ok, true)
  })
})

describe('이름 지키기', () => {
  it('계정 이름은 그 표를 가진 사람만 쓴다', () => {
    const { accounts, session } = makeOne()
    assert.equal(accounts.taken('태규'), true)
    assert.equal(accounts.owns(session.token, '태규'), true)
    assert.equal(accounts.owns('아무표', '태규'), false)
  })

  it('계정이 아닌 이름은 아무나 쓴다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.taken('민수'), false)
  })
})

describe('전적', () => {
  it('승·패·중도포기를 센다', () => {
    const { accounts, session } = makeOne()
    accounts.record(session.token, 'win', 'a')
    accounts.record(session.token, 'lose', 'b')
    const after = accounts.record(session.token, 'quit', 'c')
    assert.equal(after.ok, true)
    if (after.ok) assert.deepEqual(after.value, { played: 3, wins: 1, losses: 1, quits: 1 })
  })

  /* 결과 화면에서 새로고침하면 같은 끝이 다시 온다. 그때 또 세면 한 판이 두 판이 된다. */
  it('같은 끝은 한 번만 센다', () => {
    const { accounts, session } = makeOne()
    accounts.record(session.token, 'win', 'AB12:3:win')
    const again = accounts.record(session.token, 'win', 'AB12:3:win')
    assert.equal(again.ok, true)
    if (again.ok) assert.equal(again.value.played, 1)
  })

  it('표가 없으면 세지 않는다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.record('아무표', 'win', 'a').ok, false)
  })

  /* 같은 계정에 창 둘로 붙어 있어도 한 판은 한 판이다. */
  it('다른 표로 같은 끝을 보내도 한 번만 센다', () => {
    const { accounts, session } = makeOne()
    const second = accounts.login('태규', 'pass1234')
    assert.equal(second.ok, true)
    if (!second.ok) return

    accounts.record(session.token, 'win', 'AB12:3:win')
    const twin = accounts.record(second.value.token, 'win', 'AB12:3:win')
    assert.equal(twin.ok, true)
    if (twin.ok) assert.equal(twin.value.played, 1)
  })
})
