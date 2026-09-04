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
 *
 * **구매는 확인을 거치고 장착은 안 거친다.** 장착은 언제든 되돌릴 수 있지만 구매는
 * 되돌릴 길이 없고(환불이 없다), 40골드짜리가 25골드짜리 옆 칸에 서 있다. 잘못 누르면
 * 40승어치가 그대로 나간다. 반대로 장착까지 물으면 차림을 맞춰 보는 동안 창이 계속 뜬다.
 *
 * **넓은 화면은 두 칸이다.** 왼쪽에 지금 차림을 붙박아 두고 오른쪽에서 고른다 —
 * 네 슬롯의 조합이 이 게임의 꾸미기라, 고른 것이 즉시 얹히는 것을 보면서 골라야 한다.
 * 좁은 화면은 세로로 쌓이던 그대로다(`.looks-layout`).
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_EQUIPPED,
  balanceOf,
  cosmeticsOfKind,
  owns,
  type CosmeticItem,
  type CosmeticKind,
  type Equipped,
} from '@the-gang/shared'

import { Avatar } from '../components/Avatar.tsx'
import { ConfirmModal } from '../components/Modal.tsx'
import { buyCosmetic, equipCosmetic, useSession } from '../lib/auth.ts'

/** 슬롯마다 붙는 이름과, 그 슬롯이 `Equipped` 의 어느 칸인가. */
const LAYERS: { kind: CosmeticKind; title: string; slot: keyof Equipped }[] = [
  { kind: 'avatar', title: '아바타', slot: 'avatar' },
  { kind: 'bg', title: '프로필 배경', slot: 'bg' },
  { kind: 'effect', title: '이펙트', slot: 'effect' },
  { kind: 'banner', title: '배너', slot: 'banner' },
]

/** 확인을 기다리는 구매. 어느 슬롯에 얹을지까지 들고 있어야 사고 나서 장착한다. */
interface Pending {
  item: CosmeticItem
  slot: keyof Equipped
}

export function LooksPage() {
  const me = useSession()
  const [notice, setNotice] = useState('')
  /** 지금 서버에 묻고 있는 것. 두 번 눌러 두 번 사는 일이 없게 잠근다. */
  const [busy, setBusy] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)

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

  /** 이미 가진 것을 장착한다. 값이 오가지 않으므로 묻지 않는다. */
  async function equipOnly(id: string, slot: keyof Equipped) {
    if (busy) return
    setBusy(id)
    setNotice('')
    const failed = await equipCosmetic({ [slot]: id })
    setBusy('')
    if (failed) setNotice(failed)
  }

  /** 확인을 받은 구매. 사고 나서 장착한다 — 사자마자 장착하지 않으면 「샀는데 그대로」가 된다. */
  async function confirmBuy() {
    if (!pending || busy) return
    const { item, slot } = pending
    setBusy(item.id)
    setNotice('')
    const trouble = await buyCosmetic(item.id)
    if (trouble) {
      setBusy('')
      setPending(null)
      setNotice(trouble)
      return
    }
    const failed = await equipCosmetic({ [slot]: item.id })
    setBusy('')
    setPending(null)
    setNotice(failed ? failed : `구매 완료 — ${item.price} 골드를 사용했습니다.`)
  }

  return (
    <main className="page looks-page">
      <Link className="link-back" to="/rooms">
        ← 방 목록으로
      </Link>

      <h1 className="section-title">상점</h1>

      <div className="looks-layout">
        {/*
          넓은 화면에서는 이 칸이 붙박이다(sticky). 오른쪽을 내리며 골라도 지금 차림과
          남은 골드가 눈에서 사라지지 않아야 한다 — 값을 쓰는 화면이다.
        */}
        <div className="looks-side">
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

          {/*
            안내는 붙박이 칸 안에 둔다. 오른쪽에 두면 격자를 내리는 사이에 스크롤 밖으로
            밀려나, 거절 사유가 화면에 있는데도 안 보인다.
          */}
          {notice && <p className="notice">{notice}</p>}

          <p className="looks-foot">1승당 1골드를 획득합니다.</p>
        </div>

        <div className="looks-main">
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
                      onClick={() =>
                        mine
                          ? void equipOnly(item.id, layer.slot)
                          : setPending({ item, slot: layer.slot })
                      }
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
        </div>
      </div>

      {pending && (
        <ConfirmModal
          title="구매하시겠습니까?"
          confirmLabel="구매"
          cancelLabel="취소"
          busyLabel="구매하는 중…"
          busy={busy !== ''}
          onConfirm={() => void confirmBuy()}
          onCancel={() => setPending(null)}
        >
          {/*
            **입혀 본 모습으로 보여준다.** 목록의 작은 칸에서 고른 것이라, 사기 전에
            제 크기로 한 번은 봐야 한다. 배너는 아바타에 얹을 수 없어 깔릴 줄 그대로다.
          */}
          <div className="buy-preview">
            {pending.item.kind === 'banner' ? (
              <span className="looks-banner">
                {pending.item.id !== 'none-banner' && (
                  <span
                    className="player__banner"
                    style={{ backgroundImage: `url(/banners/${pending.item.id}.svg)` }}
                  />
                )}
                <Avatar equipped={worn} size="sm" />
              </span>
            ) : (
              <Avatar equipped={{ ...worn, [pending.slot]: pending.item.id }} size="lg" />
            )}
            <div className="buy-preview__side">
              <p className="buy-preview__name">{pending.item.name}</p>
              <p className="buy-preview__price">{pending.item.price} G</p>
            </div>
          </div>
          {/*
            **치르고 나서 얼마가 남는지까지 보인다.** 되돌릴 수 없는 값이라 「지금 얼마인가」
            보다 「쓰고 나면 얼마인가」가 판단에 쓰이는 값이다.
          */}
          <p className="buy-after">
            보유 골드 {left} <span aria-hidden="true">→</span>{' '}
            <strong>{left - pending.item.price}</strong>
          </p>
        </ConfirmModal>
      )}
    </main>
  )
}
