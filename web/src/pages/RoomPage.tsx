import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  GAME_MODES,
  GAME_MODE_LABEL,
  MIN_PLAYERS,
  PENALTIES,
  PENALTY_LABEL,
  type RoomView,
} from '@the-gang/shared'

import { getNickname, getPlayerId } from '../lib/identity.ts'
import { call, socket, useServerEvent } from '../lib/socket.ts'

/** 설정은 게임 규칙이 붙은 뒤에 열 것이다. 지금은 자리만 잡아두고 잠가 둔다. */
const SETTINGS_LOCKED = true

export function RoomPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const playerId = getPlayerId()
  const nickname = getNickname()

  const [room, setRoom] = useState<RoomView | null>(null)
  const [error, setError] = useState('')

  /**
   * 들어오기. 처음 입장이든, 새로고침이든, 잠깐 끊겼다 돌아온 것이든 같은 요청이다.
   * 서버는 이미 그 방에 자리가 있으면 입장이 아니라 재접속으로 처리한다.
   */
  useEffect(() => {
    if (!nickname) {
      navigate('/', { replace: true })
      return
    }

    let alive = true
    const enter = async () => {
      const result = await call<RoomView>('room:join', { playerId, nickname, code })
      if (!alive) return
      if (result.ok) {
        setRoom(result.value)
        setError('')
      } else {
        setError(result.message)
      }
    }

    void enter()
    socket.on('connect', enter) // 재연결 때마다 자리를 다시 잡는다
    return () => {
      alive = false
      socket.off('connect', enter)
    }
  }, [code, nickname, playerId, navigate])

  useServerEvent(
    'room:updated',
    useCallback(
      (next: RoomView) => {
        if (next.code === code) setRoom(next)
      },
      [code],
    ),
  )

  useServerEvent(
    'room:closed',
    useCallback(() => navigate('/rooms', { replace: true }), [navigate]),
  )

  async function leave() {
    await call<null>('room:leave')
    navigate('/rooms')
  }

  if (error) {
    return (
      <main className="page page--narrow">
        <Link className="link-back" to="/rooms">
          ← 방 목록
        </Link>
        <p className="error">{error}</p>
      </main>
    )
  }

  if (!room) {
    return (
      <main className="page page--narrow">
        <p className="empty">방에 들어가는 중…</p>
      </main>
    )
  }

  const host = room.players.find((player) => player.id === room.hostId)
  const iAmHost = room.hostId === playerId
  const enoughPlayers = room.players.length >= MIN_PLAYERS

  return (
    <main className="page">
      <div className="room-header">
        <h1 className="room-header__host">{host?.nickname ?? '?'}님의 방</h1>
        <span className="room-header__code">{room.code}</span>
      </div>

      <div className="room-body">
        <section className="panel">
          <h2 className="section-title">
            참여자 {room.players.length} / {room.settings.maxPlayers}
          </h2>
          <ul className="player-list">
            {room.players.map((player, index) => (
              <li
                key={player.id}
                className={[
                  'player',
                  player.connected ? '' : 'player--offline',
                  player.id === playerId ? 'player--me' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="player__seat">{index + 1}</span>
                <span className="player__name">
                  {player.nickname}
                  {player.id === playerId && ' (나)'}
                </span>
                {player.isHost && <span className="player__tag">방장</span>}
                {!player.connected && <span className="player__tag--waiting">자리 비움</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2 className="section-title">게임 설정</h2>

          <div className="setting">
            <span className="setting__label">패널티</span>
            <div className="choice-row">
              {PENALTIES.map((penalty) => (
                <label key={penalty} className={`choice ${SETTINGS_LOCKED ? 'choice--locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={room.settings.penalties.includes(penalty)}
                    disabled={SETTINGS_LOCKED || !iAmHost}
                    readOnly
                  />
                  {PENALTY_LABEL[penalty]}
                </label>
              ))}
            </div>
          </div>

          <div className="setting">
            <span className="setting__label">진행 방식</span>
            <div className="choice-row">
              {GAME_MODES.map((mode) => (
                <label
                  key={mode}
                  className={`choice ${room.settings.mode === mode ? 'choice--on' : ''} ${
                    SETTINGS_LOCKED ? 'choice--locked' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={room.settings.mode === mode}
                    disabled={SETTINGS_LOCKED || !iAmHost}
                    readOnly
                  />
                  {GAME_MODE_LABEL[mode]}
                </label>
              ))}
            </div>
          </div>

          <div className="setting">
            <span className="setting__label">최대 인원</span>
            <input
              className="number-input"
              type="number"
              value={room.settings.maxPlayers}
              disabled={SETTINGS_LOCKED || !iAmHost}
              readOnly
            />
          </div>

          <p className="notice">
            {iAmHost
              ? '지금은 기본 설정으로 고정되어 있습니다. 게임 규칙이 붙으면 방장이 바꿀 수 있습니다.'
              : '설정은 방장만 바꿀 수 있습니다.'}
          </p>
        </section>
      </div>

      <div className="room-footer">
        {iAmHost && (
          <button type="button" className="btn btn--primary" disabled title="아직 준비 중입니다">
            게임 시작
          </button>
        )}
        <button type="button" className="btn btn--danger" onClick={() => void leave()}>
          방 나가기
        </button>
        {iAmHost && !enoughPlayers && (
          <p className="notice">최소 {MIN_PLAYERS}명이 모여야 시작할 수 있습니다.</p>
        )}
      </div>
    </main>
  )
}
