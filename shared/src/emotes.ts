/**
 * 감정표현 — 한 번 눌러 잠깐 띄우는 한 마디.
 *
 * **상태가 아니라 사건이다.** 떴다 사라지는 것이라 판 상태에 실으면 재접속한 사람에게
 * 옛 감정이 뜬다. 그래서 이벤트로 쏘고 화면이 몇 초 띄웠다 지운다.
 *
 * **꾸미기가 아니다.** 아바타는 계정에 남는 것이라 로그인한 사람만 꾸미지만, 이쪽은
 * 남지 않는 말이므로 게스트도 한다 — 이미 자유 채팅이 열려 있어 감정표현만 막으면
 * 「왜 난 안 되지」만 남는다.
 *
 * **목록을 서버가 들고 있는다.** 화면이 아무 글자나 보내면 그것이 그대로 남의 화면에
 * 뜬다. 이름표(id)만 받고 무엇을 띄울지는 이 표가 정한다 — 카드 표들과 같은 어법이다.
 */

export interface Emote {
  id: string
  emoji: string
  /** 고르는 자리에 붙는 말. 이모지만 늘어놓으면 무엇을 뜻하는지 사람마다 다르게 읽는다. */
  name: string
}

export const EMOTES: Emote[] = [
  { id: 'hi', emoji: '👋', name: '안녕' },
  { id: 'good', emoji: '👍', name: '좋아' },
  { id: 'laugh', emoji: '😂', name: '웃김' },
  { id: 'wow', emoji: '😮', name: '헉' },
  { id: 'sweat', emoji: '😅', name: '아슬아슬' },
  { id: 'think', emoji: '🤔', name: '고민' },
  { id: 'sorry', emoji: '🙏', name: '미안' },
  { id: 'party', emoji: '🎉', name: '신남' },
]

const BY_ID = new Map(EMOTES.map((one) => [one.id, one]))

export function emoteOf(id: string): Emote | null {
  return BY_ID.get(id) ?? null
}

/**
 * 한 사람이 다음 것을 낼 때까지 기다리는 시간.
 *
 * **되돌릴 자리를 값 하나로 남겨 둔다.** 카드 이야기가 금지된 게임이라 감정표현은
 * 그 금지를 우회하는 신호가 될 수 있다 — 「😅😅」 같은 약속이 그렇다. 지금은 친구들
 * 사이의 규칙에 맡기고 열어 두되, 문제가 보이면 이 값 하나를 올려 조인다.
 *
 * 지금 값은 도배만 막는 정도다. 사람이 손으로 누르는 속도를 방해하지 않는다.
 */
export const EMOTE_COOLDOWN_MS = 1000

/** 화면에 떠 있는 시간. 지나면 스스로 내려간다. */
export const EMOTE_SHOW_MS = 2600

/**
 * 내려가는 데 걸리는 시간.
 *
 * **떠 있는 동안 다음 것이 오면 갈아치우지 않고 기다린다.** 그림만 바뀌면 한 마디가
 * 두 마디였다는 것이 보이지 않아, 연달아 누른 것이 한 번 누른 것처럼 읽힌다.
 * 앞의 것이 다 내려간 뒤에 새로 올라온다.
 */
export const EMOTE_EXIT_MS = 170
