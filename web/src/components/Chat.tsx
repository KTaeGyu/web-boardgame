/**
 * 방 안의 대화.
 *
 * 접어 두면 동그란 단추 하나로만 남고, 새 말이 오면 그 왼쪽에 마지막 한 줄이 잠깐 붙는다.
 * 판이 도는 중에 열어두면 테이블을 가리므로, 펼치는 것은 언제나 사람이 정한다.
 *
 * 소켓은 앱 전체가 쓰는 그 하나다. 방 코드로 이미 갈라져 있어 대화도 같은 길로 간다.
 */

import { Fragment, memo, useCallback, useEffect, useRef, useState, type FormEvent, type TouchEvent } from 'react'
import { CHAT_MAX, type ChatMessage } from '@the-gang/shared'

import { useBackIntercept } from '../lib/back.ts'
import { useEscape } from '../lib/useEscape.ts'
import { usePlayerId } from '../lib/identity.ts'
import { sfx } from '../lib/sfx.ts'
import { call, useServerEvent } from '../lib/socket.ts'

/** 접힌 채로 새 말이 왔을 때, 마지막 한 줄이 붙어 있는 시간. */
const PEEK_MS = 6000

/** 바닥에서 이만큼 안쪽이면 「바닥에 있다」로 본다. 한 줄 높이쯤이다. */
const NEAR_BOTTOM = 40

/** 창이 들고 있는 줄 수. 한 방에 오래 앉아 있어도 화면이 무거워지지 않을 만큼. */
const LOCAL_KEEP = 300

/**
 * 지금 방의 대화. **방에 있는 동안만 산다**(2026-09-21).
 *
 * 저장하지 않는다 — 서버도 쌓지 않고, 이 창도 sessionStorage 에 적지 않는다. 대기실과
 * 판 화면을 오갈 때는 이 컴포넌트가 새로 서므로, 그 사이를 이어 주는 것만 모듈에 둔다.
 * 방을 나가 목록·처음 화면으로 가면 `forgetChat` 이 비운다. 새로고침하면 모듈째 새로
 * 뜨므로 그것도 「다시 들어온 것」이 되어 그 뒤부터 보인다.
 */
let held: { code: string; messages: ChatMessage[] } = { code: '', messages: [] }

// 예전 판이 창에 적어 두던 대화. 이제 쓰지 않으니 남은 것을 한 번 치운다.
try {
  sessionStorage.removeItem('the-gang:chat')
} catch {
  /* 저장이 막힌 창이다. 치울 것도 없다 */
}

/** 방을 떠났다. 다시 들어오면 들어온 뒤부터 보인다. */
export function forgetChat(): void {
  held = { code: '', messages: [] }
}

/**
 * 보낸 시각을 `HH:mm` 으로. 보는 사람의 시계 기준이다.
 *
 * `toLocaleTimeString` 을 쓰지 않는 것은 기기마다 「오후 3:07」·「15:07」로 갈려서다.
 */
