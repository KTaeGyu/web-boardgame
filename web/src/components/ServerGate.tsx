/**
 * 서버가 잠들어 있는 동안 화면을 덮는다.
 *
 * 무료 요금제라 15분 동안 아무도 오지 않으면 서버가 내려간다. 다음 사람이 문을 두드릴 때
 * 다시 뜨는데 1~2분이 걸리고, 그동안 방 목록도 방 만들기도 되지 않는다. 눌러도 아무 일이
 * 일어나지 않으면 고장으로 보이므로, 그 시간을 덮고 얼마나 기다렸는지 보여준다.
 *
 * 방 안과 판 안에서는 덮지 않는다. 끊긴 동안에도 테이블은 봐야 하고, 자리는 유예 시간
 * 동안 지켜지므로 조용한 한 줄이면 된다.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useConnected } from '../lib/socket.ts'
import { useScrollLock } from '../lib/useScrollLock.ts'

/** 이만큼 기다려도 안 붙으면 잠든 것이 아니라 무언가 잘못된 것이다. */
const GIVE_UP_S = 300

/** 화면을 덮는 곳. 여기서는 서버 없이 할 수 있는 일이 없다. */
const BLOCKED = new Set(['/', '/rooms'])

function elapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}초`
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}

export function ServerGate() {
  const connected = useConnected()
  const { pathname } = useLocation()
  const [seconds, setSeconds] = useState(0)
  /*
   * 화면을 덮을 때에만 잠근다. 방 안과 판 안에서는 덮지 않고 조용한 한 줄이므로,
   * 그때까지 뒤를 잠그면 볼 수 있는 테이블을 못 보게 된다.
   */
  useScrollLock(!connected && BLOCKED.has(pathname))

  // 붙어 있는 동안에는 시계를 돌리지 않는다. 다시 끊기면 0 부터 센다.
  useEffect(() => {
    if (connected) {
      setSeconds(0)
      return
    }
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [connected])

  if (connected) return null

  if (!BLOCKED.has(pathname)) {
    return <div className="conn">서버와 연결이 끊겼습니다. 다시 붙는 중…</div>
  }

  const gaveUp = seconds >= GIVE_UP_S

  return (
    <div className="gate" role="alert" aria-live="assertive">
      <div className={`gate__panel ${gaveUp ? 'gate__panel--bad' : ''}`}>
        {gaveUp ? (
          <>
            <p className="gate__title">문제가 발생한 것 같습니다</p>
            <p className="gate__body">관리자에게 연락해 주세요.</p>
            {/* 이미 붙어 있는데 화면만 모르고 있을 수도 있다. 한 번 새로 여는 것이 가장 싸다. */}
            <button type="button" className="btn gate__retry" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </>
        ) : (
          <>
            <span className="gate__spinner" aria-hidden="true" />
            <p className="gate__title">서버 부팅 중입니다…</p>
            <p className="gate__body">잠시만 기다려 주세요. {elapsed(seconds)}</p>
            <p className="gate__hint">첫 접속이면 1~2분쯤 걸립니다.</p>
          </>
        )}
      </div>
    </div>
  )
}
