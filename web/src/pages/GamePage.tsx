import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CHALLENGES,
  ROUNDS,
  ROUND_LABEL,
  TOKEN_LOCK_MS,
  bestHolding,
  orderForReading,
  type Card,
  type GamePlayerView,
  type GameView,
  type Round,
} from '@the-gang/shared'

import { Chat } from '../components/Chat.tsx'
import { ExtrasDrawer, NoteCard, type CardNote } from '../components/ExtrasDrawer.tsx'
import { ScanVote } from '../components/ScanVote.tsx'
import { SetupStep } from '../components/SetupStep.tsx'
import { TableChallenges, TableSpecialist } from '../components/TableExtras.tsx'
import { TutorialTip, type TipPayload } from '../components/TutorialTip.tsx'
import { ConfirmModal } from '../components/Modal.tsx'
import { CardSlot, PlayingCard } from '../components/PlayingCard.tsx'
import { Token, TokenBlank } from '../components/Token.tsx'
import { record } from '../lib/history.ts'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { sfx } from '../lib/sfx.ts'
import { call, socket, useServerEvent } from '../lib/socket.ts'
import { useEscape } from '../lib/useEscape.ts'
import { useTokenFlight } from '../lib/useTokenFlight.ts'

/** 방이 닫힌 사유를 사람 말로. 아무 설명 없이 튕겨나가면 고장으로 느껴진다. */
const CLOSED_MESSAGE: Record<string, string> = {
  empty: '방에 아무도 남지 않아 닫혔습니다.',
  idle: '30분 동안 아무 움직임이 없어 방이 닫혔습니다.',
  rematchDeclined: '재경기를 원하지 않는 사람이 있어 방이 닫혔습니다.',
  hostClosed: '방장이 방을 닫았습니다.',
}

/**
 * 좁은 화면에서 남의 자리를 어떻게 볼 것인가.
 *
 * 'cards' 는 카드까지 옆으로 밀어 보는 것, 'chips' 는 카드를 접고 칩 이력만 두 줄로 모으는 것이다.
 * 한눈에 전원의 판단을 늘어놓고 보려는 사람이 있어서 두 벌을 둔다. 넓은 화면은 이미 다 보이므로
 * 이 값이 쓰이지 않는다.
 */
type SeatView = 'cards' | 'chips'
const SEAT_VIEW_KEY = 'the-gang:seatView'

/** 저장이 막힌 환경(시크릿 창 등)이 있다. 못 읽어도 이번 판은 돌아가야 한다. */
function savedSeatView(): SeatView {
  try {
    return localStorage.getItem(SEAT_VIEW_KEY) === 'chips' ? 'chips' : 'cards'
  } catch {
    return 'cards'
  }
}

/** 알림이 떠 있는 시간. 한 줄을 읽고 눈을 판으로 되돌릴 만큼만. */
const TOAST_MS = 3800

/** 쇼다운은 한 사람씩 차례로 뒤집어야 순서가 맞았는지 눈에 들어온다. */
const REVEAL_STEP_MS = 1900
/** 그 사람이 사슬을 이었는지 아닌지를 크게 띄워 두는 시간. */
const VERDICT_MS = 1200
/** 마지막 사람까지 보고 나서 판 전체의 결과를 띄우기까지의 뜸. */
const FINAL_GAP_MS = 350
const FINAL_MS = 2400

