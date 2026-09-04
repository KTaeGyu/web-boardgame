/**
 * 계정. 하는 일은 둘이다 — 같은 사람이 돌아왔을 때 알아보는 것과 전적을 이어 주는 것.
 *
 * 유일한 것은 이메일뿐이다. 닉네임은 겹쳐도 되므로 그것으로 자리를 다투지 않는다.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_EQUIPPED, balanceOf, cosmeticOf } from '@the-gang/shared'

import { Accounts } from '../src/accounts.ts'
import type { AccountStore, StoredAccount } from '../src/accountStore.ts'

/*
 * 가입만 비동기다. 밖에 먼저 쓰고 성공을 확인한 뒤 메모리에 넣기 때문인데,
 * 여기서는 저장소를 주지 않으므로 밖에 쓰는 걸음이 통째로 없다 — 그래도 모양은 같다.
 */
async function makeOne(email = 'tk@example.com', password = 'pass1234', nickname = '태규') {
  const accounts = new Accounts()
  const made = await accounts.signup(email, password, nickname)
  assert.equal(made.ok, true)
  return { accounts, session: made.ok ? made.value : null! }
}

describe('계정 만들기', () => {
  it('만들면 그 자리에서 로그인된 상태다', async () => {
    const { session } = await makeOne()
    assert.equal(session.email, 'tk@example.com')
    assert.equal(session.nickname, '태규')
    assert.deepEqual(session.record, { wins: 0, losses: 0 })
    assert.equal(session.token.length > 0, true)
  })

  it('같은 이메일은 두 번 만들 수 없다', async () => {
    const { accounts } = await makeOne()
    assert.equal((await accounts.signup('tk@example.com', 'other123', '다른이름')).ok, false)
  })

  /* 「TK@Example.com 」과 「tk@example.com」이 다른 계정이 되면 알아보는 뜻이 없다. */
  it('여백과 대소문자가 달라도 같은 이메일이다', async () => {
    const { accounts } = await makeOne()
    assert.equal((await accounts.signup(' TK@Example.com ', 'pass1234', '태규')).ok, false)
    assert.equal(accounts.login(' TK@Example.com ', 'pass1234').ok, true)
  })

  /* 닉네임은 유일하지 않다. 테이블에서 같은 이름이 둘이면 [1] [2] 가 붙을 뿐이다. */
  it('닉네임은 겹쳐도 된다', async () => {
    const { accounts } = await makeOne()
    assert.equal((await accounts.signup('other@example.com', 'pass1234', '태규')).ok, true)
  })

  it('이메일 꼴이 아니면 받지 않는다', async () => {
    const accounts = new Accounts()
    assert.equal((await accounts.signup('태규', 'pass1234', '태규')).ok, false)
    assert.equal((await accounts.signup('tk@example', 'pass1234', '태규')).ok, false)
    assert.equal((await accounts.signup('', 'pass1234', '태규')).ok, false)
  })

  it('짧은 비밀번호와 빈 닉네임은 받지 않는다', async () => {
    const accounts = new Accounts()
    assert.equal((await accounts.signup('tk@example.com', 'ab', '태규')).ok, false)
    assert.equal((await accounts.signup('tk@example.com', 'pass1234', '   ')).ok, false)
  })
})

describe('로그인', () => {
  it('맞으면 들어가고 틀리면 막힌다', async () => {
    const { accounts } = await makeOne()
    assert.equal(accounts.login('tk@example.com', 'pass1234').ok, true)
    assert.equal(accounts.login('tk@example.com', 'nope1234').ok, false)
  })

  /* 갈라 말하면 어느 주소가 쓰이고 있는지 물어보는 것만으로 알 수 있다. */
  it('없는 이메일과 틀린 비밀번호를 같은 말로 돌려보낸다', async () => {
    const { accounts } = await makeOne()
    const noSuch = accounts.login('nobody@example.com', 'pass1234')
    const wrongPass = accounts.login('tk@example.com', 'nope1234')
    assert.equal(noSuch.ok, false)
    assert.equal(wrongPass.ok, false)
    if (!noSuch.ok && !wrongPass.ok) {
      assert.equal(noSuch.code, wrongPass.code)
      assert.equal(noSuch.message, wrongPass.message)
    }
  })

  it('표로 돌아올 수 있고, 나가면 그 표는 죽는다', async () => {
    const { accounts, session } = await makeOne()
    assert.equal(accounts.resume(session.token).ok, true)
    accounts.logout(session.token)
    assert.equal(accounts.resume(session.token).ok, false)
  })

  /* 창 여럿으로 같은 계정에 붙어 볼 수 있어야 한다. 자리를 묶는 것은 이메일이지 표가 아니다. */
  it('두 번 로그인하면 표가 둘이고 둘 다 산다', async () => {
    const { accounts, session } = await makeOne()
    const again = accounts.login('tk@example.com', 'pass1234')
    assert.equal(again.ok, true)
    if (!again.ok) return
    assert.notEqual(again.value.token, session.token)
    assert.equal(accounts.resume(session.token).ok, true)
  })

  it('비밀번호를 그대로 들고 있지 않는다', async () => {
    const { accounts, session } = await makeOne()
    const account = accounts.accountOf(session.token)
    assert.notEqual(account?.hash, 'pass1234')
    assert.equal((account?.hash ?? '').includes('pass1234'), false)
  })
})

