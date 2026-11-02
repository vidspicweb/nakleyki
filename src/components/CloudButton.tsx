import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { FolderPicker } from './FolderPicker'
import { prettyRoot } from '../cloud/sync'

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'только что'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} мин назад` : new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Кнопка «Яндекс Диск» в шапке: вход, состояние синхронизации, выход. */
export function CloudButton() {
  const { cloud } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)
  const [picker, setPicker] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    const t = window.setInterval(() => tick((x) => x + 1), 20_000)
    return () => (document.removeEventListener('mousedown', close), window.clearInterval(t))
  }, [open])

  const st = cloud.status
  let label: React.ReactNode = '☁ Яндекс Диск'
  let cls = 'cloud-btn'
  if (cloud.connected) {
    if (st.kind === 'busy') ((label = <><span className="mini-spin" /> Сохраняем…</>), (cls += ' busy'))
    else if (st.kind === 'error') ((label = '⚠ Диск: ошибка'), (cls += ' err'))
    else ((label = '☁ Сохранено'), (cls += ' ok'))
  }

  return (
    <div className="cloud" ref={ref}>
      {picker && <FolderPicker close={() => setPicker(false)} />}
      <button className={cls} onClick={() => setOpen((o) => !o)} title="Хранение на Яндекс Диске">
        {label}
      </button>
      {open && (
        <div className="settings-pop cloud-pop">
          <div className="cloud-head">
            <span className="ya-logo">Я</span>
            <div>
              <div className="settings-title">Яндекс Диск</div>
              <div className="muted tiny">{cloud.connected ? (cloud.user ? cloud.user.name : 'подключён') : 'не подключён'}</div>
            </div>
          </div>

          {!cloud.configured ? (
            <p className="muted tiny">Хранение на Яндекс Диске ещё не настроено для этого сайта. Пока всё сохраняется в браузере на этом компьютере.</p>
          ) : !cloud.connected ? (
            <>
              <ul className="cloud-list">
                <li>Библиотека, ученики и настройки будут храниться на вашем Яндекс Диске</li>
                <li>Войдите на любом компьютере — и всё будет на месте</li>
                <li>Программа видит только свою папку «Приложения» на Диске, остальные ваши файлы ей недоступны</li>
              </ul>
              <button className="btn primary full" onClick={() => cloud.login()}>
                Войти через Яндекс
              </button>
            </>
          ) : (
            <>
              <div className={'cloud-status ' + st.kind}>
                {st.kind === 'busy' && st.msg}
                {st.kind === 'ok' && <>✓ Всё сохранено на Диске · {ago(st.at)}</>}
                {st.kind === 'error' && st.msg}
                {st.kind === 'error' && st.scope && (
                  <div className="row gap-s wrap" style={{ marginTop: 6 }}>
                    <button className="btn primary small" onClick={() => cloud.login(true)}>Войти заново</button>
                    <button className="btn ghost small" onClick={() => (setPicker(true), setOpen(false))}>Выбрать папку</button>
                  </div>
                )}
                {st.kind === 'off' && 'Подключаемся…'}
              </div>
              {cloud.user && cloud.user.totalMb > 0 && (
                <div className="disk-space">
                  <div className="bar">
                    <div style={{ width: `${Math.min(100, (cloud.user.usedMb / cloud.user.totalMb) * 100)}%` }} />
                  </div>
                  <span className="muted tiny">
                    Занято {(cloud.user.usedMb / 1024).toFixed(1)} ГБ из {(cloud.user.totalMb / 1024).toFixed(0)} ГБ
                  </span>
                </div>
              )}
              <div className="folder-line">
                <span className="muted tiny">Папка на Диске:</span>
                <b>📁 {prettyRoot(cloud.root)}</b>
                <button className="link-btn" onClick={() => (setPicker(true), setOpen(false))}>
                  Изменить
                </button>
              </div>
              <p className="muted tiny">Изменения сохраняются сами через пару секунд.</p>
              <button className="btn soft full" onClick={cloud.syncNow} disabled={st.kind === 'busy'}>
                ⟳ Синхронизировать сейчас
              </button>
              <button className="btn ghost full" onClick={() => (cloud.logout(), setOpen(false))}>
                Отключить Диск
              </button>
            </>
          )}
          {cloud.connected === false && cloud.configured && st.kind === 'error' && <div className="cloud-status error">{st.msg}</div>}
        </div>
      )}
    </div>
  )
}
