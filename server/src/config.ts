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

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (ALLOW_ANY_ORIGIN) return true
  if (!origin) return true // 같은 오리진이거나 브라우저가 아닌 요청
  if (CORS_ORIGINS.includes(origin)) return true
  // Vercel 프리뷰는 배포마다 도메인이 바뀌므로 접미사로 허용한다.
  return CORS_ORIGINS.some((allowed) => allowed.startsWith('*.') && origin.endsWith(allowed.slice(1)))
}