describe('전적', () => {
  it('이긴 판과 진 판을 센다', async () => {
    const { accounts, session } = await makeOne()
    accounts.record(session.token, 'win', 'a')
    const after = accounts.record(session.token, 'lose', 'b')
    assert.equal(after.ok, true)
    if (after.ok) assert.deepEqual(after.value, { wins: 1, losses: 1 })
  })

  /* 결과 화면에서 새로고침하면 같은 끝이 다시 온다. 그때 또 세면 한 판이 두 판이 된다. */
  it('같은 끝은 한 번만 센다', async () => {
    const { accounts, session } = await makeOne()
    accounts.record(session.token, 'win', 'AB12:3:win')
    const again = accounts.record(session.token, 'win', 'AB12:3:win')
    assert.equal(again.ok, true)
    if (again.ok) assert.equal(again.value.wins, 1)
  })

  it('표가 없으면 세지 않는다', async () => {
    const { accounts } = await makeOne()
    assert.equal(accounts.record('아무표', 'win', 'a').ok, false)
  })

  /* 같은 계정에 창 둘로 붙어 있어도 한 판은 한 판이다. */
  it('다른 표로 같은 끝을 보내도 한 번만 센다', async () => {
    const { accounts, session } = await makeOne()
    const second = accounts.login('tk@example.com', 'pass1234')
    assert.equal(second.ok, true)
    if (!second.ok) return

    accounts.record(session.token, 'win', 'AB12:3:win')
    const twin = accounts.record(second.value.token, 'win', 'AB12:3:win')
    assert.equal(twin.ok, true)
    if (twin.ok) assert.equal(twin.value.wins, 1)
  })
})

/*
 * 밖에 둔 계정(운영에서는 Contentful). 여기서는 가짜 저장소로 걸음의 순서만 본다 —
 * 실물에 붙는 부분은 자격증명이 있어야 해서 이 파일이 볼 수 있는 자리가 아니다.
 */
function fake(overrides: Partial<AccountStore> = {}) {
    const rows: StoredAccount[] = []
    const calls: string[] = []
    const store: AccountStore = {
      loadAll: async () => {
        calls.push('loadAll')
        return [...rows]
      },
      has: async (email) => {
        calls.push('has')
        return rows.some((one) => one.email === email)
      },
      create: async (account) => {
        calls.push('create')
        rows.push({ ...account })
      },
      saveRecord: async (email, wins, losses) => {
        calls.push('saveRecord')
        const row = rows.find((one) => one.email === email)
        if (row) Object.assign(row, { wins, losses })
      },
      saveCosmetics: async (email, cosmetics) => {
        calls.push('saveCosmetics')
        const row = rows.find((one) => one.email === email)
        if (row) row.cosmetics = cosmetics
      },
      ...overrides,
    }
  return { store, rows, calls }
}

