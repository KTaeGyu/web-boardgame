/**
 * 소리의 크기를 정하는 한 곳.
 *
 * 효과음과 배경음악은 나는 방식이 전혀 다르다 — 한쪽은 그 자리에서 만든 파형이고
 * 다른 쪽은 받아 온 파일이다. 그래도 사람이 만지는 손잡이는 하나여야 해서, 값만
 * 여기 모아 두고 실제로 소리를 내는 일은 sfx.ts 와 music.ts 가 각자 한다.
 *
 * 음소거를 크기 0 과 따로 두는 이유는 되돌아올 자리 때문이다. 슬라이더를 0 까지
 * 내려 끄면 다시 켤 때 얼마였는지 잊는다.
 */

import { useEffect, useReducer } from 'react'

/**
 * 고를 수 있는 곡.
 *
 * 이름을 「Covert Operations」가 아니라 「잠입」으로 부르는 것은 고르는 사람이 곡을
 * 아는 것이 아니라 분위기를 고르기 때문이다. 만든 사람은 README 에 적어 둔다 —
 * 셋 다 CC0 라 표기할 의무는 없지만, 없어도 되는 것과 안 하는 것은 다르다.
 *
 * 곡을 더 넣으려면 web/public/music 에 파일을 두고 여기 한 줄을 더한다.
 */
export const TRACKS = [
  { id: 'covert', label: '잠입', file: '/music/covert_operations.mp3' },
  { id: 'detective', label: '추리', file: '/music/acid_detective.mp3' },
  { id: 'jazz', label: '재즈', file: '/music/jazz_n_brass_loop.mp3' },
] as const

export type TrackId = (typeof TRACKS)[number]['id']

export function trackFile(id: TrackId): string {
  return (TRACKS.find((track) => track.id === id) ?? TRACKS[0]).file
}

export interface AudioSettings {
  muted: boolean
  /** 어느 곡을 트는가. */
  track: TrackId
  /** 효과음 크기. 0~1. */
  sfx: number
  /** 배경음악 크기. 0~1. */
  music: number
}

/**
 * 슬라이더를 끝까지 올렸을 때의 실제 크기.
 *
 * 1 로 두면 여러 소리가 겹칠 때 찢어진다. 기본값(효과음 0.7)에서 손으로 맞춰 둔
 * 크기가 나오도록 잡은 값이라, 여기를 만지면 판 전체가 함께 커지고 작아진다.
 */
export const SFX_MAX = 0.46
export const MUSIC_MAX = 0.5

const DEFAULTS: AudioSettings = { muted: false, track: 'covert', sfx: 0.7, music: 0.25 }

const KEY = 'the-gang:audio'

function clamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback
}

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<AudioSettings>
    // 없어진 곡을 가리키고 있으면 기본으로 돌린다. 파일이 빠졌다고 조용해지면 곤란하다.
    const known = TRACKS.some((track) => track.id === saved.track)
    return {
      muted: saved.muted === true,
      track: known ? (saved.track as TrackId) : DEFAULTS.track,
      sfx: clamp(saved.sfx, DEFAULTS.sfx),
      music: clamp(saved.music, DEFAULTS.music),
    }
  } catch {
    // 저장이 막혔거나 남이 망가뜨린 값이다. 이번 판은 기본값으로 돈다.
    return DEFAULTS
  }
}

let settings = load()

/**
 * 값이 바뀐 것을 듣는 사람들.
 *
 * 화면만이 아니라 음악을 트는 쪽도 알아야 해서 리액트 밖에도 통로를 둔다.
 */
const listeners = new Set<() => void>()

export function getAudio(): AudioSettings {
  return settings
}

export function setAudio(patch: Partial<AudioSettings>): void {
  settings = { ...settings, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* 기억하지 못할 뿐이다 */
  }
  for (const listen of listeners) listen()
}

/** 지금 효과음이 실제로 나갈 크기. 음소거면 0 이다. */
export function sfxGain(): number {
  return settings.muted ? 0 : settings.sfx * SFX_MAX
}

/** 지금 배경음악이 실제로 나갈 크기. */
export function musicGain(): number {
  return settings.muted ? 0 : settings.music * MUSIC_MAX
}

export function useAudio(): [AudioSettings, (patch: Partial<AudioSettings>) => void] {
  const [, bump] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    listeners.add(bump)
    // 같은 사람이 두 창을 띄워 놓는 일이 흔하다. 한쪽에서 줄이면 다른 쪽도 줄어든다.
    const follow = (event: StorageEvent) => {
      if (event.key !== KEY) return
      settings = load()
      for (const listen of listeners) listen()
    }
    window.addEventListener('storage', follow)
    return () => {
      listeners.delete(bump)
      window.removeEventListener('storage', follow)
    }
  }, [])

  return [settings, setAudio]
}
