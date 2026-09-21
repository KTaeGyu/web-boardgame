import { createServer, type Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'

import { isAllowedOrigin } from './config.ts'
import { attachGameServer, type GameServer, type ServerLimits } from './socket.ts'
import type { RoomStore } from './rooms.ts'

export interface GameApp {
  http: HttpServer
  io: GameServer
  store: RoomStore
  close: () => Promise<void>
}

/** 부팅을 listen 과 분리해 두면 테스트가 임의 포트로 띄웠다 닫을 수 있다. */
export function createApp(limits: ServerLimits = {}): GameApp {
  const http = createServer((req, res) => {
    // Render 의 상태 확인용. 무료 요금제에서 잠든 인스턴스를 깨우는 데도 쓴다.
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: store.size }))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('여기는 게임 서버입니다. 화면은 따로 있습니다.')
  })

  const io: GameServer = new Server(http, {
    cors: {
      origin: (origin, callback) =>
        isAllowedOrigin(origin ?? undefined)
          ? callback(null, true)
          : callback(new Error(`허용되지 않은 오리진: ${origin}`)),
      credentials: false,
    },
    /*
     * 한 번에 받는 크기. 기본 1MB 는 이 게임에 쓸 데가 없다 — 제일 큰 것이 설정 한 벌과
     * 200자 대화다. 넉넉히 64KB 로 묶어 한 요청이 메모리를 크게 물지 못하게 한다.
     */
    maxHttpBufferSize: 64_000,
  })

  const game = attachGameServer(io, limits)
  const store = game.store

  const close = () =>
    // 모아 둔 계정 쓰기를 먼저 내보낸다. 넘어져도 닫는 것은 마저 닫는다.
    game
      .stop()
      .catch(() => undefined)
      .then(() => new Promise<void>((resolve) => io.close(() => http.close(() => resolve()))))

  return { http, io, store, close }
}
