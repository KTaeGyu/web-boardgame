/**
 * 혼자 해보기.
 *
 * **화면 안에서 돈다.** 예전에는 서버에 진짜 방을 만들었는데, 무료 요금제가 잠들어
 * 있으면 그 단추가 1~2분을 기다렸다 — 「규칙을 읽는 것보다 한 판 해보는 게 빠르다」고
 * 누른 자리가 화면을 통틀어 제일 오래 기다리는 자리였다. 이제 서버가 자고 있어도 열린다.
 *
 * 규칙은 서버가 쓰는 것과 같은 한 벌이다(`localGame.ts`).
 */

import { LOCAL_CODE, startLocal } from './localGame.ts'

/** 판이 열린 자리. 주소는 사람들과 하는 판과 같은 모양이라 화면이 갈라지지 않는다. */
export function startTutorial(nickname: string): string {
  startLocal(nickname)
  return LOCAL_CODE
}
