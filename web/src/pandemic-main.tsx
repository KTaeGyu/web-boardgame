/*
 * /pandemic 의 들머리. 더 갱(`main.tsx`)과 따로 묶인다.
 *
 * 한 묶음에 두면 이 한 장을 보려고 게임 전체를 내려받고, `lib/socket.ts` 가 불려 오는
 * 순간 서버에 붙는다 — 자고 있는 서버를 깨우고 접속 한도에서 한 자리를 먹는다.
 * 그래서 `App` 도 소켓도 여기서는 부르지 않는다.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { PandemicPage } from './pages/PandemicPage.tsx'
// 색과 `.page`·`.panel` 은 더 갱의 것을 쓴다. 판 화면(game.css)은 필요 없다.
import './styles.css'
import './pandemic.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PandemicPage />
  </StrictMode>,
)
