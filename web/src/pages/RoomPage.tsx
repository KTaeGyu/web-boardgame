import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CHALLENGES,
  GAME_MODES,
  GAME_MODE_HINT,
  GAME_MODE_LABEL,
  MAX_MARKS,
  MAX_RANDOM_CHALLENGES,
  MAX_SPECTATORS,
  MIN_MARKS,
  MIN_PLAYERS,
  READY_CHALLENGES,
  canPick,
  maxHeists,
  nextHost,
  type ChallengeId,
  type SpecialistId,
  type GameMode,
  type RoomView,
} from '@the-gang/shared'

import { CardPicker } from '../components/CardPicker.tsx'
import { Chat } from '../components/Chat.tsx'
import { SpecialistGrid } from '../components/SpecialistGrid.tsx'
import { ChoiceModal, ConfirmModal } from '../components/Modal.tsx'
import { useBackIntercept } from '../lib/back.ts'
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
  /*
   * 자리 없이 보고만 있는가. 주소에 남겨 둔다 — 새로고침해도 자리에 앉혀지지 않아야 한다.
   * 상태로만 들고 있으면 F5 한 번에 구경꾼이 선수가 된다.
   */
  const [params, setParams] = useSearchParams()
  const watching = params.get('watch') === '1'
  const playerId = getPlayerId()
  const nickname = getNickname()

  const [room, setRoom] = useState<RoomView | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  /** 방장이 자리에서 물러나려 한다. 방장이 넘어가는 일이라 한 번 묻는다. */
  const [confirmWatch, setConfirmWatch] = useState(false)
  /** 내보내려는 사람. 확인창이 떠 있는 동안만 담아 둔다. */
  const [kicking, setKicking] = useState<{ id: string; name: string } | null>(null)

  /** 설정 바꾸기는 방장만 할 수 있다. 거절 사유는 그대로 보여준다. */
  async function change(patch: Partial<RoomView['settings']>) {
    const result = await call<RoomView>('room:settings', patch)
    if (!result.ok) setError(result.message)
    else setError('')
  }

  /** 자리에서 물러나 보기만 한다. 성공해야 주소를 바꾼다 — 거절당하면 자리는 그대로다. */
  async function becomeWatcher() {
    const result = await call<RoomView>('room:spectate', { playerId, nickname, code })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError('')
    setConfirmWatch(false)
    setRoom(result.value)
    setParams({ watch: '1' }, { replace: true })
  }

  function toggleChallenge(id: ChallengeId, picked: ChallengeId[]) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
    void change({ pickedChallenges: next })
  }

  /*
   * 숫자 칸은 지우는 도중에 빈 값이 되고, 그때 0 을 보내면 서버가 거절해 붉은 줄이 뜬다.
   * 고치는 중일 뿐이므로 범위를 벗어난 값은 보내지 않고 흘린다 — 칸은 방의 값으로 돌아온다.
   */
  function changeNumber(key: 'vaultsToWin' | 'alarmsToLose' | 'randomChallenges', raw: string) {
    const value = Number(raw)
    const min = key === 'randomChallenges' ? 0 : MIN_MARKS
    const max = key === 'randomChallenges' ? MAX_RANDOM_CHALLENGES : MAX_MARKS
    if (!Number.isInteger(value) || value < min || value > max) return
    void change({ [key]: value })
  }



  // 판이 열리면 방에 있는 모두가 함께 테이블로 옮겨간다. 보고 있던 사람은 보는 자리로.
  useEffect(() => {
    if (room?.phase !== 'playing') return
    navigate(watching ? `/rooms/${code}/watch` : `/rooms/${code}/game`, { replace: true })
  }, [room?.phase, code, navigate, watching])

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
      const result = await call<RoomView>(watching ? 'room:spectate' : 'room:join', {
        playerId,
        nickname,
        code,
      })
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
  }, [code, nickname, playerId, navigate, watching])

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
    !confirmLeave && !confirmWatch,
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

  // 내보내진 것은 방이 닫힌 것과 다르다. 왜 튕겼는지 그 사람만 알아야 할 말이 있다.
  useServerEvent(
    'room:kicked',
    useCallback(
      (payload: { message: string }) =>
        navigate('/rooms', { replace: true, state: { notice: payload.message } }),
      [navigate],
    ),
  )

  async function leave() {
    await call<null>('room:leave')
    navigate('/rooms')
  }

  /*
   * 대기실에서의 뒤로가기는 방에서 나가는 것이다.
   *
   * 화면만 목록으로 보내면 자리는 남는다 — 정원을 먹고, 남들에게는 아직 있는 사람으로
   * 보인다. 대기실은 언제든 다시 들어올 수 있으니 묻지 않고 나간다. 관전 중이었으면
   * 관전 목록에서 빠진다.
   *
   * 돌아가는 자리는 목록으로 바꿔 둔다(replace). 그러지 않으면 뒤로가기 한 번에
   * 방금 나온 방 주소로 되돌아와 다시 들어가진다.
   */
  useBackIntercept(true, () => {
    void call<null>('room:leave')
    navigate('/rooms', { replace: true })
  })

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
    room.settings.randomChallenges === 0 &&
    room.settings.specialistRounds.every((id) => id === null) &&
    room.settings.specialistRandomRounds.every((on) => !on)
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
        {/* 나가는 길이 화면 아래에만 있으면 설정을 다 지나쳐 내려가야 한다. 제목 옆에도 둔다. */}
        <button
          type="button"
          className="room-header__back"
          onClick={() => setConfirmLeave(true)}
          aria-label="방 나가기"
          title="방 나가기"
        >
          ←
        </button>
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
                {/* 방장만, 자기 자신은 빼고. 판이 도는 중에는 서버가 막는다. */}
                {iAmHost && player.id !== playerId && (
                  <button
                    type="button"
                    className="player__kick"
                    onClick={() => setKicking({ id: player.id, name: player.displayName })}
                    aria-label={`${player.displayName}님 내보내기`}
                    title="내보내기"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/*
            보고만 있는 사람들. 자리에 앉은 사람과 같은 목록에 두면 인원수가 헷갈린다 —
            게임을 시작할 수 있는지는 앉은 사람 수로만 정해진다.
          */}
          {room.spectators.length > 0 && (
            <>
              <h3 className="watchers__title">
                관전 {room.spectators.length} / {MAX_SPECTATORS}
              </h3>
              <ul className="watchers">
                {room.spectators.map((watcher) => (
                  <li key={watcher.id} className={watcher.id === playerId ? 'watchers--me' : ''}>
                    {watcher.nickname}
                    {watcher.id === playerId && ' (나)'}
                  </li>
                ))}
              </ul>
            </>
          )}
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
              <div className="setting">
                <span className="setting__label">금고와 경보</span>
                <span className="pick-hint">
                  금고를 다 열면 이기고, 경보가 다 울리면 집니다. 한 게임은 최대{' '}
                  {maxHeists(room.settings.vaultsToWin, room.settings.alarmsToLose)}판입니다.
                  수를 줄이면 없어지는 판에 둔 해결사도 함께 지워집니다.
                </span>
                <div className="number-row">
                  <label className="number-field">
                    <span>금고</span>
                    <input
                      className="number-input"
                      type="number"
                      min={MIN_MARKS}
                      max={MAX_MARKS}
                      value={room.settings.vaultsToWin}
                      disabled={!iAmHost}
                      onChange={(event) => changeNumber('vaultsToWin', event.target.value)}
                    />
                  </label>
                  <label className="number-field">
                    <span>경보</span>
                    <input
                      className="number-input"
                      type="number"
                      min={MIN_MARKS}
                      max={MAX_MARKS}
                      value={room.settings.alarmsToLose}
                      disabled={!iAmHost}
                      onChange={(event) => changeNumber('alarmsToLose', event.target.value)}
                    />
                  </label>
                </div>
              </div>

              {/*
                함께 걸면 어긋나는 짝은 서로 잠근다. 「빠른 접근」이 1라운드를 건너뛰면
                감지기가 보는 「처음 선언」이 2라운드가 되어, 규칙대로 돌아도
                「두 번 집은 뒤에 감지가 왔다」로 읽힌다.
              */}
              <CardPicker
                label={`도전자 카드 (${room.settings.pickedChallenges.length}장)`}
                hint={
                  READY_CHALLENGES.some((id) => !canPick(id, room.settings.pickedChallenges))
                    ? '고른 것이 모든 판에 함께 걸립니다. 「빠른 접근」과 감지기는 함께 걸 수 없어 서로 잠깁니다.'
                    : '고른 것이 모든 판에 함께 걸립니다.'
                }
                options={READY_CHALLENGES.map((id) => ({
                  id,
                  name: CHALLENGES[id].name,
                  text: CHALLENGES[id].text,
                  locked: !canPick(id, room.settings.pickedChallenges),
                }))}
                picked={room.settings.pickedChallenges}
                disabled={!iAmHost}
                onToggle={(id) => toggleChallenge(id as ChallengeId, room.settings.pickedChallenges)}
              />

              <div className="setting">
                <span className="setting__label">무작위 도전자</span>
                <span className="pick-hint">
                  <strong>판마다</strong> 이만큼을 무작위로 새로 뽑아 얹습니다. 위에서 고른 카드와는
                  겹치지 않고, 지난 판에 나왔던 카드는 다시 나올 수 있습니다.
                </span>
                <div className="number-row">
                  <label className="number-field">
                    <span>장수</span>
                    <input
                      className="number-input"
                      type="number"
                      min={0}
                      max={MAX_RANDOM_CHALLENGES}
                      value={room.settings.randomChallenges}
                      disabled={!iAmHost}
                      onChange={(event) => changeNumber('randomChallenges', event.target.value)}
                    />
                  </label>
                </div>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={room.settings.randomChallengesOnWin}
                    disabled={!iAmHost}
                    onChange={(event) => void change({ randomChallengesOnWin: event.target.checked })}
                  />
                  <span>
                    이긴 다음 판에만 얹기
                    <span className="check__hint">
                      켜면 첫 판에는 나오지 않습니다. 위에서 고른 카드는 이것과 상관없이 늘 걸립니다.
                    </span>
                  </span>
                </label>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={room.settings.randomChallengesStay}
                    disabled={!iAmHost}
                    onChange={(event) => void change({ randomChallengesStay: event.target.checked })}
                  />
                  <span>
                    한 번 나온 카드는 계속 걸어두기
                    <span className="check__hint">판이 갈수록 쌓입니다. 이미 걸린 카드는 다시 뽑지 않습니다.</span>
                  </span>
                </label>
              </div>

              <SpecialistGrid
                rounds={room.settings.specialistRounds}
                randomRounds={room.settings.specialistRandomRounds}
                onLoss={room.settings.specialistOnLoss}
                disabled={!iAmHost}
                onChange={(specialistRounds) => void change({ specialistRounds })}
                onRandomChange={(specialistRandomRounds) => void change({ specialistRandomRounds })}
                onLossChange={(specialistOnLoss) => void change({ specialistOnLoss })}
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
        {/*
          자리와 관전 사이를 오간다. 자리가 하나뿐인 방에서는 물러날 수 없다 —
          앉은 사람이 없어지면 방이 죽는다. 서버가 같은 판단을 한 번 더 한다.
        */}
        {watching ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setParams({}, { replace: true })
            }}
          >
            자리에 앉기
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={room.players.length <= 1}
            title={room.players.length <= 1 ? '혼자 있는 방에서는 바꿀 수 없습니다' : undefined}
            onClick={() => (iAmHost ? setConfirmWatch(true) : void becomeWatcher())}
          >
            관전하기
          </button>
        )}

        <button type="button" className="btn btn--danger" onClick={() => setConfirmLeave(true)}>
          방 나가기
        </button>

        {/*
          대화는 방에 속한다. 대기실에서 하던 말이 판으로, 판에서 하던 말이 다시 대기실로
          이어진다 — 화면을 옮길 때마다 방에 다시 들어가고, 서버가 지난 말을 건네주기 때문이다.

          단추를 버튼 줄 안에 두는 것은 넓은 화면 때문이다. 화면 모서리에 띄우면 가운데
          구역에서 멀리 떨어져 혼자 노는데, 줄 안에 있으면 오른쪽 끝이 본문과 같은 선에 선다.
          좁은 화면에서는 제자리에 떠 있는다(position: fixed).
        */}
        <Chat code={code} />
      </div>

      {kicking && (
        <ChoiceModal
          title={`${kicking.name}님을 내보냅니다`}
          onClose={() => setKicking(null)}
          actions={[
            {
              label: '내보내기',
              onClick: () => {
                void call('room:kick', { playerId: kicking.id })
                setKicking(null)
              },
            },
            {
              label: '차단하기',
              tone: 'danger',
              onClick: () => {
                void call('room:kick', { playerId: kicking.id, ban: true })
                setKicking(null)
              },
            },
          ]}
        >
          <strong>내보내기</strong> — 방 번호를 알면 다시 들어올 수 있습니다.
          <br />
          <strong>차단하기</strong> — 내보내고, 이 방이 닫힐 때까지 다시 못 들어옵니다.
        </ChoiceModal>
      )}

      {confirmWatch && (
        <ConfirmModal
          title="관전으로 바꾸시겠습니까?"
          confirmLabel="관전하기"
          cancelLabel="취소"
          onConfirm={() => void becomeWatcher()}
          onCancel={() => setConfirmWatch(false)}
        >
          자리에서 물러나 보기만 합니다. 구경하는 사람은 방장이 될 수 없어서,{' '}
          {successor ? (
            <>
              방장이 <strong>{successor.displayName}</strong>님에게 넘어갑니다.
            </>
          ) : (
            <>방장이 남아 있는 사람에게 넘어갑니다.</>
          )}
          <br />
          시작 인원에도 들어가지 않습니다.
        </ConfirmModal>
      )}

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
