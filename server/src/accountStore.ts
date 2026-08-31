/**
 * 계정을 서버 밖에 남겨 두는 자리.
 *
 * 서버 메모리는 다시 띄우면 비어 있고, 무료 요금제는 15분 동안 아무도 오지 않으면
 * 잠든다. 계정까지 그때 사라지면 「가입」이라는 말이 거짓이 된다. 그래서 계정을
 * 밖에 한 벌 둔다 — 전적까지 함께 둔다. 판이 끝날 때마다 한 줄 쓰는 값이 싸기 때문이다.
 *
 * **읽는 것은 부팅 때 한 번뿐이다.** 로그인도 전적 조회도 메모리만 본다. 그래서
 * 관리 API(CMA)만 쓴다 — 읽기용 API 는 CDN 캐시라 방금 쓴 것이 몇 초 늦게 보이고,
 * 보이게 하려면 발행(publish)을 한 번 더 불러야 한다. 우리는 그 이점이 필요 없으므로
 * 두 가지를 통째로 건너뛴다.
 *
 * SDK 를 붙이지 않는다. 부르는 곳이 넷뿐이고, 이 저장소는 소리도 파일 대신 파형으로
 * 만들 만큼 의존성을 아낀다.
 */

import { logLine } from './log.ts'

/** 밖에 남는 한 줄. 필드 이름이 Contentful 의 것과 같아야 해서 여기서 정한다. */
export interface StoredAccount {
  email: string
  nickname: string
  passwordHash: string
  passwordSalt: string
  wins: number
  losses: number
}

export interface AccountStore {
  /** 부팅 때 한 번. 실패하면 던진다 — 부르는 쪽이 다시 시도한다. */
  loadAll(): Promise<StoredAccount[]>
  /** 이 이메일이 이미 밖에 있나. 메모리가 비어 있을 수 있으므로 가입 때 한 번 더 본다. */
  has(email: string): Promise<boolean>
  /** 가입. 이것이 성공해야 메모리에 넣는다. */
  create(account: StoredAccount): Promise<void>
  /** 전적. 뒤에서 보내고 실패는 삼킨다. */
  saveRecord(email: string, wins: number, losses: number): Promise<void>
}

const BASE = 'https://api.contentful.com'
const CONTENT_TYPE = 'account'
/** 한 번에 받아오는 최대치. 친구들끼리 쓰는 판이라 한 장이면 남는다. */
const PAGE = 1000

interface Ref {
  id: string
  /** 고칠 때 X-Contentful-Version 으로 돌려줘야 한다. 틀리면 409 로 막힌다. */
  version: number
}

/**
 * 환경변수가 다 있으면 Contentful, 하나라도 없으면 없는 것으로 친다.
 *
 * 없을 때 조용히 메모리만으로 도는 것이 중요하다 — 테스트와 로컬이 자격증명 없이
 * 그대로 돌아가야 하고, 그러지 않으면 이 파일 하나가 저장소 전체를 인질로 잡는다.
 */
export function accountStore(): AccountStore | null {
  const space = process.env.CONTENTFUL_SPACE_ID
  const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN
  const environment = process.env.CONTENTFUL_ENVIRONMENT ?? 'master'
  if (!space || !token) return null
  return new ContentfulAccounts(space, environment, token)
}

class ContentfulAccounts implements AccountStore {
  /** 이메일 → 그 항목이 어디 있고 몇 번째 판인가. 고치려면 둘 다 있어야 한다. */
  private refs = new Map<string, Ref>()
  /**
   * 기본 로케일.
   *
   * 필드 값이 로케일로 한 겹 감싸여 있다. 코드를 박아 두면 스페이스를 다른 로케일로
   * 만든 순간 전부 어긋나므로 부팅 때 물어본다.
   */
  private locale = 'en-US'

  /*
   * 생성자에서 필드를 선언하지 않는다(`private space: string`). 이 저장소는 빌드 단계가
   * 없어 타입만 벗겨내는데, 그 문법은 벗겨내는 것만으로 사라지지 않는다.
   * tsconfig 의 erasableSyntaxOnly 가 그것을 잡아준다.
   */
  private space: string
  private environment: string
  private token: string

  constructor(space: string, environment: string, token: string) {
    this.space = space
    this.environment = environment
    this.token = token
  }

  async loadAll(): Promise<StoredAccount[]> {
    this.locale = await this.defaultLocale()
    const page = (await this.send('GET', `/entries?content_type=${CONTENT_TYPE}&limit=${PAGE}`)) as {
      items?: unknown[]
      total?: number
    }
    const items = Array.isArray(page.items) ? page.items : []
    if (typeof page.total === 'number' && page.total > items.length) {
      // 한 장을 넘겼다. 지금 규모에서는 날 일이 아니지만, 났다면 조용히 잘리면 안 된다.
      logLine('error', `계정이 ${page.total}개인데 ${items.length}개만 읽었다. 페이지를 나눠야 한다`)
    }

    this.refs.clear()
    const loaded: StoredAccount[] = []
    for (const item of items) {
      const account = this.read(item)
      if (account) loaded.push(account)
    }
    return loaded
  }

