import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { HomePage } from './pages/HomePage.tsx'
import { RoomPage } from './pages/RoomPage.tsx'
import { RoomsPage } from './pages/RoomsPage.tsx'
import { GamePage } from './pages/GamePage.tsx'
import { useConnected } from './lib/socket.ts'
import { useViewportHeight } from './lib/useViewportHeight.ts'

export function App() {
  const connected = useConnected()
  useViewportHeight()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms/:code" element={<RoomPage />} />
        <Route path="/rooms/:code/game" element={<GamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* 끊겨도 자리는 30초 지켜진다. 놀라지 않도록 조용히 알린다. */}
      {!connected && <div className="conn">서버와 연결이 끊겼습니다. 다시 붙는 중…</div>}
    </BrowserRouter>
  )
}
