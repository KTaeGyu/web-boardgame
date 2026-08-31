import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { EMAIL_MAX, NICKNAME_MAX, PASSWORD_MIN, normalizeEmail, normalizeNickname } from '@the-gang/shared'

import { login, logout, signup, useSession } from '../lib/auth.ts'
import { getNickname, getPlayerId, setNickname as saveNickname } from '../lib/identity.ts'
import { createRoom } from '../lib/rooms.ts'
import { call, useConnected } from '../lib/socket.ts'

export function HomePage() {
  const navigate = useNavigate()
  const me = useSession()
  const [nickname, setNickname] = useState(getNickname())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [solo, setSolo] = useState(false)
  /** 로그인·계정 만들기가 도는 중. 두 단추가 같은 자물쇠를 쓴다. */
  const [signing, setSigning] = useState(false)
  // 서버가 잠들어 있으면 화면이 덮이지만, 키보드로는 그 아래에 닿는다. 손잡이 자체를 잠근다.
  const connected = useConnected()

  const clean = normalizeNickname(nickname)

  /** 어디로 가든 닉네임은 있어야 한다. 테이블에 이름 없이 앉을 수는 없다. */
  function requireNickname(): string | null {
    const name = me?.nickname ?? clean
    if (!name) {
      setError(`닉네임을 1~${NICKNAME_MAX}자로 입력해 주세요.`)
      return null
    }
    saveNickname(name)
    setError('')
    return name
  }

  /**
   * 로그인과 계정 만들기.
   *
   * **보는 칸이 다르다.** 로그인은 이메일과 비밀번호만 보고, 계정 만들기는 닉네임까지
   * 본다 — 계정에 적어 둘 이름이 그때 정해지기 때문이다.
   */
  async function enter(how: 'login' | 'signup') {
    const address = normalizeEmail(email)
    if (!address) {
      setError('이메일 주소를 다시 확인해 주세요.')
      return
    }
    if (password.length < PASSWORD_MIN) {
      setError(`비밀번호를 ${PASSWORD_MIN}자 이상 입력해 주세요.`)
      return
    }
    if (how === 'signup' && !clean) {
      setError(`닉네임을 1~${NICKNAME_MAX}자로 입력해 주세요.`)
      return
    }

    setSigning(true)
    const failed =
      how === 'login' ? await login(address, password) : await signup(address, password, clean!)
    setSigning(false)
    if (failed) {
      setError(failed)
      return
    }
    setError('')
    setPassword('')
  }

  /** 게스트. 닉네임만 들고 간다 — 지금까지 하던 그대로다. */
  function asGuest() {
    if (requireNickname()) navigate('/rooms')
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

  /**
   * 엔터가 닿는 자리.
   *
   * 로그인한 사람에게는 방 찾기, 아직 아닌 사람에게는 로그인이다. 손이 엔터를 치는 순간
   * 하려던 일이 그 둘로 갈린다.
   */
  function onEnter(event: FormEvent) {
    event.preventDefault()
    if (me) {
      if (requireNickname()) navigate('/rooms')
      return
    }
    void enter('login')
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

      <form className="home-form" onSubmit={onEnter}>
        {me ? (
          /*
            로그인했다. 닉네임은 계정에 적어 둔 것을 그대로 쓴다 — 유일한 이름은 아니지만
            매번 다시 치게 할 이유가 없다. 이메일은 작게 둔다. 그것으로 불릴 일은 없다.
          */
          <div className="signed">
            <div className="signed__who">
              <strong className="signed__name">{me.nickname}</strong>
              <button type="button" className="signed__out" onClick={() => void logout()}>
                로그아웃
              </button>
            </div>
            <p className="signed__email">{me.email}</p>
            <p className="signed__record">
              {me.record.wins + me.record.losses === 0
                ? '아직 끝을 본 판이 없습니다.'
                : `${me.record.wins}승 ${me.record.losses}패`}
            </p>
          </div>
        ) : (
          <>
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
              {/* 게스트로 갈 사람에게는 이 칸이 전부다. 그 사실을 여기서 말한다. */}
              <span className="field__hint">
                게스트로 하려면 이것만 있으면 됩니다. 같은 이름이 있어도 괜찮습니다.
              </span>
            </label>

            <label className="field">
              <span className="field__label">이메일</span>
              <input
                className="field__input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="계정을 쓸 때만"
                maxLength={EMAIL_MAX}
                autoComplete="email"
              />
            </label>

            <label className="field">
              <span className="field__label">비밀번호</span>
              <input
                className="field__input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="계정을 쓸 때만"
                autoComplete="current-password"
              />
              {/*
                친구들끼리 하는 판이라 이 비밀번호는 지킬 것이 적다. 그런데 사람들은
                다른 데서 쓰던 것을 친다 — 그건 우리가 감당할 값이 아니라서 미리 말한다.
              */}
              <span className="field__hint">
                다른 곳에서 쓰는 비밀번호는 쓰지 마세요. 계정은 전적을 이어 두는 데만 씁니다.
              </span>
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="btn-row home-form__actions">
          {me ? (
            <>
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
            </>
          ) : (
            <>
              <button type="submit" className="btn btn--primary" disabled={signing || !connected}>
                {signing ? '들어가는 중…' : '로그인'}
              </button>
              <button type="button" className="btn" onClick={asGuest} disabled={!connected}>
                게스트로 하기
              </button>
            </>
          )}
        </div>

        {/*
          계정 만들기를 단추 줄에 세우지 않는다. 셋이 나란히 서면 무엇이 흔한 길인지
          안 보이는데, 계정을 만드는 것은 한 번뿐이고 로그인은 올 때마다다.
        */}
        {!me && (
          <button
            type="button"
            className="home-form__signup"
            onClick={() => void enter('signup')}
            disabled={signing || !connected}
          >
            계정이 없나요? 이 이메일로 만들기
          </button>
        )}

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
