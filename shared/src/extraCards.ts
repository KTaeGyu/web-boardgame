/**
 * 도전자 카드와 해결사 카드.
 *
 * 원작 룰북의 challenge / specialist 20장. 효과 전문은 `docs/도전자-해결사-카드.md` 가 정본이고,
 * 여기에는 화면에 보일 문구와 「지금 규칙이 붙어 있는가」만 둔다.
 *
 * ready 가 false 인 카드는 더미에 넣지 않는다. 뽑히기만 하고 아무 일도 하지 않으면
 * 규칙이 조용히 사라지는 셈이라, 차라리 나오지 않는 편이 낫다.
 */

export const CHALLENGE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type ChallengeId = (typeof CHALLENGE_IDS)[number]

export const SPECIALIST_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type SpecialistId = (typeof SPECIALIST_IDS)[number]

export interface ExtraCard {
  id: number
  name: string
  /** 화면에 그대로 띄우는 한 줄 설명. */
  text: string
  ready: boolean
}

export const CHALLENGES: Record<ChallengeId, ExtraCard> = {
  1: {
    id: 1,
    name: '빠른 접근',
    text: '1라운드를 건너뜁니다. 카드를 받자마자 커뮤니티 카드 3장이 열립니다.',
    ready: true,
  },
  2: {
    id: 2,
    name: '소음 감지기',
    text: '1·2·3라운드의 1번 토큰은 한 번 가져가면 아무도 뺏을 수 없습니다.',
    ready: true,
  },
  3: {
    id: 3,
    name: '동작 감지기',
    text: '2라운드에 열린 카드에 J·Q·K가 있으면, 1라운드에서 1번 토큰을 가졌던 사람이 카드를 새로 받습니다.',
    ready: true,
  },
  4: {
    id: 4,
    name: '망막 스캔',
    text: '가장 높은 토큰을 가진 사람이 공개하기 전에, 나머지가 그 사람의 카드 숫자 하나를 맞혀야 합니다.',
    ready: true,
  },
  5: {
    id: 5,
    name: '급한 도주',
    text: '3라운드를 건너뜁니다. 네 번째 카드만 열리고 곧바로 마지막 라운드로 갑니다.',
    ready: true,
  },
  6: {
    id: 6,
    name: '환기구',
    text: '1·2·3라운드의 가장 큰 번호 토큰은 한 번 가져가면 아무도 뺏을 수 없습니다.',
    ready: true,
  },
  7: {
    id: 7,
    name: '레이저 감지선',
    text: '2라운드에 열린 카드에 J·Q·K가 하나도 없으면, 1라운드에서 가장 큰 토큰을 가졌던 사람이 카드를 새로 받습니다.',
    ready: true,
  },
  8: {
    id: 8,
    name: '정전',
    text: '라운드가 넘어갈 때마다 지난 토큰이 치워집니다. 이력이 남지 않습니다.',
    ready: true,
  },
  9: {
    id: 9,
    name: '지문 스캔',
    text: '가장 높은 토큰을 가진 사람이 공개하기 전에, 나머지가 그 사람의 족보를 맞혀야 합니다.',
    ready: true,
  },
  10: {
    id: 10,
    name: '보안 카메라',
    text: '카드를 3장씩 받습니다. 3장과 커뮤니티 5장 중 최선의 5장을 만듭니다.',
    ready: true,
  },
}

export const SPECIALISTS: Record<SpecialistId, ExtraCard> = {
  1: { id: 1, name: '정보원', text: '한 명이 다른 한 명에게 자기 카드 한 장을 보여줍니다.', ready: true },
  2: { id: 2, name: '도주 운전사', text: '한 명이 지금 자기 족보 이름만 모두에게 알립니다.', ready: true },
  3: {
    id: 3,
    name: '투자자',
    text: '카드를 받자마자, 각자 가진 그림카드(J·Q·K) 수가 모두에게 공개됩니다.',
    ready: true,
  },
  4: { id: 4, name: '두뇌', text: '숫자 하나를 정하고, 한 명이 그 숫자를 몇 장 가졌는지 알립니다.', ready: true },
  5: { id: 5, name: '해커', text: '한 명이 카드를 한 장 더 받고 한 장을 버립니다.', ready: true },
  6: { id: 6, name: '조율가', text: '각자 카드 한 장을 골라 동시에 왼쪽 사람에게 넘깁니다.', ready: true },
  7: {
    id: 7,
    name: '잭',
    text: '한 명이 무늬 없는 J 카드를 받고 자기 카드 한 장을 버립니다. 플러시에는 쓸 수 없습니다.',
    ready: true,
  },
  8: {
    id: 8,
    name: '계산가',
    text: '카드를 받자마자, 각자 카드 두 장의 합이 모두에게 공개됩니다. (J·Q·K는 10, A는 11)',
    ready: true,
  },
  9: { id: 9, name: '사기꾼', text: '모두 카드를 본 뒤, 전원의 카드를 섞어 다시 나눕니다.', ready: true },
  10: { id: 10, name: '근육', text: '한 명은 같은 족보끼리는 무조건 이깁니다.', ready: true },
}

/**
 * 해결사를 쓰려면 무엇을 더 골라야 하는가.
 *
 * 카드를 누른 사람이 곧 쓰는 사람이다. 그 위에 대상·숫자·내 카드가 더 필요할 수 있고,
 * 화면은 이 표를 보고 무엇을 물을지 정한다.
 */
export interface SpecialistNeeds {
  /** 다른 사람을 골라야 하는가. */
  target: boolean
  /** 숫자를 골라야 하는가. */
  value: boolean
  /** 내 카드 중 하나를 골라야 하는가. */
  ownCard: boolean
}

const NOTHING: SpecialistNeeds = { target: false, value: false, ownCard: false }

export const SPECIALIST_NEEDS: Record<SpecialistId, SpecialistNeeds> = {
  1: { target: true, value: false, ownCard: true },
  2: NOTHING,
  3: NOTHING,
  4: { target: true, value: true, ownCard: false },
  5: NOTHING,
  6: NOTHING,
  7: NOTHING,
  8: NOTHING,
  9: NOTHING,
  10: NOTHING,
}

/**
 * 카드를 받자마자 저절로 시작해서, 「누가 쓸지」를 고를 것이 없는 해결사.
 * 3·8 은 그 자리에서 끝나고, 6·9 는 전원이 한 번씩 움직여야 끝난다.
 */
export const AUTOMATIC_SPECIALISTS: SpecialistId[] = [3, 6, 8, 9]

/** 딜 직후 다 같이 한 번씩 움직여야 하는 해결사. */
export const SETUP_SPECIALISTS: Record<number, 'pass' | 'memorize'> = { 6: 'pass', 9: 'memorize' }

/** 더미에 넣을 카드. 규칙이 붙지 않은 카드는 뽑히지 않는다. */
export const READY_CHALLENGES = CHALLENGE_IDS.filter((id) => CHALLENGES[id].ready)
export const READY_SPECIALISTS = SPECIALIST_IDS.filter((id) => SPECIALISTS[id].ready)

/** 프로·마스터 시프 모드에서는 「빠른 접근」을 쓰지 않는다. */
export const QUICK_ACCESS: ChallengeId = 1
