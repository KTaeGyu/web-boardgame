/**
 * 코스메틱 — 무엇을 장착할 수 있고 몇 골드인가.
 *
 * 대기실의 한 줄은 슬롯 넷으로 선다. 바깥부터 **배너 > 이펙트 > 프로필 배경 > 아바타** 다.
 * 슬롯마다 따로 고르므로 조합이 곧 그 사람의 차림이 된다.
 *
 * **표는 여기 한 벌뿐이다.** 화면이 가격을 들고 있으면 값을 고쳐 부를 수 있으므로,
 * 서버가 이 표로 잔액과 중복을 판정하고 화면은 같은 표를 보여주기만 한다. 카드 표
 * (`extraCards.ts`)와 같은 어법이다.
 *
 * **그림은 여기 없다.** 여기 있는 것은 이름표뿐이고, 실제 그림은 화면이 그 이름표로
 * 찾아 그린다(`web/public/avatars/…`). 파일 경로를 값으로 저장하면 나중에 그림을
 * 갈 때 이미 저장된 차림이 죽는다.
 *
 * **가격은 두 축으로 정한다**(1승 = 1골드).
 *
 * **슬롯끼리는 무게 순이다.** 얼굴이 곧 그 사람이라 아바타가 제일 비싸고(30~42), 줄
 * 전체를 덮는 배너가 그다음(20~25), 움직임인 이펙트(12~16), 색 하나인 프로필 배경이
 * 제일 싸다(4~6). 눈에 띄는 크기 순서와 가격 순서가 같아야 「비싼 것을 샀다」가 화면에서
 * 보인다.
 *
 * **한 슬롯 안에서는 좁게 벌린다.** 같은 자리에 걸치는 것끼리 값이 두 배 세 배로 갈리면
 * 고르는 축이 「무엇이 나다운가」가 아니라 「무엇을 살 수 있나」가 된다. 슬롯마다 제일 싼
 * 것과 제일 비싼 것의 차를 1.5배 안쪽으로 둔다.
 *
 * **그 안의 순서는 화려함이다** — 조각이 몇이고, 얼마나 넓게 덮고, **실루엣이 바뀌는가.**
 * 셋째 것이 제일 무겁다. 상자 밖으로 나가는 망토와 귀는 색을 갈아입는 것과 다른 종류의
 * 변화다. 조각 수만 세면 어긋난다 — 「체리 블로섬」은 조각이 열여덟으로 제일 많지만 가늘게
 * 흩어져 제일 조용하다.
 *
 * 가격이 짜거나 후하면 **이 표의 숫자만** 고치면 된다. 서버가 이 표로 판정하고 화면은
 * 같은 표를 보여줄 뿐이라, 고친 순간 양쪽이 함께 갈린다. 이름도 마찬가지다.
 */

/** 어느 슬롯인가. */
export type CosmeticKind = 'avatar' | 'bg' | 'effect' | 'banner'

export interface CosmeticItem {
  id: string
  kind: CosmeticKind
  /** 상점에 뜨는 이름. */
  name: string
  /**
   * 몇 골드인가. **0 이면 기본 지급**이다.
   *
   * 아무것도 사지 않은 사람도 슬롯 넷을 다 채워야 하므로 슬롯마다 0골드짜리가 하나씩 있다.
   */
  price: number
}

/**
 * 장착할 수 있는 것 전부.
 *
 * 이름은 **모티프만** 가져온다. 남의 상표를 그대로 쓰면 친구들에게 뿌리는 주소에
 * 그 이름이 그대로 실린다 — 보면 무엇인지 알아보는 것은 같고, 이름과 상징만 피한다.
 * 그래서 「나이트윙」·「배트맨」처럼 실재하는 상표는 이름 후보에서 먼저 걸러낸다.
 */
