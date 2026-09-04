/**
 * 상점 — 코스메틱을 사고 장착하는 자리.
 *
 * **골드는 승리에서 나온다.** 다만 이긴 판(`record.wins`)은 누적이라 줄지 않고,
 * 쓴 만큼(`cosmetics.spent`)을 따로 센다. 그 둘의 차가 지금 쓸 수 있는 잔액이다 —
 * 전적에서 직접 깎으면 많이 이기고 많이 쓴 사람의 전적이 0승이 된다.
 *
 * **게스트에게는 열리지 않는다.** 꾸민 것을 남길 자리가 계정뿐이라, 게스트가 골라도
 * 창을 닫는 순간 사라진다. 고를 수 있는 척하고 사라지는 것보다 못 한다고 말하는 편이 낫다.
 *
 * 구매도 장착도 **서버가 정한다.** 여기서 잠긴 것을 흐리게 두는 것은 손이
 * 헛돌지 않게 하려는 것뿐이고, 거절 사유는 서버 말을 그대로 옮긴다.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_EQUIPPED,
  balanceOf,
  cosmeticsOfKind,
  owns,
  type CosmeticKind,
  type Equipped,
} from '@the-gang/shared'

import { Avatar } from '../components/Avatar.tsx'
import { buyCosmetic, equipCosmetic, useSession } from '../lib/auth.ts'

/** 슬롯마다 붙는 이름과, 그 슬롯이 `Equipped` 의 어느 칸인가. */
const LAYERS: { kind: CosmeticKind; title: string; slot: keyof Equipped }[] = [
  { kind: 'avatar', title: '아바타', slot: 'avatar' },
  { kind: 'bg', title: '프로필 배경', slot: 'bg' },
  { kind: 'effect', title: '이펙트', slot: 'effect' },
  { kind: 'banner', title: '배너', slot: 'banner' },
]

export function LooksPage() {
  const me = useSession()
  const [notice, setNotice] = useState('')
  /** 지금 서버에 묻고 있는 것. 두 번 눌러 두 번 사는 일이 없게 잠근다. */
  const [busy, setBusy] = useState('')

  if (!me) {
    return (
      <main className="page page--narrow">
        <Link className="link-back" to="/rooms">
          ← 방 목록으로
        </Link>
        <h1 className="section-title">상점</h1>
        <p className="empty">
          구매한 코스메틱은 계정에 저장됩니다.
          <br />
          게스트는 기본 프로필로만 참가합니다.
        </p>
      </main>
    )
  }

  const worn = me.cosmetics.equipped ?? DEFAULT_EQUIPPED
  const left = balanceOf(me.record.wins, me.cosmetics.spent)

  async function choose(id: string, slot: keyof Equipped, price: number, mine: boolean) {
    if (busy) return
    setBusy(id)
    setNotice('')
    // 미보유는 구매하고 나서 장착한다. 사자마자 장착하지 않으면 「샀는데 그대로」가 된다.
    const trouble = mine ? null : await buyCosmetic(id)
    if (trouble) {
      setBusy('')
      setNotice(trouble)
      return
    }
    const failed = await equipCosmetic({ [slot]: id })
    setBusy('')
    if (failed) setNotice(failed)
    else if (!mine) setNotice(`구매 완료 — ${price} 골드를 사용했습니다.`)
  }

  return (
    <main className="page page--narrow">
      <Link className="link-back" to="/rooms">
        ← 방 목록으로
      </Link>

      <h1 className="section-title">상점</h1>

      <section className="panel looks-me">
        <Avatar equipped={worn} size="lg" />
        <div className="looks-me__side">
          <p className="looks-me__name">{me.nickname}</p>
          {/*
            누적 승리와 보유 골드를 **나란히** 둔다. 같은 숫자에서 나오지만 다른 값이라,
            떨어뜨려 두면 「전적이 줄었다」로 읽힌다.
          */}
          <p className="looks-me__coin">
            보유 골드 <strong>{left}</strong>
          </p>
          <p className="looks-me__hint">
            누적 획득 {me.record.wins} · 사용 {me.cosmetics.spent}
          </p>
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}

      {LAYERS.map((layer) => (
        <section className="panel" key={layer.kind}>
          <h2 className="section-title">{layer.title}</h2>
          {/* 배너는 가로로 긴 것이라 좁은 칸에 넣으면 오른쪽 끝만 잘려 다 비슷해 보인다. */}
          <div className={`looks-grid ${layer.kind === 'banner' ? 'looks-grid--wide' : ''}`}>
            {cosmeticsOfKind(layer.kind).map((item) => {
              const mine = owns(me.cosmetics, item.id)
              const on = worn[layer.slot] === item.id
              const afford = mine || left >= item.price
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`looks-item ${on ? 'looks-item--on' : ''} ${afford ? '' : 'looks-item--locked'}`}
                  disabled={busy !== '' || (!afford && !mine)}
                  onClick={() => void choose(item.id, layer.slot, item.price, mine)}
                >
                  {/*
                    배너는 **깔릴 줄 그대로** 미리보기를 준다. 아바타 위에 얹어 보일 수 없는
                    슬롯이고, 좁은 칸에 우겨 넣으면 오른쪽 끝만 잘려 다 비슷해 보인다.
                  */}
                  {layer.kind === 'banner' ? (
                    <span className="looks-banner">
                      {item.id !== 'none-banner' && (
                        <span
                          className="player__banner"
                          style={{ backgroundImage: `url(/banners/${item.id}.svg)` }}
                        />
                      )}
                      <Avatar equipped={worn} size="sm" label={item.name} />
                      <span className="looks-item__name">{item.name}</span>
                      <span className="looks-item__price">
                        {on ? '장착 중' : mine ? '보유' : `${item.price} G`}
                      </span>
                    </span>
                  ) : (
                    <>
                      <Avatar
                        equipped={{ ...worn, [layer.slot]: item.id }}
                        size="md"
                        label={item.name}
                      />
                      <span className="looks-item__name">{item.name}</span>
                      {/* 보유한 것에는 가격을 적지 않는다. 이미 치른 값이라 지금 판단에 쓸모가 없다. */}
                      <span className="looks-item__price">
                        {on ? '장착 중' : mine ? '보유' : `${item.price} G`}
                      </span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <p className="looks-foot">1승당 1골드를 획득합니다.</p>
    </main>
  )
}
