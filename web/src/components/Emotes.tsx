/**
 * 감정표현 — 누르면 그 사람 옆에 잠깐 떴다 내려간다.
 *
 * **상태가 아니라 사건이다.** 서버는 「누가 무엇을」만 한 번 쏘고 아무것도 남기지
 * 않는다. 그래서 늦게 들어온 사람에게 지난 감정이 뜨지 않고, 새로고침하면 사라진다 —
 * 실제로 말이 그런 것과 같다.
 *
 * **떠 있는 동안 다음 것이 오면 갈아치우지 않고 차례를 지킨다.** 그림만 바뀌면 한
 * 마디가 두 마디였다는 것이 보이지 않아, 연달아 누른 것이 한 번 누른 것처럼 읽힌다.
 * 앞의 것이 다 내려간 뒤에 새로 올라온다.
 *
 * 뜨는 자리는 화면마다 다르다(대기실은 줄 안, 판은 자리 위). 그래서 **받는 일**과
 * **그리는 일**을 갈라 둔다 — 받는 것은 훅 하나가 맡고, 어디에 띄울지는 부르는 쪽이 정한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { EMOTES, EMOTE_EXIT_MS, EMOTE_SHOW_MS, emoteOf } from '@the-gang/shared'

import { call, useServerEvent } from '../lib/transport.ts'

/**
 * 지금 누구 위에 무엇이 떠 있나.
 *
 * `state` 는 올라오는 중인지 내려가는 중인지다 — 내려가는 동안에도 자리에 남아 있어야
 * 그 움직임이 보인다.
 */
export type LiveEmote = { id: string; key: number; state: 'in' | 'out' }
export type LiveEmotes = Record<string, LiveEmote>

export function useEmotes(): {
  live: LiveEmotes
  send: (id: string) => void
} {
  const [live, setLive] = useState<LiveEmotes>({})
  /**
   * 지금 떠 있는 것을 콜백 안에서 읽기 위한 거울.
   *
   * 서버에서 오는 것은 렌더 밖의 사건이라, 그때의 `live` 는 그 콜백이 만들어질 때의
   * 낡은 값이다. 「지금 무엇이 떠 있나」를 물어야 차례를 지킬 수 있다.
   */
  const mirror = useRef<LiveEmotes>({})
  /** 사람마다의 시계. 내려가기·지우기·다음 것 올리기 셋이 겹치지 않게 한 자리에 모은다. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>[]>())
  /** 같은 감정을 연달아 눌러도 다시 튀어오르게 하는 번호. 내용으로는 구별되지 않는다. */
  const seq = useRef(0)

  const put = useCallback((playerId: string, next: LiveEmote | null) => {
    setLive((current) => {
      const updated = { ...current }
      if (next) updated[playerId] = next
      else delete updated[playerId]
      mirror.current = updated
      return updated
    })
  }, [])

  const later = useCallback((playerId: string, run: () => void, ms: number) => {
    const list = timers.current.get(playerId) ?? []
    list.push(setTimeout(run, ms))
    timers.current.set(playerId, list)
  }, [])

  const stop = useCallback((playerId: string) => {
    for (const timer of timers.current.get(playerId) ?? []) clearTimeout(timer)
    timers.current.set(playerId, [])
  }, [])

  /** 하나를 올린다. 떠 있는 시간이 지나면 스스로 내려가고, 다 내려가면 자리를 비운다. */
  const raise = useCallback(
    (playerId: string, id: string) => {
      const key = (seq.current += 1)
      put(playerId, { id, key, state: 'in' })
      later(
        playerId,
        () => {
          if (mirror.current[playerId]?.key !== key) return
          put(playerId, { id, key, state: 'out' })
          later(
            playerId,
            () => {
              if (mirror.current[playerId]?.key === key) put(playerId, null)
            },
            EMOTE_EXIT_MS,
          )
        },
        EMOTE_SHOW_MS,
      )
    },
    [later, put],
  )

  useServerEvent(
    'emote',
    useCallback(
      (payload: { playerId: string; id: string }) => {
        if (!emoteOf(payload.id)) return
        const showing = mirror.current[payload.playerId]
        stop(payload.playerId)

        // 비어 있으면 곧바로 올린다.
        if (!showing) {
          raise(payload.playerId, payload.id)
          return
        }
        // 떠 있으면 먼저 내리고, 다 내려간 뒤에 올린다.
        if (showing.state === 'in') put(payload.playerId, { ...showing, state: 'out' })
        later(payload.playerId, () => raise(payload.playerId, payload.id), EMOTE_EXIT_MS)
      },
      [later, put, raise, stop],
    ),
  )

  // 화면을 벗어나면 남은 시계도 함께 접는다.
  const shelf = timers.current
  useEffect(
    () => () => {
      for (const list of shelf.values()) for (const timer of list) clearTimeout(timer)
    },
    [shelf],
  )

  const send = useCallback((id: string) => {
    void call<null>('emote:send', { id })
  }, [])

  return { live, send }
}

/** 그 사람 옆에 뜨는 말풍선 하나. 없으면 아무것도 그리지 않는다. */
export function EmoteBubble({ emote }: { emote?: LiveEmote }) {
  if (!emote) return null
  const found = emoteOf(emote.id)
  if (!found) return null
  /*
   * `key` 를 바꿔 다시 붙인다 — 같은 감정을 연달아 눌러도 올라오는 움직임이 처음부터 돈다.
   * 내려갈 때는 같은 `key` 를 유지해야 붙어 있는 채로 움직임만 바뀐다.
   */
  return (
    <span
      key={emote.key}
      className={`emote-bubble ${emote.state === 'out' ? 'emote-bubble--out' : ''}`}
      role="img"
      aria-label={found.name}
    >
      {found.emoji}
    </span>
  )
}

/**
 * 고르는 단추.
 *
 * 접혀 있다가 누르면 목록이 펼쳐지고, 하나 고르면 보내고 접힌다. **한 번 더 묻지
 * 않는다** — 되돌릴 것이 없는 동작이고, 확인창을 끼우면 「잠깐 띄우는 한 마디」가
 * 아니게 된다.
 */
export function EmotePicker({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`emote-picker ${open ? 'emote-picker--open' : ''}`}>
      {open && (
        <div className="emote-picker__list">
          {EMOTES.map((one) => (
            <button
              key={one.id}
              type="button"
              className="emote-picker__one"
              onClick={() => {
                onPick(one.id)
                setOpen(false)
              }}
              title={one.name}
            >
              <span aria-hidden="true">{one.emoji}</span>
              <span className="emote-picker__name">{one.name}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="emote-picker__toggle"
        onClick={() => setOpen((on) => !on)}
        aria-label={open ? '감정표현 접기' : '감정표현'}
        aria-expanded={open}
      >
        {open ? '✕' : '😀'}
      </button>
    </div>
  )
}
