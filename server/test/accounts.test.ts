/**
 * 계정. 하는 일은 둘이다 — 같은 사람이 돌아왔을 때 알아보는 것과 전적을 이어 주는 것.
 *
 * 유일한 것은 이메일뿐이다. 닉네임은 겹쳐도 되므로 그것으로 자리를 다투지 않는다.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_EQUIPPED,
  EMPTY_COSMETICS,
  LEGACY_GOLD_RATE,
  balanceOf,
  cosmeticOf,
  owns,
  sanitizeEquipped,
  shopCosmetics,
} from '@the-gang/shared'

import { Accounts } from '../src/accounts.ts'
import { readCosmetics, type AccountStore, type StoredAccount } from '../src/accountStore.ts'

/*
 * 가입과 로그인은 비동기다. 둘 다 비밀번호 해시(scrypt)를 스레드에서 기다리고, 가입은
 * 거기에 밖에 먼저 쓰는 걸음이 더 있다 — 여기서는 저장소를 주지 않으므로 그 걸음은 없다.
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
    assert.equal((await accounts.login(' TK@Example.com ', 'pass1234')).ok, true)
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

  /* 해시를 기다리는 사이가 생겼다. 그 틈에 같은 이메일이 둘 들어오면 안 된다. */
  it('같은 이메일로 동시에 가입하면 하나만 된다', async () => {
    const accounts = new Accounts()
    const results = await Promise.all([
      accounts.signup('tk@example.com', 'pass1234', '하나'),
      accounts.signup('tk@example.com', 'pass5678', '둘'),
    ])
    // 해시는 스레드에서 돌아 어느 쪽이 먼저 끝날지 정해져 있지 않다. 하나만 되면 된다.
    assert.equal(results.filter((result) => result.ok).length, 1)
  })

  it('짧은 비밀번호와 빈 닉네임은 받지 않는다', async () => {
    const accounts = new Accounts()
    assert.equal((await accounts.signup('tk@example.com', 'ab', '태규')).ok, false)
    assert.equal((await accounts.signup('tk@example.com', 'pass1234', '   ')).ok, false)
  })
})

