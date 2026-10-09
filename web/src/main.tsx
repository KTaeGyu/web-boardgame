import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.tsx'
// 화면이 그려지기 전에 걸어야 첫 칠에서 난 것도 받는다. 배포본에서는 빈 모듈이 된다.
import './lib/devlog.ts'
import './styles.css'
import './game.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
