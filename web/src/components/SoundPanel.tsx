/**
 * 소리 조절.
 *
 * 옆의 두 단추와 달리 그림이 「누르면 무엇이 되는가」가 아니라 **지금 어떤가**다.
 * 눌러도 소리가 꺼지는 것이 아니라 조절판이 열리기 때문이다 — 누르면 되는 일과
 * 그림이 어긋나면 안 되므로, 여기서만 규칙이 다르다.
 *
 * 효과음과 배경음악을 따로 두는 것은 끄고 싶은 것이 대개 한쪽뿐이라서다.
 * 음소거는 그 위에 따로 있다. 슬라이더를 0 까지 내려 끄면 다시 켤 때 얼마였는지 잊는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { TRACKS, useAudio } from '../lib/audio.ts'
import { sfx } from '../lib/sfx.ts'
import { useEscape } from '../lib/useEscape.ts'

export function SoundPanel() {
  const [open, setOpen] = useState(false)
  const [audio, set] = useAudio()
  const box = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  useEscape(open, close)

  // 바깥을 누르면 닫힌다. 단추도 상자 안에 있으므로 여는 그 손짓에 곧바로 닫히지 않는다.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // 크기를 옮기고 손을 뗄 때 한 번 들려준다. 숫자만 보고는 얼마나 큰지 알 수 없다.
  const preview = () => sfx('take')

  return (
    <div className="sound" ref={box}>
      <button
        type="button"
        className="tool-btn"
        onClick={() => setOpen((now) => !now)}
        aria-expanded={open}
        aria-label="소리 조절"
        title="소리 조절"
      >
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
          {audio.muted ? (
            <path d="M16.5 9.2l4 5.6M20.5 9.2l-4 5.6" />
          ) : (
            <>
              <path d="M15.8 9.4a3.4 3.4 0 0 1 0 5.2" />
              <path d="M18.6 7.2a6.8 6.8 0 0 1 0 9.6" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div className="sound__panel">
          <button
            type="button"
            className={`sound__mute ${audio.muted ? 'sound__mute--on' : ''}`}
            onClick={() => {
              set({ muted: !audio.muted })
              // 켜는 쪽으로 갈 때만 들려준다. 끄는 쪽에서는 이미 조용한 것이 답이다.
              if (audio.muted) setTimeout(preview, 0)
            }}
          >
            {audio.muted ? '소리 켜기' : '소리 끄기'}
          </button>

          <Slider
            label="효과음"
            value={audio.sfx}
            dim={audio.muted}
            onChange={(sfxValue) => set({ sfx: sfxValue })}
            onSettle={preview}
          />
          <Slider
            label="배경음악"
            value={audio.music}
            dim={audio.muted}
            onChange={(music) => set({ music })}
          />

          {/* 크기 바로 아래에 둔다 — 무엇이 흐르는가와 얼마나 크게가 한 이야기다. */}
          <div className={`sound__tracks ${audio.muted ? 'sound__tracks--dim' : ''}`}>
            {TRACKS.map((track) => (
              <button
                key={track.id}
                type="button"
                className={`sound__track ${audio.track === track.id ? 'sound__track--on' : ''}`}
                onClick={() => set({ track: track.id })}
                aria-pressed={audio.track === track.id}
              >
                {track.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface SliderProps {
  label: string
  value: number
  /** 음소거 중에는 값이 있어도 소리가 안 난다. 흐리게 두어 그 사실을 보인다. */
  dim: boolean
  onChange: (value: number) => void
  onSettle?: () => void
}

function Slider({ label, value, dim, onChange, onSettle }: SliderProps) {
  const percent = Math.round(value * 100)

  return (
    <label className={`sound__row ${dim ? 'sound__row--dim' : ''}`}>
      <span className="sound__label">
        {label}
        <span className="sound__value">{percent}%</span>
      </span>
      <input
        type="range"
        className="sound__range"
        min={0}
        max={100}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        onPointerUp={onSettle}
        onKeyUp={onSettle}
        aria-label={`${label} 크기`}
      />
    </label>
  )
}
