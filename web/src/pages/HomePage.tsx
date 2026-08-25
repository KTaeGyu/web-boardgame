import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { NICKNAME_MAX, normalizeNickname } from '@the-gang/shared'

import { getNickname, getPlayerId, setNickname as saveNickname } from '../lib/identity.ts'
import { createRoom } from '../lib/rooms.ts'
import { call, useConnected } from '../lib/socket.ts'

export function HomePage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(getNickname())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [solo, setSolo] = useState(false)
  // 서버가 잠들어 있으면 화면이 덮이지만, 키보드로는 그 아래에 닿는다. 손잡이 자체를 잠근다.
  const connected = useConnected()

  const clean = normalizeNickname(nickname)

  /** 두 버튼 모두 닉네임을 요구한다. 닉네임 없이는 아무 데도 갈 수 없다. */
  function requireNickname(): string | null {
    if (!clean) {
      setError(`닉네임을 1~${NICKNAME_MAX}자로 입력해 주세요.`)
      return null
    }
    saveNickname(clean)
    setError('')
    return clean
  }

  async function makeRoom() {
    const name = requireNickname()
    if (!name) return

    setBusy(true)
    const result = await createRoom(name)
    setBusy(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    navigate(`/rooms/${result.value.code}`)
  }

  /**
   * 혼자 해보기. 봇 둘이 함께 앉은 판이 곧바로 시작된다.
   * 대기실을 거치지 않는 것은 기다릴 사람이 없기 때문이다.
   */
  async function startTutorial() {
    const name = requireNickname()
    if (!name) return

    setSolo(true)
    const result = await call<{ code: string }>('tutorial:start', {
      playerId: getPlayerId(),
      nickname: name,
    })
    setSolo(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    navigate(`/rooms/${result.value.code}/game`)
  }

  /** 엔터가 닿는 자리. 대부분은 만들기보다 남의 방에 들어가려고 온다. */
  function findRoom(event: FormEvent) {
    event.preventDefault()
    if (requireNickname()) navigate('/rooms')
  }

  return (
    <main className="page page--narrow page--column home-page">
      {/* 표제·입력·버튼이 한 상자다. 넓은 화면에서는 이 상자째 화면 가운데에 놓인다. */}
      <div className="home-box">
        <header className="brand">
        <h1 className="brand__title">THE GANG</h1>
        <div className="brand__rule" />
        <p className="brand__sub">말하지 않고 맞추는 협력 포커</p>
      </header>

      <form className="home-form" onSubmit={findRoom}>
        <label className="field">
          <span className="field__label">닉네임</span>
          <input
            className="field__input"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="테이블에서 불릴 이름"
            maxLength={NICKNAME_MAX}
            autoFocus
          />
          <span className="field__hint">최대 {NICKNAME_MAX}자. 같은 이름이 있어도 괜찮습니다.</span>
        </label>

        {error && <p className="error">{error}</p>}

        <div className="btn-row home-form__actions">
          <button
            type="button"
            className="btn"
            onClick={() => void makeRoom()}
            disabled={busy || !connected}
          >
            {busy ? '만드는 중…' : '방 만들기'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !connected}>
            방 찾기
          </button>
        </div>

        {/* 처음 온 사람의 자리. 규칙을 읽는 것보다 한 판 해보는 편이 빠르다. */}
        <button
          type="button"
          className="btn home-form__solo"
          onClick={() => void startTutorial()}
          disabled={solo || !connected}
        >
          {solo ? '자리를 차리는 중…' : '혼자 해보기 — 봇 2명과 연습'}
        </button>
        </form>
      </div>
    </main>
  )
}