describe('밖에 둔 계정', () => {
  const quick = { retryWaitMs: 1, holdMs: 1 }

  it('부팅 때 읽어 온 계정으로 곧바로 로그인된다', async () => {
    const { store, rows } = fake()
    // 먼저 한 서버에서 가입해 둔 것처럼 밖에 한 줄을 만든다.
    const first = new Accounts(store, quick)
    assert.equal((await first.signup('tk@example.com', 'pass1234', '태규')).ok, true)

    // 서버가 다시 떴다. 메모리는 비어 있고 밖에 있는 것만 읽는다.
    const next = new Accounts(store, quick)
    await next.load()
    assert.equal(next.size, 1)
    assert.equal(next.login('tk@example.com', 'pass1234').ok, true)
    assert.equal(rows.length, 1)
  })

  it('전적도 함께 돌아온다', async () => {
    const { store } = fake()
    const first = new Accounts(store, quick)
    const made = await first.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) return
    first.record(made.value.token, 'win', 'a')
    first.record(made.value.token, 'lose', 'b')
    // 모았다가 나가므로 잠깐 기다린다.
    await new Promise((done) => setTimeout(done, 30))

    const next = new Accounts(store, quick)
    await next.load()
    const back = next.login('tk@example.com', 'pass1234')
    assert.equal(back.ok, true)
    if (back.ok) assert.deepEqual(back.value.record, { wins: 1, losses: 1 })
  })

  /*
   * 빈 채로 열면 가입해 둔 사람들이 「없는 계정」이 되어 다시 가입하고, 같은 이메일로
   * 줄이 둘 생긴다. 그것보다는 닫는 편이 낫다 — 게스트는 그때도 그대로 된다.
   */
  it('밖에 둔 것을 못 읽으면 계정 기능을 잠근다', async () => {
    const { store } = fake({
      loadAll: async () => {
        throw new Error('못 읽었다')
      },
    })
    const accounts = new Accounts(store, quick)
    await accounts.load()

    assert.equal(accounts.closed, true)
    assert.equal((await accounts.signup('tk@example.com', 'pass1234', '태규')).ok, false)
    assert.equal(accounts.login('tk@example.com', 'pass1234').ok, false)
  })

  it('세 번까지 다시 해보고, 그 안에 되면 열린다', async () => {
    let tried = 0
    const { store } = fake({
      loadAll: async () => {
        tried += 1
        if (tried < 3) throw new Error('아직')
        return []
      },
    })
    const accounts = new Accounts(store, quick)
    await accounts.load()

    assert.equal(tried, 3)
    assert.equal(accounts.closed, false)
  })

  /* 순서를 뒤집으면 「가입됐다」고 말해 놓고 서버가 다시 뜨는 순간 그 계정이 없어진다. */
  it('밖에 쓰지 못하면 메모리에도 남지 않는다', async () => {
    const { store } = fake({
      create: async () => {
        throw new Error('못 썼다')
      },
    })
    const accounts = new Accounts(store, quick)

    assert.equal((await accounts.signup('tk@example.com', 'pass1234', '태규')).ok, false)
    assert.equal(accounts.size, 0)
    assert.equal(accounts.login('tk@example.com', 'pass1234').ok, false)
  })

  /* 부팅 로딩이 반쯤 어긋났을 때 같은 이메일로 줄이 둘 생기는 것을 막는다. */
  it('메모리에 없어도 밖에 있으면 가입을 막는다', async () => {
    const { store, rows, calls } = fake()
    rows.push({
      email: 'tk@example.com',
      nickname: '태규',
      passwordHash: 'x',
      passwordSalt: 'y',
      wins: 0,
      losses: 0,
      cosmetics: null,
    })

    const accounts = new Accounts(store, quick)
    assert.equal((await accounts.signup('tk@example.com', 'pass1234', '태규')).ok, false)
    assert.equal(calls.includes('has'), true)
    assert.equal(calls.includes('create'), false)
  })
})

/*
 * **값은 표에서 읽는다.** 가격은 고치라고 있는 숫자라(`cosmetics.ts`) 시험에 박아 두면
 * 값을 손볼 때마다 관계없는 시험이 무더기로 깨진다. 아래가 보려는 것은 「25가 맞는가」가
 * 아니라 「모자라면 막는가 · 쓴 만큼만 느는가」다.
 */
const price = (id: string) => cosmeticOf(id)?.price ?? 0
/** 「나이트 카울」과 「섀도우 마스크」. 값이 다른 아이템 둘이면 아래는 다 성립한다. */
const COWL = price('bat')
const MASK = price('mask')

/**
 * 코스메틱 — 골드가 걸린 자리라 판정이 서버에 있어야 한다.
 *
 * 누적 승리는 줄지 않고, 사용한 만큼(`spent`)을 따로 센다. 그 둘의 차가 보유 골드다.
 */
