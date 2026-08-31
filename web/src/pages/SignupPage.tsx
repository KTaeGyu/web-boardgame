/**
 * 계정 만들기.
 *
 * 이메일이 사람을 가리키고, 닉네임은 테이블에서 불릴 이름이다. **닉네임은 유일하지 않다** —
 * 같은 이름이 둘 앉으면 예전처럼 [1] [2] 가 붙는다. 그래서 여기서 겹치는지 묻지 않는다.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NICKNAME_MAX, PASSWORD_MIN } from '@the-gang/shared'

import { signup } from '../lib/auth.ts'
import { useConnected } from '../lib/socket.ts'

export function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = useConnected()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const failed = await signup(email, password, nickname)
    setBusy(false)
    if (failed) {
      setError(failed)
      return
    }
    // 만들면 그 자리에서 로그인된 상태다. 한 번 더 치게 하지 않는다.
    navigate('/')
  }

  return (
    <main className="page page--narrow page--column home-page">
      <div className="home-box">
        <Link className="link-back" to="/login">
          ← 로그인으로
        </Link>

        <h1 className="section-title">계정 만들기</h1>

        <form className="home-form" onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span className="field__label">이메일</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              autoFocus
            />
            <span className="field__hint">보내서 확인하지 않습니다. 나를 가리키는 이름으로만 씁니다.</span>
          </label>

          <label className="field">
            <span className="field__label">비밀번호</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            {/*
              친구가 다른 데서 쓰던 비밀번호를 치면 그건 「이 게임의 비밀번호」가 아니라
              「그 사람의 비밀번호」다. 우리가 감당할 값이 아니라 미리 말한다.
            */}
            <span className="field__hint">
              {PASSWORD_MIN}자 이상. <strong>다른 곳에서 쓰는 비밀번호는 쓰지 마세요.</strong>
            </span>
          </label>

          <label className="field">
            <span className="field__label">닉네임</span>
            <input
              className="field__input"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="테이블에서 불릴 이름"
              maxLength={NICKNAME_MAX}
            />
            <span className="field__hint">최대 {NICKNAME_MAX}자. 같은 이름이 있어도 괜찮습니다.</span>
          </label>

          {error && <p className="error">{error}</p>}

          <div className="home-form__actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !connected}>
              {busy ? '만드는 중…' : '계정 만들기'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
