import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'только что'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} мин назад` : new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Общая библиотека на Яндекс Диске владельца.
 * Владелец входит один раз и делится ссылкой; сотрудники просто открывают ссылку.
 */
export function CloudButton() {
  const { cloud, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    const t = window.setInterval(() => tick((x) => x + 1), 20_000)
    return () => (document.removeEventListener('mousedown', close), window.clearInterval(t))
  }, [open])

  if (!cloud.configured) return null

  const st = cloud.status
  const owner = cloud.role === 'owner'
  let label: React.ReactNode = '☁ Общая библиотека'
  let cls = 'cloud-btn'
  if (cloud.connected) {
    if (st.kind === 'busy') ((label = <><span className="mini-spin" /> Сохраняем…</>), (cls += ' busy'))
    else if (st.kind === 'error') ((label = '⚠ Диск: ошибка'), (cls += ' err'))
    else ((label = '☁ Сохранено'), (cls += ' ok'))
  }

  const daysLeft = cloud.expiresAt ? Math.floor((cloud.expiresAt - Date.now()) / 864e5) : null

  const copy = async () => {
    const link = cloud.shareLink()
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      prompt('Скопируйте ссылку:', link)
    }
    setCopied(true)
    toast('Ссылка скопирована — отправьте её сотруднику')
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div className="cloud" ref={ref}>
      <button className={cls} onClick={() => setOpen((o) => !o)} title="Общая библиотека на Яндекс Диске">
        {label}
      </button>
      {open && (
        <div className="settings-pop cloud-pop">
          <div className="cloud-head">
            <span className="ya-logo">Я</span>
            <div>
              <div className="settings-title">Общая библиотека</div>
              <div className="muted tiny">
                {!cloud.connected ? 'не подключена' : owner ? `Ваш Диск${cloud.user ? ' · ' + cloud.user.name : ''}` : 'на Диске владельца'}
              </div>
            </div>
          </div>

          {!cloud.connected ? (
            <>
              <p className="muted tiny">
                <b>Вам дали ссылку?</b> Просто откройте её — больше ничего делать не нужно.
              </p>
              <div className="divider" />
              <p className="muted tiny">
                <b>Вы владелец библиотеки?</b> Подключите свой Яндекс Диск: шаблоны, ученики и настройки будут храниться в папке «Приложения › Наклейки», а сотрудникам вы отправите ссылку.
              </p>
              <button className="btn primary full" onClick={() => cloud.login()}>
                Подключить мой Яндекс Диск
              </button>
            </>
          ) : (
            <>
              <div className={'cloud-status ' + st.kind}>
                {st.kind === 'busy' && st.msg}
                {st.kind === 'ok' && <>✓ Всё сохранено · {ago(st.at)}</>}
                {st.kind === 'error' && st.msg}
                {st.kind === 'off' && 'Подключаемся…'}
              </div>

              {owner && (
                <>
                  {cloud.user && cloud.user.totalMb > 0 && (
                    <div className="disk-space">
                      <div className="bar">
                        <div style={{ width: `${Math.min(100, (cloud.user.usedMb / cloud.user.totalMb) * 100)}%` }} />
                      </div>
                      <span className="muted tiny">
                        На Диске занято {(cloud.user.usedMb / 1024).toFixed(1)} ГБ из {(cloud.user.totalMb / 1024).toFixed(0)} ГБ
                      </span>
                    </div>
                  )}
                  <div className="share-box">
                    <b>🔗 Ссылка для сотрудника</b>
                    <span className="muted tiny">Кто откроет её, сможет работать с этой библиотекой без входа. Доступ — только к папке «Приложения › Наклейки», остальные ваши файлы не видны.</span>
                    <button className="btn primary full" onClick={copy}>
                      {copied ? '✓ Скопировано' : 'Скопировать ссылку'}
                    </button>
                    <span className="muted tiny">
                      Отправляйте только своим людям. Чтобы отключить все ссылки — отзовите доступ приложения «Наклейки» в настройках Яндекс ID и подключите Диск заново.
                    </span>
                  </div>
                </>
              )}
              {daysLeft !== null && daysLeft < 30 && (
                <div className="hint">
                  Доступ к Диску закончится через {Math.max(0, daysLeft)} дн.{' '}
                  {owner ? 'Подключите Диск заново и отправьте сотрудникам новую ссылку.' : 'Попросите у владельца новую ссылку.'}
                </div>
              )}
              <p className="muted tiny">Папка на Диске: Приложения › Наклейки. Изменения сохраняются сами через пару секунд.</p>
              <button className="btn soft full" onClick={cloud.syncNow} disabled={st.kind === 'busy'}>
                ⟳ Синхронизировать сейчас
              </button>
              <button
                className="btn ghost full"
                onClick={() => {
                  if (confirm('Отключить общую библиотеку на этом компьютере? Шаблоны на Диске останутся.')) (cloud.logout(), setOpen(false))
                }}
              >
                Отключить на этом компьютере
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