function clock(at: number): string {
  const when = new Date(at)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${two(when.getHours())}:${two(when.getMinutes())}`
}

/**
 * 받는 것이 방 번호 하나뿐이라 memo 로 부모에서 떼어 둔다. 판 화면은 토큰이 움직일
 * 때마다 다시 그려지는데, 그때마다 대화 수백 줄을 다시 맞춰 볼 이유가 없다.
 */
export const Chat = memo(function Chat({ code }: { code: string }) {
  const me = usePlayerId()
  const [open, setOpen] = useState(false)
  // 펼쳐 둔 채 휴대폰의 뒤로가기를 누르면 판을 떠나는 것이 아니라 대화를 접는다.
  useBackIntercept(open, () => setOpen(false))
  useEscape(open, useCallback(() => setOpen(false), []))
  // 같은 방의 대기실↔판 화면을 오간 것이면 이어 보이고, 다른 방이면 빈 채로 시작한다.
  const [messages, setMessages] = useState<ChatMessage[]>(() => (held.code === code ? held.messages : []))
  const [draft, setDraft] = useState('')
  /** 서버가 거절한 이유. 도배로 막혔을 때가 거의 전부다. */
  const [notice, setNotice] = useState('')
  /** 접힌 동안 왼쪽에 붙어 있는 마지막 한 줄. */
  const [peek, setPeek] = useState<ChatMessage | null>(null)
  const [unread, setUnread] = useState(0)
  /**
   * 옛 대화를 읽어 올린 동안 아래에 새로 온 말. 목록 밑에 한 줄로 붙고, 누르면 바닥으로 간다.
   * 접힌 동안의 한 줄(`peek`)과 달리 스스로 사라지지 않는다 — 내려가서 읽어야 없어진다.
   */
  const [below, setBelow] = useState<ChatMessage | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)
  /**
   * 목록이 바닥에 붙어 있는가.
   *
   * 창 높이가 바뀔 때 다시 붙일지 정하는 값이다. 상태가 아니라 상자에 두는 것은
   * 스크롤마다 다시 그릴 이유가 없어서다 — 대화 한 줄을 훑을 때마다 판이 다시 그려진다.
   */
  const pinned = useRef(true)
  /*
   * 아래로 밀어 닫기.
   *
   * 시트를 손가락 따라 내리고, 충분히 내려갔으면 닫는다. 목록을 위아래로 훑는 것과
   * 겹치지 않도록 머리 쪽을 잡았을 때만 받는다 — 대화를 읽어 올리다 창이 닫히면
   * 그다음부터는 아무도 목록을 만지지 않는다.
   */
  const grab = useRef<{ y: number; moved: number } | null>(null)

  function onGrab(event: TouchEvent<HTMLElement>) {
    const from = event.target as Element
    if (!from.closest('.chat__head')) return
    grab.current = { y: event.touches[0].clientY, moved: 0 }
  }

  function onDrag(event: TouchEvent<HTMLElement>) {
    if (!grab.current || !sheetRef.current) return
    const moved = Math.max(0, event.touches[0].clientY - grab.current.y)
    grab.current.moved = moved
    sheetRef.current.style.transform = `translateY(${moved}px)`
    sheetRef.current.style.transition = 'none'
  }

  function onRelease() {
    const sheet = sheetRef.current
    const held = grab.current
    grab.current = null
    if (!sheet || !held) return

    sheet.style.transition = ''
    sheet.style.transform = ''
    // 손가락이 닿은 자리에서 조금 흔들린 것은 미는 것이 아니다.
    if (held.moved > 90) setOpen(false)
  }
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 콜백은 한 번만 등록되므로, 그 안에서 최신 열림 상태를 읽으려면 상자가 필요하다. */
  const openRef = useRef(open)
  openRef.current = open

  useServerEvent(
    'chat:message',
    useCallback(
      (message: ChatMessage) => {
        setMessages((current) => [...current, message].slice(-LOCAL_KEEP))
        /*
         * 방에 일어난 일(입장 같은)은 소리도 알림도 내지 않는다. 사람이 오갈 때마다
         * 소리가 나면, 정작 누가 말을 걸었을 때의 소리와 구별되지 않는다.
         * 흐름에는 남으므로 창을 열면 무슨 일이 있었는지 그대로 보인다.
         */
        if (message.system) return
        // 내가 한 말에 내가 놀랄 이유는 없다. 창이 열려 있어도 판을 보는 중일 수 있어
        // 접힘 여부는 따지지 않는다.
        if (message.playerId !== me) sfx('chat')
        // 내가 한 말은 알림이 아니다. 접혀 있을 때만 왼쪽에 잠깐 붙인다.
        if (message.playerId === me) return
        if (openRef.current) {
          if (!pinned.current) setBelow(message)
          return
        }
        setPeek(message)
        setUnread((count) => count + 1)
      },
      [me],
    ),
  )

  // 화면을 옮기면 이 컴포넌트가 새로 서므로, 모듈에 걸어 두는 것이 유일한 다리다.
  useEffect(() => {
    held = { code, messages }
  }, [code, messages])

  // 붙은 한 줄은 스스로 사라진다. 다음 말이 오면 시계도 다시 돈다.
  useEffect(() => {
    if (!peek) return
    const timer = setTimeout(() => setPeek(null), PEEK_MS)
    return () => clearTimeout(timer)
  }, [peek])

  /*
   * 새 말을 따라 내려가는 것은 **바닥에 있었을 때만**이다.
   *
   * 예전에는 말이 올 때마다 끌어내렸는데, 옛 대화를 읽어 올린 사람은 누가 한마디 할
   * 때마다 읽던 자리를 잃었다(2026-09-21). 막 펼쳤을 때와 내가 말했을 때는 예외다 —
   * 펼치면 마지막 말부터 보여야 하고, 내 말이 화면 밖에 떨어지면 나갔는지 알 수 없다.
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    const list = listRef.current
    const opened = open && !wasOpen.current
    wasOpen.current = open
    if (!open || !list) return
    const mine = messages[messages.length - 1]?.playerId === me
    if (opened || mine || pinned.current) toBottom()
  }, [open, messages, me])

  function toBottom() {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
    pinned.current = true
    setBelow(null)
  }

  /*
   * 창이 짧아져도 마지막 말이 그대로 보여야 한다.
   *
   * 작은 화면의 대화는 바닥에 붙은 시트라, 입력칸을 누르면 키보드가 올라온 만큼
   * 창이 통째로 짧아진다. 그런데 목록이 얼마나 내려가 있는지(scrollTop)는 그대로여서,
   * 줄어든 높이만큼 아래쪽 말들이 화면 밖으로 밀려난다 — 정작 방금 읽던 줄이 사라진다.
   * 말이 새로 온 것도 창을 연 것도 아니라 위의 효과는 이때 돌지 않는다.
   *
   * **바닥에 있었을 때만 다시 붙인다.** 옛 대화를 읽어 올린 사람을 끌어내리면,
   * 키보드가 오르내릴 때마다 읽던 자리를 잃는다.
   */
  useEffect(() => {
    const list = listRef.current
    if (!open || !list) return
    const watch = new ResizeObserver(() => {
      if (pinned.current) list.scrollTop = list.scrollHeight
    })
    watch.observe(list)
    return () => watch.disconnect()
  }, [open])

  function toggle() {
    setOpen((on) => {
      if (!on) {
        setUnread(0)
        setPeek(null)
        // 펼치는 동작의 목적은 대부분 말하기다. 한 번 더 누르게 하지 않는다.
        setTimeout(() => inputRef.current?.focus(), 0)
      }
      return !on
    })
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return

    const result = await call<null>('chat:send', { text })
    // 막혔을 때 쓴 것을 지우면 다시 쳐야 한다. 나간 것이 확인된 뒤에만 비운다.
    if (!result.ok) {
      setNotice(result.message)
      return
    }
    setNotice('')
    setDraft('')
  }

  return (
    <>
      {open && (
        <section
          className="chat"
          aria-label="대화"
          ref={sheetRef}
          onTouchStart={onGrab}
          onTouchMove={onDrag}
          onTouchEnd={onRelease}
          onTouchCancel={onRelease}
        >
          <header className="chat__head">
            {/* 손잡이. 아래로 밀면 닫힌다 — 시트는 그렇게 닫는 것이 몸에 익다. */}
            <span className="chat__grip" aria-hidden="true" />
            <span className="chat__title">대화</span>
            <button type="button" className="chat__close" onClick={toggle} aria-label="접기">
              ×
            </button>
          </header>

          <div
            className="chat__list"
            ref={listRef}
            onScroll={(event) => {
              const list = event.currentTarget
              pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM
              // 손으로 내려와 읽었으면 알릴 것이 남지 않는다.
              if (pinned.current) setBelow(null)
            }}
          >
            {messages.length === 0 ? (
              <p className="chat__empty">아직 아무 말도 없습니다.</p>
            ) : (
              messages.map((message, index) => {
                const mine = message.playerId === me
                /*
                 * 번호는 방 안에서 하나씩 올라간다. 이어지지 않는다는 것은 그 사이의 말이
                 * 어디에도 남아 있지 않다는 뜻이다 — 자리를 비운 동안 서버가 들고 있는
                 * 만큼을 넘겨 오갔을 때 그렇게 된다. 조용히 붙여 두면 이어진 대화로 읽힌다.
                 */
                const broken = index > 0 && message.id !== messages[index - 1].id + 1
                return (
                  <Fragment key={message.id}>
                    {broken && <p className="chat__break">이 사이의 대화는 남아 있지 않습니다</p>}
                    {/*
                      누구의 말도 아닌 줄은 가운데에 선다. 말풍선으로 세우면 그 사람이
                      한 말로 읽히고, 왼쪽·오른쪽 어느 쪽에 세워도 편이 생긴다.
                    */}
                    {message.system ? (
                      <p className="chat__note">{message.text}</p>
                    ) : (
                      <div className={`chat__line ${mine ? 'chat__line--mine' : ''}`}>
                        {/* 내 말에 내 이름을 붙일 이유는 없다. 오른쪽에 선 것이 곧 표시다. */}
                        {!mine && (
                          <span className="chat__who">
                            {message.name}
                            {/* 판 밖에서 보는 사람의 말은 선언과 무게가 다르다. 그것이 보여야 한다. */}
                            {message.spectator && <span className="chat__watcher">관전</span>}
                          </span>
                        )}
                        {/*
                          시각은 말풍선 옆 아래에 작게 선다. 말보다 앞서 읽히면 안 되고,
                          내 말이면 왼쪽·남의 말이면 오른쪽 — 늘 말풍선의 안쪽 옆이다.
                        */}
                        <span className="chat__row">
                          <span className="chat__bubble">{message.text}</span>
                          <time className="chat__time" dateTime={new Date(message.at).toISOString()}>
                            {clock(message.at)}
                          </time>
                        </span>
                      </div>
                    )}
                  </Fragment>
                )
              })
            )}
          </div>

          {below && (
            <button type="button" className="chat__below" onClick={toBottom} aria-label="새 말로 내려가기">
              <span className="chat__who">{below.name}</span>
              <span className="chat__below-text">{below.text}</span>
              <span className="chat__below-go" aria-hidden="true">
                ↓
              </span>
            </button>
          )}

          {notice && <p className="chat__notice">{notice}</p>}

          <form className="chat__form" onSubmit={(event) => void send(event)}>
            <input
              ref={inputRef}
              className="chat__input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="한 줄 쓰기"
              maxLength={CHAT_MAX}
              autoComplete="off"
            />
            <button type="submit" className="chat__send" disabled={!draft.trim()}>
              보내기
            </button>
          </form>
        </section>
      )}

      {!open && peek && (
        <button type="button" className="chat-peek" onClick={toggle}>
          <span className="chat__who">{peek.name}</span>
          <span className="chat-peek__text">{peek.text}</span>
        </button>
      )}

      <button
        type="button"
        className={`chat-fab ${open ? 'chat-fab--open' : ''}`}
        onClick={toggle}
        aria-label={open ? '대화 접기' : '대화 열기'}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 5.5h16v11H9.5L5.5 20v-3.5H4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && <span className="chat-fab__count">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </>
  )
})
