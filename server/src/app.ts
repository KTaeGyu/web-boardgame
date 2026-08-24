import { createServer, type Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'

import { isAllowedOrigin } from './config.ts'
import { attachGameServer, type GameServer } from './socket.ts'
import type { RoomStore } from './rooms.ts'

export interface GameApp {
  http: HttpServer
  io: GameServer
  store: RoomStore
  close: () => Promise<void>
}

/** 부팅을 listen 과 분리해 두면 테스트가 임의 포트로 띄웠다 닫을 수 있다. */
export function createApp(): GameApp {
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
  })

  const game = attachGameServer(io)
  const store = game.store

  const close = () =>
    new Promise<void>((resolve) => {
      game.stop()
      io.close(() => http.close(() => resolve()))
    })

  return { http, io, store, close }
}
