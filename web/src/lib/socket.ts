/**
 * 소켓 클라이언트.
 *
 * 연결은 앱 전체에서 하나다. 방을 옮겨도 끊었다 붙이지 않는다 —
 * 끊김은 서버에서 「자리를 비울지 말지」 판단의 근거라 함부로 만들면 안 된다.
 */

import { io, type Socket } from 'socket.io-client'
import type { Result, ServerToClientEvents } from '@the-gang/shared'
import { useEffect, useState } from 'react'

import { devLog } from './devlog.ts'

const URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001'

export const socket: Socket = io(URL, { transports: ['websocket'], autoConnect: true })

/*
 * 연결이 오가는 것을 개발에서만 적어 둔다(logs/web.log).
 *
 * 화면의 여러 자리가 「붙어 있는가」로 잠긴다 — 방에 들어가는 단추가 그렇다.
 * 끊긴 것을 화면만 모르고 있으면 「눌러도 아무 일이 없다」로 보이므로,
 * 붙고 끊긴 시각이 남아 있어야 그 둘을 갈라낼 수 있다.
 */
if (import.meta.env.DEV) {
  socket.on('connect', () => devLog('sock', `연결됨 ${socket.id}`))
  socket.on('disconnect', (reason) => devLog('sock', `끊김 — ${reason}`))
  socket.on('connect_error', (error) => devLog('sock', `연결 실패 — ${error.message}`))
}

/**
 * ack 콜백을 프라미스로 감싼다. 서버는 실패도 예외가 아니라 값으로 보내므로
 * 화면이 사유별로 다르게 안내할 수 있다.
 */
export function call<T>(event: string, ...args: unknown[]): Promise<Result<T>> {
  return new Promise((resolve) => {
    /*
     * 거절은 예외가 아니라 값이라 어디에도 남지 않는다. 화면이 그 말을 사람에게
     * 보이고 끝내므로, 무엇이 왜 거절당했는지는 여기를 지날 때만 볼 수 있다.
     */
    const answer = (result: Result<T>) => {
      if (!result.ok) devLog('deny', `${event} — ${result.code} ${result.message}`)
      resolve(result)
    }
    if (!socket.connected) {
      // 끊긴 상태에서 보낸 요청은 socket.io 가 큐에 쌓아두지만, 사용자는 답을 기다리게 된다.
      devLog('sock', `${event} — 끊긴 채로 보냄. 붙을 때까지 기다린다`)
      socket.once('connect', () => socket.emit(event, ...args, answer))
      return
    }
    socket.emit(event, ...args, answer)
  })
}

/** 서버가 보내는 이벤트 하나를 구독한다. 핸들러가 바뀌어도 재구독이 안전하다. */
export function useServerEvent<K extends keyof ServerToClientEvents>(
  event: K,
  handler: ServerToClientEvents[K],
): void {
  useEffect(() => {
    socket.on(event as string, handler as (...args: unknown[]) => void)
    return () => {
      socket.off(event as string, handler as (...args: unknown[]) => void)
    }
  }, [event, handler])
}

/** 연결이 살아 있는지. 끊기면 화면 아래에 조용히 알려준다. */
export function useConnected(): boolean {
  const [connected, setConnected] = useState(socket.connected)
  useEffect(() => {
    const on = () => setConnected(true)
    const off = () => setConnected(false)
    socket.on('connect', on)
    socket.on('disconnect', off)
    return () => {
      socket.off('connect', on)
      socket.off('disconnect', off)
    }
  }, [])
  return connected
}
