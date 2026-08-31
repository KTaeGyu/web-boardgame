/**
 * 지난 기록.
 *
 * **두 곳에 있다.** 로그인했으면 계정의 것이 맨 위에 서고, 그 아래에 이 기기에 남은
 * 것들이 온다. 기록은 성취감을 위한 것이지 순위표가 아니라, 남과 견주는 자리가 아니다.
 *
 * 계정 쪽은 서버 메모리라 서버가 다시 뜨면 사라지고, 기기 쪽은 그때도 남는다.
 * 그래서 둘 중 하나를 지우지 않는다 — 서로가 서로의 뒷자리다.
 */

import { Link } from 'react-router-dom'

import { useSession } from '../lib/auth.ts'
import { getNickname } from '../lib/identity.ts'
import { allNames, statsOf } from '../lib/history.ts'

export function HistoryPage() {
  const me = useSession()
  const nickname = getNickname()
  const mine = me ? me.record : statsOf(nickname)
  const others = allNames().filter((one) => one.nickname !== nickname.trim())

  return (
    <main className="page page--narrow">
      <Link className="link-back" to="/rooms">
        ← 방 목록으로
      </Link>

      <h1 className="section-title">지난 기록</h1>

      {nickname ? (
        <section className="panel record">
          <p className="record__name">
            {nickname}
            {me && ' — 계정'}
          </p>
          <p className="record__played">
            <strong>{mine.played}</strong>판
          </p>
          <dl className="record__grid">
            <div>
              <dt>이김</dt>
              <dd className="record__win">{mine.wins}</dd>
            </div>
            <div>
              <dt>짐</dt>
              <dd className="record__lose">{mine.losses}</dd>
            </div>
            <div>
              <dt>도중에 나감</dt>
              <dd>{mine.quits}</dd>
            </div>
          </dl>
          {mine.played === 0 && (
            <p className="record__empty">아직 끝까지 간 판이 없습니다. 한 판 하고 오세요.</p>
          )}
        </section>
      ) : (
        <p className="empty">닉네임을 먼저 정해 주세요.</p>
      )}

      {others.length > 0 && (
        <>
          <h2 className="section-title record__section">이 기기의 다른 이름</h2>
          <ul className="record__others">
            {others.map((one) => (
              <li key={one.nickname}>
                <span className="record__others-name">{one.nickname}</span>
                <span className="record__others-line">
                  {one.record.played}판 · {one.record.wins}승 {one.record.losses}패
                  {one.record.quits > 0 && ` · 중도 ${one.record.quits}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="record__note">
        기록은 이 브라우저에만 남습니다. 기기를 바꾸면 따라오지 않고, 브라우저 데이터를 지우면
        함께 사라집니다.
      </p>
    </main>
  )
}
