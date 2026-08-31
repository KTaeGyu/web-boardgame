/**
 * 혼자 해보기. 봇 둘이 함께 앉은 판이 곧바로 시작된다.
 *
 * 대기실을 거치지 않는 것은 기다릴 사람이 없기 때문이다.
 * 진입점과 게스트 화면 두 곳에서 부르므로 여기 한 벌만 둔다 — 두 곳에 적어두면
 * 한쪽만 고치는 날이 온다.
 */

import type { Result } from '@the-gang/shared'

import { getPlayerId } from './identity.ts'
import { call } from './socket.ts'

export function startTutorial(nickname: string): Promise<Result<{ code: string }>> {
  return call<{ code: string }>('tutorial:start', { playerId: getPlayerId(), nickname })
}
