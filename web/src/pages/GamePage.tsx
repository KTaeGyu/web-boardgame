import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CHALLENGES,
  ROUNDS,
  ROUND_LABEL,
  TOKEN_LOCK_MS,
  VAULTS_TO_WIN,
  bestHolding,
  type Card,
  type GamePlayerView,
  type GameView,
  type Round,
} from '@the-gang/shared'

import { ExtrasDrawer, NoteCard, type CardNote } from '../components/ExtrasDrawer.tsx'
import { ScanVote } from '../components/ScanVote.tsx'
import { SetupStep } from '../components/SetupStep.tsx'
import { ConfirmModal } from '../components/Modal.tsx'
import { CardSlot, PlayingCard } from '../components/PlayingCard.tsx'
import { Token, TokenBlank } from '../components/Token.tsx'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { call, socket, useServerEvent } from '../lib/socket.ts'
import { useEscape } from '../lib/useEscape.ts'
import { useTokenFlight } from '../lib/useTokenFlight.ts'

/** 방이 닫힌 사유를 사람 말로. 아무 설명 없이 튕겨나가면 고장으로 느껴진다. */
const CLOSED_MESSAGE: Record<string, string> = {
  empty: '방에 아무도 남지 않아 닫혔습니다.',
  idle: '10분 동안 아무 움직임이 없어 방이 닫혔습니다.',
  rematchDeclined: '재경기를 원하지 않는 사람이 있어 방이 닫혔습니다.',
  hostClosed: '방장이 방을 닫았습니다.',
}

/** 쇼다운은 한 사람씩 차례로 뒤집어야 순서가 맞았는지 눈에 들어온다. */
const REVEAL_STEP_MS = 1900
/** 그 사람이 사슬을 이었는지 아닌지를 크게 띄워 두는 시간. */
const VERDICT_MS = 1200
/** 마지막 사람까지 보고 나서 판 전체의 결과를 띄우기까지의 뜸. */
const FINAL_GAP_MS = 350
const FINAL_MS = 2400

