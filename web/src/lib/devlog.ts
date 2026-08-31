/**
 * 화면에서 난 것을 개발 서버로 보내 파일에 적는다(`logs/web.log`).
 *
 * 화면 층에는 테스트 러너가 없고, 무엇이 잘못됐는지는 사람이 보고 옮겨 적어야 했다.
 * 그 자리를 파일 하나로 바꾼다 — 고치는 쪽이 직접 읽을 수 있다.
 *
 * **개발에서만 산다.** `import.meta.env.DEV` 가 배포본에서는 false 로 바뀌고,
 * 이 파일의 알맹이는 통째로 떨어져 나간다. 받는 자리(`/__log`)도 개발 서버에만 있다.
 *
 * 파일이 처음부터 다시 쓰이는 것은 **개발 서버가 다시 뜰 때**다. 새로고침마다 지우면
 * 「새로고침 직전에 무엇이 났는지」를 잃는데, 그것이 대개 보고 싶은 자리다.
 */

const ENDPOINT = '/__log'

/**
 * 한 번에 모아 보낸다. 오류는 대개 한꺼번에 여럿이 나므로, 한 줄에 한 번씩
 * 보내면 요청이 오류보다 많아진다.
 */
let queue: string[] = []
let scheduled = false

/**
 * 이 화면이 남길 수 있는 줄 수.
 *
 * 되풀이되는 오류(다시 그릴 때마다 나는 것)는 끝이 없다. 한도가 없으면 로그가
 * 같은 줄로만 채워져, 정작 처음에 무엇이 났는지가 파일 앞쪽에 묻힌다.
 */
const MAX_LINES = 500
let written = 0

function stamp(): string {
  const now = new Date()
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

function shape(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function flush(): void {
  scheduled = false
  if (queue.length === 0) return
  const lines = queue
  queue = []
  /*
   * keepalive 라 화면을 떠나는 중에도 나간다 — 새로고침 직전에 난 것이 대개
   * 보고 싶은 자리다. 실패는 삼킨다. 로그를 못 보냈다고 화면이 시끄러워지면
   * 그 자체가 새 오류가 된다.
   */
  void fetch(ENDPOINT, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(lines),
  }).catch(() => {})
}

/** 한 줄 남긴다. 개발이 아니면 아무 일도 하지 않는다. */
export function devLog(level: string, ...parts: unknown[]): void {
  if (!import.meta.env.DEV) return
  if (written >= MAX_LINES) return
  written += 1
  if (written === MAX_LINES) {
    queue.push(`${stamp()} [log] ── 여기까지만 적는다(${MAX_LINES}줄). 되풀이되는 오류가 있다 ──`)
  } else {
    queue.push(`${stamp()} [${level}] ${parts.map(shape).join(' ')}`)
  }
  if (scheduled) return
  scheduled = true
  setTimeout(flush, 200)
}

if (import.meta.env.DEV) {
  // 아무도 받지 않은 오류. 콘솔에만 나고 사라지던 것들이다.
  window.addEventListener('error', (event) => {
    devLog('error', event.error ?? `${event.message} (${event.filename}:${event.lineno})`)
  })
  window.addEventListener('unhandledrejection', (event) => devLog('reject', event.reason))

  /*
   * console 은 가로채지 않고 감싼다. 개발자 도구에도 그대로 나와야 한다 —
   * 파일로 옮겨버리면 브라우저를 열어둔 사람이 아무것도 못 본다.
   * React 가 경고를 여기로 보내므로 warn 도 함께 받는다.
   */
  const realError = console.error
  const realWarn = console.warn
  console.error = (...args: unknown[]) => {
    devLog('error', ...args)
    realError(...args)
  }
  console.warn = (...args: unknown[]) => {
    devLog('warn', ...args)
    realWarn(...args)
  }

  // 화면을 떠나기 전에 쌓인 것을 밀어낸다.
  window.addEventListener('pagehide', flush)
}
