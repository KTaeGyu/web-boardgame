/**
 * 게스트로 하기.
 *
 * 이름만 정하고 들어간다 — 계정을 만들기 전의, 그리고 만들지 않을 사람의 길이다.
 * 여기서 정한 이름은 이 창이 기억하고(sessionStorage), 방과 테이블에서 그대로 불린다.
 *
 * 「혼자 해보기」는 여기 없다. 그쪽은 이름이 자기 자리 이름표 하나로만 쓰여 물어볼
 * 이유가 없고, 같은 단추를 두 자리에 두면 어느 것이 무엇인지 흐려진다.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NICKNAME_MAX, normalizeNickname } from '@the-gang/shared'

import { getNickname, setNickname as saveNickname } from '../lib/identity.ts'
import { useConnected } from '../lib/socket.ts'

export function GuestPage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(getNickname())
  const [error, setError] = useState('')
  const connected = useConnected()

  function submit(event: FormEvent) {
    event.preventDefault()
    const clean = normalizeNickname(nickname)
    if (!clean) {
      setError(`이름을 1~${NICKNAME_MAX}자로 입력해 주세요.`)
      return
    }
    saveNickname(clean)
    navigate('/rooms')
  }

  return (
    <main className="page page--narrow page--column home-page">
      <div className="home-box">
        <Link className="link-back" to="/">
          ← 처음으로
        </Link>

        <h1 className="section-title">게스트로 하기</h1>

        <form className="home-form" onSubmit={submit}>
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
            <span className="field__hint">
              최대 {NICKNAME_MAX}자. 같은 이름이 있어도 괜찮습니다. 전적은 쌓이지 않습니다.
            </span>
          </label>

          {error && <p className="error">{error}</p>}

          <div className="home-form__actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={!connected}>
              들어가기
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
