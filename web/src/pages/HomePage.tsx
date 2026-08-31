/**
 * 진입점.
 *
 * 여기서는 **어느 길로 갈지만** 고른다 — 로그인이냐 게스트냐. 예전에는 이 한 화면이
 * 이름·이메일·비밀번호를 다 받고 로그인·가입·게스트·연습을 다 했는데, 그러느라 상태가
 * 여섯 개 얽혀 있었고 무엇이 흔한 길인지도 안 보였다. 칸은 각자의 화면으로 옮겼다.
 *
 * 로그인한 사람에게는 고를 것이 없다. 그때는 이 화면이 「나」와 「어디로 갈까」를 보인다.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { logout, useSession } from '../lib/auth.ts'
import { getNickname, setNickname as saveNickname } from '../lib/identity.ts'
import { createRoom } from '../lib/rooms.ts'
import { startTutorial } from '../lib/solo.ts'
import { useConnected } from '../lib/socket.ts'

/**
 * 연습판에서 쓸 이름.
 *
 * 봇 둘과 나뿐이라 이 이름이 하는 일은 내 자리 이름표 하나다. 그것 때문에 시작 전에
 * 이름을 치라고 하면, 「규칙을 읽는 것보다 한 판 해보는 편이 빠르다」는 이 단추의
 * 취지가 깎인다. 쓰던 이름이 있으면 그것을 쓰고, 없으면 이걸로 간다.
 */
const SOLO_NAME = '나'

export function HomePage() {
  const navigate = useNavigate()
  const me = useSession()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = useConnected()

  async function makeRoom() {
    if (!me) return
    setBusy(true)
    const result = await createRoom(me.nickname)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    navigate(`/rooms/${result.value.code}`)
  }

  /**
   * 봇 둘이 함께 앉은 판이 곧바로 시작된다. 대기실을 거칠 이유가 없다.
   *
   * 서버를 부르지 않는다 — 판이 화면 안에서 돌기 때문이다. 서버가 자고 있어도 열린다.
   */
  function practice() {
    const name = me?.nickname || getNickname() || SOLO_NAME
    saveNickname(name)
    navigate(`/rooms/${startTutorial(name)}/game`)
  }

  return (
    <main className="page page--narrow page--column home-page">
      <div className="home-box">
        <header className="brand">
          <h1 className="brand__title">THE GANG</h1>
          <div className="brand__rule" />
          <p className="brand__sub">말하지 않고 맞추는 협력 포커</p>
        </header>

        <div className="home-form">
          {me && (
            /*
              로그인했다. 이름은 계정 이름이라 고칠 수 없다 — 고칠 수 있으면 계정이
              사람을 가리키는 뜻이 흐려진다. 대신 전적을 그 자리에 보인다.
            */
            <div className="signed">
              <div className="signed__who">
                <strong className="signed__name">{me.nickname}</strong>
                <button type="button" className="signed__out" onClick={() => void logout()}>
                  로그아웃
                </button>
              </div>
              <p className="signed__record">
                {me.record.wins + me.record.losses === 0
                  ? '아직 끝을 본 판이 없습니다.'
                  : `${me.record.wins}승 ${me.record.losses}패`}
              </p>
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <div className="home-form__actions home-choice">
            {me ? (
              <>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => navigate('/rooms')}
                  disabled={!connected}
                >
                  방 찾기
                </button>
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => void makeRoom()}
                  disabled={busy || !connected}
                >
                  {busy ? '만드는 중…' : '방 만들기'}
                </button>
              </>
            ) : (
              <>
                <Link className="btn btn--primary btn--block" to="/login">
                  로그인
                </Link>
                <Link className="btn btn--block" to="/guest">
                  게스트로 하기
                </Link>
              </>
            )}
          </div>

          {/* 처음 온 사람의 자리. 이름을 묻지 않고 그 자리에서 시작한다. */}
          <button
            type="button"
            className="btn home-form__solo"
            onClick={practice}
          >
            혼자 해보기 — 봇 2명과 연습
          </button>
        </div>
      </div>
    </main>
  )
}
