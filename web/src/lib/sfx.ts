/**
 * 효과음.
 *
 * 파일을 두지 않고 그 자리에서 파형을 만든다. 이 판에 필요한 소리는 칩 딸깍·딩·사이렌처럼
 * 노이즈와 사인파에 엔벨로프를 씌운 것이 대부분이라, 녹음을 구해 오는 것보다 숫자 몇 개를
 * 만지는 편이 빠르다. 번들이 늘지 않고, 공개된 화면이라 늘 따라오던 출처 문제도 없다.
 *
 * 브라우저는 사람이 한 번 누르기 전까지 소리를 내주지 않는다. 그래서 AudioContext 를
 * 미리 만들지 않고 첫 소리에 만들며 resume 을 함께 부른다 — 방에 들어오는 클릭이 이미
 * 지나갔으므로 대개 그 자리에서 열린다.
 *
 * 소리를 못 내는 것으로 판이 멈추면 안 된다. 여기서 나는 예외는 전부 삼킨다.
 */

import { useEffect } from 'react'

import { sfxGain } from './audio.ts'

export type Sound =
  /** 토큰을 집었다. 중앙에서든 남의 손에서든 내 쪽에서는 같은 동작이다. */
  | 'take'
  /** 내가 쥐고 있던 것을 남이 가져갔다. */
  | 'steal'
  /** 눌렀는데 안 됐다. */
  | 'deny'
  /** 보드에 카드가 깔린다. */
  | 'deal'
  /** 쇼다운에서 한 사람이 사슬을 이었다. 단계마다 반음씩 오른다. */
  | 'revealOk'
  /** 거기서 끊겼다. */
  | 'revealBad'
  /** 금고가 열렸다. */
  | 'vault'
  /** 경보가 울렸다. */
  | 'alarm'
  /** 남이 토큰을 쥐었다. 중앙에서 집었든 남의 손에서 뺏었든 옆에서는 같은 일이다. */
  | 'otherTake'
  /** 남이 쥐고 있던 것을 중앙으로 되돌렸다. */
  | 'otherDrop'
  /** 감지기가 누군가의 손을 갈아엎었다. */
  | 'sensor'
  /** 단추를 눌렀다. 판이 아니라 화면을 만진 것이라 가장 작다. */
  | 'click'
  /** 확정·시작처럼 앞으로 가는 단추. */
  | 'clickGo'
  /** 나가기처럼 되돌릴 수 없는 단추. */
  | 'clickBack'
  /** 취소처럼 물러나는 단추. */
  | 'clickSoft'
  /** 켜는 쪽으로 넘긴 토글. */
  | 'toggleOn'
  /** 끄는 쪽으로 넘긴 토글. */
  | 'toggleOff'
  /** 게임이 끝났다 — 이겼다. 금고 하나가 열린 것과는 다르다. */
  | 'win'
  /** 게임이 끝났다 — 졌다. */
  | 'lose'
  /** 남이 한 마디 했다. */
  | 'chat'
  /** 내 손패가 왔다. 판이 열린다. */
  | 'dealHand'
  /** 카드가 나에게만 알려준 것이 도착했다. */
  | 'note'
  /** 해결사를 썼다. */
  | 'specialist'
  /** 스캔이 열렸다. */
  | 'scanStart'
  /** 스캔을 맞혔다. */
  | 'scanRight'
  /** 스캔을 틀렸다. */
  | 'scanWrong'

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** 노이즈 한 통을 만들어 두고 돌려 쓴다. 소리마다 새로 채우면 집는 순간이 밀린다. */
let noiseBuffer: AudioBuffer | null = null

/**
 * 소리를 낼 준비가 됐으면 지금 시각을, 아니면 null 을.
 *
 * 크기가 0 일 때 아예 만들지 않는 것은 아끼려는 것이 아니라, 꺼둔 사람의 브라우저에
 * 오디오 장치를 잡아두지 않기 위해서다.
 */
