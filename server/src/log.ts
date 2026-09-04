/**
 * 로컬에서만 남기는 파일 로그.
 *
 * 화면 층은 눈으로만 확인된다 — 무엇이 잘못됐는지 사람이 보고 옮겨 적어야 했다.
 * 그 자리를 파일 하나로 바꾼다. 로그가 `logs/server.log` 에 쌓이면 코드를 고치는
 * 쪽에서 직접 읽을 수 있다.
 *
 * **뜰 때마다 처음부터 다시 쓴다.** 파일이 하나씩 늘어나면 어느 것이 이번 판의
 * 것인지 고르는 일이 먼저가 된다. 지난 판을 남기는 것보다 지금 판이 처음부터
 * 온전한 편이 낫다 — 서버를 다시 띄우면 어차피 방이 전부 사라지므로, 재부팅
 * 이전의 줄은 지금 벌어지는 일과 이어지지도 않는다.
 *
 * 운영에서는 파일을 남기지 않는다. Render 의 디스크는 배포마다 사라져 남길
 * 자리가 아니고, 그쪽은 대시보드의 로그가 이미 같은 것을 들고 있다.
 *
 * **여기 사는 것이 하나 더 있다** — `guardCrashes()`, 아무도 받지 않은 오류를 받는
 * 마지막 그물이다. 그쪽은 로컬·운영을 가리지 않는다. 전에는 파일 로그 안에 딸려 있어
 * 운영에서만 빠져 있었는데, 죽으면 안 되는 쪽이 운영이라 거꾸로였다.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 감싸이기 전의 진짜 console.
 *
 * 파일 로그가 `console.error` 를 감싸므로, 나중에 붙잡으면 감싼 것을 붙잡게 되어
 * 한 번의 오류가 파일에 두 줄로 남는다. 모듈이 실린 순간에 붙잡아 둔다.
 */
const rawError = console.error
const rawWarn = console.warn

/** 저장소 뿌리. 이 파일이 server/src 에 있으므로 두 칸 올라간다. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILE = join(ROOT, 'logs', 'server.log')

/**
 * 로컬인가.
 *
 * render.yaml 이 운영에만 NODE_ENV=production 을 넣는다. 값이 없으면 로컬이다 —
 * 없는 쪽을 기본으로 두어야 새 환경에서 조용히 꺼져 있는 일이 없다.
 */
export const LOCAL = process.env.NODE_ENV !== 'production'

/** 아직 켜지지 않았으면 어디에도 쓰지 않는다. 테스트는 이 길로 오지 않는다. */
let on = false

function stamp(): string {
  const now = new Date()
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

/** 무엇이 왔든 한 줄로 만든다. Error 는 스택까지, 객체는 JSON 으로. */
function shape(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 한 줄 남긴다. 꺼져 있으면 아무 일도 하지 않는다. */
export function logLine(level: string, ...parts: unknown[]): void {
  if (!on) return
  try {
    appendFileSync(FILE, `${stamp()} [${level}] ${parts.map(shape).join(' ')}\n`, 'utf8')
  } catch {
    /* 로그를 남기려다 서버를 죽일 수는 없다 */
  }
}

/**
 * 파일을 비우고 받아 적기 시작한다. index.ts 에서만 부른다 —
 * 테스트는 app.ts 를 직접 쓰므로 이 길을 밟지 않고, 그래서 파일을 건드리지 않는다.
 */
export function startFileLog(): string | null {
  if (!LOCAL) return null
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, `── 서버 시작 ${new Date().toLocaleString('ko-KR')} ──\n`, 'utf8')
  } catch {
    return null
  }
  on = true

  /*
   * console 을 가로채지 않고 감싼다. 터미널에도 그대로 나와야 한다 —
   * 파일로 옮겨버리면 서버를 띄워둔 사람이 아무것도 못 본다.
   */
  console.error = (...args: unknown[]) => {
    logLine('error', ...args)
    rawError(...args)
  }
  console.warn = (...args: unknown[]) => {
    logLine('warn', ...args)
    rawWarn(...args)
  }

  return FILE
}

/**
 * 마지막 그물 — 아무도 받지 않은 오류를 여기서 받는다.
 *
 * **운영에서도 건다.** 이것이 없으면 Node 는 미처리 거부를 예외로 바꿔 던지고, 받는
 * 사람이 없으므로 **프로세스를 끝낸다.** 전에는 이 등록이 파일 로그 안에 들어 있어
 * `if (!LOCAL) return null` 에 걸렸다 — 로컬은 살아남고 운영만 죽는 거꾸로였다.
 *
 * **받고 나서 계속 돈다.** 죽는 쪽이 정석이라는 말이 있지만 그것은 다시 세우면 상태가
 * 돌아오는 서버의 이야기다. 여기는 방도 판도 메모리에만 있어 재시작이 곧 전멸이고,
 * 하던 판 열 개를 잃는 값이 「의심스러운 상태로 계속 도는」 값보다 크다.
 *
 * 그래서 **삼키지는 않는다.** 로컬이면 `logs/server.log` 에, 운영이면 Render 대시보드에
 * 남는다. 조용히 넘어가면 이 그물이 버그를 가리는 물건이 된다.
 */
export function guardCrashes(): void {
  process.on('uncaughtException', (error) => {
    logLine('crash', error)
    rawError('[the-gang] 아무도 받지 않은 예외 — 계속 돈다', error)
  })
  process.on('unhandledRejection', (reason) => {
    logLine('crash', reason)
    rawError('[the-gang] 아무도 받지 않은 거부 — 계속 돈다', reason)
  })
}
