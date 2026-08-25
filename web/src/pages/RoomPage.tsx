import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CHALLENGES,
  GAME_MODES,
  GAME_MODE_HINT,
  GAME_MODE_LABEL,
  MIN_PLAYERS,
  READY_CHALLENGES,
  nextHost,
  type ChallengeId,
  type SpecialistId,
  type GameMode,
  type RoomView,
} from '@the-gang/shared'

import { CardPicker } from '../components/CardPicker.tsx'
import { SpecialistGrid } from '../components/SpecialistGrid.tsx'
import { ConfirmModal } from '../components/Modal.tsx'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { call, socket, useServerEvent } from '../lib/socket.ts'
import { useEscape } from '../lib/useEscape.ts'

/** 방이 닫힌 사유를 사람 말로. 아무 설명 없이 튕겨나가면 고장으로 느껴진다. */
const CLOSED_MESSAGE: Record<string, string> = {
  empty: '방에 아무도 남지 않아 닫혔습니다.',
  idle: '30분 동안 아무 움직임이 없어 방이 닫혔습니다.',
  rematchDeclined: '재경기를 원하지 않는 사람이 있어 방이 닫혔습니다.',
  hostClosed: '방장이 방을 닫았습니다.',
}

export function RoomPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const playerId = getPlayerId()
  const nickname = getNickname()

  const [room, setRoom] = useState<RoomView | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  /** 설정 바꾸기는 방장만 할 수 있다. 거절 사유는 그대로 보여준다. */
  async function change(patch: Partial<RoomView['settings']>) {
    const result = await call<RoomView>('room:settings', patch)
    if (!result.ok) setError(result.message)
    else setError('')
  }

  function toggleChallenge(id: ChallengeId, picked: ChallengeId[]) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
    void change({ pickedChallenges: next })
  }



  // 판이 열리면 방에 있는 모두가 함께 테이블로 옮겨간다.
  useEffect(() => {
    if (room?.phase === 'playing') navigate(`/rooms/${code}/game`, { replace: true })
  }, [room?.phase, code, navigate])

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

  useEscape(
    !confirmLeave,
    useCallback(() => setConfirmLeave(true), []),
  )

  useServerEvent(
    'room:closed',
    useCallback(
      (payload: { reason: string }) =>
        navigate('/rooms', { replace: true, state: { notice: CLOSED_MESSAGE[payload.reason] } }),
      [navigate],
    ),
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
  const everyoneHere = room.players.every((player) => player.connected)
  // 직접 고르기인데 아무것도 고르지 않았다. 설정은 그대로 두고 시작만 막는다.
  const needsCards =
    room.settings.mode === 'custom' &&
    room.settings.pickedChallenges.length === 0 &&
    room.settings.specialistRounds.every((id) => id === null)
  // 내가 빠진 뒤의 인원으로 다음 방장을 미리 구한다. 서버가 실제로 쓰는 규칙과 같은 함수다.
  const successor = iAmHost ? nextHost(room.players.filter((player) => player.id !== playerId)) : null

  async function startGame() {
    setStarting(true)
    const result = await call<unknown>('game:start')
    setStarting(false)
    if (!result.ok) setError(result.message)
  }

  return (
    <main className="page room-page">
      <div className="room-header">
        <h1 className="room-header__host">{host?.displayName ?? '?'}님의 방</h1>
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
                  {player.displayName}
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

          <CardPicker
            label="진행 방식"
            single
            describePicked
            options={GAME_MODES.map((mode) => ({
              id: mode,
              name: GAME_MODE_LABEL[mode],
              text: GAME_MODE_HINT[mode],
            }))}
            picked={[room.settings.mode]}
            disabled={!iAmHost}
            onToggle={(id) => void change({ mode: id as GameMode })}
          />

          {room.settings.mode === 'custom' && (
            <>
              <CardPicker
                label={`도전자 카드 (${room.settings.pickedChallenges.length}장)`}
                hint="고른 것이 모든 판에 함께 걸립니다."
                options={READY_CHALLENGES.map((id) => ({
                  id,
                  name: CHALLENGES[id].name,
                  text: CHALLENGES[id].text,
                }))}
                picked={room.settings.pickedChallenges}
                disabled={!iAmHost}
                onToggle={(id) => toggleChallenge(id as ChallengeId, room.settings.pickedChallenges)}
              />

              <SpecialistGrid
                rounds={room.settings.specialistRounds}
                disabled={!iAmHost}
                onChange={(specialistRounds) => void change({ specialistRounds })}
              />
            </>
          )}

          <div className="setting">
            <span className="setting__label">최대 인원</span>
            <input
              className="number-input"
              type="number"
              min={MIN_PLAYERS}
              max={10}
              value={room.settings.maxPlayers}
              disabled={!iAmHost}
              onChange={(event) => void change({ maxPlayers: Number(event.target.value) })}
            />
          </div>

          {!iAmHost && <p className="notice">설정은 방장만 바꿀 수 있습니다.</p>}
        </section>
      </div>

      {needsCards && (
        <p className="notice notice--warn">
          직접 고르기를 골랐습니다. 도전자든 해결사든 카드를 하나 이상 골라야 시작할 수 있습니다.
        </p>
      )}
      {iAmHost && !enoughPlayers && (
        <p className="notice">최소 {MIN_PLAYERS}명이 모여야 시작할 수 있습니다.</p>
      )}
      {iAmHost && enoughPlayers && !everyoneHere && (
        <p className="notice">자리를 비운 사람이 있습니다. 돌아오기를 기다려 주세요.</p>
      )}

      {/* 안내문구를 밖으로 뺐다. 아래에 고정되는 것은 버튼뿐이어야 자리가 흔들리지 않는다. */}
      <div className="room-footer">
        {iAmHost && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!enoughPlayers || !everyoneHere || needsCards || starting}
            onClick={() => void startGame()}
          >
            {starting ? '차리는 중…' : '게임 시작'}
          </button>
        )}
        <button type="button" className="btn btn--danger" onClick={() => setConfirmLeave(true)}>
          방 나가기
        </button>
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="방을 나가시겠습니까?"
          confirmLabel="나가기"
          cancelLabel="취소"
          onConfirm={() => void leave()}
          onCancel={() => setConfirmLeave(false)}
        >
          <LeaveMessage isHost={iAmHost} successorName={successor?.displayName} />
        </ConfirmModal>
      )}
    </main>
  )
}

/** 나갈 때 무엇이 달라지는지. 방장인가에 따라 결과가 다르다. */
function LeaveMessage({ isHost, successorName }: { isHost: boolean; successorName?: string }) {
  if (!isHost) return <>대기실에서 나갑니다. 방 목록에서 다시 들어올 수 있습니다.</>
  if (!successorName) return <>마지막 사람이라, 나가면 이 방은 사라집니다.</>
  return (
    <>
      방장이 <strong>{successorName}</strong>님에게 넘어갑니다.
    </>
  )
}
