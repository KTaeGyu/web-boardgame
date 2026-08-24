import { createApp } from './app.ts'
import { CORS_ORIGINS, PORT } from './config.ts'

const app = createApp()

app.http.listen(PORT, () => {
  console.log(`[the-gang] 소켓 서버 :${PORT}`)
  console.log(`[the-gang] 허용 오리진 ${CORS_ORIGINS.join(', ')}`)
})

/** Render 의 배포 교체는 SIGTERM 으로 온다. 진행 중인 방이 있으므로 조용히 닫는다. */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[the-gang] ${signal} — 종료합니다`)
    void app.close().then(() => process.exit(0))
  })
}
