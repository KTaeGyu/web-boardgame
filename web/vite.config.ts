import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 공용 패키지는 빌드된 산출물이 아니라 소스 .ts 다. 미리 번들하면 수정이 반영되지 않는다.
  optimizeDeps: { exclude: ['@the-gang/shared'] },
  server: { port: 5173 },
})
