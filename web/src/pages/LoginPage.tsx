/**
 * 로그인.
 *
 * 진입점에서 「로그인」을 고른 사람만 온다. 이메일과 비밀번호 둘만 묻는다 —
 * 닉네임은 계정에 이미 적혀 있고, 게스트로 갈 사람은 여기 오지 않는다.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { login } from '../lib/auth.ts'
import { useConnected } from '../lib/socket.ts'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = useConnected()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    const failed = await login(email, password)
    setBusy(false)
    if (failed) {
      setError(failed)
      return
    }
    // 들어가면 전적이 보이는 자리로. 로그인이 됐다는 것이 그 화면으로 증명된다.
    navigate('/')
  }

  return (
    <main className="page page--narrow page--column home-page">
      <div className="home-box">
        <Link className="link-back" to="/">
          ← 처음으로
        </Link>

        <h1 className="section-title">로그인</h1>

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
          </label>

          <label className="field">
            <span className="field__label">비밀번호</span>
            <input
              className="field__input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <div className="home-form__actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !connected}>
              {busy ? '들어가는 중…' : '로그인'}
            </button>
          </div>

          {/* 계정 만들기는 한 번뿐이고 로그인은 올 때마다다. 크기가 그 차이를 말한다. */}
          <Link className="home-form__signup" to="/signup">
            계정이 없나요? 계정 만들기
          </Link>
        </form>
      </div>
    </main>
  )
}