export function GamePage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const playerId = getPlayerId()
  const nickname = getNickname()

  const [game, setGame] = useState<GameView | null>(null)
  const [hand, setHand] = useState<Card[]>([])
  const [notice, setNotice] = useState('')
  const [rejected, setRejected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(0)
  /**
   * 화면 앞에 크게 띄우는 글자.
   *
   * 사람마다의 판정(성공/실패)과 판 전체의 결과가 같은 자리에 차례로 온다.
   * 마지막 사람이 성공이어도 판은 실패일 수 있어서, 결과를 따로 못박아야 한다.
   */
  const [flash, setFlash] = useState<{ key: string; text: string; tone: 'ok' | 'bad'; final?: boolean } | null>(
    null,
  )
  /** 마지막 결과까지 다 보여줬는가. 이때가 되어야 다음으로 넘어가는 버튼이 열린다. */
  const [finished, setFinished] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  /** 방장인지. 방장은 나가는 대신 판을 접어 모두를 대기실로 되돌린다. */
  const [hostId, setHostId] = useState('')
  /** 카드가 나에게만 알려준 것들. 이번 판 동안 드로어에 남는다. */
  const [notes, setNotes] = useState<CardNote[]>([])
  /** 방금 도착한 쪽지. 한 번 보여주고 나면 드로어에서 다시 볼 수 있다. */
  const [fresh, setFresh] = useState<CardNote | null>(null)

  const tokenRef = useTokenFlight(TOKEN_LOCK_MS)

  // 내 홀카드와 이미 공개된 보드만으로 구한다. 남의 정보는 쓰지 않으므로 새는 것이 없다.
  const myHolding = useMemo(() => bestHolding([...hand, ...(game?.community ?? [])]), [hand, game?.community])

  /**
   * 뱃지를 짚고 있는 동안에만 그 조합을 밝힌다. 평소에는 판을 어지럽히지 않는다.
   *
   * 눌러서 켜두면 마우스를 치워도 남고, 다시 누르면 꺼진다. 이때 마우스가
   * 아직 뱃지 위에 있으면 hover 가 곧바로 다시 켜버리므로, 벗어날 때까지
   * hover 를 한 번 무시한다. 「눌렀는데 안 꺼진다」로 보이지 않게 하려는 것이다.
   */
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [ignoreHover, setIgnoreHover] = useState(false)
  const comboOn = pinned || (hovering && !ignoreHover)
  const lit = new Set<string>(comboOn ? (myHolding?.used ?? []) : [])

  // 라운드가 바뀌면 조합도 바뀐다. 켜둔 채로 넘어가면 엉뚱한 카드가 밝혀진 것처럼 보인다.
  useEffect(() => {
    setPinned(false)
    setIgnoreHover(false)
  }, [game?.round, game?.heist])

  // 진입·새로고침·재연결이 모두 같은 요청이다. 서버가 자리와 손패를 되돌려준다.
  useEffect(() => {
    if (!nickname) {
      navigate('/', { replace: true })
      return
    }
    let alive = true
    const enter = async () => {
      const result = await call<{ hostId: string; phase: string }>('room:join', {
        playerId,
        nickname,
        code,
      })
      if (!alive) return

      // 실패를 삼키면 「테이블을 차리는 중」에서 영영 멈춘다. 서버가 다시 뜬 뒤
      // 새로고침하면 방이 없으므로, 무슨 일인지 알리고 목록으로 돌려보낸다.
      if (!result.ok) {
        setNotice(
          result.code === 'ROOM_NOT_FOUND'
            ? '방이 사라졌습니다. 모두 나갔거나 서버가 다시 시작되었습니다.'
            : result.message,
        )
        setTimeout(() => navigate('/rooms', { replace: true }), 2200)
        return
      }
      setHostId(result.value.hostId)
      // 방은 있는데 판이 없으면 여기 있을 이유가 없다.
      if (result.value.phase === 'lobby') navigate(`/rooms/${code}`, { replace: true })
    }

    void enter()
    socket.on('connect', () => void enter())
    return () => {
      alive = false
      socket.off('connect')
    }
  }, [code, nickname, playerId, navigate])

  useEscape(
    !confirmLeave,
    useCallback(() => setConfirmLeave(true), []),
  )

  useServerEvent(
    'game:state',
    useCallback(
      (view: GameView) => {
        if (view.roomCode === code) setGame(view)
      },
      [code],
    ),
  )

  useServerEvent(
    'game:hand',
    useCallback((payload: { hole: Card[] }) => {
      setHand(payload.hole)
      setNotes([]) // 새 판이면 지난 판의 쪽지도 지운다
      setFresh(null)
    }, []),
  )

  useServerEvent(
    'game:note',
    useCallback((payload: CardNote) => {
      setNotes((current) => [...current.filter((n) => n.specialist !== payload.specialist), payload])
      setFresh(payload) // 도착하자마자 한 번은 보여준다
    }, []),
  )

  useServerEvent(
    'game:aborted',
    useCallback(
      (payload: { message: string }) => {
        setNotice(payload.message)
        setGame(null)
        setTimeout(() => navigate(`/rooms/${code}`, { replace: true }), 2200)
      },
      [code, navigate],
    ),
  )

  useServerEvent(
    'room:updated',
    useCallback(
      (room: { code: string; phase: string; hostId: string }) => {
        if (room.code !== code) return
        setHostId(room.hostId)
        // 판이 접혔거나 아직 시작 전이면 이 화면에 있을 이유가 없다.
        if (room.phase === 'lobby') navigate(`/rooms/${code}`, { replace: true })
      },
      [code, navigate],
    ),
  )

  useServerEvent(
    'room:closed',
    useCallback(
      (payload: { reason: string }) =>
        navigate('/rooms', { replace: true, state: { notice: CLOSED_MESSAGE[payload.reason] } }),
      [navigate],
    ),
  )

  /** 쇼다운에 들어서면 한 명씩 뒤집는다. 다음 판이 시작되면 처음으로 되돌린다. */
  const phase = game?.phase
  const showdownKey = `${game?.heist ?? 0}:${phase}`
  const revealCount = game?.showdown?.reveals.length ?? 0
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  /**
   * 공개 순서는 ref 로 읽는다. 의존성에 넣으면 누가 「다음 금고로」를 누를 때마다
   * 새 상태가 도착해 공개가 처음부터 다시 시작된다.
   */
  const revealsRef = useRef(game?.showdown?.reveals ?? [])
  revealsRef.current = game?.showdown?.reveals ?? []
  const successRef = useRef(false)
  successRef.current = game?.showdown?.success ?? false
  /** 스캔을 틀렸는지. 순서가 맞았는데도 실패했다면 이유가 여기에 있다. */
  const missedScanRef = useRef<('rank' | 'category')[]>([])
  missedScanRef.current = (game?.scan?.questions ?? [])
    .filter((question) => question.correct === false)
    .map((question) => question.kind)

  useEffect(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
    setRevealed(0)
    setFlash(null)
    setFinished(false)
    if (phase === 'picking' || phase === 'scanning' || revealCount === 0) return

    const at = (ms: number, run: () => void) => timers.current.push(setTimeout(run, ms))

    for (let index = 1; index <= revealCount; index++) {
      at(REVEAL_STEP_MS * index, () => {
        setRevealed(index)
        // 첫 사람은 비교할 상대가 없다. 두 번째부터 사슬이 이어졌는지 판정이 선다.
        if (index < 2) return
        const ok = revealsRef.current[index - 1]?.ok ?? true
        const key = `p${index}`
        setFlash({ key, text: ok ? '성공' : '실패', tone: ok ? 'ok' : 'bad' })
        at(VERDICT_MS, () => setFlash((current) => (current?.key === key ? null : current)))
      })
    }

    // 마지막 사람의 판정이 사라진 뒤에 판 전체의 결과를 못박는다.
    at(REVEAL_STEP_MS * revealCount + VERDICT_MS + FINAL_GAP_MS, () => {
      const success = successRef.current
      setFinished(true)
      setFlash({
        key: 'final',
        // 스캔에 걸린 것이면 순서는 맞았을 수 있다. 무엇에 걸렸는지 짚어 준다.
        text: success ? '금고가 열렸습니다' : failureText(missedScanRef.current),
        tone: success ? 'ok' : 'bad',
        final: true,
      })
      at(FINAL_MS, () => setFlash((current) => (current?.key === 'final' ? null : current)))
    })

    return () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    }
  }, [showdownKey, revealCount, phase])

  /**
   * 감지기가 터지면 한 번 크게 알린다.
   *
   * 의존성은 키 하나뿐이다. sensor 객체는 상태가 올 때마다 새로 만들어지므로
   * 그것에 매달면 매번 정리 함수가 돌아 타이머가 취소되고 글자가 남는다.
   */
  const sensor = game?.sensor ?? null
  const sensorKey = sensor ? `${game?.heist}:${sensor.challenge}` : ''
  const sensorRef = useRef(sensor)
  sensorRef.current = sensor

  useEffect(() => {
    const fired = sensorRef.current
    if (!fired) return

    setFlash({
      key: sensorKey,
      text: `${CHALLENGES[fired.challenge].name} 작동!`,
      tone: 'bad',
      final: true,
    })
    const timer = setTimeout(
      () => setFlash((current) => (current?.key === sensorKey ? null : current)),
      FINAL_MS,
    )
    return () => clearTimeout(timer)
  }, [sensorKey])

  async function take(token: number) {
    const result = await call<null>('game:take', { token })
    if (result.ok) return
    // 거절은 조용히 씹지 않는다. 눌렀는데 아무 일도 안 일어나는 게 제일 나쁘다.
    setRejected(token)
    setTimeout(() => setRejected(null), 450)
  }

  if (notice) {
    return (
      <main className="page page--narrow">
        <p className="error">{notice}</p>
        <p className="empty">대기실로 돌아갑니다…</p>
      </main>
    )
  }

  if (!game) {
    return (
      <main className="page page--narrow">
        <p className="empty">테이블을 차리는 중…</p>
      </main>
    )
  }

  const me = game.players.find((player) => player.id === playerId)
  const others = game.players.filter((player) => player.id !== playerId)
  const picking = game.phase === 'picking'
  // 방장에게는 나가기 대신 「로비로」가 있다. 정말 나가려면 대기실에서 한 번 더 눌러야 한다.
  const iAmHost = hostId === playerId
  const waitingFor = game.players.filter((player) => !player.connected)

  return (
    <main className="game">
      <header className="game-bar">
        <span className="game-bar__heist">{game.heist}번째 금고</span>
        {/* 금고와 경보를 두 줄로 나눈다. 좁은 화면에서 한 줄로 늘어놓으면 나가기가 밀려난다. */}
        <span className="game-bar__marks" title={`금고 ${game.vaults} / 경보 ${game.alarms}`}>
          <span className="mark-row">
            {Array.from({ length: VAULTS_TO_WIN }, (_, i) => (
              <i key={`v${i}`} className={`mark mark--vault ${i < game.vaults ? 'mark--on' : ''}`} />
            ))}
          </span>
          <span className="mark-row">
            {Array.from({ length: game.alarmsToLose }, (_, i) => (
              <i key={`a${i}`} className={`mark mark--alarm ${i < game.alarms ? 'mark--on' : ''}`} />
            ))}
          </span>
        </span>
        <span className="game-bar__round">
          {picking ? `${game.round}라운드 · ${ROUND_LABEL[game.round]}` : '쇼다운'}
        </span>
        <button type="button" className="game-bar__leave" onClick={() => setConfirmLeave(true)}>
          {iAmHost ? '로비로' : '나가기'}
        </button>
      </header>

      {game.announcements.length > 0 && (
        <ul className="announcements">
          {game.announcements.map((item) => (
            <li key={item.playerId}>{item.text}</li>
          ))}
        </ul>
      )}

      {waitingFor.length > 0 && (
        <p className="game-waiting">
          {waitingFor.map((player) => player.displayName).join(', ')}님의 재접속을 기다리는 중입니다.
        </p>
      )}

      <section className="seats">
        {others.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            round={game.round}
            phase={game.phase}
            lockedTokens={game.lockedTokens}
            stuckTokens={game.stuckTokens}
            rejected={rejected}
            tokenRef={tokenRef}
            onTakeToken={take}
          />
        ))}
      </section>

      <section className="table">
        <div className="table__community">
          {Array.from({ length: 5 }, (_, index) =>
            game.community[index] ? (
              <PlayingCard
                key={game.community[index]}
                card={game.community[index]}
                delay={index * 90}
                highlight={lit.has(game.community[index])}
              />
            ) : (
              <CardSlot key={`slot-${index}`} />
            ),
          )}
        </div>

        <div className="table__tokens">
          {game.centerTokens.map((token) => (
            <Token
              key={token}
              value={token}
              round={game.round}
              locked={game.lockedTokens.includes(token)}
              stuck={game.stuckTokens.includes(token)}
              innerRef={tokenRef(token)}
              onClick={picking ? () => void take(token) : undefined}
            />
          ))}
          {picking && game.centerTokens.length === 0 && (
            <span className="table__tokens-empty">토큰이 모두 나갔습니다</span>
          )}
        </div>
      </section>

      {me && (
        <section className={`my-seat ${me.ready ? 'my-seat--ready' : ''}`}>
          <div className="my-seat__cards">
            {hand.length > 0 ? (
              hand.map((card, index) => (
                <PlayingCard key={card} card={card} delay={index * 120} highlight={lit.has(card)} />
              ))
            ) : (
              <>
                <CardSlot />
                <CardSlot />
              </>
            )}
          </div>
          <div className="my-seat__info">
            <span className="my-seat__name">
              {me.displayName} (나)
              {me.ready && <em className="my-seat__ready">확정</em>}
              {myHolding && (
                <button
                  type="button"
                  className={`my-seat__holding ${comboOn ? 'my-seat__holding--on' : ''}`}
                  onMouseEnter={() => setHovering(true)}
                  onMouseLeave={() => {
                    setHovering(false)
                    setIgnoreHover(false)
                  }}
                  onFocus={() => setHovering(true)}
                  onBlur={() => {
                    setHovering(false)
                    setIgnoreHover(false)
                  }}
                  onClick={() => {
                    setPinned((on) => {
                      // 끄는 클릭이라면, 커서가 아직 위에 있어도 다시 켜지지 않게 막는다.
                      if (on) setIgnoreHover(true)
                      return !on
                    })
                  }}
                  title="어떤 카드로 만든 족보인지 보기"
                >
                  {myHolding.description}
                </button>
              )}
            </span>
            <TokenTrack
              player={me}
              round={game.round}
              phase={game.phase}
              lockedTokens={game.lockedTokens}
              stuckTokens={game.stuckTokens}
              rejected={rejected}
              tokenRef={tokenRef}
              onTakeToken={take}
            />
          </div>
        </section>
      )}

      <footer className="game-actions">
        {picking && me && (
          <button
            type="button"
            className={`btn ${me.ready ? '' : 'btn--primary'}`}
            disabled={!game.canConfirm}
            onClick={() => void call('game:ready', { ready: !me.ready })}
          >
            {me.ready ? '확정 취소' : '확정'}
          </button>
        )}
        {picking && (
          <span className="game-actions__status">
            {game.canConfirm
              ? `확정 ${game.players.filter((p) => p.ready).length} / ${game.players.length}`
              : '모두가 토큰을 가져가면 확정할 수 있습니다'}
          </span>
        )}
      </footer>

      <ExtrasDrawer
        game={game}
        playerId={playerId}
        hand={hand}
        notes={notes}
        onUse={(input) => void call('game:useSpecialist', input)}
      />

      {fresh && <NoteCard note={fresh} onClose={() => setFresh(null)} />}

      <SetupStep
        game={game}
        playerId={playerId}
        hand={hand}
        onSubmit={(cardIndex) => void call('game:setupCard', { cardIndex })}
        onDiscard={(cardIndex) => void call('game:discard', { cardIndex })}
      />

      <ScanVote
        game={game}
        playerId={playerId}
        onVote={(kind, value) => void call('game:scanVote', { kind, value })}
      />

      {game.showdown && game.phase !== 'scanning' && (
        <Showdown game={game} revealed={revealed} finished={finished} playerId={playerId} />
      )}

      {/* 쇼다운 밖에서도 뜬다. 감지기는 라운드 도중에 터진다. */}
      {flash && (
        <div
          key={flash.key}
          className={`verdict verdict--${flash.tone} ${flash.final ? 'verdict--final' : ''}`}
        >
          {flash.text}
        </div>
      )}

      {confirmLeave && iAmHost && (
        <ConfirmModal
          title="판을 접고 대기실로 돌아가시겠습니까?"
          confirmLabel="대기실로"
          cancelLabel="계속하기"
          onConfirm={() => {
            void call('game:toLobby')
            setConfirmLeave(false)
          }}
          onCancel={() => setConfirmLeave(false)}
        >
          <strong>이 판이 취소되고</strong> 방에 있는 모두가 대기실로 돌아갑니다. 방은 그대로 남습니다.
        </ConfirmModal>
      )}

      {confirmLeave && !iAmHost && (
        <ConfirmModal
          title="게임에서 나가시겠습니까?"
          confirmLabel="나가기"
          cancelLabel="계속하기"
          onConfirm={() => void leave(navigate)}
          onCancel={() => setConfirmLeave(false)}
        >
          지금 나가면 <strong>이 판이 취소되고</strong> 남은 사람들도 모두 대기실로 돌아갑니다.
        </ConfirmModal>
      )}
    </main>
  )
}