function ready(): number | null {
  const gain = sfxGain()
  if (gain <= 0) return null
  try {
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.connect(ctx.destination)

      const length = Math.floor(ctx.sampleRate * 0.5)
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    }
    // 슬라이더를 옮긴 것이 다음 소리부터 바로 듣긴다.
    master!.gain.value = gain
    // 처음 몇 번은 아직 잠겨 있을 수 있다. 열릴 때까지 눌러 본다.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx.currentTime
  } catch {
    return null
  }
}

/**
 * 한 음.
 *
 * 엔벨로프를 지수로 여닫는 이유는 선형으로 하면 시작과 끝에서 「딱」 하고 끊기는
 * 소리가 따로 들리기 때문이다. 0 으로는 못 내려가므로 아주 작은 값에서 멈춘다.
 */
function tone(
  start: number,
  freq: number,
  dur: number,
  options: { type?: OscillatorType; gain?: number; to?: number } = {},
): void {
  if (!ctx || !master) return
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = options.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, start)
  if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, start + dur)

  const peak = options.gain ?? 0.3
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(peak, start + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)

  osc.connect(env)
  env.connect(master)
  osc.start(start)
  osc.stop(start + dur + 0.03)
}

/** 노이즈 한 조각. 필터를 어디에 두느냐로 칩·카드·철문이 갈린다. */
function noise(
  start: number,
  dur: number,
  options: {
    type?: BiquadFilterType
    freq?: number
    q?: number
    gain?: number
    to?: number
  } = {},
): void {
  if (!ctx || !master || !noiseBuffer) return
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer
  // 같은 통을 돌려 쓰므로 늘 같은 자리에서 시작하면 매번 똑같이 들린다.
  const offset = Math.random() * 0.3

  const filter = ctx.createBiquadFilter()
  filter.type = options.type ?? 'bandpass'
  const freq = options.freq ?? 2000
  filter.frequency.setValueAtTime(freq, start)
  if (options.to) filter.frequency.exponentialRampToValueAtTime(options.to, start + dur)
  filter.Q.value = options.q ?? 1

  const env = ctx.createGain()
  const peak = options.gain ?? 0.3
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(peak, start + 0.004)
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur)

  source.connect(filter)
  filter.connect(env)
  env.connect(master)
  source.start(start, offset, dur + 0.05)
  source.stop(start + dur + 0.05)
}

/**
 * 소리를 낸다.
 *
 * `step` 의 뜻은 소리마다 다르다 — 쇼다운은 몇 번째 사람인가(음정이 그만큼 오른다),
 * 카드는 몇 장이 깔리는가다. 나머지는 쓰지 않는다.
 */
