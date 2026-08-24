import { useCallback, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { ThemeToggle } from './components/ThemeToggle.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { RoomPage } from './pages/RoomPage.tsx'
import { RoomsPage } from './pages/RoomsPage.tsx'
import { GamePage } from './pages/GamePage.tsx'
import { useConnected, useServerEvent } from './lib/socket.ts'
import { useViewportHeight } from './lib/useViewportHeight.ts'

export function App() {
  const connected = useConnected()
  useViewportHeight()

  /** 서버가 감당할 인원을 넘겼다. 연결이 끊기기 전에 이유를 남긴다. */
  const [full, setFull] = useState('')
  useServerEvent(
    'server:full',
    useCallback((payload: { message: string }) => setFull(payload.message), []),
  )

  if (full) {
    return (
      <main className="page page--narrow">
        <header className="brand">
          <h1 className="brand__title">THE GANG</h1>
          <div className="brand__rule" />
        </header>
        <p className="error">{full}</p>
        <ThemeToggle />
      </main>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms/:code" element={<RoomPage />} />
        <Route path="/rooms/:code/game" element={<GamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ThemeToggle />
      {/* 끊겨도 자리는 30초 지켜진다. 놀라지 않도록 조용히 알린다. */}
      {!connected && <div className="conn">서버와 연결이 끊겼습니다. 다시 붙는 중…</div>}
    </BrowserRouter>
  )
}
