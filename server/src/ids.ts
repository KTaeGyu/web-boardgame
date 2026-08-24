import { randomInt } from 'node:crypto'

/** 헷갈리는 글자(0/O, 1/I/L)를 뺐다. 전화로 불러줄 수 있어야 한다. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 4

export function randomRoomCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/** 이미 쓰이는 코드를 피해서 하나 뽑는다. 방 수가 31^4 에 근접할 일은 없다. */
export function uniqueRoomCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = randomRoomCode()
    if (!taken(code)) return code
  }
  throw new Error('방 코드를 뽑지 못했다 — 방이 지나치게 많다')
}

/** 카드 셔플용 난수. 예측 가능한 딜이 나오지 않도록 Math.random 대신 crypto 를 쓴다. */
export function cryptoRandom(): number {
  return randomInt(0, 2 ** 48) / 2 ** 48
}
