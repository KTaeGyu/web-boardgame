import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { NICKNAME_MAX, type RoomView, normalizeNickname } from '@the-gang/shared'

import { getNickname, getPlayerId, setNickname as saveNickname } from '../lib/identity.ts'
import { call } from '../lib/socket.ts'

export function HomePage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(getNickname())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  async function createRoom(event: FormEvent) {
    event.preventDefault()
    const name = requireNickname()
    if (!name) return

    setBusy(true)
    const result = await call<RoomView>('room:create', { playerId: getPlayerId(), nickname: name })
    setBusy(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    navigate(`/rooms/${result.value.code}`)
  }

  function findRoom() {
    if (requireNickname()) navigate('/rooms')
  }

  return (
    <main className="page page--narrow">
      <header className="brand">
        <h1 className="brand__title">THE GANG</h1>
        <div className="brand__rule" />
        <p className="brand__sub">말하지 않고 맞추는 협력 포커</p>
      </header>

      <form onSubmit={createRoom}>
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

        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? '만드는 중…' : '방 만들기'}
          </button>
          <button type="button" className="btn" onClick={findRoom} disabled={busy}>
            방 찾기
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
