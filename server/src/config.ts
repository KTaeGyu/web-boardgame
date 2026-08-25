/** Render 는 인스턴스당 포트를 하나만 열어준다. 방마다 포트를 여는 구조는 성립하지 않는다. */
export const PORT = Number(process.env.PORT ?? 3001)

/**
 * 프론트가 Vercel, 서버가 Render 라 오리진이 갈린다.
 * 배포 도메인과 프리뷰 도메인을 함께 넣어야 한다. 콤마로 구분한다.
 */
const RAW_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:5173'

export const ALLOW_ANY_ORIGIN = RAW_ORIGINS.trim() === '*'
export const CORS_ORIGINS = RAW_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/** 유예를 넘긴 자리를 치우러 도는 주기. 유예 자체보다 촘촘해야 한다. */
export const SWEEP_INTERVAL_MS = 5_000

/**
 * 한 서버가 감당할 양. 무료 요금제의 이용량을 넘기지 않으려는 한도다.
 * 게임 규칙이 아니라 운영 한도이므로 환경변수로 조절한다.
 */
export const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 40)
export const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 8)

/**
 * 아무도 아무것도 하지 않은 채 이만큼 지나면 방을 지운다.
 *
 * 끊김 유예(10분)와 다른 이야기다. 저쪽은 「연결이 살아 있는가」이고
 * 이쪽은 「사람이 실제로 하고 있는가」다. 접속만 걸어두고 떠난 방이 자리를 먹는다.
 *
 * 유예보다 길어야 한다. 짧으면 돌아올 사람을 기다리는 방을 방치로 보고 먼저 치운다.
 */
export const IDLE_ROOM_MS = 30 * 60_000

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (ALLOW_ANY_ORIGIN) return true
  if (!origin) return true // 같은 오리진이거나 브라우저가 아닌 요청
  if (CORS_ORIGINS.includes(origin)) return true
  // Vercel 프리뷰는 배포마다 도메인이 바뀌므로 접미사로 허용한다.
  return CORS_ORIGINS.some((allowed) => allowed.startsWith('*.') && origin.endsWith(allowed.slice(1)))
}
