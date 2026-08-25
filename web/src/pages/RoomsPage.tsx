import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { RoomSummary, RoomView } from '@the-gang/shared'

import { ConfirmModal } from '../components/Modal.tsx'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { createRoom } from '../lib/rooms.ts'
import { call, socket, useConnected, useServerEvent } from '../lib/socket.ts'
import { useEscape } from '../lib/useEscape.ts'

export function RoomsPage() {
  const navigate = useNavigate()
  // 방이 닫혀서 밀려온 경우, 왜 닫혔는지 여기서 알려준다.
  const arrivedWith = (useLocation().state as { notice?: string } | null)?.notice ?? ''
  const nickname = getNickname()
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [asking, setAsking] = useState<RoomSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [making, setMaking] = useState(false)
  // 서버가 잠들어 있으면 화면이 덮이지만, 키보드로는 그 아래에 닿는다. 손잡이 자체를 잠근다.
  const connected = useConnected()
  /** 지금 몇 명이 붙어 있고 방은 몇 개인가. 서버가 바뀔 때마다 알려준다. */
  const [stats, setStats] = useState<{ online: number; rooms: number } | null>(null)

  // 닉네임 없이 들어온 경우는 주소를 직접 친 것이다. 처음으로 돌려보낸다.
  useEffect(() => {
    if (!nickname) navigate('/', { replace: true })
  }, [nickname, navigate])

  /**
   * 목록을 구독한다. 방이 생기고 사라지는 걸 새로고침 없이 따라간다.
   * 재연결 때 다시 구독해야 서버가 우리를 기억한다.
   */
  useEffect(() => {
    const watch = () => socket.emit('rooms:watch', { watching: true })
    watch()
    socket.on('connect', watch)
    void call<RoomSummary[]>('room:list').then((result) => {
      if (result.ok) setRooms(result.value)
    })
    return () => {
      socket.off('connect', watch)
      socket.emit('rooms:watch', { watching: false })
    }
  }, [])

  useServerEvent('rooms:changed', useCallback((next: RoomSummary[]) => setRooms(next), []))

  useServerEvent(
    'lobby:stats',
    useCallback((next: { online: number; rooms: number }) => setStats(next), []),
  )

  // 입장 확인창이 떠 있으면 Esc 는 그쪽 몫이다.
  useEscape(asking === null, useCallback(() => navigate('/'), [navigate]))

  /** 여기까지 왔다는 것은 닉네임이 이미 있다는 뜻이라, 바로 방을 열 수 있다. */
  async function makeRoom() {
    setMaking(true)
    const result = await createRoom(nickname)
    setMaking(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    navigate(`/rooms/${result.value.code}`)
  }

  async function enter(room: RoomSummary) {
    setBusy(true)
    const result = await call<RoomView>('room:join', {
      playerId: getPlayerId(),
      nickname,
      code: room.code,
    })
    setBusy(false)
    setAsking(null)

    if (!result.ok) {
      setError(result.message)
      return
    }
    navigate(`/rooms/${result.value.code}`)
  }

  return (
    <main className="page page--column rooms-page">
      <Link className="link-back" to="/">
        ← 처음으로
      </Link>

      <div className="rooms-head">
        <div>
          <h1 className="section-title">열려 있는 방</h1>
          {/* 방에 든 사람만이 아니라 화면을 열어둔 모두다. 기다리는 사람이 보여야 한다. */}
          <p className="rooms-head__stats">
            {stats ? `${stats.online}명 접속 중 · 방 ${stats.rooms}개` : ' '}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary rooms-head__create"
          onClick={() => void makeRoom()}
          disabled={making || !connected}
        >
          {making ? '만드는 중…' : '방 만들기'}
        </button>
      </div>

      {arrivedWith && <p className="notice">{arrivedWith}</p>}

      {rooms === null && <p className="empty">불러오는 중…</p>}

      {rooms?.length === 0 && (
        <p className="empty">
          아직 열린 방이 없습니다.
          <br />
          방을 만들어 친구를 불러 보세요.
        </p>
      )}

      {rooms && rooms.length > 0 && (
        <ul className="room-list">
          {rooms.map((room) => {
            const playing = room.phase !== 'lobby'
            const full = room.playerCount >= room.maxPlayers
            return (
              <li key={room.code}>
                <button
                  type="button"
                  className="room-item"
                  onClick={() => setAsking(room)}
                  disabled={playing || full || !connected}
                >
                  <span className="room-item__code">{room.code}</span>
                  <span className="room-item__main">
                    <span className="room-item__host">{room.hostNickname}님의 방</span>
                    <br />
                    <span className="room-item__meta">
                      {room.playerCount} / {room.maxPlayers}명
                    </span>
                  </span>
                  {playing && <span className="badge badge--playing">게임 중</span>}
                  {!playing && full && <span className="badge">정원 참</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {asking && (
        <ConfirmModal
          title={`${asking.hostNickname}님의 방에 입장하시겠습니까?`}
          onConfirm={() => void enter(asking)}
          onCancel={() => setAsking(null)}
          busy={busy}
        >
          현재 {asking.playerCount}명이 기다리고 있습니다.
        </ConfirmModal>
      )}
    </main>
  )
}
