export const TIP_WIDTH = 240
const TIP_GAP = 14

/**
 * 말풍선을 커서·손가락 옆에 붙이되 화면 밖으로 나가지 않게 한다.
 *
 * 오른쪽에 공간이 없으면 왼쪽으로 넘긴다. 드로어처럼 화면 끝에 붙은 것 옆에서는
 * 그냥 오른쪽에 두면 거의 항상 잘린다.
 */
export function tipPosition(point: { x: number; y: number }): { left: number; top: number } {
  const spillsRight = point.x + TIP_GAP + TIP_WIDTH > window.innerWidth
  return {
    left: spillsRight ? Math.max(8, point.x - TIP_GAP - TIP_WIDTH) : point.x + TIP_GAP,
    top: Math.min(point.y + TIP_GAP, window.innerHeight - 120),
  }
}
