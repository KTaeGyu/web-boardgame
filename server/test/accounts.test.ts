/**
 * 계정. 하는 일은 둘이다 — 같은 사람이 돌아왔을 때 알아보는 것과 전적을 이어 주는 것.
 *
 * 유일한 것은 이메일뿐이다. 닉네임은 겹쳐도 되므로 그것으로 자리를 다투지 않는다.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Accounts } from '../src/accounts.ts'

function makeOne(email = 'tk@example.com', password = 'pass1234', nickname = '태규') {
  const accounts = new Accounts()
  const made = accounts.signup(email, password, nickname)
  assert.equal(made.ok, true)
  return { accounts, session: made.ok ? made.value : null! }
}

describe('계정 만들기', () => {
  it('만들면 그 자리에서 로그인된 상태다', () => {
    const { session } = makeOne()
    assert.equal(session.email, 'tk@example.com')
    assert.equal(session.nickname, '태규')
    assert.deepEqual(session.record, { wins: 0, losses: 0 })
    assert.equal(session.token.length > 0, true)
  })

  it('같은 이메일은 두 번 만들 수 없다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.signup('tk@example.com', 'other123', '다른이름').ok, false)
  })

  /* 「TK@Example.com 」과 「tk@example.com」이 다른 계정이 되면 알아보는 뜻이 없다. */
  it('여백과 대소문자가 달라도 같은 이메일이다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.signup(' TK@Example.com ', 'pass1234', '태규').ok, false)
    assert.equal(accounts.login(' TK@Example.com ', 'pass1234').ok, true)
  })

  /* 닉네임은 유일하지 않다. 테이블에서 같은 이름이 둘이면 [1] [2] 가 붙을 뿐이다. */
  it('닉네임은 겹쳐도 된다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.signup('other@example.com', 'pass1234', '태규').ok, true)
  })

  it('이메일 꼴이 아니면 받지 않는다', () => {
    const accounts = new Accounts()
    assert.equal(accounts.signup('태규', 'pass1234', '태규').ok, false)
    assert.equal(accounts.signup('tk@example', 'pass1234', '태규').ok, false)
    assert.equal(accounts.signup('', 'pass1234', '태규').ok, false)
  })

  it('짧은 비밀번호와 빈 닉네임은 받지 않는다', () => {
    const accounts = new Accounts()
    assert.equal(accounts.signup('tk@example.com', 'ab', '태규').ok, false)
    assert.equal(accounts.signup('tk@example.com', 'pass1234', '   ').ok, false)
  })
})

describe('로그인', () => {
  it('맞으면 들어가고 틀리면 막힌다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.login('tk@example.com', 'pass1234').ok, true)
    assert.equal(accounts.login('tk@example.com', 'nope1234').ok, false)
  })

  /* 갈라 말하면 어느 주소가 쓰이고 있는지 물어보는 것만으로 알 수 있다. */
  it('없는 이메일과 틀린 비밀번호를 같은 말로 돌려보낸다', () => {
    const { accounts } = makeOne()
    const noSuch = accounts.login('nobody@example.com', 'pass1234')
    const wrongPass = accounts.login('tk@example.com', 'nope1234')
    assert.equal(noSuch.ok, false)
    assert.equal(wrongPass.ok, false)
    if (!noSuch.ok && !wrongPass.ok) {
      assert.equal(noSuch.code, wrongPass.code)
      assert.equal(noSuch.message, wrongPass.message)
    }
  })

  it('표로 돌아올 수 있고, 나가면 그 표는 죽는다', () => {
    const { accounts, session } = makeOne()
    assert.equal(accounts.resume(session.token).ok, true)
    accounts.logout(session.token)
    assert.equal(accounts.resume(session.token).ok, false)
  })

  /* 창 여럿으로 같은 계정에 붙어 볼 수 있어야 한다. 자리를 묶는 것은 이메일이지 표가 아니다. */
  it('두 번 로그인하면 표가 둘이고 둘 다 산다', () => {
    const { accounts, session } = makeOne()
    const again = accounts.login('tk@example.com', 'pass1234')
    assert.equal(again.ok, true)
    if (!again.ok) return
    assert.notEqual(again.value.token, session.token)
    assert.equal(accounts.resume(session.token).ok, true)
  })

  it('비밀번호를 그대로 들고 있지 않는다', () => {
    const { accounts, session } = makeOne()
    const account = accounts.accountOf(session.token)
    assert.notEqual(account?.hash, 'pass1234')
    assert.equal((account?.hash ?? '').includes('pass1234'), false)
  })
})

describe('전적', () => {
  it('이긴 판과 진 판을 센다', () => {
    const { accounts, session } = makeOne()
    accounts.record(session.token, 'win', 'a')
    const after = accounts.record(session.token, 'lose', 'b')
    assert.equal(after.ok, true)
    if (after.ok) assert.deepEqual(after.value, { wins: 1, losses: 1 })
  })

  /* 결과 화면에서 새로고침하면 같은 끝이 다시 온다. 그때 또 세면 한 판이 두 판이 된다. */
  it('같은 끝은 한 번만 센다', () => {
    const { accounts, session } = makeOne()
    accounts.record(session.token, 'win', 'AB12:3:win')
    const again = accounts.record(session.token, 'win', 'AB12:3:win')
    assert.equal(again.ok, true)
    if (again.ok) assert.equal(again.value.wins, 1)
  })

  it('표가 없으면 세지 않는다', () => {
    const { accounts } = makeOne()
    assert.equal(accounts.record('아무표', 'win', 'a').ok, false)
  })

  /* 같은 계정에 창 둘로 붙어 있어도 한 판은 한 판이다. */
  it('다른 표로 같은 끝을 보내도 한 번만 센다', () => {
    const { accounts, session } = makeOne()
    const second = accounts.login('tk@example.com', 'pass1234')
    assert.equal(second.ok, true)
    if (!second.ok) return

    accounts.record(session.token, 'win', 'AB12:3:win')
    const twin = accounts.record(second.value.token, 'win', 'AB12:3:win')
    assert.equal(twin.ok, true)
    if (twin.ok) assert.equal(twin.value.wins, 1)
  })
})