export function sfx(name: Sound, step = 0): void {
  const now = ready()
  if (now === null) return

  switch (name) {
    /*
     * 단추. 여기 있는 것 중 가장 작고 가장 짧다.
     *
     * 판에서 벌어진 일이 아니라 화면을 만진 것이라, 들린다기보다 손끝에 닿는 정도여야
     * 한다. 이것이 칩만큼 나면 목록을 훑는 동안 판이 도는 것처럼 들린다.
     */
    case 'click':
      noise(now, 0.018, { type: 'highpass', freq: 3200, gain: 0.16 })
      tone(now, 520, 0.025, { type: 'triangle', gain: 0.05, to: 380 })
      break

    // 앞으로 가는 단추. 딸깍 위에 높은 음 하나를 얹는 것만으로 방향이 생긴다.
    case 'clickGo':
      noise(now, 0.018, { type: 'highpass', freq: 3200, gain: 0.16 })
      tone(now, 660, 0.07, { type: 'triangle', gain: 0.07 })
      break

    // 되돌릴 수 없는 단추. 낮고 둔해서 손이 한 번 멈칫한다.
    case 'clickBack':
      noise(now, 0.022, { type: 'lowpass', freq: 900, gain: 0.14 })
      tone(now, 200, 0.09, { type: 'triangle', gain: 0.08, to: 140 })
      break

    // 물러나는 단추. 음 없이 숨소리만 남긴다.
    case 'clickSoft':
      noise(now, 0.014, { type: 'highpass', freq: 2600, gain: 0.1 })
      break

    /*
     * 토글. 올라가는가 내려가는가가 이 둘의 전부다.
     *
     * 배치표처럼 같은 격자를 여러 번 누르는 자리에서는 화면을 보지 않고도
     * 방금 켠 것인지 끈 것인지 알 수 있어야 한다.
     */
    case 'toggleOn':
      noise(now, 0.014, { type: 'highpass', freq: 3000, gain: 0.1 })
      tone(now, 480, 0.06, { type: 'triangle', gain: 0.07, to: 720 })
      break

    case 'toggleOff':
      noise(now, 0.014, { type: 'highpass', freq: 3000, gain: 0.1 })
      tone(now, 620, 0.06, { type: 'triangle', gain: 0.07, to: 400 })
      break

    /*
     * 게임이 끝났다.
     *
     * 금고(vault)·경보(alarm)와 따로 두는 이유는 층위가 달라서다 — 저쪽은 판 하나의
     * 결말이고 이쪽은 여기서 자리를 뜬다는 뜻이다. 금고가 세 번 열려야 이 소리가 난다.
     */
    case 'win': {
      const chord = [523, 659, 784, 1047]
      chord.forEach((freq, index) => tone(now + index * 0.11, freq, 0.5, { gain: 0.2 }))
      break
    }

    case 'lose': {
      const fall = [392, 330, 262, 196]
      fall.forEach((freq, index) =>
        tone(now + index * 0.14, freq, 0.6, { type: 'triangle', gain: 0.18 }),
      )
      break
    }

    // 남의 한마디. 판을 보는 중에 대화창을 안 보므로 있는 것만 알리고 비켜선다.
    case 'chat':
      tone(now, 880, 0.05, { gain: 0.08 })
      tone(now + 0.05, 1170, 0.07, { gain: 0.06 })
      break

    // 내 손패가 온다. 보드에 깔리는 카드보다 낮게 — 저쪽은 모두의 것이고 이쪽은 내 것이다.
    case 'dealHand':
      for (let i = 0; i < 3; i++) {
        noise(now + i * 0.085, 0.055, { type: 'highpass', freq: 1800, gain: 0.34, to: 4200 })
      }
      break

    // 쪽지. 종이가 스치고 작은 종이 하나 울린다.
    case 'note':
      noise(now, 0.09, { type: 'highpass', freq: 4000, gain: 0.14, to: 7000 })
      tone(now + 0.05, 1320, 0.25, { gain: 0.07 })
      break

    // 해결사. 전자 잠금이 풀리는 소리라 사람이 낸 소리와 갈린다.
    case 'specialist':
      tone(now, 700, 0.06, { type: 'square', gain: 0.09 })
      noise(now + 0.08, 0.06, { freq: 2600, q: 2, gain: 0.2 })
      tone(now + 0.08, 1050, 0.1, { type: 'square', gain: 0.08 })
      break

    // 스캐너가 훑고 지나간다. 올라가는 스윕 하나면 「지금 검사 중」이 선다.
    case 'scanStart':
      noise(now, 0.5, { freq: 1200, q: 4, gain: 0.08, to: 3000 })
      tone(now, 400, 0.5, { type: 'sawtooth', gain: 0.09, to: 1400 })
      break

    case 'scanRight':
      tone(now, 880, 0.1, { gain: 0.16 })
      tone(now + 0.1, 1320, 0.22, { gain: 0.16 })
      break

    case 'scanWrong':
      tone(now, 300, 0.12, { type: 'square', gain: 0.1 })
      tone(now + 0.16, 220, 0.2, { type: 'square', gain: 0.1 })
      break

    // 칩이 펠트에 닿는다. 짧고 건조해야 연달아 집어도 뭉치지 않는다.
    case 'take':
      noise(now, 0.035, { freq: 2600, q: 1.2, gain: 0.5 })
      tone(now, 320, 0.05, { type: 'triangle', gain: 0.18, to: 180 })
      break

    // 같은 칩이되 낮고 길게 끌린다. 「가져갔다」가 아니라 「끌려갔다」로 들려야 돌아본다.
    case 'steal':
      noise(now, 0.09, { freq: 1500, q: 0.8, gain: 0.55, to: 700 })
      tone(now, 220, 0.12, { type: 'triangle', gain: 0.22, to: 110 })
      break

    /*
     * 남의 칩. 내 것과 같은 동작이지만 한참 작고 어둡다.
     *
     * 크기를 이렇게 벌려 둔 이유는 열 명이 앉은 판 때문이다 — 내 것과 같은 크기로
     * 울리면 한 라운드에 열 번 넘게 나면서 정작 내 손이 묻힌다. 들리되 앞에 서지
     * 않을 만큼만 남긴다.
     */
    case 'otherTake':
      noise(now, 0.03, { freq: 1900, q: 1.4, gain: 0.22 })
      tone(now, 260, 0.045, { type: 'triangle', gain: 0.08, to: 160 })
      break

    // 되돌려 놓는 쪽은 더 낮게. 집는 것과 놓는 것이 같게 들리면 방향을 알 수 없다.
    case 'otherDrop':
      noise(now, 0.045, { freq: 1200, q: 1.2, gain: 0.16 })
      tone(now, 180, 0.07, { type: 'triangle', gain: 0.07, to: 120 })
      break

    // 막힌 소리. 음이라기보다 벽에 닿는 느낌이라 낮고 짧다.
    case 'deny':
      tone(now, 150, 0.1, { type: 'square', gain: 0.16, to: 96 })
      noise(now, 0.03, { type: 'lowpass', freq: 500, gain: 0.35 })
      break

    // 카드가 미끄러져 놓인다. 플롭은 세 장이라 세 번 울려야 눈에 보이는 것과 맞는다.
    case 'deal':
      for (let i = 0; i < Math.max(1, step); i++) {
        noise(now + i * 0.11, 0.06, { type: 'highpass', freq: 2400, gain: 0.4, to: 5200 })
      }
      break

    /*
     * 사슬이 이어졌다. 반음씩 올라가는 것이 이 소리의 전부다 —
     * 순서가 맞아 가는 중이라는 것을 글자보다 먼저 알려준다.
     */
    case 'revealOk': {
      const freq = 392 * Math.pow(2, step / 12)
      tone(now, freq, 0.34, { gain: 0.3 })
      tone(now, freq * 2, 0.2, { gain: 0.09 })
      break
    }

    // 올라가던 것이 두 번에 걸쳐 떨어진다.
    case 'revealBad':
      noise(now, 0.05, { type: 'lowpass', freq: 900, gain: 0.3 })
      tone(now, 300, 0.1, { type: 'sawtooth', gain: 0.2, to: 150 })
      tone(now + 0.1, 190, 0.3, { type: 'sawtooth', gain: 0.22, to: 90 })
      break

    /*
     * 다이얼이 돌고 빗장이 풀리고 문이 열린다. 셋을 이어 붙여야 「열렸다」로 들린다 —
     * 화음만 울리면 금고가 아니라 알림이다.
     */
    case 'vault': {
      for (let i = 0; i < 6; i++) {
        noise(now + i * 0.075, 0.02, { freq: 3000, q: 3, gain: 0.26 })
      }
      const clank = now + 0.52
      noise(clank, 0.18, { type: 'lowpass', freq: 1400, gain: 0.5 })
      tone(clank, 150, 0.5, { type: 'triangle', gain: 0.5, to: 62 })
      tone(clank + 0.16, 262, 0.7, { gain: 0.22 })
      tone(clank + 0.24, 330, 0.66, { gain: 0.2 })
      tone(clank + 0.32, 392, 0.66, { gain: 0.2 })
      break
    }

    /*
     * 감지기. 두 음을 삼전음으로 겹쳐 둔다 — 어느 쪽으로도 풀리지 않는 간격이라
     * 「무언가 잘못됐다」가 화음만으로 선다. 경보(alarm)와는 달라야 한다.
     * 저쪽은 판이 끝난 것이고 이쪽은 판이 도는 중에 내 손이 뒤집힌 것이다.
     */
    case 'sensor':
      noise(now, 0.4, { type: 'lowpass', freq: 700, gain: 0.12 })
      for (let i = 0; i < 2; i++) {
        const at = now + i * 0.26
        tone(at, 180, 0.2, { type: 'sawtooth', gain: 0.16 })
        tone(at, 254, 0.2, { type: 'sawtooth', gain: 0.1 })
      }
      break

    // 사이렌. 사각파라 날카로워서 크기를 많이 낮춰 두었다.
    case 'alarm':
      for (let i = 0; i < 3; i++) {
        const at = now + i * 0.42
        tone(at, 620, 0.2, { type: 'square', gain: 0.12, to: 940 })
        tone(at + 0.2, 940, 0.2, { type: 'square', gain: 0.12, to: 620 })
      }
      break
  }
}

