import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store'
import { DEFAULT_ROOT, prettyRoot } from '../cloud/sync'
import { ScopeError } from '../cloud/yadisk'

/** Выбор папки на Яндекс Диске, куда сохранять библиотеку. */
export function FolderPicker({ close }: { close: () => void }) {
  const { cloud } = useApp()
  const [path, setPath] = useState(cloud.root === DEFAULT_ROOT ? 'disk:/' : cloud.root)
  const [items, setItems] = useState<string[] | null>(null)
  const [err, setErr] = useState<'scope' | string | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    let alive = true
    setItems(null)
    setErr(null)
    cloud
      .folders(path)
      .then((f) => alive && setItems(f))
      .catch((e) => alive && setErr(e instanceof ScopeError ? 'scope' : (e as Error).message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const parts = path.replace(/^disk:\/?/, '').split('/').filter(Boolean)
  const go = (i: number) => setPath('disk:/' + parts.slice(0, i).join('/'))
  const child = (n: string) => (path.endsWith('/') ? path : path + '/') + n

  const create = async () => {
    const n = name.trim().replace(/[\\/]/g, '-')
    if (!n) return
    try {
      await cloud.mkdir(child(n))
      setName('')
      setPath(child(n))
    } catch (e) {
      setErr(e instanceof ScopeError ? 'scope' : (e as Error).message)
    }
  }

  // окно рисуем поверх всей страницы, а не внутри шапки
  return createPortal(
    <div className="modal-back" onClick={close}>
      <div className="modal folder-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Где хранить библиотеку на Диске</h2>

        <button className={'folder-option' + (cloud.root === DEFAULT_ROOT ? ' on' : '')} onClick={() => (cloud.root !== DEFAULT_ROOT && cloud.setRoot(DEFAULT_ROOT), close())}>
          <b>📁 Папка приложения</b>
          <span className="muted tiny">Приложения › Наклейки — программа видит только её. Самый безопасный вариант.</span>
        </button>

        <div className="folder-option static">
          <b>🗂 Своя папка</b>
          <span className="muted tiny">Например «Школа › Наклейки». Нужно разрешить программе доступ к Диску.</span>

          {err === 'scope' ? (
            <div className="hint">
              Сейчас у программы нет доступа к вашим папкам — только к папке приложения.
              <br />
              Нажмите «Войти заново» и разрешите доступ к Диску. Если Яндекс не предложит такой доступ — его ещё не включили в настройках приложения.
              <button className="btn primary small full" style={{ marginTop: 8 }} onClick={() => cloud.login(true)}>
                Войти заново
              </button>
            </div>
          ) : (
            <>
              <div className="crumbs">
                <button onClick={() => go(0)}>Диск</button>
                {parts.map((p, i) => (
                  <span key={i}>
                    › <button onClick={() => go(i + 1)}>{p}</button>
                  </span>
                ))}
              </div>
              <div className="folder-list">
                {err && <div className="cloud-status error">{err}</div>}
                {!items && !err && <div className="muted pad center">Загружаем папки…</div>}
                {items?.length === 0 && <div className="muted pad center">Здесь нет папок</div>}
                {items?.map((f) => (
                  <button key={f} className="folder-item" onClick={() => setPath(child(f))}>
                    📁 {f}
                  </button>
                ))}
              </div>
              <div className="tag-new">
                <input value={name} placeholder="Новая папка, например «Наклейки»" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
                <button className="btn soft small" onClick={create} disabled={!name.trim()}>
                  Создать
                </button>
              </div>
              <button
                className="btn primary full"
                disabled={!parts.length || !!err}
                onClick={() => {
                  cloud.setRoot(path)
                  close()
                }}
              >
                {parts.length ? `Сохранять в «${prettyRoot(path)}»` : 'Выберите или создайте папку'}
              </button>
            </>
          )}
        </div>

        <p className="muted tiny">После смены папки библиотека с этого компьютера скопируется в новую папку. Старая папка останется на Диске как есть.</p>
        <div className="row end">
          <button className="btn ghost" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
