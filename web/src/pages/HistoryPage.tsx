/**
 * 지난 기록.
 *
 * **계정의 것만 보여준다.** 예전에는 기기(localStorage)에 닉네임을 열쇠로 쌓았는데,
 * 계정이 생기면서 같은 것이 두 곳에 있게 됐다. 두 벌을 두면 어느 쪽이 진짜인지 매번
 * 골라야 하고, 서버가 다시 뜬 뒤에는 두 수가 어긋난 채로 나란히 선다.
 *
 * 그래서 세는 자리를 하나로 줄였다. **그 대신 서버가 잠들면 전적도 함께 사라진다.**
 * 화면이 그 사실을 적어야 한다 — 사라진 것을 잃어버린 것으로 읽으면 안 된다.
 *
 * 순위표가 아니다. 남과 견주는 자리가 아니라 스스로 보는 자리다.
 */

import { Link } from 'react-router-dom'

import { useSession } from '../lib/auth.ts'

export function HistoryPage() {
  const me = useSession()

  return (
    <main className="page page--narrow">
      <Link className="link-back" to="/rooms">
        ← 방 목록으로
      </Link>

      <h1 className="section-title">지난 기록</h1>

      {me ? (
        <section className="panel record">
          <p className="record__name">{me.name}</p>
          <p className="record__played">
            <strong>{me.record.played}</strong>판
          </p>
          <dl className="record__grid">
            <div>
              <dt>이김</dt>
              <dd className="record__win">{me.record.wins}</dd>
            </div>
            <div>
              <dt>짐</dt>
              <dd className="record__lose">{me.record.losses}</dd>
            </div>
            <div>
              <dt>도중에 나감</dt>
              <dd>{me.record.quits}</dd>
            </div>
          </dl>
          {me.record.played === 0 && (
            <p className="record__empty">아직 끝까지 간 판이 없습니다. 한 판 하고 오세요.</p>
          )}
        </section>
      ) : (
        /* 게스트는 쌓이는 곳이 없다. 없다는 것을 「아직 없다」로 읽히게 두면 안 된다. */
        <p className="empty">
          전적은 계정에 쌓입니다.
          <br />
          게스트로 한 판은 세지 않습니다.
        </p>
      )}

      <p className="record__note">
        전적은 서버가 도는 동안만 남습니다. 서버가 잠들면 계정과 함께 사라집니다.
      </p>
    </main>
  )
}
