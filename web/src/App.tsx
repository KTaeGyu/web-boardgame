import { useCallback, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { ServerGate } from './components/ServerGate.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { RoomPage } from './pages/RoomPage.tsx'
import { RoomsPage } from './pages/RoomsPage.tsx'
import { GamePage } from './pages/GamePage.tsx'
import { useServerEvent } from './lib/socket.ts'
import { useViewportHeight } from './lib/useViewportHeight.ts'

export function App() {
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
      {/*
        서버가 없을 때. 어디에 있느냐에 따라 화면을 덮기도 하고 한 줄만 남기기도 한다 —
        판 안에서는 끊겨도 테이블을 봐야 하고, 자리는 유예 시간 동안 지켜진다.
      */}
      <ServerGate />
    </BrowserRouter>
  )
}
