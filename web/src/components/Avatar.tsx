/**
 * 장착한 차림 한 덩이.
 *
 * 슬롯은 안쪽부터 **아바타 → 프로필 배경 → 이펙트** 셋이고, 제일 바깥의 배너는
 * 줄 전체에 깔리는 것이라 여기 없다(그 줄을 그리는 쪽이 맡는다).
 *
 * **로그인한 사람만 코스메틱을 장착한다.** 게스트에게는 차림이 아예 오지 않으므로
 * (`equipped` 없음) 기본 아바타로 그린다 — 빈자리로 두면 줄마다 높이가 달라진다.
 *
 * 그림은 `web/public/avatars/<이름>.svg` 에 있다. 이름표로 찾아 그리므로, 파일이
 * 없거나 이름이 낡았으면 기본 아바타로 되돌아간다(`onError`) — 아이템 하나 때문에
 * 깨진 그림 자리가 남지는 않게 한다.
 */

import { useState } from 'react'
import { DEFAULT_EQUIPPED, cosmeticOf, type Equipped } from '@the-gang/shared'

/**
 * 아바타 뒤에 깔리는 프로필 배경 색.
 *
 * 표(`shared/src/cosmetics.ts`)에는 이름과 값만 있고 **실제 색은 화면의 것**이다.
 * 서버가 알 이유가 없고, 테마가 바뀌면 여기만 손대면 된다.
 */
const BG_COLORS: Record<string, string> = {
  slate: 'linear-gradient(160deg, #6b6f76, #43464c)',
  crimson: 'linear-gradient(160deg, #b4384a, #6d1a27)',
  forest: 'linear-gradient(160deg, #4f8a5b, #23472c)',
  night: 'linear-gradient(160deg, #3b4a7a, #1a2140)',
  gold: 'linear-gradient(160deg, #d8b45a, #8a6a1e)',
}

interface Props {
  /** 장착한 것. 없으면(게스트·옛 줄) 기본 차림이다. */
  equipped?: Equipped
  size?: 'sm' | 'md' | 'lg'
  /** 이름을 읽어주는 자리. 줄에 이름이 이미 있으면 굳이 두 번 읽지 않는다. */
  label?: string
}

export function Avatar({ equipped, size = 'sm', label }: Props) {
  const worn = equipped ?? DEFAULT_EQUIPPED
  // 그림이 없는 이름이 올 수 있다. 한 번 실패하면 기본으로 두고 다시 시도하지 않는다.
  const [broken, setBroken] = useState(false)
  const avatar = broken ? DEFAULT_EQUIPPED.avatar : worn.avatar
  const name = label ?? cosmeticOf(avatar)?.name ?? ''

  return (
    <span className={`avatar avatar--${size} avatar--fx-${worn.effect}`}>
      <span
        className="avatar__bg"
        style={{ background: BG_COLORS[worn.bg] ?? BG_COLORS[DEFAULT_EQUIPPED.bg] }}
      >
        <img
          className="avatar__face"
          src={`/avatars/${avatar}.svg`}
          alt={name}
          onError={() => setBroken(true)}
        />
      </span>
    </span>
  )
}
