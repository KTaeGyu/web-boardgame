import type { Result, RoomView } from '@the-gang/shared'

import { getPlayerId } from './identity.ts'
import { call } from './socket.ts'

/** 방 만들기는 처음 화면과 방 목록 두 곳에서 부른다. 한 곳에 둔다. */
export function createRoom(nickname: string): Promise<Result<RoomView>> {
  return call<RoomView>('room:create', { playerId: getPlayerId(), nickname })
}
