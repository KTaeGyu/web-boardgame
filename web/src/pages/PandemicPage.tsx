/**
 * 팬데믹 레거시 시즌 1 — 달마다의 결과.
 *
 * 더 갱과는 상관없는 화면이다. 같은 친구들이 하는 다른 게임의 기록을 여기 얹어 둔 것이라
 * 어디에서도 이 주소로 이어 주지 않는다 — 주소를 아는 사람만 온다.
 *
 * `App` 밖에 선다(`main.tsx` 가 주소를 보고 가른다). 그래서 배경음악도 도구 줄도 서버
 * 덮개도 없고, 라우터 밖이라 `Link` 를 쓸 수 없다.
 */

type DiseaseColor = 'yellow' | 'red' | 'black'

const COLOR_LABEL: Record<DiseaseColor, string> = {
  yellow: '노랑',
  red: '빨강',
  black: '검정',
}

/** 공황 단계의 끝. 점을 이만큼 그린다. */
const PANIC_MAX = 5

const JANUARY = {
  title: '1월 첫 게임 결과',
  result: '성공',
  funding: 2,
  objective: 'LD 04 F',
  bonus: 'LD 05 F',
  disease: {
    name: 'COdA-403b',
    color: 'black' as DiseaseColor,
    effects: ['치료제 개발이 불가능합니다.', '질병 치료가 불가능합니다.'],
  },
  cities: [
    { name: '보고타', color: 'yellow', panic: 2 },
    { name: '부에노스아이레스', color: 'yellow', panic: 2 },
    { name: '상파울루', color: 'yellow', panic: 1 },
    { name: '요하네스버그', color: 'yellow', panic: 1 },
    { name: '바그다드', color: 'black', panic: 1 },
  ] satisfies { name: string; color: DiseaseColor; panic: number }[],
  characters: [
    {
      who: '과학자',
      kind: '관계',
      name: '라이벌',
      text: '라이벌이 카드를 버리거나 사용한다면, 당신은 카드 2장을 내고 즉시 그 카드를 가져옵니다.',
    },
    {
      who: '검역전문가',
      kind: '관계',
      name: '라이벌',
      text: '라이벌이 카드를 버리거나 사용한다면, 당신은 카드 2장을 내고 즉시 그 카드를 가져옵니다.',
    },
    {
      who: '검역전문가',
      kind: '능력',
      name: '유연성',
      text: '행동 하나를 소비해, 카드 1장을 버리고 버려진 더미의 같은 색 카드로 교환합니다.',
    },
  ],
  mutations: [
    {
      color: 'red' as DiseaseColor,
      name: '공통구조',
      text: '당신은 더이상 치료제를 개발하기 위해 연구소에 갈 필요가 없습니다. (어디서든 치료제 개발이 가능합니다.)',
    },
  ],
  rules: [
    {
      doc: 'G',
      name: '검역',
      text: '행동으로 현재 있는 도시에 검역 마커를 놓습니다. 한 도시에는 하나의 검역 마커만 존재할 수 있습니다. 검역 마커가 있는 도시에 (색깔에 관계없이) 질병 큐브를 추가하는 경우에, 질병 큐브를 추가하는 대신 검역 마커를 제거합니다. 추가할 검역 마커가 부족한 경우, 원하는 도시 위의 검역 마커를 가져와 현재 도시에 둘 수 있습니다.',
    },
    {
      doc: 'A',
      name: '관계',
      text: '캐릭터를 만들 때, 이미 만들어진 캐릭터와의 관계를 줍니다. 고른 두 캐릭터는 같은 관계를 얻습니다. 관계에 다른 캐릭터의 이름을 쓰십시오. 각 캐릭터는 관계를 2개까지 가질 수 있습니다.',
    },
  ],
}

function Chip({ color }: { color: DiseaseColor }) {
  return <span className={`pd-chip pd-chip--${color}`}>{COLOR_LABEL[color]}</span>
}

