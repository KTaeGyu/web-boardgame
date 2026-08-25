/**
 * 경기 기록.
 *
 * 서버에 저장할 곳이 없어서(DB 가 없다) 브라우저가 들고 있는다. localStorage 라
 * 창을 닫아도 기기를 껐다 켜도 남는다 — 정체성이 있는 sessionStorage 와 다른 자리다.
 *
 * **키는 닉네임이다.** 정체성(playerId)은 창마다 다르므로, 그것으로 세면 창을 새로 열
 * 때마다 기록이 0 부터 시작한다. 같은 이름으로 하던 사람이 쌓아온 것을 보는 것이
 * 이 기능의 전부이므로 이름으로 센다.
 *
 * 기록은 이 기기에만 있다. 기기를 바꾸면 따라오지 않고, 사파리는 한동안 방문이 없으면
 * 지운다. 성취감을 위한 것이지 증명서가 아니다.
 */

export interface Record {
  /** 승·패·중도포기의 합. 끝을 본 판만 센다. */
  played: number
  wins: number
  losses: number
  quits: number
}

export type Outcome = 'win' | 'lose' | 'quit'

const KEY = 'the-gang:history'
/** 같은 끝을 두 번 세지 않기 위한 표시. 새로고침해도 남고 창을 닫으면 사라진다. */
const ONCE_KEY = 'the-gang:history:done'

const EMPTY: Record = { played: 0, wins: 0, losses: 0, quits: 0 }

function readAll(): { [nickname: string]: Record } {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as { [k: string]: Record }) : {}
  } catch {
    return {}
  }
}

export function statsOf(nickname: string): Record {
  const found = readAll()[nickname.trim()]
  return found ? { ...EMPTY, ...found } : { ...EMPTY }
}

/** 이 기기에 기록이 남아 있는 이름들. 많이 한 순서로. */
export function allNames(): { nickname: string; record: Record }[] {
  return Object.entries(readAll())
    .map(([nickname, record]) => ({ nickname, record: { ...EMPTY, ...record } }))
    .sort((a, b) => b.record.played - a.record.played)
}

/**
 * 한 판의 끝을 적는다.
 *
 * `token` 은 그 판을 가리키는 표시다. 결과 화면에서 새로고침하면 같은 끝이 다시 오는데,
 * 그때 또 세면 한 판이 두 판이 된다.
 */
export function record(nickname: string, outcome: Outcome, token: string): void {
  const name = nickname.trim()
  if (!name) return

  try {
    if (sessionStorage.getItem(ONCE_KEY) === token) return
    sessionStorage.setItem(ONCE_KEY, token)
  } catch {
    // 표시를 못 남기는 환경이면 세지 않는다. 두 번 세는 것보다 빠뜨리는 편이 낫다.
    return
  }

  const all = readAll()
  const before = all[name] ? { ...EMPTY, ...all[name] } : { ...EMPTY }
  all[name] = {
    played: before.played + 1,
    wins: before.wins + (outcome === 'win' ? 1 : 0),
    losses: before.losses + (outcome === 'lose' ? 1 : 0),
    quits: before.quits + (outcome === 'quit' ? 1 : 0),
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* 기억하지 못할 뿐이다 */
  }
}