describe('코스메틱', () => {
  /** 승리를 원하는 수만큼 쌓아 둔 계정 하나. 보유 골드는 곧 승리 수다. */
  async function signedIn(wins: number) {
    const accounts = new Accounts(null)
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')
    const token = made.value.token
    for (let at = 0; at < wins; at += 1) accounts.record(token, 'win', `heist-${at}`)
    return { accounts, token }
  }

  it('처음에는 아무것도 구매하지 않았고 기본 차림이다', async () => {
    const { accounts, token } = await signedIn(0)
    const me = accounts.resume(token)
    assert.equal(me.ok, true)
    if (!me.ok) return
    assert.deepEqual(me.value.cosmetics.owned, [])
    assert.equal(me.value.cosmetics.spent, 0)
    assert.deepEqual(me.value.cosmetics.equipped, DEFAULT_EQUIPPED)
  })

  it('골드가 부족하면 구매할 수 없다', async () => {
    // 「나이트 카울」에 딱 1 모자란 계정.
    const { accounts, token } = await signedIn(COWL - 1)
    const bought = await accounts.buy(token, 'bat')
    assert.equal(bought.ok, false)
    if (!bought.ok) assert.match(bought.message, /골드가 1 부족합니다/)
  })

  it('구매하면 사용한 만큼만 늘고 누적 승리는 그대로다', async () => {
    const wins = COWL + 5
    const { accounts, token } = await signedIn(wins)
    const bought = await accounts.buy(token, 'bat')
    assert.equal(bought.ok, true)
    if (!bought.ok) return

    assert.deepEqual(bought.value.owned, ['bat'])
    assert.equal(bought.value.spent, COWL)

    const me = accounts.resume(token)
    assert.equal(me.ok, true)
    if (!me.ok) return
    assert.equal(me.value.record.wins, wins, '전적은 깎이지 않는다')
    assert.equal(balanceOf(me.value.record.wins, me.value.cosmetics.spent), 5)
  })

  it('같은 것을 두 번 구매할 수 없다', async () => {
    const { accounts, token } = await signedIn(COWL * 2)
    assert.equal((await accounts.buy(token, 'bat')).ok, true)
    const again = await accounts.buy(token, 'bat')
    assert.equal(again.ok, false)
    if (!again.ok) assert.match(again.message, /이미 보유한/)
  })

  it('존재하지 않는 아이템은 구매할 수 없다', async () => {
    const { accounts, token } = await signedIn(99)
    assert.equal((await accounts.buy(token, '없는것')).ok, false)
  })

  it('보유한 것만 장착할 수 있다 — 미보유 슬롯은 기본으로 되돌린다', async () => {
    const { accounts, token } = await signedIn(COWL)
    assert.equal((await accounts.buy(token, 'bat')).ok, true)

    const worn = await accounts.equip(token, { avatar: 'bat', banner: 'castle' })
    assert.equal(worn.ok, true)
    if (!worn.ok) return
    assert.equal(worn.value.equipped.avatar, 'bat', '산 것은 걸친다')
    assert.equal(worn.value.equipped.banner, DEFAULT_EQUIPPED.banner, '안 산 겹만 되돌아간다')
  })

  it('0원짜리는 사지 않아도 걸칠 수 있다', async () => {
    const { accounts, token } = await signedIn(0)
    const worn = await accounts.equip(token, { avatar: 'square' })
    assert.equal(worn.ok, true)
    if (!worn.ok) return
    assert.equal(worn.value.equipped.avatar, 'square')
  })

  it('로그인하지 않았으면 사지도 걸치지도 못한다', async () => {
    const accounts = new Accounts(null)
    assert.equal((await accounts.buy('없는표', 'bat')).ok, false)
    assert.equal((await accounts.equip('없는표', { avatar: 'bat' })).ok, false)
  })

  /*
   * 밖에 남기지 못하면 구매하지 않은 것으로 둔다. 순서를 뒤집으면 「구매 완료」라고
   * 말해 놓고 서버가 다시 뜨는 순간 골드만 깎인 채로 남는다.
   */
  it('밖에 남기지 못하면 구매하지 않은 것이 된다', async () => {
    const { store, rows } = fake({
      saveCosmetics: async () => {
        throw new Error('저장소가 안 된다')
      },
    })
    void rows
    const accounts = new Accounts(store, { retryWaitMs: 1, holdMs: 1 })
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) return
    const token = made.value.token
    for (let at = 0; at < 30; at += 1) accounts.record(token, 'win', `heist-${at}`)

    const bought = await accounts.buy(token, 'bat')
    assert.equal(bought.ok, false)

    const me = accounts.resume(token)
    assert.equal(me.ok, true)
    if (!me.ok) return
    assert.deepEqual(me.value.cosmetics.owned, [], '보유한 것이 없어야 한다')
    assert.equal(me.value.cosmetics.spent, 0, '골드도 그대로여야 한다')
  })
})