  async has(email: string): Promise<boolean> {
    /*
     * 걸러 달라고 부탁하되 받은 것을 다시 본다. 조건이 무시되면 전부 돌아오는데,
     * 그것을 그대로 「있다」로 읽으면 아무도 가입할 수 없게 된다.
     */
    const found = (await this.send(
      'GET',
      `/entries?content_type=${CONTENT_TYPE}&fields.email=${encodeURIComponent(email)}&limit=${PAGE}`,
    )) as { items?: unknown[] }
    const items = Array.isArray(found.items) ? found.items : []
    return items.some((item) => this.read(item)?.email === email)
  }

  async create(account: StoredAccount): Promise<void> {
    const made = (await this.send('POST', '/entries', this.body(account), {
      'X-Contentful-Content-Type': CONTENT_TYPE,
    })) as { sys?: { id?: string; version?: number } }

    const id = made.sys?.id
    const version = made.sys?.version
    if (typeof id !== 'string' || typeof version !== 'number') {
      throw new Error('만들어진 항목의 자리를 알 수 없다')
    }
    this.refs.set(account.email, { id, version })
  }

  async saveRecord(email: string, wins: number, losses: number): Promise<void> {
    const ref = this.refs.get(email)
    if (!ref) throw new Error(`밖에 없는 계정이다: ${email}`)

    // 고치는 것도 전체를 보낸다. 부분 수정이 없어서 지금 값을 다시 실어야 한다.
    const kept = (await this.send('GET', `/entries/${ref.id}`)) as {
      fields?: Record<string, Record<string, unknown>>
      sys?: { version?: number }
    }
    const fields = kept.fields ?? {}
    fields.wins = { [this.locale]: wins }
    fields.losses = { [this.locale]: losses }
    // 방금 읽은 판이 우리가 들고 있던 것보다 새로울 수 있다. 그쪽을 믿는다.
    if (typeof kept.sys?.version === 'number') ref.version = kept.sys.version

    const saved = (await this.send(
      'PUT',
      `/entries/${ref.id}`,
      { fields },
      { 'X-Contentful-Version': String(ref.version) },
    )) as { sys?: { version?: number } }

    const next = saved.sys?.version
    if (typeof next === 'number') ref.version = next
  }

  /** 필드 값을 로케일로 감싼다. Contentful 이 그렇게 받는다. */
  private body(account: StoredAccount): { fields: Record<string, Record<string, unknown>> } {
    const at = (value: unknown) => ({ [this.locale]: value })
    return {
      fields: {
        email: at(account.email),
        nickname: at(account.nickname),
        passwordHash: at(account.passwordHash),
        passwordSalt: at(account.passwordSalt),
        wins: at(account.wins),
        losses: at(account.losses),
      },
    }
  }

  /** 항목 하나를 우리 모양으로. 어느 한 칸이라도 비면 버린다 — 반쯤 만들어진 줄이다. */
  private read(item: unknown): StoredAccount | null {
    const entry = item as {
      sys?: { id?: string; version?: number }
      fields?: Record<string, Record<string, unknown>>
    }
    const fields = entry.fields
    const id = entry.sys?.id
    const version = entry.sys?.version
    if (!fields || typeof id !== 'string' || typeof version !== 'number') return null

    const pick = (name: string): unknown => {
      const field = fields[name]
      if (!field) return undefined
      // 기본 로케일을 못 찾으면 들어 있는 첫 값을 쓴다. 로케일이 바뀐 옛 줄일 수 있다.
      return this.locale in field ? field[this.locale] : Object.values(field)[0]
    }

    const email = pick('email')
    const nickname = pick('nickname')
    const passwordHash = pick('passwordHash')
    const passwordSalt = pick('passwordSalt')
    if (
      typeof email !== 'string' ||
      typeof nickname !== 'string' ||
      typeof passwordHash !== 'string' ||
      typeof passwordSalt !== 'string'
    ) {
      logLine('error', `계정 한 줄을 읽지 못했다: ${id}`)
      return null
    }

    const wins = pick('wins')
    const losses = pick('losses')
    this.refs.set(email, { id, version })
    return {
      email,
      nickname,
      passwordHash,
      passwordSalt,
      wins: typeof wins === 'number' ? wins : 0,
      losses: typeof losses === 'number' ? losses : 0,
    }
  }

  private async defaultLocale(): Promise<string> {
    const list = (await this.send('GET', '/locales')) as {
      items?: { code?: string; default?: boolean }[]
    }
    const items = list.items ?? []
    return items.find((one) => one.default)?.code ?? items[0]?.code ?? this.locale
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<unknown> {
    const url = `${BASE}/spaces/${this.space}/environments/${this.environment}${path}`
    const answer = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/vnd.contentful.management.v1+json',
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!answer.ok) {
      /*
       * 본문을 조금만 실어 보낸다. 통째로 남기면 로그가 한 번의 실패로 가득 차고,
       * 정작 그 앞뒤에 무슨 일이 있었는지가 밀려난다.
       */
      const said = (await answer.text().catch(() => '')).slice(0, 300)
      throw new Error(`Contentful ${method} ${path} → ${answer.status} ${said}`)
    }
    return answer.status === 204 ? null : await answer.json()
  }
}