const SCAN_NAME: Record<'rank' | 'category', string> = { rank: '망막', category: '지문' }

/** 판이 실패한 이유. 스캔에 걸렸으면 순서가 맞았어도 실패이므로 그 사실을 알린다. */
function failureText(missed: ('rank' | 'category')[]): string {
  if (missed.length === 0) return '경보가 울렸습니다'
  return `${missed.map((kind) => SCAN_NAME[kind]).join('·')} 스캔에 걸렸습니다!`
}

async function leave(navigate: ReturnType<typeof useNavigate>) {
  await call<null>('room:leave')
  navigate('/rooms')
}

// ── 자리 ──────────────────────────────────────────────────

interface SeatProps {
  player: GamePlayerView
  round: Round
  phase: GameView['phase']
  lockedTokens: number[]
  stuckTokens: number[]
  rejected: number | null
  tokenRef: (token: number) => (node: HTMLElement | null) => void
  onTakeToken: (token: number) => void
}

function PlayerSeat(props: SeatProps) {
  const { player, phase } = props
  return (
    <div className={`seat ${player.connected ? '' : 'seat--offline'} ${player.ready ? 'seat--ready' : ''}`}>
      <div className="seat__cards">
        {(player.hole ?? [null, null]).map((card, index) => (
          <PlayingCard
            key={card ?? `back-${index}`}
            card={card}
            faceDown={phase === 'picking'}
            size="sm"
            delay={index * 120}
          />
        ))}
      </div>
      <span className="seat__name">{player.displayName}</span>
      <TokenTrack {...props} />
      {!player.connected && <span className="seat__away">자리 비움</span>}
    </div>
  )
}

