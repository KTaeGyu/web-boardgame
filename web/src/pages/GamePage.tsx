import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ALARMS_TO_LOSE,
  ROUNDS,
  ROUND_LABEL,
  TOKEN_LOCK_MS,
  VAULTS_TO_WIN,
  type Card,
  type GamePlayerView,
  type GameView,
  type Round,
} from '@the-gang/shared'

import { CardSlot, PlayingCard } from '../components/PlayingCard.tsx'
import { Token, TokenBlank } from '../components/Token.tsx'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { call, socket, useServerEvent } from '../lib/socket.ts'
import { useTokenFlight } from '../lib/useTokenFlight.ts'

/** 쇼다운은 한 사람씩 차례로 뒤집어야 순서가 맞았는지 눈에 들어온다. */
const REVEAL_STEP_MS = 900

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

  const tokenRef = useTokenFlight(TOKEN_LOCK_MS)

  // 진입·새로고침·재연결이 모두 같은 요청이다. 서버가 자리와 손패를 되돌려준다.
  useEffect(() => {
    if (!nickname) {
      navigate('/', { replace: true })
      return
    }
    const enter = () => void call('room:join', { playerId, nickname, code })
    enter()
    socket.on('connect', enter)
    return () => {
      socket.off('connect', enter)
    }
  }, [code, nickname, playerId, navigate])

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
    useCallback((payload: { hole: Card[] }) => setHand(payload.hole), []),
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
      (room: { code: string; phase: string }) => {
        // 판이 접혔거나 아직 시작 전이면 이 화면에 있을 이유가 없다.
        if (room.code === code && room.phase === 'lobby') navigate(`/rooms/${code}`, { replace: true })
      },
      [code, navigate],
    ),
  )

  useServerEvent(
    'room:closed',
    useCallback(() => navigate('/rooms', { replace: true }), [navigate]),
  )

  /** 쇼다운에 들어서면 한 명씩 뒤집는다. 다음 판이 시작되면 처음으로 되돌린다. */
  const phase = game?.phase
  const showdownKey = `${game?.heist ?? 0}:${phase}`
  const revealCount = game?.showdown?.reveals.length ?? 0
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []

    if (phase === 'picking' || revealCount === 0) {
      setRevealed(0)
      return
    }
    setRevealed(0)
    for (let index = 1; index <= revealCount; index++) {
      timers.current.push(setTimeout(() => setRevealed(index), REVEAL_STEP_MS * index))
    }
    return () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    }
  }, [showdownKey, revealCount, phase])

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
  const waitingFor = game.players.filter((player) => !player.connected)

  return (
    <main className="game">
      <header className="game-bar">
        <span className="game-bar__heist">{game.heist}번째 금고</span>
        <span className="game-bar__marks" title={`금고 ${game.vaults} / 경보 ${game.alarms}`}>
          {Array.from({ length: VAULTS_TO_WIN }, (_, i) => (
            <i key={`v${i}`} className={`mark mark--vault ${i < game.vaults ? 'mark--on' : ''}`} />
          ))}
          <em className="game-bar__divider" />
          {Array.from({ length: ALARMS_TO_LOSE }, (_, i) => (
            <i key={`a${i}`} className={`mark mark--alarm ${i < game.alarms ? 'mark--on' : ''}`} />
          ))}
        </span>
        <span className="game-bar__round">{picking ? ROUND_LABEL[game.round] : '쇼다운'}</span>
        <button type="button" className="game-bar__leave" onClick={() => void leave(navigate)}>
          나가기
        </button>
      </header>

      {waitingFor.length > 0 && (
        <p className="game-waiting">
          {waitingFor.map((player) => player.nickname).join(', ')}님의 재접속을 기다리는 중입니다.
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
              <PlayingCard key={game.community[index]} card={game.community[index]} delay={index * 90} />
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
        <section className="my-seat">
          <div className="my-seat__cards">
            {hand.length > 0 ? (
              hand.map((card, index) => <PlayingCard key={card} card={card} delay={index * 120} />)
            ) : (
              <>
                <CardSlot />
                <CardSlot />
              </>
            )}
          </div>
          <div className="my-seat__info">
            <span className="my-seat__name">{me.nickname} (나)</span>
            <TokenTrack
              player={me}
              round={game.round}
              phase={game.phase}
              lockedTokens={game.lockedTokens}
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

      {game.showdown && <Showdown game={game} revealed={revealed} playerId={playerId} />}
    </main>
  )
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
      <span className="seat__name">{player.nickname}</span>
      <TokenTrack {...props} />
      {!player.connected && <span className="seat__away">자리 비움</span>}
    </div>
  )
}

/**
 * 라운드별 판단의 흐름. 지난 라운드는 확정된 채로 굳어 있고,
 * 이번 라운드 토큰만 살아 있어 남이 뺏어갈 수 있다.
 */
function TokenTrack({ player, round, phase, lockedTokens, rejected, tokenRef, onTakeToken }: SeatProps) {
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

function Showdown({ game, revealed, playerId }: { game: GameView; revealed: number; playerId: string }) {
  const navigate = useNavigate()
  const reveals = game.showdown?.reveals ?? []
  const done = revealed >= reveals.length
  const over = game.phase === 'gameOver'
  const iAgreed = game.rematch.agreed.includes(playerId)
  const askedToRematch = over && game.rematch.proposed && !iAgreed

  return (
    <div className="showdown">
      <div className="showdown__panel">
        <h2 className="showdown__title">
          {done ? (game.showdown?.success ? '금고가 열렸습니다' : '경보가 울렸습니다') : '공개 중…'}
        </h2>

        <ol className="reveal-list">
          {reveals.map((reveal, index) => {
            const shown = index < revealed
            return (
              <li key={reveal.playerId} className={`reveal ${shown ? 'reveal--shown' : ''} ${shown && !reveal.ok ? 'reveal--bad' : ''}`}>
                <span className="reveal__token">{reveal.token}</span>
                <span className="reveal__name">{game.players.find((p) => p.id === reveal.playerId)?.nickname}</span>
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
          <button type="button" className="btn btn--primary btn--block" onClick={() => void call('game:continue')}>
            다음 금고로
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
