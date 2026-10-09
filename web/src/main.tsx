import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.tsx'
import { PandemicPage } from './pages/PandemicPage.tsx'
// 화면이 그려지기 전에 걸어야 첫 칠에서 난 것도 받는다. 배포본에서는 빈 모듈이 된다.
import './lib/devlog.ts'
import './styles.css'
import './game.css'
import './pandemic.css'

/*
 * /pandemic 은 더 갱의 화면이 아니다. App 을 지나면 배경음악·누르는 소리·오른쪽 위 도구 줄·
 * 서버 덮개가 함께 붙으므로 여기서 갈라 그 한 장만 세운다. 앱 안에서 이 주소로 오가는
 * 길이 없어(주소를 직접 쳐서만 온다) 처음 뜰 때 한 번 보면 된다.
 */
const standalone = window.location.pathname.replace(/\/+$/, '') === '/pandemic'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{standalone ? <PandemicPage /> : <App />}</StrictMode>,
)
