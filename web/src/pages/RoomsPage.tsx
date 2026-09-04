import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { RoomSummary, RoomView } from '@the-gang/shared'

import { ChoiceModal } from '../components/Modal.tsx'
import { session } from '../lib/auth.ts'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { createRoom } from '../lib/rooms.ts'
import { call, socket, useConnected, useServerEvent } from '../lib/socket.ts'
import { useEscapeFallback } from '../lib/useEscape.ts'

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
  /**
   * 내 자리가 아직 남아 있는 방. 없으면 null.
   *
   * 정원이 찬 방은 잠기지만 **이미 내 자리인 방은 잠기면 안 된다** — 서버는 정원을
   * 보기 전에 재접속으로 받아준다. 새로고침한 창은 자기가 어느 방에 앉아 있었는지
   * 잊으므로 서버에 묻는다.
   */
  const [mySeat, setMySeat] = useState<string | null>(null)

  // 닉네임 없이 들어온 경우는 주소를 직접 친 것이다. 처음으로 돌려보낸다.
  useEffect(() => {
    if (!nickname) navigate('/', { replace: true })
  }, [nickname, navigate])

  /**
   * 목록을 구독한다. 방이 생기고 사라지는 걸 새로고침 없이 따라간다.
   * 재연결 때 다시 구독해야 서버가 우리를 기억한다.
   */
  useEffect(() => {
    const watch = () => {
      socket.emit('rooms:watch', { watching: true })
      void askWhere()
    }
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

  /*
   * 목록이 바뀔 때마다 다시 묻는다. 자리는 유예가 끝나면 사라지는데, 그 순간에도
   * 목록은 갱신되므로 같은 신호를 타고 온다. 한 번만 묻고 들고 있으면 없어진 자리를
   * 「돌아가기」로 그린다.
   */
  useServerEvent(
    'rooms:changed',
    useCallback((next: RoomSummary[]) => {
      setRooms(next)
      void askWhere()
    }, []),
  )

  useServerEvent(
    'lobby:stats',
    useCallback((next: { online: number; rooms: number }) => setStats(next), []),
  )

  // 입장 확인창이 떠 있으면 Esc 는 그쪽 몫이다.
  /* 덮개가 하나도 없을 때만 받는다. 「asking」 창은 제 Esc 를 들고 있다. */
  useEscapeFallback(true, useCallback(() => navigate('/'), [navigate]))

  /** 내 자리가 어느 방에 남아 있는지 서버에 묻는다. 답이 없으면 없는 것으로 둔다. */
  async function askWhere() {
    const result = await call<string | null>('room:where', { playerId: getPlayerId() })
    setMySeat(result.ok ? result.value : null)
  }

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
      // 표는 꾸민 차림을 자리에 붙이려고 함께 간다. 게스트에게는 없다.
      token: session()?.token,
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
      <div className="rooms-top">
        <Link className="link-back" to="/">
          ← 처음으로
        </Link>
        {/* 상점과 전적을 나란히 둔다. 둘 다 방에 들어가기 전에 들르는 곳이다. */}
        <Link className="link-back" to="/looks">
          <svg className="link-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            {/* 차양을 얹은 가게. 선 하나로 그려 글자 색을 그대로 따라간다. */}
            <path
              d="M3 8h18M4 8V6h16v2M5 8v12h14V8M9 20v-6h6v6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          상점
        </Link>
        <Link className="link-back" to="/history">
          <svg className="link-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            {/*
              적어 두는 장부. **트로피를 쓰지 않는다** — 이 화면은 순위표가 아니라
              스스로 보는 자리라, 트로피를 달면 남과 견주는 자리로 읽힌다.
            */}
            <path
              d="M6 3h8l4 4v14H6zM14 3v4h4M9.5 12h5M9.5 16h3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          대전기록
        </Link>
      </div>

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
            /*
              내 자리가 남아 있는 방. 정원이 찼어도 잠그지 않는다 — 그 자리가 내 것이라
              서버는 정원을 보기 전에 재접속으로 받아준다. 잠가두면 잠깐 끊긴 사람이
              제 방으로 돌아갈 길이 없어진다.
            */
            const mine = room.code === mySeat
            /*
              관전은 정원 밖이다. 정원이 찼어도 이 자리가 남아 있으면 들어와 볼 수 있으므로
              줄을 잠그지 않는다 — 잠긴 줄은 「닫힌 문」으로 읽혀 아무도 두드리지 않는다.
              들어가 앉을 수 없다는 것은 창 안에서 말한다.
            */
            const canWatch = room.spectatorCount < room.maxSpectators
            return (
              <li key={room.code}>
                {/*
                  판이 도는 방은 들어가 앉을 수는 없지만 볼 수는 있다. 그래서 잠그지 않고
                  가는 곳만 바꾼다 — 잠긴 줄은 「닫힌 문」으로 읽혀 아무도 두드리지 않는다.
                */}
                <button
                  type="button"
                  className="room-item"
                  onClick={() => (playing ? navigate(`/rooms/${room.code}/watch`) : setAsking(room))}
                  disabled={(!playing && full && !mine && !canWatch) || !connected}
                >
                  <span className="room-item__code">{room.code}</span>
                  <span className="room-item__main">
                    <span className="room-item__host">{room.hostNickname}님의 방</span>
                    <br />
                    <span className="room-item__meta">
                      {room.playerCount} / {room.maxPlayers}명
                      {/*
                        자리는 찼는데 사람이 덜 보이는 이유. 이 줄이 없으면 「셋이라면서
                        왜 둘만 있나」가 설명되지 않는다.
                      */}
                      {room.awayCount > 0 && ` · 자리 비움 ${room.awayCount}`}
                      {/*
                        관전은 정원이 찼을 때 「그래도 들어갈 수 있는가」의 답이 되므로,
                        그때는 보는 사람이 없어도 자릿수를 보인다.
                      */}
                      {(room.spectatorCount > 0 || full) &&
                        ` · 관전 ${room.spectatorCount} / ${room.maxSpectators}`}
                    </span>
                  </span>
                  {playing && <span className="badge badge--playing">게임 중 · 관전</span>}
                  {!playing && mine && <span className="badge badge--mine">돌아가기</span>}
                  {!playing && !mine && full && (
                    <span className="badge">{canWatch ? '정원 참 · 관전 가능' : '정원 참'}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {asking && (
        <ChoiceModal
          title={`${asking.hostNickname}님의 방`}
          onClose={() => setAsking(null)}
          actions={[
            {
              label: busy ? '들어가는 중…' : '들어가기',
              tone: 'primary',
              // 정원이 찼으면 앉을 수는 없다. 창을 열어둔 것은 관전이 남아 있어서다.
              disabled: asking.playerCount >= asking.maxPlayers,
              onClick: () => void enter(asking),
            },
            {
              label: '관전하기',
              disabled: asking.spectatorCount >= asking.maxSpectators,
              onClick: () => navigate(`/rooms/${asking.code}?watch=1`),
            },
          ]}
        >
          {asking.playerCount >= asking.maxPlayers ? (
            <strong>정원이 찼습니다. 보기만 할 수 있습니다.</strong>
          ) : (
            `${asking.playerCount}명이 자리에 있습니다.`
          )}
          {asking.awayCount > 0 && ` 그중 ${asking.awayCount}명은 자리를 비웠고, 돌아올 때까지 자리가 남아 있습니다.`}
          <br />
          관전은 자리를 차지하지 않아 <strong>시작 인원에 들어가지 않습니다.</strong>
          {asking.maxSpectators === 0
            ? ' 이 방은 관전을 받지 않습니다.'
            : ` 관전 ${asking.spectatorCount} / ${asking.maxSpectators}.`}
        </ChoiceModal>
      )}
    </main>
  )
}