describe('로그인', () => {
  /*
   * 해시를 동기로 돌리면 그동안 서버 전체가 선다 — 다른 방의 토큰도, 쇼다운도.
   * 로그인 다섯이 겹치는 동안 1ms 시계가 한 번도 못 돌면 루프가 막힌 것이다.
   */
  it('비밀번호를 견주는 동안 서버의 다른 일을 막지 않는다', async () => {
    const { accounts } = await makeOne()
    let ticks = 0
    const clock = setInterval(() => (ticks += 1), 1)
    await Promise.all(Array.from({ length: 5 }, () => accounts.login('tk@example.com', 'pass1234')))
    clearInterval(clock)
    assert.equal(ticks > 0, true, '해시가 이벤트 루프 위에서 돌았다')
  })

  it('맞으면 들어가고 틀리면 막힌다', async () => {
    const { accounts } = await makeOne()
    assert.equal((await accounts.login('tk@example.com', 'pass1234')).ok, true)
    assert.equal((await accounts.login('tk@example.com', 'nope1234')).ok, false)
  })

  /* 갈라 말하면 어느 주소가 쓰이고 있는지 물어보는 것만으로 알 수 있다. */
  it('없는 이메일과 틀린 비밀번호를 같은 말로 돌려보낸다', async () => {
    const { accounts } = await makeOne()
    const noSuch = await accounts.login('nobody@example.com', 'pass1234')
    const wrongPass = await accounts.login('tk@example.com', 'nope1234')
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
    const again = await accounts.login('tk@example.com', 'pass1234')
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
    const second = await accounts.login('tk@example.com', 'pass1234')
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
      saveAccount: async (email, changes) => {
        calls.push(`saveAccount:${Object.keys(changes).sort().join('+')}`)
        const row = rows.find((one) => one.email === email)
        if (row && changes.record) Object.assign(row, changes.record)
        if (row && changes.cosmetics) row.cosmetics = changes.cosmetics
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

  /*
   * 골드는 판 도중에 밖에 쓰지 않는다. 금고가 열릴 때마다 쓰면 다음 라운드의 토큰을
   * 집는 동안 요청이 몰려 판이 굼떴다. 판이 끝나면(전적을 적을 때) 한 번에 나간다.
   */
  it('판 도중에 번 골드는 판이 끝날 때 전적과 한 번에 나간다', async () => {
    const { store, rows, calls } = fake()
    const accounts = new Accounts(store, quick)
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) return
    const token = made.value.token
    calls.length = 0

    accounts.earn(token, 'ROOM:1:1')
    accounts.earn(token, 'ROOM:1:2')
    await new Promise((done) => setTimeout(done, 30))
    assert.deepEqual(calls, [], '판 도중에는 아무것도 쓰지 않는다')
    const now = accounts.resume(token)
    assert.equal(now.ok && now.value.cosmetics.earned, 2, '잔액은 메모리에서 바로 오른다')

    accounts.record(token, 'win', 'ROOM:1:win')
    await new Promise((done) => setTimeout(done, 30))
    assert.deepEqual(calls, ['saveAccount:cosmetics+record'], '전적과 골드를 한 번에 쓴다')
    assert.equal(rows[0].cosmetics?.earned, 2)
    assert.equal(rows[0].wins, 1)
  })

  it('판 도중에 떠나면 그때까지 번 골드만 쓴다', async () => {
    const { store, rows, calls } = fake()
    const accounts = new Accounts(store, quick)
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) return
    calls.length = 0

    accounts.earn(made.value.token, 'ROOM:1:1')
    accounts.release('tk@example.com')
    await new Promise((done) => setTimeout(done, 30))
    assert.deepEqual(calls, ['saveAccount:cosmetics'], '바뀌지 않은 전적은 쓰지 않는다')
    assert.equal(rows[0].cosmetics?.earned, 1)
  })

  it('서버를 끌 때 미뤄 둔 골드도 내보낸다', async () => {
    const { store, rows } = fake()
    const accounts = new Accounts(store, quick)
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) return

    accounts.earn(made.value.token, 'ROOM:1:1')
    await accounts.stop()
    assert.equal(rows[0].cosmetics?.earned, 1)
  })

  it('아무도 내보내 주지 않으면 한도가 지나 스스로 나간다', async () => {
    const { store, rows } = fake()
    const accounts = new Accounts(store, { ...quick, goldHoldMs: 5 })
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) return

    accounts.earn(made.value.token, 'ROOM:1:1')
    await new Promise((done) => setTimeout(done, 40))
    assert.equal(rows[0].cosmetics?.earned, 1)
  })

  it('부팅 때 읽어 온 계정으로 곧바로 로그인된다', async () => {
    const { store, rows } = fake()
    // 먼저 한 서버에서 가입해 둔 것처럼 밖에 한 줄을 만든다.
    const first = new Accounts(store, quick)
    assert.equal((await first.signup('tk@example.com', 'pass1234', '태규')).ok, true)

    // 서버가 다시 떴다. 메모리는 비어 있고 밖에 있는 것만 읽는다.
    const next = new Accounts(store, quick)
    await next.load()
    assert.equal(next.size, 1)
    assert.equal((await next.login('tk@example.com', 'pass1234')).ok, true)
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
    const back = await next.login('tk@example.com', 'pass1234')
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
    assert.equal((await accounts.login('tk@example.com', 'pass1234')).ok, false)
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
    assert.equal((await accounts.login('tk@example.com', 'pass1234')).ok, false)
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
 * 번 골드(`earned`, 연 금고 하나에 1)는 줄지 않고, 사용한 만큼(`spent`)을 따로 센다.
 * 그 둘의 차가 보유 골드다. 전적(승·패)과는 따로 돈다.
 */
describe('코스메틱', () => {
  /** 금고를 원하는 수만큼 열어 둔 계정 하나. 보유 골드는 곧 연 금고 수다. */
  async function signedIn(vaults: number) {
    const accounts = new Accounts(null)
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')
    const token = made.value.token
    for (let at = 0; at < vaults; at += 1) accounts.earn(token, `heist-${at}`)
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

  it('구매하면 사용한 만큼만 늘고 번 골드는 그대로다', async () => {
    const vaults = COWL + 5
    const { accounts, token } = await signedIn(vaults)
    const bought = await accounts.buy(token, 'bat')
    assert.equal(bought.ok, true)
    if (!bought.ok) return

    assert.deepEqual(bought.value.owned, ['bat'])
    assert.equal(bought.value.spent, COWL)

    const me = accounts.resume(token)
    assert.equal(me.ok, true)
    if (!me.ok) return
    assert.equal(me.value.cosmetics.earned, vaults, '번 골드는 깎이지 않는다')
    assert.equal(balanceOf(me.value.cosmetics), 5)
  })

  /*
   * 골드는 게임이 아니라 금고로 센다(2026-09-21). 끝까지 못 하고 자리를 뜨는 사람에게도
   * 그동안 연 금고는 남아야 한다 — 전적은 여전히 끝을 본 게임만 센다.
   */
  it('금고를 열면 게임이 끝나지 않아도 골드가 쌓이고, 전적은 그대로다', async () => {
    const { accounts, token } = await signedIn(0)
    const earned = accounts.earn(token, 'ROOM:1:1')
    assert.equal(earned.ok, true)
    if (earned.ok) assert.equal(balanceOf(earned.value), 1)

    const me = accounts.resume(token)
    if (me.ok) assert.deepEqual(me.value.record, { wins: 0, losses: 0 })
  })

  /*
   * 옛 줄에는 `earned` 가 없다. 그때는 이긴 게임 수가 곧 번 골드였으므로 그 값으로
   * 읽어야 가진 골드가 그대로 넘어온다 — 0 으로 읽으면 이미 쓴 사람의 잔액이 사라진다.
   */
  it('옛 계정은 번 것과 쓴 것을 같은 배율로 옮겨 읽는다', () => {
    const old = readCosmetics({ owned: ['bat'], equipped: {}, spent: 30 }, 34)
    assert.equal(old?.earned, 34 * LEGACY_GOLD_RATE)
    if (old) assert.equal(balanceOf(old), 4 * LEGACY_GOLD_RATE, '잔액이 그 배율 그대로 넘어온다')

    const moved = readCosmetics({ owned: [], equipped: {}, earned: 50, spent: 30 }, 34)
    assert.equal(moved?.earned, 50, '한 번 옮긴 뒤로는 제 값을 따른다')
    assert.equal(moved?.spent, 30, '두 번 곱하면 쓴 돈이 불어난다')
  })

  it('같은 금고는 한 번만 센다 — 새로고침으로 두 번 보내도', async () => {
    const { accounts, token } = await signedIn(0)
    accounts.earn(token, 'ROOM:1:1')
    const again = accounts.earn(token, 'ROOM:1:1')
    if (again.ok) assert.equal(again.value.earned, 1)
  })

  it('게임을 이기는 것만으로는 골드가 늘지 않는다', async () => {
    const { accounts, token } = await signedIn(0)
    accounts.record(token, 'win', 'ROOM:1:win')
    const me = accounts.resume(token)
    if (me.ok) assert.equal(balanceOf(me.value.cosmetics), 0)
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

  /*
   * 선물 전용 — 파는 물건이 아니라 주는 물건이다.
   *
   * 상점 목록에 없으니 화면에서는 누를 수 없지만, 요청은 손으로 만들 수 있다.
   * 막는 자리가 서버여야 하는 이유가 그것뿐이다.
   */
  it('선물 전용은 골드가 넘쳐도 살 수 없다', async () => {
    const { accounts, token } = await signedIn(999)
    const bought = await accounts.buy(token, 'insider')
    assert.equal(bought.ok, false)
    if (!bought.ok) assert.match(bought.message, /상점에서 살 수 없는/)
  })

  /** 값이 0이 아니어야 하는 이유. 0이면 「기본 지급」으로 새어 모두의 것이 된다. */
  it('선물 전용은 받기 전에는 가진 것이 아니다', async () => {
    assert.equal(owns(EMPTY_COSMETICS, 'insider'), false)
    assert.equal(
      shopCosmetics('avatar', EMPTY_COSMETICS).some((one) => one.id === 'insider'),
      false,
      '못 받은 사람의 상점에는 서지 않는다',
    )
  })

  /** 밖에서 손으로 넣어 주면(Contentful 의 owned) 그때부터 가진 것이고 걸칠 수 있다. */
  it('선물받으면 목록에 서고 걸칠 수 있다', async () => {
    const given = { ...EMPTY_COSMETICS, owned: ['insider'] }
    assert.equal(owns(given, 'insider'), true)
    assert.equal(
      shopCosmetics('avatar', given).some((one) => one.id === 'insider'),
      true,
      '받은 사람에게는 보여야 걸칠 수 있다',
    )
    assert.equal(sanitizeEquipped({ ...given, equipped: { ...DEFAULT_EQUIPPED, avatar: 'insider' } }).avatar, 'insider')
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
      saveAccount: async () => {},
      saveCosmetics: async () => {
        await new Promise((done) => setTimeout(done, 5))
      },
    }
  }

  /** 금고를 원하는 만큼 열어 둔 계정 하나. 저장소는 느린 것으로 준다. */
  async function rich(vaults: number) {
    const accounts = new Accounts(slow(), { retryWaitMs: 1, holdMs: 1 })
    const made = await accounts.signup('tk@example.com', 'pass1234', '태규')
    assert.equal(made.ok, true)
    if (!made.ok) throw new Error('unreachable')
    const token = made.value.token
    for (let at = 0; at < vaults; at += 1) accounts.earn(token, `heist-${at}`)
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