export function GamePage({ spectating = false }: { spectating?: boolean } = {}) {
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
  /** 혼자 해보는 판인가. 돌아갈 대기실도, 다음 금고도 없다. */
  const [tutorial, setTutorial] = useState(false)
  /** 카드가 나에게만 알려준 것들. 이번 판 동안 드로어에 남는다. */
  const [notes, setNotes] = useState<CardNote[]>([])
  /** 방금 도착한 쪽지. 한 번 보여주고 나면 드로어에서 다시 볼 수 있다. */
  const [fresh, setFresh] = useState<CardNote | null>(null)
  /** 좁은 화면에서 남의 자리를 보는 방식. 한 번 고르면 다음 판에도 그대로 온다. */
  const [seatView, setSeatView] = useState<SeatView>(savedSeatView)
  /**
   * 방금 나에게 벌어진 일. 여러 개가 겹칠 수 있어 쌓아 두고 오래된 것부터 지운다.
   *
   * 같은 글이 연달아 올 수 있으므로(같은 사람에게 두 번 뺏기는 일) 내용이 아니라
   * 번호로 구별한다.
   */
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: 'info' | 'warn' }[]>([])
  const toastSeq = useRef(0)
  /** 튜토리얼 안내. 떠 있는 동안 서버가 봇을 멈춰 두므로 스스로 사라지지 않는다. */
  const [tip, setTip] = useState<TipPayload | null>(null)

  const dropToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const toggleSeatView = useCallback(() => {
    setSeatView((current) => {
      const next: SeatView = current === 'cards' ? 'chips' : 'cards'
      try {
        localStorage.setItem(SEAT_VIEW_KEY, next)
      } catch {
        /* 기억하지 못할 뿐이다 */
      }
      return next
    })
  }, [])

  /*
   * 토큰 자리표. 이것이 바뀔 때만 날아가는 계산을 다시 한다 —
   * 알림 한 줄이나 남의 채팅에도 화면은 다시 그려지는데, 그때마다 재면 비행이 끊긴다.
   */
  const layoutKey = game
    ? `${game.round}:${game.centerTokens.join(',')}|${game.players
        .map((player) => `${player.id}:${player.currentToken ?? '-'}`)
        .join(',')}`
    : ''
  const tokenRef = useTokenFlight(TOKEN_LOCK_MS, layoutKey)

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
      // 보러 온 사람은 자리에 앉지 않는다. 같은 화면이지만 들어가는 문이 다르다.
      const result = await call<{ hostId: string; phase: string; tutorial: boolean }>(
        spectating ? 'room:spectate' : 'room:join',
        { playerId, nickname, code },
      )
      if (!alive) return

      /*
       * 보러 왔는데 사실 내 자리가 있는 방이었다.
       *
       * 방 목록에서 판이 도는 방을 누르면 관전으로 들어가는데, 뒤로가기로 나갔다 돌아온
       * 사람도 같은 길을 탄다. 그 사람에게는 관전이 아니라 제자리가 맞다 —
       * 자리가 없으면 서버가 어차피 거절하므로, 한 번 물어보는 것으로 갈린다.
       */
      if (!result.ok && spectating) {
        const seat = await call<{ hostId: string; phase: string; tutorial: boolean }>('room:join', {
          playerId,
          nickname,
          code,
        })
        if (!alive) return
        if (seat.ok) {
          navigate(`/rooms/${code}/game`, { replace: true })
          return
        }
      }

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
      setTutorial(result.value.tutorial)
      // 방은 있는데 판이 없으면 여기 있을 이유가 없다. 보러 온 사람은 대기실에도 갈 자리가 없다.
      if (result.value.phase === 'lobby') {
        navigate(spectating ? '/rooms' : `/rooms/${code}`, { replace: true })
      }
    }

    void enter()
    // 인자 없는 off 는 'connect' 를 듣던 모두를 떼어낸다 — 연결 표시등까지 귀가 먹어
    // 서버가 돌아와도 화면이 영영 「끊김」인 채로 남는다. 내 것만 떼어낸다.
    const onConnect = () => void enter()
    socket.on('connect', onConnect)
    return () => {
      alive = false
      socket.off('connect', onConnect)
    }
  }, [code, nickname, playerId, navigate, spectating])

  /*
   * 지금 어느 화면인가를 body 에 적어 둔다.
   *
   * 테마·신고 단추는 App 이 그리는 붙박이라 이 화면의 자손이 아니다. 그래서 여기서
   * 「판 화면이다」를 알려야 그 단추들이 상태 줄을 비켜설 수 있다.
   */
  useEffect(() => {
    document.body.dataset.screen = 'game'
    return () => {
      delete document.body.dataset.screen
    }
  }, [])

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
    'game:toast',
    useCallback(
      (payload: { text: string; tone?: 'info' | 'warn' }) => {
        /*
         * 뺏긴 것과 「내려놓을 수 없다」는 둘 다 warn 이지만 성격이 다르다. 서버가
         * 종류를 따로 보내지 않아 문구로 가른다 — server/src/game.ts 의 그 한 줄이
         * 바뀌면 여기도 함께 본다. 어긋나도 소리 하나가 달라질 뿐이다.
         */
        if (payload.tone === 'warn') sfx(payload.text.includes('뺏겼') ? 'steal' : 'deny')
        const id = (toastSeq.current += 1)
        // 세 줄까지만 남긴다. 그 이상 쌓이면 판이 가려진다.
        setToasts((current) =>
          [...current, { id, text: payload.text, tone: payload.tone ?? ('info' as const) }].slice(-3),
        )
        setTimeout(() => dropToast(id), TOAST_MS)
      },
      [dropToast],
    ),
  )

  useServerEvent('tutorial:tip', useCallback((payload: TipPayload) => setTip(payload), []))

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
      (room: { code: string; phase: string; hostId: string; tutorial: boolean }) => {
        if (room.code !== code) return
        setHostId(room.hostId)
        setTutorial(room.tutorial)
        // 판이 접혔거나 아직 시작 전이면 이 화면에 있을 이유가 없다.
        if (room.phase === 'lobby') {
          navigate(spectating ? '/rooms' : `/rooms/${code}`, {
            replace: true,
            ...(spectating ? { state: { notice: '판이 끝났습니다.' } } : {}),
          })
        }
      },
      [code, navigate, spectating],
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

  /*
   * 보드에 카드가 깔릴 때 소리를 낸다.
   *
   * 라운드 번호가 아니라 깔린 장수를 센다 — 플롭은 한 번에 세 장이라 세 번 울려야
   * 눈에 보이는 것과 맞는다. 처음 받은 상태는 「지금 이만큼 깔려 있다」이지 방금
   * 깔린 것이 아니므로 건너뛴다. 새로고침할 때마다 리버가 울리면 안 된다.
   */
  const communityCount = game?.community.length ?? 0
  const dealtBefore = useRef<number | null>(null)
  useEffect(() => {
    const before = dealtBefore.current
    dealtBefore.current = communityCount
    if (before !== null && communityCount > before) sfx('deal', communityCount - before)
  }, [communityCount])

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
        if (index < 2) {
          // 판정은 없지만 소리는 낸다. 여기가 계단의 첫 칸이다.
          sfx('revealOk', 0)
          return
        }
        const ok = revealsRef.current[index - 1]?.ok ?? true
        const key = `p${index}`
        // 한 사람마다 반음씩 오른다. 사슬이 이어지는 중임을 글자보다 먼저 알린다.
        sfx(ok ? 'revealOk' : 'revealBad', index - 1)
        setFlash({ key, text: ok ? '성공' : '실패', tone: ok ? 'ok' : 'bad' })
        at(VERDICT_MS, () => setFlash((current) => (current?.key === key ? null : current)))
      })
    }

    // 마지막 사람의 판정이 사라진 뒤에 판 전체의 결과를 못박는다.
    at(REVEAL_STEP_MS * revealCount + VERDICT_MS + FINAL_GAP_MS, () => {
      const success = successRef.current
      setFinished(true)
      sfx(success ? 'vault' : 'alarm')
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

  /*
   * 끝을 본 판만 적는다 — 승·패·중도포기 셋뿐이라 그때만 세면 새로고침으로 두 번 세는
   * 일이 없다. 연습과 관전은 세지 않는다. 남이 나가 접힌 판도 내 승패가 아니라 세지 않는다.
   */
  useEffect(() => {
    if (spectating || tutorial || !game) return
    if (game.phase !== 'gameOver' || !game.outcome) return
    record(nickname, game.outcome === 'win' ? 'win' : 'lose', `${code}:${game.heist}:${game.outcome}`)
  }, [spectating, tutorial, game, nickname, code])

  /** 판이 끝나기 전에 스스로 나가는 것은 중도포기다. */
  function leaveNow() {
    if (!spectating && !tutorial && game && game.phase !== 'gameOver') {
      record(nickname, 'quit', `${code}:${game.heist}:quit`)
    }
    setConfirmLeave(false)
    void leave(navigate, tutorial)
  }

  async function take(token: number) {
    const result = await call<null>('game:take', { token })
    if (result.ok) {
      sfx('take')
      return
    }
    // 거절은 조용히 씹지 않는다. 눌렀는데 아무 일도 안 일어나는 게 제일 나쁘다.
    sfx('deny')
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
  /*
   * 뒤의 자리도 모달과 같은 순서로 열린다.
   *
   * 서버는 판이 끝나는 순간 모두의 홀카드를 공개 상태에 싣는다. 그대로 그리면 덮개
   * 뒤에서 전원의 카드가 한꺼번에 뒤집혀, 모달이 한 명씩 여는 연출이 시작부터 무너진다.
   * 공개된 사람만 앞면으로 둔다 — 순서는 모달이 쓰는 것과 같은 배열(토큰 오름차순)이다.
   *
   * 스캔 중은 그대로 둔다. 그때는 지목된 사람 말고는 이미 다 공개된 자리이고,
   * 그 사람의 카드는 서버가 아예 보내지 않는다.
   */
  const revealing = game.phase === 'showdown' || game.phase === 'gameOver'
  const openSeats = new Set(
    (game.showdown?.reveals ?? []).slice(0, revealed).map((reveal) => reveal.playerId),
  )
  const picking = game.phase === 'picking'
  /*
   * 내 토큰이 날아가는 중이다.
   *
   * 이 동안 다른 토큰을 눌러도 서버가 「방금 움직인 토큰입니다」로 거절한다 — 쥔 것이
   * 아직 잠겨 있어 내려놓을 수 없기 때문이다. 거절하고 흔드느니 아예 잠가 둔다.
   * 손이 도착하는 순간 잠금도 함께 풀린다.
   */
  const flying =
    picking && me?.currentToken != null && game.lockedTokens.includes(me.currentToken)
  /*
   * 방장에게는 나가기 대신 「로비로」가 있다. 정말 나가려면 대기실에서 한 번 더 눌러야 한다.
   * 튜토리얼은 만든 사람이 곧 방장이지만 돌아갈 대기실이 없다 — 혼자였으므로 그냥 나간다.
   */
  const iAmHost = hostId === playerId && !tutorial && !spectating
  const waitingFor = game.players.filter((player) => !player.connected)

  return (
    <main className={`game ${spectating ? 'game--watching' : ''}`}>
      <header className="game-bar">
        <span className="game-bar__heist">{game.heist}번째 금고</span>
        {/* 금고와 경보를 두 줄로 나눈다. 좁은 화면에서 한 줄로 늘어놓으면 나가기가 밀려난다. */}
        <span className="game-bar__marks" title={`금고 ${game.vaults} / 경보 ${game.alarms}`}>
          <span className="mark-row">
            {Array.from({ length: game.vaultsToWin }, (_, i) => (
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
        {spectating && <span className="game-bar__watching">관전 중</span>}
        <button type="button" className="game-bar__leave" onClick={() => setConfirmLeave(true)}>
          {iAmHost ? '로비로' : '나가기'}
        </button>
      </header>

      {/*
        방금 나에게 벌어진 일. 공개 안내(announcements)와 다른 층위라 자리도 다르다 —
        저쪽은 판에 남는 기록이고, 이쪽은 지나가면 그만인 알림이다.
      */}
      {toasts.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              className={`toast toast--${toast.tone}`}
              onClick={() => dropToast(toast.id)}
            >
              {toast.text}
            </button>
          ))}
        </div>
      )}

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

      <div className="seats-area">
        {/* 좁은 화면에서만 보인다. 넓은 화면은 카드도 칩도 이미 다 보인다. */}
        <button
          type="button"
          className="seats-view"
          onClick={toggleSeatView}
          aria-pressed={seatView === 'chips'}
        >
          {seatView === 'cards' ? '칩만 모아 보기' : '카드도 보기'}
        </button>

        <section className={`seats seats--${seatView}`}>
          {others.map((player) => (
            <PlayerSeat
              key={player.id}
              player={player}
              round={game.round}
              phase={game.phase}
              hideCards={revealing && !openSeats.has(player.id)}
              lockedTokens={game.lockedTokens}
              stuckTokens={game.stuckTokens}
              rejected={rejected}
              busy={flying}
              tokenRef={tokenRef}
              onTakeToken={take}
            />
          ))}
        </section>
      </div>

      {/*
        테이블과 그 양옆. 넓은 화면에서만 옆이 서고, 좁으면 테이블 하나만 남는다.
        무엇이 걸렸는지 매번 드로어를 열어 확인하게 두면 잊은 채로 두는 쪽을 고르게 된다.
      */}
      <div className="table-row">
        <TableSpecialist game={game} note={notes.find((n) => n.specialist === game.specialist) ?? null} />

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
              busy={flying}
              innerRef={tokenRef(token)}
              onClick={picking ? () => void take(token) : undefined}
            />
          ))}
          {picking && game.centerTokens.length === 0 && (
            <span className="table__tokens-empty">토큰이 모두 나갔습니다</span>
          )}
        </div>
      </section>

        <TableChallenges game={game} />
      </div>

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
              busy={flying}
              mine
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

      {tip && (
        <TutorialTip
          tip={tip}
          onClose={() => {
            setTip(null)
            void call('tutorial:next')
          }}
        />
      )}

      {/* 대화. 접힌 채로도 새 말 한 줄은 단추 옆에 잠깐 붙는다. */}
      <Chat code={code} />

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
        <Showdown
          game={game}
          revealed={revealed}
          finished={finished}
          playerId={playerId}
          iAmHost={iAmHost}
          tutorial={tutorial}
          onLeave={() => setConfirmLeave(true)}
        />
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
          title={
            spectating
              ? '관전을 그만두시겠습니까?'
              : tutorial
                ? '연습을 그만두시겠습니까?'
                : '게임에서 나가시겠습니까?'
          }
          confirmLabel="나가기"
          cancelLabel="계속하기"
          onConfirm={leaveNow}
          onCancel={() => setConfirmLeave(false)}
        >
          {spectating ? (
            <>보던 판에서 나갑니다. 판은 그대로 이어집니다.</>
          ) : tutorial ? (
            <>연습을 그만두고 첫 화면으로 돌아갑니다. 언제든 다시 시작할 수 있습니다.</>
          ) : (
            <>
              지금 나가면 <strong>이 판이 취소되고</strong> 남은 사람들도 모두 대기실로 돌아갑니다.
            </>
          )}
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

