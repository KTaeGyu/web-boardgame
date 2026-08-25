/**
 * 배경음악.
 *
 * 효과음과 달리 받아 온 파일이라, 만드는 것이 아니라 트는 것이다. 그래서 Web Audio 가
 * 아니라 오디오 원소 하나다 — 파형을 만질 일이 없는데 통째로 풀어 두면 메모리만 든다.
 *
 * 브라우저는 사람이 한 번 누르기 전까지 소리를 내주지 않아서, 처음의 재생은 거의 언제나
 * 거절당한다. 그것을 실패로 보지 않고 첫 손짓을 기다렸다가 다시 건다.
 */

import { useEffect } from 'react'

import { musicGain, trackFile, useAudio } from './audio.ts'

/** 갑자기 켜지고 꺼지면 놀란다. 이 시간에 걸쳐 오르내린다. */
const FADE_MS = 900

let el: HTMLAudioElement | null = null
let fade: ReturnType<typeof setInterval> | null = null

function element(): HTMLAudioElement {
  if (!el) {
    el = new Audio()
    el.loop = true
    // 판이 시작될 때까지 기다렸다가 받으면 첫 몇 초가 빈다.
    el.preload = 'auto'
    el.volume = 0
  }
  return el
}

/**
 * 목표 크기까지 천천히 옮긴다.
 *
 * 0 에 닿으면 멈춘다 — 소리가 안 나는 채로 계속 돌면 배터리만 쓴다.
 */
function glide(to: number): void {
  const audio = element()
  if (fade) clearInterval(fade)

  const from = audio.volume
  const steps = Math.max(1, Math.round(FADE_MS / 50))
  let step = 0

  fade = setInterval(() => {
    step += 1
    const at = from + (to - from) * (step / steps)
    audio.volume = Math.min(1, Math.max(0, at))
    if (step < steps) return

    if (fade) clearInterval(fade)
    fade = null
    if (to <= 0) audio.pause()
  }, 50)
}

/**
 * 배경음악을 튼다. 화면 어디에 있든 이어지도록 App 에서 한 번만 부른다.
 */
export function useBackgroundMusic(): void {
  const [settings] = useAudio()
  const target = musicGain()
  const file = trackFile(settings.track)

  useEffect(() => {
    const audio = element()

    /*
     * 곡이 바뀌었을 때만 갈아 끼운다.
     *
     * 같은 곡이면 손대지 않는 것이 중요하다 — 크기를 만질 때마다 다시 걸면 매번
     * 처음으로 되감겨, 슬라이더를 몇 번 움직이는 사이에 듣던 자리를 잃는다.
     */
    if (audio.dataset.file !== file) {
      audio.dataset.file = file
      audio.src = file
      // 새 곡은 앞의 크기를 물려받지 않는다. 0 에서 올라와야 갈린 티가 안 난다.
      audio.volume = 0
    }

    if (target <= 0) {
      glide(0)
      return
    }

    /*
     * 아직 사람이 아무것도 누르지 않았으면 여기서 거절당한다. 그때는 첫 손짓을
     * 기다렸다가 한 번 더 건다 — 그 한 번이면 그 뒤로는 막히지 않는다.
     */
    void audio.play().then(
      () => glide(target),
      () => {
        const retry = () => {
          void audio.play().then(() => glide(target), () => undefined)
        }
        document.addEventListener('pointerdown', retry, { once: true })
        document.addEventListener('keydown', retry, { once: true })
      },
    )
  }, [target, file])
}
