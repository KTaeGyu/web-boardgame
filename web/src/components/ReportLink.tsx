/**
 * 불편사항 신고.
 *
 * 테마 단추와 같은 자리(오른쪽 위)에 붙박이로 둔다 — 어느 화면에서 겪었든 눈이 같은 곳을
 * 보게 하려는 것이다. 판이 도는 중에 겪은 일이 가장 값어치 있는데, 그때 누를 것이 없으면
 * 사람은 그냥 넘어간다.
 *
 * 받는 곳은 구글 시트다. 앱은 아무것도 모른 채 새 탭으로 넘기기만 한다 —
 * 서버에 저장할 곳이 없어서(DB 가 없다) 바깥에 맡긴 것이다.
 * 나중에 폼으로 바꾸더라도 여기 주소 한 줄만 갈아 끼우면 된다.
 */

const REPORT_URL =
  'https://docs.google.com/spreadsheets/d/1lRwvULXufdmaxQTH_-DtqykJdrtJcvct-NMwkFVzmZI/edit?gid=0#gid=0'

export function ReportLink() {
  return (
    <a
      className="report-link"
      href={REPORT_URL}
      target="_blank"
      rel="noreferrer noopener"
      title="불편했던 점이나 이상한 동작을 적어 주세요"
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 5.2h16v10.4H9.2L5.2 19v-3.4H4z" />
        <path d="M12 8v3.4" />
        <path d="M12 13.2v0.1" />
      </svg>
      {/* 좁은 화면에서는 그림만 남는다. 넓으면 글자까지 보여야 무엇인지 알아본다. */}
      <span className="report-link__text">불편 신고</span>
    </a>
  )
}
