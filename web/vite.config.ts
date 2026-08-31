import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'logs', 'web.log')

/**
 * 화면에서 난 오류를 파일로 받아 적는다.
 *
 * 브라우저는 파일을 쓸 수 없으므로 개발 서버가 대신 쓴다. 받는 자리를 소켓 서버가
 * 아니라 여기에 둔 이유가 둘이다 — 화면과 같은 출처라 CORS 를 열 일이 없고,
 * **개발 서버가 다시 뜰 때 파일이 처음부터 다시 쓰인다.** 화면을 고치는 쪽과 로그가
 * 같은 수명을 갖는다.
 *
 * `apply: 'serve'` 라 빌드에는 실려 나가지 않는다. 짝이 되는 화면 쪽은
 * `web/src/lib/devlog.ts` 이고 그쪽도 개발에서만 산다.
 */
function devLogFile(): Plugin {
  return {
    name: 'the-gang-dev-log',
    apply: 'serve',
    configureServer(server) {
      mkdirSync(dirname(FILE), { recursive: true })
      writeFileSync(FILE, `── 화면 개발 서버 시작 ${new Date().toLocaleString('ko-KR')} ──\n`, 'utf8')

      server.middlewares.use('/__log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
          // 한 번에 오는 양을 묶어 둔다. 흘러넘치면 받다가 개발 서버가 먼저 지친다.
          if (body.length > 64_000) req.destroy()
        })
        req.on('end', () => {
          try {
            const lines = JSON.parse(body) as string[]
            appendFileSync(FILE, lines.map((line) => `${line}\n`).join(''), 'utf8')
          } catch {
            /* 반쯤 오다 끊긴 것이다. 로그를 남기려다 개발 서버를 죽일 수는 없다 */
          }
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devLogFile()],
  // 공용 패키지는 빌드된 산출물이 아니라 소스 .ts 다. 미리 번들하면 수정이 반영되지 않는다.
  optimizeDeps: { exclude: ['@the-gang/shared'] },
  server: { port: 5173 },
})