/** 연습은 첫 화면에서 들어왔으므로 첫 화면으로 되돌린다. 방 목록에 볼 것이 없다. */
async function leave(navigate: ReturnType<typeof useNavigate>, tutorial = false) {
  await call<null>('room:leave')
  navigate(tutorial ? '/' : '/rooms')
}

// ── 자리 ──────────────────────────────────────────────────

interface SeatProps {
  player: GamePlayerView
  round: Round
  phase: GameView['phase']
  lockedTokens: number[]
  stuckTokens: number[]
  rejected: number | null
  /** 내 토큰이 날아가는 중. 도착할 때까지 아무것도 누를 수 없다. */
  busy: boolean
  /** 내 자리인가. 내 토큰은 누르면 가져오는 것이 아니라 내려놓는 것이다. */
  mine?: boolean
  /** 아직 차례가 오지 않은 자리. 공개 상태에는 카드가 실려 있어도 뒷면으로 둔다. */
  hideCards?: boolean
  tokenRef: (token: number) => (node: HTMLElement | null) => void
  onTakeToken: (token: number) => void
}

function PlayerSeat(props: SeatProps) {
  const { player, phase, hideCards = false } = props
  return (
    <div className={`seat ${player.connected ? '' : 'seat--offline'} ${player.ready ? 'seat--ready' : ''}`}>
      <div className="seat__cards">
        {(player.hole ?? [null, null]).map((card, index) => (
          <PlayingCard
            key={card ?? `back-${index}`}
            card={card}
            faceDown={phase === 'picking' || hideCards}
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
  busy,
  mine = false,
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
              busy={busy}
              mine={mine}
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
  /** 방장은 나가는 대신 판을 접어 모두를 대기실로 되돌린다. 확인창의 말도 달라진다. */
  iAmHost: boolean
  /** 혼자 해보는 판. 다음 금고가 없고, 여기서 끝난다. */
  tutorial: boolean
  onLeave: () => void
}

function Showdown({ game, revealed, finished, playerId, iAmHost, tutorial, onLeave }: ShowdownProps) {
  const navigate = useNavigate()
  /**
   * 마우스를 올린 사람의 다섯 장.
   *
   * 공개가 다 끝난 뒤에만 켠다 — 한 장씩 뒤집히는 동안 켜지면 아직 안 뒤집힌 카드까지
   * 밝혀져 순서를 보여주는 연출이 무너진다.
   */
  const [hovered, setHovered] = useState<string | null>(null)
  /**
   * 무엇을 보여줄 것인가.
   *
   * 'hand' 는 그 사람이 쥐고 있던 두 장이고, 'combo' 는 그 두 장과 공용 카드로 만들어진
   * 실제 다섯 장이다. 둘 다 필요하다 — 앞은 「무엇을 들고 그렇게 선언했나」, 뒤는
   * 「그래서 얼마나 셌나」를 말한다.
   */
  const [view, setView] = useState<'hand' | 'combo'>('hand')
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

  /*
   * 짚고 있는 사람이 실제로 쓴 다섯 장. 공개된 홀카드와 공용 카드로 다시 구해도
   * 서버가 판정한 것과 같은 답이 나온다 — 같은 규칙이 shared 에 한 벌만 있기 때문이다.
   */
  const lit = new Set<string>(
    hovered && view === 'hand'
      ? (bestHolding([
          ...(reveals.find((one) => one.playerId === hovered)?.hole ?? []),
          ...game.community,
        ])?.used ?? [])
      : [],
  )

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

        {/*
          판정의 근거가 되는 다섯 장. 모달이 테이블을 덮고 있어, 이것이 없으면
          「내 카드가 왜 그 족보인지」를 확인하려고 모달을 닫아야 한다.
        */}
        {game.community.length > 0 && (
          <div className="showdown__community">
            {game.community.map((card, index) => (
              <PlayingCard
                key={card}
                card={card}
                size="sm"
                delay={index * 60}
                highlight={lit.has(card)}
              />
            ))}
          </div>
        )}

        {done && (
          <div className="showdown__view">
            <button
              type="button"
              className="showdown__swap"
              onClick={() => setView(view === 'hand' ? 'combo' : 'hand')}
              aria-label={view === 'hand' ? '조합 보기로 바꾸기' : '핸드 보기로 바꾸기'}
            >
              {view === 'hand' ? '조합 보기 →' : '← 핸드 보기'}
            </button>
          </div>
        )}

        <ol className="reveal-list">
          {reveals.map((reveal, index) => {
            const shown = index < revealed
            const seat = game.players.find((player) => player.id === reveal.playerId)
            return (
              <li
                key={reveal.playerId}
                className={`reveal ${shown ? 'reveal--shown' : ''} ${shown && !reveal.ok ? 'reveal--bad' : ''} ${
                  hovered === reveal.playerId ? 'reveal--lit' : ''
                }`}
                // 공개가 다 끝난 뒤에만. 그 전에는 아직 뒤집히지 않은 카드가 있다.
                onMouseEnter={() => done && setHovered(reveal.playerId)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="reveal__token">{reveal.token}</span>
                <span className="reveal__name">
                  {seat?.displayName}
                  {/*
                    라운드마다의 선언. 마지막 하나만 보면 「어쩌다 그 자리에 섰는지」가
                    안 보인다 — 처음부터 세다가 밀린 것인지, 끝에 와서 올린 것인지가
                    이 줄에 남는다.
                  */}
                  <span className="reveal__track">
                    {ROUNDS.map((r) => {
                      const past = seat?.history[r - 1]
                      return past === null || past === undefined ? (
                        <TokenBlank key={r} round={r} />
                      ) : (
                        <Token key={r} value={past} round={r} settled />
                      )
                    })}
                  </span>
                </span>
                <span className={`reveal__cards ${view === 'combo' ? 'reveal__cards--combo' : ''}`}>
                  {/*
                    조합 보기는 읽는 차례로 세운다 — 짝이 앞, 나머지는 높은 것부터.
                    서버가 고른 다섯 장은 딜 순서 그대로라 무엇이 짝이었는지 눈으로 세어야 했다.
                  */}
                  {(view === 'combo' && shown
                    ? orderForReading(bestHolding([...reveal.hole, ...game.community])?.used ?? reveal.hole)
                    : reveal.hole
                  ).map((card) => (
                    <PlayingCard
                      key={card}
                      card={card}
                      size="sm"
                      faceDown={!shown}
                      highlight={lit.has(card)}
                    />
                  ))}
                </span>
                <span className="reveal__hand">{shown ? reveal.description : ''}</span>
              </li>
            )
          })}
        </ol>

        {/* 연습은 금고 하나로 끝난다. 다음 금고를 걸어두면 끝나지 않는 연습이 된다. */}
        {done && tutorial && (
          <button type="button" className="btn btn--primary btn--block" onClick={onLeave}>
            나가기
          </button>
        )}

        {done && !over && !tutorial && (
          <div className="showdown__next">
            <button
              type="button"
              className="btn btn--primary"
              disabled={iContinued}
              onClick={() => void call('game:continue')}
            >
              {iContinued
                ? `다른 사람을 기다리는 중 (${continued.length}/${waitingOn})`
                : `다음 금고로 (${continued.length}/${waitingOn})`}
            </button>
            {/*
              다음 금고로를 이미 눌렀어도 여기서 빠져나갈 수 있어야 한다 — 다른 사람을
              기다리는 동안 갇히면, 남은 길이 브라우저를 닫는 것뿐이다.
            */}
            <button type="button" className="btn showdown__leave" onClick={onLeave}>
              {iAmHost ? '로비로' : '나가기'}
            </button>
          </div>
        )}

        {done && over && (
          <>
            <p className={`outcome outcome--${game.outcome}`}>
              {game.outcome === 'win'
                ? `금고 ${game.vaultsToWin}개 — 강도 성공!`
                : `경보 ${game.alarmsToLose}번 — 모두 붙잡혔습니다`}
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
