import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AUTO_CONFIRM_COUNTDOWN_MS,
  CHALLENGES,
  ROUNDS,
  ROUND_LABEL,
  TOKEN_LOCK_MS,
  usableCommunity,
  VARIANTS,
  orderForReading,
  type Card,
  type GamePlayerView,
  type GameView,
  type Round,
} from '@the-gang/shared'

import { recordPlay, session } from '../lib/auth.ts'
import { Chat } from '../components/Chat.tsx'
import { EmoteBubble, EmotePicker, useEmotes, type LiveEmote } from '../components/Emotes.tsx'
import { ExtrasDrawer, NoteCard, type CardNote } from '../components/ExtrasDrawer.tsx'
import { ScanVote } from '../components/ScanVote.tsx'
import { Toast } from '../components/Toast.tsx'
import { SetupStep } from '../components/SetupStep.tsx'
import { TableChallenges, TableSpecialist } from '../components/TableExtras.tsx'
import { useSpecialistUse } from '../components/SpecialistUse.tsx'
import { TutorialTip, type TipPayload } from '../components/TutorialTip.tsx'
import { ConfirmModal } from '../components/Modal.tsx'
import { CommunityBoard } from '../components/Board.tsx'
import { CardSlot, PlayingCard } from '../components/PlayingCard.tsx'
import { Token, TokenBlank, TokenHole } from '../components/Token.tsx'
import { useBackIntercept } from '../lib/back.ts'
import { getNickname, getPlayerId } from '../lib/identity.ts'
import { sfx } from '../lib/sfx.ts'
import { socket } from '../lib/socket.ts'
// 사람들과 하는 판은 서버에서, 혼자 해보기는 화면 안에서 돈다. 이 화면은 그 차이를 모른다.
import { call, useServerEvent } from '../lib/transport.ts'
import { useEscapeFallback } from '../lib/useEscape.ts'
import { useTokenFlight } from '../lib/useTokenFlight.ts'
import { useScrollLock } from '../lib/useScrollLock.ts'

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
  const emotes = useEmotes()

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
  /*
   * 판이 도는 중의 뒤로가기는 나가는 것이 아니라 묻는 것이다.
   *
   * 휴대폰의 뒤로가기는 실수로 눌리는 단추다. 그대로 나가면 화면만 목록으로 가고
   * 자리는 남아, 라운드가 내 확정을 기다리며 선다 — 남들 화면에는 아무 일도 없는데
   * 판만 멈춘다. 취소하면 제자리이므로 잃는 것이 없다.
   */
  useBackIntercept(!confirmLeave, () => setConfirmLeave(true))
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
  /** 손패를 받은 마지막 판. 재접속과 새 판을 가른다. */
  const dealtHeist = useRef<number | null>(null)
  /** 튜토리얼 안내. 떠 있는 동안 서버가 봇을 멈춰 두므로 스스로 사라지지 않는다. */
  const [tip, setTip] = useState<TipPayload | null>(null)

  const dropToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  /** 화면이 스스로 알려야 할 때. 서버가 보낸 것(game:toast)과 같은 자리에 같은 모양으로 쌓인다. */
  const showToast = useCallback(
    (text: string, tone: 'info' | 'warn' = 'warn') => {
      const id = (toastSeq.current += 1)
      setToasts((current) => [...current, { id, text, tone }].slice(-3))
      setTimeout(() => dropToast(id), TOAST_MS)
    },
    [dropToast],
  )

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

  /*
   * 내 홀카드와 이미 공개된 보드만으로 구한다. 남의 정보는 쓰지 않으므로 새는 것이 없다.
   *
   * 손을 만드는 법은 포커 방식마다 다르다 — 오마하는 손에서 정확히 두 장이라,
   * 텍사스와 같은 카드를 들고도 답이 다르다. 규칙은 shared 에 한 벌뿐이다.
   */
  const myHolding = useMemo(
    () => (game ? VARIANTS[game.variant].holding(hand, usableCommunity(game, playerId)) : null),
    [hand, game, playerId],
  )

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
        { playerId, nickname, code, token: session()?.token },
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

  /* 덮개가 하나도 없을 때만 받는다. 무엇이 떠 있는지 여기서 셀 필요가 없다. */
  useEscapeFallback(
    true,
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
    useCallback((payload: { heist: number; hole: Card[] }) => {
      setHand(payload.hole)
      setNotes([]) // 새 판이면 지난 판의 쪽지도 지운다
      setFresh(null)
      // 재접속에도 손패가 다시 온다. 그때 판이 열리는 소리가 나면 거짓말이다.
      if (dealtHeist.current === payload.heist) return
      dealtHeist.current = payload.heist
      sfx('dealHand')
    }, []),
  )

  useServerEvent(
    'game:note',
    useCallback((payload: CardNote) => {
      setNotes((current) => [...current.filter((n) => n.specialist !== payload.specialist), payload])
      setFresh(payload) // 도착하자마자 한 번은 보여준다
      sfx('note')
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
        if (payload.tone === 'warn') {
          if (payload.text.includes('뺏겼')) sfx('steal')
          // 거절은 하나같이 「~할 수 없습니다」로 끝난다. 그 밖의 warn 은 거절이 아니라
          // 사건이므로 툭 소리를 내면 어긋난다 — 감지기가 그렇고, 저쪽은 따로 운다.
          else if (payload.text.includes('수 없습니다')) sfx('deny')
        }
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

  /*
   * 구경을 마치고 목록으로 나간다.
   *
   * 화면만 옮기면 방 쪽에는 구경꾼이 그대로 남아, 대기실에 있는 사람들에게는 아직 보고
   * 있는 것처럼 「관전 1/5」이 뜬다. 자리는 끊겨도 지켜주지만 구경 자리는 지킬 것이 없다.
   */
  const leaveAsWatcher = useCallback(
    (notice: string) => {
      void call<null>('room:leave')
      navigate('/rooms', { replace: true, state: { notice } })
    },
    [navigate],
  )

  /*
   * 판이 접혔다는 말을 잠깐 보여주고 옮긴다. 그 사이에 화면을 벗어나면 시계도 함께 접는다 —
   * 남겨두면 이미 목록으로 나간 사람을 뒤늦게 방으로 끌고 온다.
   */
  const abortTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (abortTimer.current) clearTimeout(abortTimer.current)
    },
    [],
  )

  useServerEvent(
    'game:aborted',
    useCallback(
      (payload: { message: string }) => {
        setNotice(payload.message)
        setGame(null)
        if (abortTimer.current) clearTimeout(abortTimer.current)
        abortTimer.current = setTimeout(() => {
          /*
           * 구경꾼에게는 돌아갈 자리가 없다.
           *
           * 방 주소로 보내면 대기실이 그 주소를 「앉으러 왔다」로 읽어 자리에 앉혀 버린다
           * (RoomPage 는 ?watch=1 이 없으면 room:join 을 부른다). 보던 사람이 판이
           * 접혔다는 이유로 선수가 되면 안 된다.
           */
          if (spectating) {
            leaveAsWatcher('판이 끝났습니다.')
            return
          }
          navigate(`/rooms/${code}`, { replace: true })
        }, 2200)
      },
      [code, navigate, spectating, leaveAsWatcher],
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
          if (spectating) {
            leaveAsWatcher('판이 끝났습니다.')
            return
          }
          navigate(`/rooms/${code}`, { replace: true })
        }
      },
      [code, navigate, spectating, leaveAsWatcher],
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
   * 남이 토큰을 움직였을 때도 소리가 난다.
   *
   * 토큰이 이 판의 유일한 언어라, 남의 선언이 들리지 않으면 화면에서 눈을 뗄 수 없다.
   * 내 일은 take·steal 이 이미 맡으므로 여기서는 남의 자리만 본다.
   *
   * 한 번의 뺏기가 두 사람의 자리를 함께 바꾼다 — 뺏은 쪽은 새로 쥐고 뺏긴 쪽은 빈다.
   * 그래서 「새로 쥔 사람」에서만 울리고, 빈 자리는 그 토큰이 중앙으로 돌아갔을 때에만,
   * 곧 스스로 내려놓았을 때에만 울린다. 그러지 않으면 한 동작에 두 번 난다.
   */
  const seatTokens = game?.players.map((player) => player.currentToken)
  const heldBefore = useRef<Map<string, number | null> | null>(null)
  const roundKey = game ? `${game.heist}:${game.round}` : ''
  const roundBefore = useRef(roundKey)

  useEffect(() => {
    if (!game) return
    const before = heldBefore.current
    const sameRound = roundBefore.current === roundKey
    heldBefore.current = new Map(game.players.map((player) => [player.id, player.currentToken]))
    roundBefore.current = roundKey
    // 라운드가 넘어가면 모두의 자리가 한꺼번에 비워진다. 그건 누가 움직인 것이 아니다.
    if (!before || !sameRound) return

    for (const player of game.players) {
      if (player.id === playerId) continue
      const was = before.get(player.id)
      // 방금 들어온 사람에게는 견줄 앞자리가 없다.
      if (was === undefined || was === player.currentToken) continue

      if (player.currentToken !== null) {
        // 내 손에서 간 것이면 뺏겼다는 소리가 이미 울렸다.
        const from = [...before].find(([, token]) => token === player.currentToken)?.[0]
        if (from !== playerId) sfx('otherTake')
      } else if (was !== null && game.centerTokens.includes(was)) {
        sfx('otherDrop')
      }
    }
    // seatTokens 가 배치가 바뀐 것을 알린다. game 하나만 매면 채팅 한 줄에도 다시 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatTokens?.join(','), roundKey, playerId])

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

  /*
   * 해결사를 쓴 순간.
   *
   * 판이 바뀌면 「썼는가」가 false 로 돌아오므로 거짓에서 참으로 넘어갈 때만 잡으면 된다.
   */
  const specialistUsed = game?.specialistUsed ?? false
  const usedBefore = useRef(specialistUsed)
  useEffect(() => {
    if (specialistUsed && !usedBefore.current) sfx('specialist')
    usedBefore.current = specialistUsed
  }, [specialistUsed])

  /* 스캔이 열린다. 마지막 사람 차례에 한 번 열리고 판이 바뀌면 사라진다. */
  const scanOpen = Boolean(game?.scan)
  const scanBefore = useRef(false)
  useEffect(() => {
    if (scanOpen && !scanBefore.current) sfx('scanStart')
    scanBefore.current = scanOpen
  }, [scanOpen])

  /*
   * 스캔의 답이 정해진다.
   *
   * 물음이 둘일 수 있어(망막과 지문이 함께 걸린 판) 정해진 것만 순서대로 세어 두고,
   * 늘어난 만큼만 울린다. 한꺼번에 정해지면 사이를 두어 두 소리가 겹치지 않게 한다.
   */
  const decided = (game?.scan?.questions ?? [])
    .filter((question) => question.correct !== null)
    .map((question) => question.correct)
    .join(',')
  const decidedBefore = useRef('')
  useEffect(() => {
    const before = decidedBefore.current
    decidedBefore.current = decided
    if (!decided || decided === before) return
    const fresh = decided.split(',').slice(before ? before.split(',').length : 0)
    fresh.forEach((verdict, index) => {
      if (!verdict) return
      setTimeout(() => sfx(verdict === 'true' ? 'scanRight' : 'scanWrong'), index * 420)
    })
  }, [decided])

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
  /** 이 판으로 게임까지 끝났는가. 금고가 열린 것과 게임을 이긴 것은 다르다. */
  const outcomeRef = useRef<'win' | 'lose' | null>(null)
  outcomeRef.current = game?.outcome ?? null
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
      // 금고·경보가 지나간 뒤에 한 번 더 못박는다. 판이 아니라 게임이 끝난 것이다.
      const ending = outcomeRef.current
      if (ending) at(1500, () => sfx(ending === 'win' ? 'win' : 'lose'))
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

  /*
   * 자동 확정까지 남은 시간.
   *
   * 서버는 「몇 시에」가 아니라 **「얼마나 남았는가」**를 보낸다. 화면의 시계는 서버와
   * 몇 초씩 어긋나 있을 수 있고, 절대 시각을 받으면 그 차이가 그대로 숫자에 실린다.
   * 받은 길이를 내 시계 기준으로 못박고 여기서부터 센다. 상태가 새로 올 때마다 다시
   * 못박히므로, 누가 토큰을 옮겨 시계가 처음부터 시작하면 화면도 함께 되감긴다.
   */
  const autoIn = game?.autoConfirmIn ?? null
  const [autoLeft, setAutoLeft] = useState<number | null>(null)

  useEffect(() => {
    if (autoIn === null) {
      setAutoLeft(null)
      return
    }
    const deadline = Date.now() + autoIn
    const tick = () => setAutoLeft(Math.max(0, deadline - Date.now()))
    tick()
    // 초가 바뀌는 순간과 눈금이 어긋나면 숫자가 한 박자 늦게 넘어간다. 촘촘히 센다.
    const timer = setInterval(tick, 100)
    return () => clearInterval(timer)
  }, [autoIn])

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

    sfx('sensor')
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
    // 로그인했을 때만 쌓인다. 게스트로 한 판은 세지 않는다 — 쌓을 곳이 없다.
    void recordPlay(
      game.outcome === 'win' ? 'win' : 'lose',
      `${code}:${game.heist}:${game.outcome}`,
    )
  }, [spectating, tutorial, game, code])

  /*
   * 판이 끝나기 전에 나간다.
   *
   * 전적에는 아무 줄도 남지 않는다 — 판이 어떻게 끝났는지 모르는 채로 자리를 뜬 것이라
   * 승도 패도 아니다. 예전에는 「중도포기」로 세었는데, 세는 항목을 둘로 줄이면서 뺐다.
   */
  function leaveNow() {
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

  /*
   * 해결사를 쓰는 한 벌. 드로어 안의 카드와 테이블 옆의 카드가 **같은 것**이어야 하므로
   * 손잡이와 물음창을 이 화면이 들고 두 카드에 나눠 준다. 물음창은 여기 한 번만 그린다.
   *
   * 거절을 조용히 삼키지 않는다. 확인창은 누르는 순간 닫히므로, 실패하면
   * 「눌렀는데 아무 일도 안 일어났다」로만 남는다. 실제로 두 갈래가 있다 —
   * 남이 한발 먼저 눌렀을 때, 그리고 창을 열어둔 사이에 라운드가 넘어갔을 때
   * (마지막 라운드에서는 그대로 쇼다운으로 간다).
   */
  const specialistUse = useSpecialistUse({
    game,
    playerId,
    hand,
    onVote: (pick) => {
      void call<null>('game:voteSpecialist', { pick }).then((result) => {
        if (result.ok) return
        sfx('deny')
        showToast(result.message)
      })
    },
    onUse: (input) => {
      void call<null>('game:useSpecialist', input).then((result) => {
        if (result.ok) return
        sfx('deny')
        showToast(result.message)
      })
    },
  })

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
  /*
   * 마지막 5초만 크게 센다. 그전에는 발밑의 한 줄로 충분하다 —
   * 15초 내내 큰 숫자가 떠 있으면 정작 봐야 할 카드와 토큰을 가린다.
   */
  const countdown =
    autoLeft !== null && autoLeft > 0 && autoLeft <= AUTO_CONFIRM_COUNTDOWN_MS
      ? Math.max(1, Math.ceil(autoLeft / 1000))
      : null
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
            <Toast
              key={toast.id}
              text={toast.text}
              tone={toast.tone}
              onAway={() => dropToast(toast.id)}
            />
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
              holeCount={game.holeCount}
              emote={emotes.live[player.id]}
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
        <TableSpecialist
          game={game}
          note={notes.find((n) => n.specialist === game.specialist) ?? null}
          onUse={specialistUse.start}
          useLabel={specialistUse.label}
        />

      <section className="table">
        <CommunityBoard game={game} slots lit={lit} delayStep={90} base="table__community" me={playerId} />

        {/*
          토큰 번호는 1..인원수이고, **그 자리를 늘 다 그린다.**

          남은 것만 그리면 하나가 나갈 때마다 나머지가 가운데로 다시 모인다 —
          누르려던 토큰이 손가락 밑에서 옆으로 미끄러져, 엉뚱한 수를 집게 된다.
          나간 자리는 같은 크기의 빈 구멍으로 두어 옆의 것들이 움직이지 않게 한다.
        */}
        <div className="table__tokens">
          {game.players.map((_, index) => {
            const token = index + 1
            if (!game.centerTokens.includes(token)) return <TokenHole key={token} />
            return (
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
            )
          })}
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
              // 아직 손패가 안 왔을 때의 빈자리. 몇 장인지는 포커 방식이 정한다.
              Array.from({ length: game.holeCount }, (_, index) => <CardSlot key={`hole-${index}`} />)
            )}
          </div>
          <div className="my-seat__info">
            <span className="my-seat__name">
              <EmoteBubble emote={emotes.live[playerId]} />
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
              ? `확정 ${game.players.filter((p) => p.ready).length} / ${game.players.length}` +
                (autoLeft !== null ? ` · ${Math.ceil(autoLeft / 1000)}초 뒤 자동 확정` : '')
              : '모두가 토큰을 가져가면 확정할 수 있습니다'}
          </span>
        )}
      </footer>

      <ExtrasDrawer
        game={game}
        notes={notes}
        onUse={specialistUse.start}
        useLabel={specialistUse.label}
      />

      {specialistUse.ask}

      {tip && (
        <TutorialTip
          tip={tip}
          onClose={() => {
            setTip(null)
            void call('tutorial:next')
          }}
        />
      )}

      {/*
        대화. 접힌 채로도 새 말 한 줄은 단추 옆에 잠깐 붙는다.
        연습판에는 말할 상대가 없다 — 봇은 읽지 않는다.
      */}
      {/* 연습판에는 상대가 없다. 보낼 곳이 없는 단추를 두지 않는다. */}
      {!tutorial && <EmotePicker onPick={emotes.send} />}
      {!tutorial && <Chat code={code} />}

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
          spectating={spectating}
          onLeave={() => setConfirmLeave(true)}
        />
      )}

      {/*
        * 성공·실패와 같은 자리다. 둘이 겹치면 판정이 이긴다 — 감지기가 터진 순간에
        * 숫자가 그 위에 겹치면 둘 다 못 읽는다.
        */}
      {!flash && countdown !== null && (
        <div key={countdown} className="verdict verdict--count" aria-live="off">
          {countdown}
          <em className="verdict__hint">뒤에 자동 확정</em>
        </div>
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
  /** 이 판에 한 사람이 몇 장을 쥐고 있나. 자리에 그 수만큼 뒷면을 세운다. */
  holeCount?: number
  /** 지금 이 사람 위에 떠 있는 한 마디. 없으면 아무것도 그리지 않는다. */
  emote?: LiveEmote
  tokenRef: (token: number) => (node: HTMLElement | null) => void
  onTakeToken: (token: number) => void
}

/**
 * 남의 자리.
 *
 * **카드는 장식이다.** 몇 장 쥐고 있는지만 보이고 앞면은 그리지 않는다 — 남의 카드를
 * 화면에 그리는 길을 아예 두지 않는 것이 목적이다. 공개되는 두 순간(스캔·쇼다운)은
 * 각각 제 창이 화면을 덮고 필요한 카드를 그 안에 다시 그리므로, 여기서 뒤집을 일이 없다.
 *
 * 2026-09-03 에 조율가가 걸린 판에서 전원의 홀카드가 새어 나갔다. 서버와 화면이 공개
 * 조건을 똑같이 「picking 이 아니면 공개」로 적고 있었고, 딜 직후 단계가 그 자리에 딸려
 * 들어갔기 때문이다. 서버 쪽은 고쳤고, 여기서는 조건 자체를 없앤다.
 */
function PlayerSeat(props: SeatProps) {
  const { player, holeCount = 2, emote } = props
  return (
    <div className={`seat ${player.connected ? '' : 'seat--offline'} ${player.ready ? 'seat--ready' : ''}`}>
      {/*
        자리 위로 떠오른다. **이름 칸에 두지 않는다** — 그쪽은 긴 이름을 자르려고
        overflow: hidden 이 걸려 있어 말풍선이 통째로 잘린다(실제로 그랬다).
      */}
      <EmoteBubble emote={emote} />
      <div className="seat__cards">
        {Array.from({ length: holeCount }, (_, index) => (
          <PlayingCard key={`back-${index}`} card={null} faceDown size="sm" delay={index * 120} />
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
  /** 자리 없이 보고만 있다. 판을 넘기는 것은 앉은 사람들이 정할 일이다. */
  spectating: boolean
  onLeave: () => void
}

function Showdown({
  game,
  revealed,
  finished,
  playerId,
  iAmHost,
  tutorial,
  spectating,
  onLeave,
}: ShowdownProps) {
  const navigate = useNavigate()
  // 결과가 화면을 덮는 동안 뒤 판은 움직이지 않는다. 위에 겹치는 재경기 물음도 이 안이다.
  useScrollLock()
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
  // 재경기는 같은 사람들이 다시 하는 것이라 앉은 사람들이 정한다. 구경꾼에게는 묻지 않는다.
  const askedToRematch = over && game.rematch.proposed && !iAgreed && !spectating

  /*
   * 짚고 있는 사람이 실제로 쓴 다섯 장. 공개된 홀카드와 공용 카드로 다시 구해도
   * 서버가 판정한 것과 같은 답이 나온다 — 같은 규칙이 shared 에 한 벌만 있기 때문이다.
   */
  const lit = new Set<string>(
    hovered && view === 'hand'
      ? (VARIANTS[game.variant].holding(
          reveals.find((one) => one.playerId === hovered)?.hole ?? [],
          usableCommunity(game, hovered),
        )?.used ?? [])
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
          판정의 근거가 되는 공용 카드. 모달이 테이블을 덮고 있어, 이것이 없으면
          「내 카드가 왜 그 족보인지」를 확인하려고 모달을 닫아야 한다.

          모양은 테이블과 같다 — 격자가 한 줄로 펴지거나 원이 일렬로 서면
          어느 줄·어느 이웃으로 만든 손인지 짚어 봐도 알아볼 수 없다.
        */}
        {game.community.length > 0 && (
          <CommunityBoard
            game={game}
            size="sm"
            lit={lit}
            delayStep={60}
            base="showdown__community"
            me={playerId}
            // 짚은 사람 쪽으로 돌린다. 「나」는 내 자리에 그대로 남는다.
            focus={hovered ?? playerId}
          />
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
                    ? orderForReading(
                        VARIANTS[game.variant].holding(reveal.hole, usableCommunity(game, reveal.playerId))
                          ?.used ?? reveal.hole,
                      )
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
            {/*
              판을 넘기는 것은 자리에 앉은 사람들이 정한다. 구경꾼에게는 세는 것만 보인다 —
              눌러도 서버가 「이 판에 참여하고 있지 않습니다」로 돌려보낸다.
            */}
            <button
              type="button"
              className="btn btn--primary"
              disabled={iContinued || spectating}
              onClick={() => void call('game:continue')}
            >
              {spectating
                ? `넘어가기를 기다리는 중 (${continued.length}/${waitingOn})`
                : iContinued
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
                disabled={iAgreed || spectating}
                onClick={() => void call('game:rematch', { agree: true })}
              >
                {spectating
                  ? `재경기 ${game.rematch.agreed.length}/${game.players.length}`
                  : iAgreed
                    ? `재경기 대기 ${game.rematch.agreed.length}/${game.players.length}`
                    : '재경기 제안'}
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
