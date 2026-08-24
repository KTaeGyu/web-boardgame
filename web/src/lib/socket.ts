/**
 * 소켓 클라이언트.
 *
 * 연결은 앱 전체에서 하나다. 방을 옮겨도 끊었다 붙이지 않는다 —
 * 끊김은 서버에서 「자리를 비울지 말지」 판단의 근거라 함부로 만들면 안 된다.
 */

import { io, type Socket } from 'socket.io-client'
import type { Result, ServerToClientEvents } from '@the-gang/shared'
import { useEffect, useState } from 'react'

const URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001'

export const socket: Socket = io(URL, { transports: ['websocket'], autoConnect: true })

/**
 * ack 콜백을 프라미스로 감싼다. 서버는 실패도 예외가 아니라 값으로 보내므로
 * 화면이 사유별로 다르게 안내할 수 있다.
 */
export function call<T>(event: string, ...args: unknown[]): Promise<Result<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      // 끊긴 상태에서 보낸 요청은 socket.io 가 큐에 쌓아두지만, 사용자는 답을 기다리게 된다.
      socket.once('connect', () => socket.emit(event, ...args, resolve))
      return
    }
    socket.emit(event, ...args, resolve)
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
