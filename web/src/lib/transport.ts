/**
 * 판이 어디서 도는가에 따라 말을 거는 곳이 갈린다.
 *
 * 사람들과 하는 판은 서버에서 돌고, 혼자 해보기는 화면 안에서 돈다(`localGame.ts`).
 * 게임 화면은 그 차이를 몰라야 한다 — 두 벌로 갈라 쓰면 화면 코드가 「지금 어느
 * 쪽인가」를 스무 군데에서 물어보게 되고, 그중 하나를 빠뜨리는 날이 온다.
 *
 * 그래서 부르는 자리를 하나로 두고 여기서만 가른다. 게임 화면은 socket.ts 대신
 * 이 파일에서 call·useServerEvent 를 들여온다.
 */

import { useEffect } from 'react'
import type { Result, ServerToClientEvents } from '@the-gang/shared'

import { localCall, localRunning, onLocal } from './localGame.ts'
import { call as socketCall, useServerEvent as useSocketEvent } from './socket.ts'

export function call<T>(event: string, ...args: unknown[]): Promise<Result<T>> {
  if (localRunning()) return localCall<T>(event, (args[0] as Record<string, unknown>) ?? {})
  return socketCall<T>(event, ...args)
}

/**
 * 양쪽을 다 듣는다.
 *
 * 어느 쪽이 살아 있는지 보고 하나만 고를 수도 있지만, 연습판은 화면이 열려 있는 동안
 * 열리고 닫힌다 — 고르는 시점과 쓰는 시점이 달라 어긋난다. 둘 다 듣게 두면 그 문제가
 * 없다. 연습 중에는 서버가 이 화면에 게임 이벤트를 보낼 일이 없으므로 섞이지 않는다.
 */
export function useServerEvent<K extends keyof ServerToClientEvents>(
  event: K,
  handler: ServerToClientEvents[K],
): void {
  useSocketEvent(event, handler)
  useEffect(() => {
    return onLocal(event as string, handler as (payload: unknown) => void)
  }, [event, handler])
}
