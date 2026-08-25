/**
 * 지난 기록.
 *
 * 이 기기에 남은 것만 보여준다. 서버는 아무것도 모른다 — 기록은 성취감을 위한 것이지
 * 순위표가 아니라, 남과 견주는 자리가 아니다.
 *
 * 지금 쓰는 이름을 맨 위에 크게 두고, 이 기기에서 쓰였던 다른 이름들은 아래에 작게 둔다.
 * 한 브라우저를 여럿이 돌려 쓰는 일이 있어서다.
 */

import { Link } from 'react-router-dom'

import { getNickname } from '../lib/identity.ts'
import { allNames, statsOf } from '../lib/history.ts'

export function HistoryPage() {
  const nickname = getNickname()
  const mine = statsOf(nickname)
  const others = allNames().filter((one) => one.nickname !== nickname.trim())

  return (
    <main className="page page--narrow">
      <Link className="link-back" to="/rooms">
        ← 방 목록으로
      </Link>

      <h1 className="section-title">지난 기록</h1>

      {nickname ? (
        <section className="panel record">
          <p className="record__name">{nickname}</p>
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
