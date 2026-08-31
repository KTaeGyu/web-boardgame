import { useCallback, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { useResumeSession } from './lib/auth.ts'
import { DensityToggle } from './components/DensityToggle.tsx'
import { HandRanks } from './components/HandRanks.tsx'
import { ReportLink } from './components/ReportLink.tsx'
import { ServerGate } from './components/ServerGate.tsx'
import { SoundPanel } from './components/SoundPanel.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { RoomPage } from './pages/RoomPage.tsx'
import { RoomsPage } from './pages/RoomsPage.tsx'
import { GamePage } from './pages/GamePage.tsx'
import { HistoryPage } from './pages/HistoryPage.tsx'
import { useBackgroundMusic } from './lib/music.ts'
import { useClickSound } from './lib/sfx.ts'
import { useServerEvent } from './lib/socket.ts'
import { useViewportHeight } from './lib/useViewportHeight.ts'

export function App() {
  useViewportHeight()
  useClickSound()
  useBackgroundMusic()
  /*
   * 표가 아직 사는지 붙을 때마다 확인한다. 서버가 그 사이에 다시 떴으면 계정이 통째로
   * 없어졌을 수 있고, 화면만 로그인한 척하고 있으면 방에 들어갈 때 이름이 막힌다.
   */
  useResumeSession()

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
        <Tools />
      </main>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/rooms/:code" element={<RoomPage />} />
        <Route path="/rooms/:code/game" element={<GamePage />} />
        {/* 자리 없이 보기만 하는 길. 같은 화면이되 내 자리와 단추가 없다. */}
        <Route path="/rooms/:code/watch" element={<GamePage spectating />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Tools />
      {/*
        서버가 없을 때. 어디에 있느냐에 따라 화면을 덮기도 하고 한 줄만 남기기도 한다 —
        판 안에서는 끊겨도 테이블을 봐야 하고, 자리는 유예 시간 동안 지켜진다.
      */}
      <ServerGate />
    </BrowserRouter>
  )
}

/**
 * 어느 화면에서나 오른쪽 위에 붙는 것들.
 *
 * 한 상자에 담아 가로로 세운다. 각자 자기 좌표를 들고 있으면 하나가 늘어날 때마다
 * 나머지 좌표를 손으로 다시 잡아야 한다 — 「불편 신고」는 넓은 화면에서 글자까지 보여
 * 폭이 달라진다.
 */
function Tools() {
  return (
    <div className="tools">
      <ReportLink />
      <SoundPanel />
      <DensityToggle />
      <ThemeToggle />
      <HandRanks />
    </div>
  )
}
