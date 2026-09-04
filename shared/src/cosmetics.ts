/**
 * 꾸미기 — 무엇을 걸칠 수 있고 얼마인가.
 *
 * 대기실의 한 줄은 네 겹으로 선다. 바깥부터 **배너배경 > 이펙트 > 아바타배경 > 아바타** 다.
 * 겹마다 따로 고르므로 조합이 곧 그 사람의 차림이 된다.
 *
 * **표는 여기 한 벌뿐이다.** 화면이 가격을 들고 있으면 값을 고쳐 부를 수 있으므로,
 * 서버가 이 표로 잔액과 중복을 판정하고 화면은 같은 표를 보여주기만 한다. 카드 표
 * (`extraCards.ts`)와 같은 어법이다.
 *
 * **그림은 여기 없다.** 여기 있는 것은 이름표뿐이고, 실제 그림은 화면이 그 이름표로
 * 찾아 그린다(`web/public/avatars/…`). 파일 경로를 값으로 저장하면 나중에 그림을
 * 갈 때 이미 저장된 차림이 죽는다.
 */

/** 어느 겹인가. */
export type CosmeticKind = 'avatar' | 'bg' | 'effect' | 'banner'

export interface CosmeticItem {
  id: string
  kind: CosmeticKind
  /** 고르는 화면에 뜨는 이름. */
  name: string
  /**
   * 몇 분배금인가. **0 이면 처음부터 가진 것**이다.
   *
   * 아무것도 사지 않은 사람도 네 겹을 다 걸쳐야 하므로 겹마다 0짜리가 하나씩 있다.
   */
  price: number
}

/**
 * 걸칠 수 있는 것 전부.
 *
 * 이름은 **모티프만** 가져온다. 남의 상표를 그대로 쓰면 친구들에게 뿌리는 주소에
 * 그 이름이 그대로 실린다 — 보면 무엇인지 알아보는 것은 같고, 이름과 상징만 피한다.
 */
export const COSMETICS: CosmeticItem[] = [
  // ── 아바타 ────────────────────────────────
  { id: 'square', kind: 'avatar', name: '네모', price: 0 },
  { id: 'mask', kind: 'avatar', name: '복면네모', price: 20 },
  { id: 'bat', kind: 'avatar', name: '박쥐네모', price: 25 },
  { id: 'spider', kind: 'avatar', name: '거미네모', price: 32 },
  { id: 'dracula', kind: 'avatar', name: '드라큘라네모', price: 40 },
  { id: 'driver', kind: 'avatar', name: '운전수네모', price: 50 },

  // ── 아바타 배경 ───────────────────────────
  // 그림이 아니라 색이다. 아바타 뒤에 깔리는 작은 자리라 그림은 읽히지 않고,
  // 그림의 몫은 배너배경이 맡는다. 색이면 파일도 필요 없다.
  { id: 'slate', kind: 'bg', name: '무광 회색', price: 0 },
  { id: 'crimson', kind: 'bg', name: '핏빛', price: 1 },
  { id: 'forest', kind: 'bg', name: '숲빛', price: 1 },
  { id: 'night', kind: 'bg', name: '한밤', price: 2 },
  { id: 'gold', kind: 'bg', name: '금빛', price: 3 },

  // ── 이펙트 ────────────────────────────────
  { id: 'none-effect', kind: 'effect', name: '없음', price: 0 },
  { id: 'flame', kind: 'effect', name: '불꽃', price: 4 },
  { id: 'dash', kind: 'effect', name: '질주', price: 4 },
  { id: 'petal', kind: 'effect', name: '벚꽃', price: 6 },

  // ── 배너 배경 ─────────────────────────────
  { id: 'none-banner', kind: 'banner', name: '없음', price: 0 },
  { id: 'night-city', kind: 'banner', name: '밤의 도시', price: 8 },
  { id: 'castle', kind: 'banner', name: '고성', price: 8 },
  { id: 'blossom', kind: 'banner', name: '벚꽃길', price: 10 },
  { id: 'vault', kind: 'banner', name: '금고', price: 12 },
]

/** 지금 걸치고 있는 네 겹. */
export interface Equipped {
  avatar: string
  bg: string
  effect: string
  banner: string
}

/** 아무것도 사지 않은 사람의 차림. 계정이 없는 사람(게스트)도 늘 이것이다. */
export const DEFAULT_EQUIPPED: Equipped = {
  avatar: 'square',
  bg: 'slate',
  effect: 'none-effect',
  banner: 'none-banner',
}

/**
 * 계정이 들고 다니는 꾸미기.
 *
 * **`spent` 는 전적과 따로 센다.** 이긴 판 수(`wins`)는 누적이라 줄지 않는다 —
 * 거기서 깎으면 많이 이기고 많이 쓴 사람의 전적이 0승이 된다. 살 수 있는 것은
 * `wins - spent` 이고, 그 값만 「분배금」으로 부른다.
 */
export interface Cosmetics {
  /** 산 것들. 0원짜리는 여기 없어도 늘 가진 것으로 친다. */
  owned: string[]
  equipped: Equipped
  spent: number
}

export const EMPTY_COSMETICS: Cosmetics = {
  owned: [],
  equipped: DEFAULT_EQUIPPED,
  spent: 0,
}

const BY_ID = new Map(COSMETICS.map((item) => [item.id, item]))

export function cosmeticOf(id: string): CosmeticItem | null {
  return BY_ID.get(id) ?? null
}

export function cosmeticsOfKind(kind: CosmeticKind): CosmeticItem[] {
  return COSMETICS.filter((item) => item.kind === kind)
}

/** 지금 쓸 수 있는 분배금. 이긴 판에서 쓴 만큼을 뺀다. */
export function balanceOf(wins: number, spent: number): number {
  return Math.max(0, wins - spent)
}

/** 가졌는가. 0원짜리는 사지 않아도 늘 가진 것이다 — 그래야 기본 차림이 성립한다. */
export function owns(cosmetics: Cosmetics, id: string): boolean {
  const item = cosmeticOf(id)
  if (!item) return false
  return item.price === 0 || cosmetics.owned.includes(id)
}

/**
 * 걸친 차림을 믿을 수 있는 값으로 고친다.
 *
 * 저장된 값이 낡았을 수 있다 — 그림을 지웠거나 이름을 갈았거나, 손으로 고쳐 보낸
 * 값일 수도 있다. 가지지 않은 것을 걸치고 있으면 그 겹만 기본으로 되돌린다.
 * 통째로 되돌리지 않는 것은, 한 겹이 낡았다고 나머지 세 겹까지 잃을 이유가 없어서다.
 */
export function sanitizeEquipped(cosmetics: Cosmetics): Equipped {
  const pick = (kind: CosmeticKind, id: string, fallback: string) => {
    const item = cosmeticOf(id)
    return item && item.kind === kind && owns(cosmetics, id) ? id : fallback
  }
  const worn = cosmetics.equipped ?? DEFAULT_EQUIPPED
  return {
    avatar: pick('avatar', worn.avatar, DEFAULT_EQUIPPED.avatar),
    bg: pick('bg', worn.bg, DEFAULT_EQUIPPED.bg),
    effect: pick('effect', worn.effect, DEFAULT_EQUIPPED.effect),
    banner: pick('banner', worn.banner, DEFAULT_EQUIPPED.banner),
  }
}