/**
 * 어떤 단추를 누르든 작게 딸깍.
 *
 * 단추마다 손으로 붙이면 새로 만들 때마다 빠뜨리고, 빠진 자리는 「이 단추만 안 눌리나」로
 * 읽힌다. 그래서 문서에서 한 번만 듣고 눌린 것이 단추인지 본다.
 *
 * click 이 아니라 pointerdown 인 것은 누른 그 순간에 나야 손끝과 붙기 때문이고,
 * capture 로 듣는 것은 그 클릭에 화면이 사라져도 소리는 나야 하기 때문이다 —
 * 모달의 닫기 단추가 그렇다.
 */
export function useClickSound(): void {
  useEffect(() => {
    const hear = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      const hit = event.target.closest('button, a, [role="button"], label')
      if (!hit) return
      // 토큰은 자기 소리가 따로 있다. 딸깍이 겹치면 칩을 두 번 놓은 것처럼 들린다.
      if (hit.classList.contains('token')) return
      // 잠긴 단추는 눌러도 아무 일이 없다. 소리가 나면 눌린 줄 안다.
      if (hit instanceof HTMLButtonElement && hit.disabled) return

      /*
       * 단추가 무슨 단추인지는 이미 클래스에 적혀 있다. 그래서 소리를 가르는 데
       * 컴포넌트를 하나도 고치지 않는다 — 새로 만드는 단추도 클래스만 맞으면 따라온다.
       *
       * 토글은 aria-pressed 를 본다. 눌리기 **전** 값이라 true 면 지금 끄는 중이다.
       * 곡 고르기처럼 골라 두는 것(다시 눌러도 꺼지지 않는 것)은 이 셈에서 살짝
       * 어긋나지만, 이미 켜진 것을 다시 누르는 일이 드물어 그대로 둔다.
       */
      const pressed = hit.getAttribute('aria-pressed')
      if (pressed === 'true') sfx('toggleOff')
      else if (pressed === 'false') sfx('toggleOn')
      else if (hit.classList.contains('btn--primary')) sfx('clickGo')
      else if (hit.classList.contains('btn--danger')) sfx('clickBack')
      else if (hit.classList.contains('btn--ghost')) sfx('clickSoft')
      else sfx('click')
    }
    document.addEventListener('pointerdown', hear, true)
    return () => document.removeEventListener('pointerdown', hear, true)
  }, [])
}

/*
 * 개발 중에만 창에 걸어 둔다.
 *
 * 여덟 개를 판을 돌려 가며 다 듣기는 번거롭다. 콘솔에서 하나씩 불러 크기와 음정을
 * 잡을 수 있어야 고치는 자리와 듣는 자리가 붙는다. import.meta.env.DEV 가 배포본에서
 * 이 블록을 통째로 걷어내므로 나가는 짐은 늘지 않는다.
 *
 * 음소거일 때는 여기서 불러도 조용하다 — 켜 두고 들어야 한다.
 */
if (import.meta.env.DEV) {
  ;(window as unknown as { __sfx: typeof sfx }).__sfx = sfx
}