export const COSMETICS: CosmeticItem[] = [
  // ── 아바타 ────────────────────────────────
  { id: 'square', kind: 'avatar', name: '루키', price: 0 },
  // 눈가리개 하나. 상자도 이목구비도 그대로라 제일 적게 바뀐다.
  { id: 'mask', kind: 'avatar', name: '섀도우 마스크', price: 30 },
  { id: 'bat', kind: 'avatar', name: '나이트 카울', price: 32 },
  // 여기부터는 얼굴이 통째로 바뀐다.
  { id: 'cheddar', kind: 'avatar', name: '체다', price: 34 },
  { id: 'driver', kind: 'avatar', name: '겟어웨이 드라이버', price: 36 },
  { id: 'spider', kind: 'avatar', name: '레드 웹', price: 38 },
  // 귀와 망토는 상자 밖으로 나간다 — 실루엣이 바뀌는 둘이라 제일 비싸다.
  { id: 'rabbit', kind: 'avatar', name: '화이트 래빗', price: 40 },
  { id: 'dracula', kind: 'avatar', name: '블러드 로드', price: 42 },

  // ── 프로필 배경 ───────────────────────────
  // 그림이 아니라 색이다. 아바타 뒤에 깔리는 작은 자리라 그림은 읽히지 않고,
  // 그림의 몫은 배너가 맡는다. 색이면 파일도 필요 없다.
  //
  // 금빛을 「골드」로 부르지 않는 것은 재화 이름과 겹쳐서다 — 「골드 10 G」가 된다.
  //
  // 값이 거의 붙어 있다. 이 슬롯은 색 하나라 화려함에 차이를 둘 자리가 없다 —
  // 밝아서 눈에 먼저 드는 둘만 위로 올린다.
  { id: 'slate', kind: 'bg', name: '스틸 그레이', price: 0 },
  { id: 'crimson', kind: 'bg', name: '크림슨', price: 4 },
  { id: 'forest', kind: 'bg', name: '에메랄드', price: 4 },
  { id: 'night', kind: 'bg', name: '미드나잇', price: 4 },
  { id: 'mustard', kind: 'bg', name: '머스터드', price: 4 },
  { id: 'gold', kind: 'bg', name: '앰버', price: 6 },
  { id: 'carrot', kind: 'bg', name: '캐럿', price: 6 },

  // ── 이펙트 ────────────────────────────────
  { id: 'none-effect', kind: 'effect', name: '미장착', price: 0 },
  // 한 겹짜리 둘.
  { id: 'flame', kind: 'effect', name: '플레임', price: 12 },
  { id: 'dash', kind: 'effect', name: '스피드 라인', price: 12 },
  // 조각이 둘이고 생겼다 사라지는 둘.
  { id: 'petal', kind: 'effect', name: '블로섬', price: 14 },
  { id: 'melt', kind: 'effect', name: '멜팅', price: 14 },
  // 아바타 «전체»가 움직인다. 이 슬롯에서 제일 눈에 든다.
  { id: 'hop', kind: 'effect', name: '홉', price: 16 },

  // ── 배너 ──────────────────────────────────
  //
  // 줄을 얼마나 덮는가로 세운다. 「더 볼트」가 아래쪽인 것이 어색해 보이지만 금고 하나에
  // 금괴 몇이 전부다 — 이야기의 무게가 아니라 눈에 드는 무게로 매긴다.
  { id: 'none-banner', kind: 'banner', name: '미장착', price: 0 },
  { id: 'moonlit-hill', kind: 'banner', name: '문라이트 힐', price: 20 },
  { id: 'vault', kind: 'banner', name: '더 볼트', price: 21 },
  { id: 'cheese-factory', kind: 'banner', name: '치즈 팩토리', price: 22 },
  { id: 'blossom', kind: 'banner', name: '체리 블로섬', price: 23 },
  { id: 'castle', kind: 'banner', name: '고딕 캐슬', price: 24 },
  { id: 'night-city', kind: 'banner', name: '네온 시티', price: 25 },
]

/** 지금 장착 중인 슬롯 넷. */
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
 * 계정이 들고 다니는 코스메틱.
 *
 * **`spent` 는 전적과 따로 센다.** 승리 수(`wins`)는 누적이라 줄지 않는다 —
 * 거기서 깎으면 많이 이기고 많이 쓴 사람의 전적이 0승이 된다. 살 수 있는 것은
 * `wins - spent` 이고, 그 값만 「골드」로 부른다.
 */
export interface Cosmetics {
  /** 구매한 것들. 0골드짜리는 여기 없어도 늘 보유한 것으로 친다. */
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

/** 지금 쓸 수 있는 골드. 승리로 번 것에서 쓴 만큼을 뺀다. */
export function balanceOf(wins: number, spent: number): number {
  return Math.max(0, wins - spent)
}

/** 보유했는가. 0골드짜리는 사지 않아도 늘 보유한 것이다 — 그래야 기본 차림이 성립한다. */
export function owns(cosmetics: Cosmetics, id: string): boolean {
  const item = cosmeticOf(id)
  if (!item) return false
  return item.price === 0 || cosmetics.owned.includes(id)
}

/**
 * 장착한 차림을 믿을 수 있는 값으로 고친다.
 *
 * 저장된 값이 낡았을 수 있다 — 그림을 지웠거나 이름을 갈았거나, 손으로 고쳐 보낸
 * 값일 수도 있다. 보유하지 않은 것을 장착하고 있으면 그 슬롯만 기본으로 되돌린다.
 * 통째로 되돌리지 않는 것은, 슬롯 하나가 낡았다고 나머지 셋까지 잃을 이유가 없어서다.
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