/**
 * 라운드별 판단의 흐름. 지난 라운드는 확정된 채로 굳어 있고,
 * 이번 라운드 토큰만 살아 있어 남이 뺏어갈 수 있다.
 */
function TokenTrack({
  player,
  round,
  phase,
  lockedTokens,
  stuckTokens,
  rejected,
  tokenRef,
  onTakeToken,
}: SeatProps) {
  return (
    <div className="track">
      {ROUNDS.map((r) => {
        const settledToken = player.history[r - 1]
        const isCurrent = r === round && phase === 'picking'

        if (isCurrent) {
          if (player.currentToken === null) return <TokenBlank key={r} round={r} />
          return (
            <Token
              key={r}
              value={player.currentToken}
              round={r}
              locked={lockedTokens.includes(player.currentToken)}
              stuck={stuckTokens.includes(player.currentToken)}
              innerRef={tokenRef(player.currentToken)}
              onClick={() => onTakeToken(player.currentToken as number)}
            />
          )
        }
        if (settledToken === null || settledToken === undefined) return <TokenBlank key={r} round={r} />
        return <Token key={r} value={settledToken} round={r} settled />
      })}
      {rejected !== null && player.currentToken === rejected && <span className="track__shake" />}
    </div>
  )
}

// ── 쇼다운과 결과 ──────────────────────────────────────────

