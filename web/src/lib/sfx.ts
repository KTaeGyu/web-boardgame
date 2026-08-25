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

import { useEffect, useState } from 'react'

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

const KEY = 'the-gang:sound'

function savedMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === 'off'
  } catch {
    return false
  }
}

let muted = savedMuted()

export function isMuted(): boolean {
  return muted
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** 노이즈 한 통을 만들어 두고 돌려 쓴다. 소리마다 새로 채우면 집는 순간이 밀린다. */
let noiseBuffer: AudioBuffer | null = null

/**
 * 소리를 낼 준비가 됐으면 지금 시각을, 아니면 null 을.
 *
 * 음소거일 때 아예 만들지 않는 것은 아끼려는 것이 아니라, 꺼둔 사람의 브라우저에
 * 오디오 장치를 잡아두지 않기 위해서다.
 */
function ready(): number | null {
  if (muted) return null
  try {
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      // 여러 소리가 겹쳐도 찢어지지 않을 만큼. 판 전체의 크기를 여기 하나로 잡는다.
      master.gain.value = 0.32
      master.connect(ctx.destination)

      const length = Math.floor(ctx.sampleRate * 0.5)
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    }
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
 * 소리를 켜고 끈다.
 *
 * 테마·화면 크기와 같은 방식으로 기억하되, 화면이 그려지기 전에 정할 것이 없어서
 * index.html 이 미리 손댈 일은 없다 — 첫 칠에 보이는 것이 아니라 첫 소리에 쓰인다.
 */
export function useSound(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(!muted)

  // 같은 사람이 두 창을 띄워 놓는 일이 흔하다. 한쪽에서 끄면 다른 쪽도 조용해진다.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== KEY) return
      muted = event.newValue === 'off'
      setOn(!muted)
    }
    window.addEventListener('storage', follow)
    return () => window.removeEventListener('storage', follow)
  }, [])

  const toggle = () => {
    muted = !muted
    try {
      localStorage.setItem(KEY, muted ? 'off' : 'on')
    } catch {
      /* 기억하지 못할 뿐이다 */
    }
    setOn(!muted)
    // 켜는 순간 한 번 들려준다. 켰는데 아무 소리도 안 나면 고장으로 읽힌다.
    if (!muted) sfx('take')
  }

  return { on, toggle }
}