function Panic({ level }: { level: number }) {
  return (
    <span className="pd-panic">
      <span className="pd-pips" aria-hidden="true">
        {Array.from({ length: PANIC_MAX }, (_, index) => (
          <i key={index} className={index < level ? 'on' : undefined} />
        ))}
      </span>
      {level}
    </span>
  )
}

export function PandemicPage() {
  const month = JANUARY

  return (
    <main className="page pd">
      <header className="pd-head">
        <p className="pd-eyebrow">PANDEMIC LEGACY · SEASON 1</p>
        <h1 className="pd-title">{month.title}</h1>
      </header>

      <div className="pd-stats">
        <div className="pd-stat pd-stat--win">
          <p className="pd-stat__label">성공 여부</p>
          <p className="pd-stat__value">{month.result}</p>
        </div>
        <div className="pd-stat">
          <p className="pd-stat__label">재정 지원</p>
          <p className="pd-stat__value">{month.funding}</p>
        </div>
        <div className="pd-stat">
          <p className="pd-stat__label">목표</p>
          <p className="pd-stat__value">
            <code>{month.objective}</code>
          </p>
        </div>
        <div className="pd-stat">
          <p className="pd-stat__label">승리 보너스</p>
          <p className="pd-stat__value">
            <code>{month.bonus}</code>
          </p>
        </div>
      </div>

      <section className="panel pd-section">
        <h2 className="pd-h2">{month.disease.name}</h2>
        <div className="pd-disease">
          <p className="pd-disease__color">
            질병 색 <Chip color={month.disease.color} />
          </p>
          <ul>
            {month.disease.effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel pd-section">
        <h2 className="pd-h2">도시 상태</h2>
        <div className="pd-scroll">
          <table className="pd-table">
            <thead>
              <tr>
                <th className="pd-num">순번</th>
                <th>도시</th>
                <th>색</th>
                <th>공황 상태</th>
              </tr>
            </thead>
            <tbody>
              {month.cities.map((city, index) => (
                <tr key={city.name}>
                  <td className="pd-num">{index + 1}</td>
                  <td className="pd-name">{city.name}</td>
                  <td>
                    <Chip color={city.color} />
                  </td>
                  <td>
                    <Panic level={city.panic} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel pd-section">
        <h2 className="pd-h2">업그레이드</h2>

        <h3 className="pd-h3">캐릭터</h3>
        <div className="pd-scroll">
          <table className="pd-table">
            <thead>
              <tr>
                <th className="pd-num">순번</th>
                <th>캐릭터</th>
                <th>항목</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {month.characters.map((row, index) => (
                <tr key={`${row.who}-${row.name}`}>
                  <td className="pd-num">{index + 1}</td>
                  <td className="pd-name">{row.who}</td>
                  <td>
                    <span className="pd-tag">{row.kind}</span>
                  </td>
                  <td>
                    <strong>{row.name}</strong> — {row.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="pd-h3">긍정적 돌연변이</h3>
        <div className="pd-scroll">
          <table className="pd-table">
            <thead>
              <tr>
                <th className="pd-num">순번</th>
                <th>색</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {month.mutations.map((row, index) => (
                <tr key={row.name}>
                  <td className="pd-num">{index + 1}</td>
                  <td>
                    <Chip color={row.color} />
                  </td>
                  <td>
                    <strong>{row.name}</strong> — {row.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel pd-section">
        <h2 className="pd-h2">추가 규칙</h2>
        <div className="pd-scroll">
          <table className="pd-table">
            <thead>
              <tr>
                <th className="pd-num">순번</th>
                <th>문서번호</th>
                <th>규칙</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {month.rules.map((row, index) => (
                <tr key={row.doc}>
                  <td className="pd-num">{index + 1}</td>
                  <td>
                    <code>{row.doc}</code>
                  </td>
                  <td className="pd-name">{row.name}</td>
                  <td>{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
