import { accountStore } from './accountStore.ts'
import { createApp } from './app.ts'
import { CORS_ORIGINS, PORT } from './config.ts'
import { logLine, startFileLog } from './log.ts'

// 방을 만들기 전에 켠다. 부팅에서 나는 것도 파일에 있어야 한다.
const logFile = startFileLog()

/*
 * 계정을 밖에 남겨 두는 자리는 여기서만 만든다. 환경변수가 다 있으면 Contentful,
 * 하나라도 없으면 메모리만으로 돈다 — 테스트는 createApp 을 직접 쓰므로 이 길을 밟지 않는다.
 */
const app = createApp({ accounts: accountStore() })

app.http.listen(PORT, () => {
  console.log(`[the-gang] 소켓 서버 :${PORT}`)
  console.log(`[the-gang] 허용 오리진 ${CORS_ORIGINS.join(', ')}`)
  if (logFile) console.log(`[the-gang] 로그 ${logFile}`)
  logLine('info', `소켓 서버 :${PORT} · 허용 오리진 ${CORS_ORIGINS.join(', ')}`)
})

/*
 * 붙지 못한 접속. 소켓이 열리기 전에 막힌 것이라 socket 이벤트로는 잡히지 않는다 —
 * 오리진이 어긋났을 때가 여기로 온다. 화면에서는 「서버 부팅 중」으로만 보인다.
 */
app.io.engine.on('connection_error', (error: { code: number; message: string; context?: unknown }) => {
  logLine('conn', `접속 실패 ${error.code} ${error.message}`, error.context)
})

/** Render 의 배포 교체는 SIGTERM 으로 온다. 진행 중인 방이 있으므로 조용히 닫는다. */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[the-gang] ${signal} — 종료합니다`)
    logLine('info', `${signal} — 종료합니다`)
    void app.close().then(() => process.exit(0))
  })
}