interface ShowdownProps {
  game: GameView
  revealed: number
  finished: boolean
  playerId: string
}

function Showdown({ game, revealed, finished, playerId }: ShowdownProps) {
  const navigate = useNavigate()
  const reveals = game.showdown?.reveals ?? []
  const done = finished
  const over = game.phase === 'gameOver'
  const iAgreed = game.rematch.agreed.includes(playerId)
  // 서버가 구버전이면 이 값이 없다. 없다고 화면이 깨지지는 않게 한다.
  const continued = game.continued ?? []
  const iContinued = continued.includes(playerId)
  // 끊긴 사람은 기다려주지 않으므로 분모도 접속 중인 사람 수다.
  const waitingOn = game.players.filter((player) => player.connected).length
  const askedToRematch = over && game.rematch.proposed && !iAgreed

  return (
    <div className="showdown">
      <div className="showdown__panel">
        <h2 className="showdown__title">
          {!done
            ? '공개 중…'
            : game.showdown?.success
              ? '금고가 열렸습니다'
              : failureText(
                  (game.scan?.questions ?? [])
                    .filter((question) => question.correct === false)
                    .map((question) => question.kind),
                )}
        </h2>

        <ol className="reveal-list">
          {reveals.map((reveal, index) => {
            const shown = index < revealed
            return (
              <li key={reveal.playerId} className={`reveal ${shown ? 'reveal--shown' : ''} ${shown && !reveal.ok ? 'reveal--bad' : ''}`}>
                <span className="reveal__token">{reveal.token}</span>
                <span className="reveal__name">
                  {game.players.find((p) => p.id === reveal.playerId)?.displayName}
                </span>
                <span className="reveal__cards">
                  {reveal.hole.map((card) => (
                    <PlayingCard key={card} card={card} size="sm" faceDown={!shown} />
                  ))}
                </span>
                <span className="reveal__hand">{shown ? reveal.description : ''}</span>
              </li>
            )
          })}
        </ol>

        {done && !over && (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={iContinued}
            onClick={() => void call('game:continue')}
          >
            {iContinued
              ? `다른 사람을 기다리는 중 (${continued.length}/${waitingOn})`
              : `다음 금고로 (${continued.length}/${waitingOn})`}
          </button>
        )}

        {done && over && (
          <>
            <p className={`outcome outcome--${game.outcome}`}>
              {game.outcome === 'win' ? '금고 3개 — 강도 성공!' : '경보 3번 — 모두 붙잡혔습니다'}
            </p>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => void leave(navigate)}>
                방 나가기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={iAgreed}
                onClick={() => void call('game:rematch', { agree: true })}
              >
                {iAgreed ? `재경기 대기 ${game.rematch.agreed.length}/${game.players.length}` : '재경기 제안'}
              </button>
            </div>
          </>
        )}
      </div>

      {askedToRematch && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <h2 className="modal__title">재경기 제안이 들어왔습니다</h2>
            <p className="modal__body">같은 사람들과 처음부터 다시 합니다. 한 명이라도 거절하면 방이 닫힙니다.</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void call('game:rematch', { agree: false })}
              >
                아니오
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void call('game:rematch', { agree: true })}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