/**
 * 같은 계정이 두 군데서 동시에 손댈 때.
 *
 * 화면의 잠금은 **그 창 안에서만 보인다.** 같은 계정을 두 창에 열면 서로를 모르므로,
 * 막는 자리는 서버여야 한다. 여기서 쓰는 저장소는 **일부러 느리다** — 밖에 쓰는 동안
 * 열리는 틈이 이 결함의 전부라, 저장소가 즉시 끝나면 재현되지 않는다.
 */
describe('꾸미기 동시 요청', () => {
  /** 밖에 쓰는 데 시간이 걸리는 저장소. 운영의 Contentful 자리다. */
  function slow(): AccountStore {
    return {
      loadAll: async () => [],
      has: async () => false,
      create: async () => {},
      saveRecord: async () => {},
      saveCosmetics: async () => {
        await new Promise((done) => setTimeout(done, 5))
      },
    }
  }

  /** 원하는 만큼 이겨 둔 계정 하나. 저장소는 느린 것으로 준다. */
  async function rich(wins: number) {
    const accounts = new Accounts(slow(), { retryWaitMs: 1, holdMs: 1 })
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')
    const token = made.value.token
    for (let at = 0; at < wins; at += 1) accounts.record(token, 'win', `heist-${at}`)
    return { accounts, token }
  }

  function worn(accounts: Accounts, token: string) {
    const me = accounts.resume(token)
    assert.equal(me.ok, true)
    if (!me.ok) throw new Error('unreachable')
    return me.value.cosmetics
  }

  /*
   * 「구매 완료」가 두 번 나가면 안 된다. 골드는 한 번만 깎이므로 손해는 없지만,
   * 두 번 깎였다고 읽힌다 — 말이 값을 잘못 일러 주는 자리다.
   */
  it('같은 것을 동시에 사면 한 번만 성공한다', async () => {
    const { accounts, token } = await rich(500)
    const both = await Promise.all([accounts.buy(token, 'bat'), accounts.buy(token, 'bat')])

    assert.equal(both.filter((one) => one.ok).length, 1, '한 쪽만 성공해야 한다')
    const failed = both.find((one) => !one.ok)
    if (failed && !failed.ok) assert.match(failed.message, /이미 보유한/)
    assert.equal(worn(accounts, token).spent, COWL)
  })

  /*
   * 이쪽이 값을 잃는 자리다. 둘 다 자기가 읽은 값 위에 통째로 덮어쓰면, 나중에 끝난
   * 쪽이 먼저 끝난 쪽을 지운다 — 「구매 완료」라고 답해 놓고 아이템도 골드도 없다.
   */
  it('다른 것을 동시에 사면 둘 다 남는다', async () => {
    const { accounts, token } = await rich(500)
    const both = await Promise.all([accounts.buy(token, 'bat'), accounts.buy(token, 'mask')])

    assert.equal(both.every((one) => one.ok), true)
    const after = worn(accounts, token)
    assert.deepEqual([...after.owned].sort(), ['bat', 'mask'])
    assert.equal(after.spent, COWL + MASK)
  })

  /** 장착도 통째로 덮어쓴다. 줄 밖에 두면 그 사이에 끝난 구매를 지운다. */
  it('사는 사이에 장착해도 구매가 지워지지 않는다', async () => {
    const { accounts, token } = await rich(500)
    const both = await Promise.all([
      accounts.buy(token, 'bat'),
      accounts.equip(token, { bg: 'slate' }),
    ])

    assert.equal(both.every((one) => one.ok), true)
    const after = worn(accounts, token)
    assert.deepEqual(after.owned, ['bat'])
    assert.equal(after.spent, COWL)
  })

  /** 잔액도 줄 안에서 다시 세야 한다. 밖에서 한 번만 보면 둘 다 통과한다. */
  it('둘을 살 만큼은 없는 골드로 동시에 사면 한 쪽만 나간다', async () => {
    // 둘 중 비싼 것 하나는 사고 둘을 함께는 못 사는 딱 그만큼.
    const purse = Math.max(COWL, MASK)
    assert.equal(purse < COWL + MASK, true, '둘을 함께는 못 사는 액수여야 시험이 성립한다')
    const { accounts, token } = await rich(purse)
    const both = await Promise.all([accounts.buy(token, 'bat'), accounts.buy(token, 'mask')])

    assert.equal(both.filter((one) => one.ok).length, 1, '한 쪽만 성공해야 한다')
    const failed = both.find((one) => !one.ok)
    if (failed && !failed.ok) assert.match(failed.message, /골드가 .* 부족합니다/)
    assert.equal(worn(accounts, token).spent <= purse, true, '가진 것보다 더 쓸 수 없다')
  })
})
