/**
 * 방 안의 대화.
 *
 * 접어 두면 동그란 단추 하나로만 남고, 새 말이 오면 그 왼쪽에 마지막 한 줄이 잠깐 붙는다.
 * 판이 도는 중에 열어두면 테이블을 가리므로, 펼치는 것은 언제나 사람이 정한다.
 *
 * 소켓은 앱 전체가 쓰는 그 하나다. 방 코드로 이미 갈라져 있어 대화도 같은 길로 간다.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type TouchEvent } from 'react'
import { CHAT_MAX, type ChatMessage } from '@the-gang/shared'

import { useBackIntercept } from '../lib/back.ts'
import { getPlayerId } from '../lib/identity.ts'
import { sfx } from '../lib/sfx.ts'
import { call, useServerEvent } from '../lib/socket.ts'

/** 접힌 채로 새 말이 왔을 때, 마지막 한 줄이 붙어 있는 시간. */
const PEEK_MS = 6000

/**
 * 창이 들고 있는 줄 수. 서버가 들고 있는 것(CHAT_KEEP)보다 넉넉하다 —
 * 자리를 비운 사이 서버 창 밖으로 밀려난 옛 대화가 내 화면에는 남아 있게 하려는 것이다.
 */
const LOCAL_KEEP = 300

/**
 * 이 창이 들고 있는 대화. **한 방치만 둔다.**
 *
 * 한 사람은 한 번에 한 방에만 있으므로 여러 방을 쌓아둘 이유가 없다. 다른 방에 들어가면
 * 지난 것은 그 자리에서 밀어버린다. 창마다 따로여야 하므로 sessionStorage 다 —
 * 여러 창으로 여러 사람을 흉내 낼 때 서로 섞이면 안 된다.
 *
 * 번호만으로는 같은 방인지 알 수 없다. 방 번호는 네 자리라 닫힌 방의 번호가 다시 쓰이는데,
 * 그때 옛 대화가 남의 새 방에 섞인다. 그래서 방이 열린 시각(since)을 함께 적어 두고
 * 둘 다 같아야 이어 붙인다.
 *
 * 서버도 방마다 마지막 CHAT_KEEP 줄을 들고 있다가 들어올 때 건넨다. 이쪽은 그것이
 * 사라진 뒤(서버 재시작·방 닫힘)에도 내 화면에 남기려는 것이고, 둘은 id 로 합친다.
 */
const STORE_KEY = 'the-gang:chat'

interface Saved {
  code: string
  /** 방이 열린 시각. 서버가 건네주기 전에는 0 이다. */
  since: number
  messages: ChatMessage[]
}

function loadSaved(code: string): Saved {
  const empty: Saved = { code, since: 0, messages: [] }
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return empty
    const saved = JSON.parse(raw) as Partial<Saved>
    if (saved.code !== code) {
      sessionStorage.removeItem(STORE_KEY)
      return empty
    }
    return {
      code,
      since: typeof saved.since === 'number' ? saved.since : 0,
      messages: Array.isArray(saved.messages) ? saved.messages : [],
    }
  } catch {
    // 저장이 막혔거나 형태가 깨졌다. 지난 대화가 없는 것으로 친다.
    return empty
  }
}

function save(code: string, since: number, messages: ChatMessage[]): void {
  try {
    sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({ code, since, messages: messages.slice(-LOCAL_KEEP) }),
    )
  } catch {
    /* 기억하지 못할 뿐이다 */
  }
}

/** 저장분과 서버 이력을 합친다. 같은 말이 두 줄로 서지 않도록 번호로 고른다. */
function mergeById(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map(a.map((message) => [message.id, message]))
  for (const message of b) byId.set(message.id, message)
  return [...byId.values()].sort((left, right) => left.id - right.id).slice(-LOCAL_KEEP)
}

export function Chat({ code }: { code: string }) {
  const me = getPlayerId()
  const [open, setOpen] = useState(false)
  // 펼쳐 둔 채 휴대폰의 뒤로가기를 누르면 판을 떠나는 것이 아니라 대화를 접는다.
  useBackIntercept(open, () => setOpen(false))
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSaved(code).messages)
  /** 창이 들고 있는 대화가 어느 방의 것인가. 서버가 건네주는 시각과 맞춰 본다. */
  const sinceRef = useRef(loadSaved(code).since)
  const [draft, setDraft] = useState('')
  /** 서버가 거절한 이유. 도배로 막혔을 때가 거의 전부다. */
  const [notice, setNotice] = useState('')
  /** 접힌 동안 왼쪽에 붙어 있는 마지막 한 줄. */
  const [peek, setPeek] = useState<ChatMessage | null>(null)
  const [unread, setUnread] = useState(0)

  const listRef = useRef<HTMLDivElement | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)
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
    'chat:history',
    useCallback(({ messages: history, since }: { messages: ChatMessage[]; since: number }) => {
      // 번호는 같은데 열린 시각이 다르다 — 같은 자리에 선 다른 방이다. 옛 대화는 남의 것이다.
      const stale = sinceRef.current !== 0 && since !== 0 && sinceRef.current !== since
      sinceRef.current = since
      setMessages((current) => (stale ? history : mergeById(current, history)))
    }, []),
  )

  useServerEvent(
    'chat:message',
    useCallback(
      (message: ChatMessage) => {
        setMessages((current) => [...current, message])
        // 내가 한 말에 내가 놀랄 이유는 없다. 창이 열려 있어도 판을 보는 중일 수 있어
        // 접힘 여부는 따지지 않는다.
        if (message.playerId !== me) sfx('chat')
        // 내가 한 말은 알림이 아니다. 접혀 있을 때만 왼쪽에 잠깐 붙인다.
        if (message.playerId === me || openRef.current) return
        setPeek(message)
        setUnread((count) => count + 1)
      },
      [me],
    ),
  )

  // 오갈 때마다 적어 둔다. 화면을 옮기면 이 컴포넌트가 새로 서므로, 여기가 유일한 다리다.
  useEffect(() => {
    save(code, sinceRef.current, messages)
  }, [code, messages])

  // 붙은 한 줄은 스스로 사라진다. 다음 말이 오면 시계도 다시 돈다.
  useEffect(() => {
    if (!peek) return
    const timer = setTimeout(() => setPeek(null), PEEK_MS)
    return () => clearTimeout(timer)
  }, [peek])

  // 펼쳐져 있으면 늘 마지막 말이 보여야 한다.
  useEffect(() => {
    if (!open || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [open, messages])

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

          <div className="chat__list" ref={listRef}>
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
                    <div className={`chat__line ${mine ? 'chat__line--mine' : ''}`}>
                      {/* 내 말에 내 이름을 붙일 이유는 없다. 오른쪽에 선 것이 곧 표시다. */}
                      {!mine && (
                      <span className="chat__who">
                        {message.name}
                        {/* 판 밖에서 보는 사람의 말은 선언과 무게가 다르다. 그것이 보여야 한다. */}
                        {message.spectator && <span className="chat__watcher">관전</span>}
                      </span>
                    )}
                      <span className="chat__bubble">{message.text}</span>
                    </div>
                  </Fragment>
                )
              })
            )}
          </div>

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
}
