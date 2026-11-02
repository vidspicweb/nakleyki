import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store'
import { importFile } from '../importer'
import { plural } from '../util'
import { blankPage, buildPdf, composeDisplay, download, dropSource, fullRender, loadFile, parseRanges, saveGroups } from '../pdftools/engine'
import type { Edit, PageRef, Source } from '../pdftools/engine'
import { CutDialog, EditDialog, FragmentsDialog } from '../pdftools/dialogs'
import type { CutScope } from '../pdftools/dialogs'
import { FULL, compose, rebase, toBase } from '../pdftools/geom'
import type { FRect } from '../pdftools/geom'
import { uid } from '../util'

type SplitMode = 'each' | 'every' | 'ranges' | 'selected'

export function PdfToolsPage({ goLibrary }: { goLibrary: () => void }) {
  const { state, update, toast } = useApp()
  const [sources] = useState(() => new Map<string, Source>())
  const [pages, setPagesRaw] = useState<PageRef[]>([])
  const [history, setHistory] = useState<PageRef[][]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [fileOver, setFileOver] = useState(false)
  const [split, setSplit] = useState(false)
  const [preview, setPreview] = useState<PageRef | null>(null)
  const [cutting, setCutting] = useState<PageRef | null>(null)
  const [fragmenting, setFragmenting] = useState<PageRef | null>(null)
  const [editing, setEditing] = useState<PageRef | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** Любое изменение листов запоминаем, чтобы можно было отменить. */
  const pagesRef = useRef<PageRef[]>([])
  pagesRef.current = pages
  const historyRef = useRef<PageRef[][]>([])
  historyRef.current = history
  const setPages = useCallback((next: PageRef[] | ((p: PageRef[]) => PageRef[])) => {
    const cur = pagesRef.current
    const n = typeof next === 'function' ? next(cur) : next
    if (n === cur) return
    pagesRef.current = n
    setHistory((h) => [...h.slice(-49), cur])
    setPagesRaw(n)
  }, [])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (!h.length) return
    const prev = h[h.length - 1]
    pagesRef.current = prev
    setPagesRaw(prev)
    setHistory(h.slice(0, -1))
  }, [])

  const sel = useMemo(() => new Set(selected), [selected])
  const selPages = pages.filter((p) => sel.has(p.key))

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    const added: PageRef[] = []
    for (const [i, f] of list.entries()) {
      setBusy(list.length > 1 ? `Открываем файл ${i + 1} из ${list.length}…` : `Открываем «${f.name}»…`)
      try {
        const { source, pages: ps } = await loadFile(f)
        sources.set(source.id, source)
        added.push(...ps)
        if (!name && !pages.length && i === 0) setName(source.name)
      } catch (e) {
        toast((e as Error).message || `Не получилось открыть «${f.name}»`, 'warn')
      }
    }
    setBusy(null)
    if (!added.length) return
    // вставляем после последнего выбранного листа, иначе — в конец
    const cur = pagesRef.current
    const lastSel = cur.reduce((acc, p, i) => (sel.has(p.key) ? i : acc), -1)
    setPages(lastSel >= 0 ? [...cur.slice(0, lastSel + 1), ...added, ...cur.slice(lastSel + 1)] : [...cur, ...added])
    toast(`Добавлено ${added.length} ${plural(added.length, 'лист', 'листа', 'листов')}` + (lastSel >= 0 ? ' после выбранного' : ''))
  }

  const rotate = (keys: string[], deg: number) => setPages((cur) => cur.map((p) => (keys.includes(p.key) ? { ...p, rot: (p.rot + deg + 360) % 360 } : p)))
  const remove = (keys: string[]) => {
    setPages((cur) => cur.filter((p) => !keys.includes(p.key)))
    setSelected((s) => s.filter((k) => !keys.includes(k)))
  }
  const duplicate = (keys: string[]) =>
    setPages((cur) => cur.flatMap((p) => (keys.includes(p.key) ? [p, { ...p, key: crypto.randomUUID?.() ?? Math.random().toString(36) }] : [p])))
  const addBlank = () => {
    const lastSel = pages.reduce((acc, p, i) => (sel.has(p.key) ? i : acc), -1)
    const like = pages[lastSel >= 0 ? lastSel : pages.length - 1]
    const b = blankPage(like)
    setPages((cur) => (lastSel >= 0 ? [...cur.slice(0, lastSel + 1), b, ...cur.slice(lastSel + 1)] : [...cur, b]))
  }

  /** Кусок листа (прямоугольник — как видно на экране) → новый лист. */
  const pieceOf = (p: PageRef, cell: FRect): PageRef => {
    const piece = toBase(cell, p.rot) // часть в координатах листа без поворота
    const crop = compose(p.crop ?? FULL, piece)
    const edits = p.edits?.map((e): Edit => (e.kind === 'copy' ? { kind: 'copy', from: rebase(e.from, piece), to: rebase(e.to, piece) } : { kind: 'erase', rect: rebase(e.rect, piece) }))
    return { ...p, key: uid(), crop, edits, w: crop.w * p.fw, h: crop.h * p.fh }
  }

  const cutFragments = (boxes: FRect[], keep: boolean, around: PageRef) => {
    const pieces = boxes.map((b) => pieceOf(around, b))
    setPages((cur) => cur.flatMap((p) => (p.key === around.key ? (keep ? [p, ...pieces] : pieces) : [p])))
    setSelected(pieces.map((p) => p.key))
    setFragmenting(null)
    toast(`Вырезано ${pieces.length} ${plural(pieces.length, 'фрагмент', 'фрагмента', 'фрагментов')} — они выделены синим. Отменить — «↶ Отменить»`)
  }

  /** Разрезаем листы: каждый превращается в несколько (части — как видно на экране). */
  const cutPages = (cells: FRect[], scope: CutScope, around: PageRef) => {
    const targets = new Set(scope === 'one' ? [around.key] : scope === 'selected' ? selected : pages.map((p) => p.key))
    let made = 0
    setPages((cur) =>
      cur.flatMap((p) => {
        if (!targets.has(p.key) || !p.src) return [p]
        return cells.map((cell) => {
          made++
          return pieceOf(p, cell)
        })
      }),
    )
    setSelected([])
    setCutting(null)
    setTimeout(() => toast(`Готово: получилось ${made} ${plural(made, 'лист', 'листа', 'листов')}. Отменить — «↶ Отменить»`), 0)
  }

  const clearAll = () => {
    if (pages.length && !confirm('Закрыть все листы? Несохранённые изменения пропадут.')) return
    for (const id of sources.keys()) dropSource(id)
    sources.clear()
    setPagesRaw([])
    setHistory([])
    setSelected([])
    setName('')
  }

  const click = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchor) {
      const a = pages.findIndex((p) => p.key === anchor)
      const b = pages.findIndex((p) => p.key === key)
      const range = pages.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.key)
      setSelected((s) => [...new Set([...s, ...range])])
    } else {
      setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))
      setAnchor(key)
    }
  }

  // перетаскивание листов мышкой
  const onDrop = (to: number) => {
    if (!dragKey) return
    const moving = sel.has(dragKey) ? pages.filter((p) => sel.has(p.key)) : pages.filter((p) => p.key === dragKey)
    const ids = new Set(moving.map((p) => p.key))
    const before = pages.slice(0, to).filter((p) => !ids.has(p.key))
    const after = pages.slice(to).filter((p) => !ids.has(p.key))
    setPages([...before, ...moving, ...after])
    setDragKey(null)
    setDropAt(null)
  }

  const fileName = (name.trim() || 'Документ').replace(/[\\/:*?"<>|]+/g, '-')

  const save = async (list: PageRef[], suffix = '') => {
    setBusy('Собираем PDF…')
    try {
      download(await buildPdf(list, sources), fileName + suffix + '.pdf')
    } catch (e) {
      toast('Не удалось собрать PDF: ' + (e as Error).message, 'warn')
    }
    setBusy(null)
  }

  const toLibrary = async () => {
    const list = selPages.length ? selPages : pages
    setBusy('Добавляем в библиотеку наклеек…')
    try {
      const bytes = await buildPdf(list, sources)
      const file = new File([bytes as BlobPart], fileName + '.pdf', { type: 'application/pdf' })
      const { template, sheets } = await importFile(file, { tags: [], baseLayout: state.lastLayout })
      update((d) => {
        d.templates.push(template)
        d.sheets.push(...sheets)
      })
      toast(`В библиотеку добавлено ${sheets.length} ${plural(sheets.length, 'шаблон', 'шаблона', 'шаблонов')}`)
    } catch (e) {
      toast('Не получилось: ' + (e as Error).message, 'warn')
    }
    setBusy(null)
  }

  // горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || split || preview || cutting || editing || fragmenting) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') (e.preventDefault(), undo())
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'ф') && pages.length) (e.preventDefault(), setSelected(pages.map((p) => p.key)))
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) (e.preventDefault(), remove(selected))
      else if (e.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // предупреждение при закрытии вкладки
  useEffect(() => {
    if (!pages.length) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [pages.length])

  const input = (
    <input
      ref={fileRef}
      type="file"
      hidden
      multiple
      accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
      onChange={(e) => e.target.files && addFiles(e.target.files).then(() => (e.target.value = ''))}
    />
  )

  if (!pages.length)
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Работа с PDF</h1>
            <p className="lead">Удалить или добавить листы, поменять порядок, повернуть, объединить несколько файлов или разделить один на части. Всё происходит на вашем компьютере — файлы никуда не отправляются.</p>
          </div>
        </div>
        <div
          className={'dropzone big-drop' + (fileOver ? ' drag' : '')}
          onDragOver={(e) => (e.preventDefault(), setFileOver(true))}
          onDragLeave={() => setFileOver(false)}
          onDrop={(e) => (e.preventDefault(), setFileOver(false), addFiles(e.dataTransfer.files))}
          onClick={() => !busy && fileRef.current?.click()}
        >
          {input}
          {busy ? (
            <>
              <div className="spinner" />
              <b>{busy}</b>
            </>
          ) : (
            <>
              <div className="drop-icon">📄</div>
              <b>Перетащите сюда PDF или картинки</b>
              <span className="muted">или нажмите, чтобы выбрать · можно сразу несколько файлов — они объединятся</span>
            </>
          )}
        </div>
        <div className="tool-cards">
          {[
            ['🗑', 'Удалить листы', 'Выберите лишние листы и нажмите «Удалить»'],
            ['↕️', 'Поменять порядок', 'Перетаскивайте листы мышкой'],
            ['➕', 'Добавить листы', 'Из другого PDF, картинки или пустой лист'],
            ['🔗', 'Объединить файлы', 'Откройте несколько PDF сразу'],
            ['⬚', 'Вырезать фрагменты', 'Обведите рамкой нужную часть листа — она станет отдельным листом'],
            ['✂️', 'Разделить PDF', 'По одному листу, по диапазонам или по N листов'],
            ['⟳', 'Повернуть', 'Если лист отсканирован боком'],
          ].map(([icon, t, d]) => (
            <div key={t} className="tool-card">
              <span className="tool-icon">{icon}</span>
              <b>{t}</b>
              <span className="muted tiny">{d}</span>
            </div>
          ))}
        </div>
      </div>
    )

  const n = selected.length

  return (
    <div
      className="page pdf-tools"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) (e.preventDefault(), setFileOver(true))
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setFileOver(false)
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) (e.preventDefault(), setFileOver(false), addFiles(e.dataTransfer.files))
      }}
    >
      {input}
      <div className="page-head">
        <div className="doc-title">
          <span className="muted tiny">Название файла</span>
          <input className="title-input big" value={name} placeholder="Документ" onChange={(e) => setName(e.target.value)} />
          <span className="muted tiny">
            {pages.length} {plural(pages.length, 'лист', 'листа', 'листов')} · перетаскивайте листы, чтобы поменять порядок
          </span>
        </div>
        <div className="row gap-s wrap">
          <button className="btn ghost" onClick={() => setSplit(true)}>
            ✂️ Разделить…
          </button>
          <button className="btn primary big" onClick={() => save(pages)} disabled={!!busy}>
            ⬇ Скачать PDF
          </button>
        </div>
      </div>

      <div className="pdf-toolbar">
        <div className="row gap-s wrap">
          <button className="btn soft small" onClick={() => fileRef.current?.click()}>
            ➕ Добавить файлы
          </button>
          <button className="btn ghost small" onClick={addBlank}>
            ⬜ Пустой лист
          </button>
          <button className="btn ghost small" onClick={undo} disabled={!history.length} title="Ctrl+Z">
            ↶ Отменить
          </button>
        </div>
        <div className="row gap-s wrap sel-actions">
          {n === 0 ? (
            <>
              <span className="muted tiny">Нажмите на лист, чтобы выбрать. Наведите на лист: ✂ — вырезать фрагменты, ✏️ — править.</span>
              <button className="link-btn" onClick={() => setSelected(pages.map((p) => p.key))}>
                Выбрать все
              </button>
            </>
          ) : (
            <>
              <b className="sel-count">Выбрано: {n}</b>
              <button className="btn ghost small" onClick={() => rotate(selected, -90)} title="Повернуть влево">
                ⟲
              </button>
              <button className="btn ghost small" onClick={() => rotate(selected, 90)} title="Повернуть вправо">
                ⟳
              </button>
              <button className="btn ghost small" onClick={() => duplicate(selected)}>
                ⧉ Дублировать
              </button>
              <button className="btn ghost small" onClick={() => setCutting(selPages.find((p) => p.src) ?? null)} disabled={!selPages.some((p) => p.src)}>
                ✂ Разрезать линиями
              </button>
              {n === 1 && selPages[0].src && (
                <button className="btn ghost small" onClick={() => setFragmenting(selPages[0])}>
                  ⬚ Вырезать фрагменты
                </button>
              )}
              {n === 1 && selPages[0].src && (
                <button className="btn ghost small" onClick={() => setEditing(selPages[0])}>
                  ✏️ Править
                </button>
              )}
              <button className="btn ghost small" onClick={() => save(selPages, ' (выбранные листы)')}>
                📤 Сохранить выбранные
              </button>
              <button className="btn ghost small danger" onClick={() => remove(selected)}>
                🗑 Удалить
              </button>
              <button className="link-btn" onClick={() => setSelected([])}>
                Снять выбор
              </button>
            </>
          )}
        </div>
      </div>

      <div className={'page-grid' + (fileOver ? ' file-over' : '')}>
        {pages.map((p, i) => (
          <div
            key={p.key}
            className={'pg' + (sel.has(p.key) ? ' on' : '') + (dragKey === p.key ? ' dragging' : '') + (dropAt === i ? ' drop-before' : '')}
            draggable
            onDragStart={(e) => {
              setDragKey(p.key)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => (setDragKey(null), setDropAt(null))}
            onDragOver={(e) => {
              if (!dragKey) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1)
            }}
            onDrop={(e) => {
              if (!dragKey) return
              e.preventDefault()
              e.stopPropagation()
              onDrop(dropAt ?? i)
            }}
            onClick={(e) => click(e, p.key)}
            onDoubleClick={() => setPreview(p)}
          >
            <div className="pg-thumb">
              <PageThumb page={p} />
              <span className="pg-check">{sel.has(p.key) ? '✓' : ''}</span>
              <div className="pg-actions" onClick={(e) => e.stopPropagation()}>
                <button title="Посмотреть крупно" onClick={() => setPreview(p)}>🔍</button>
                <button title="Повернуть" onClick={() => rotate([p.key], 90)}>⟳</button>
                {p.src && <button title="Вырезать фрагменты" onClick={() => setFragmenting(p)}>✂</button>}
                {p.src && <button title="Править: дублировать или убрать элементы" onClick={() => setEditing(p)}>✏️</button>}
                <button title="Дублировать" onClick={() => duplicate([p.key])}>⧉</button>
                <button title="Удалить" onClick={() => remove([p.key])}>🗑</button>
              </div>
            </div>
            <span className="pg-num">{i + 1}</span>
          </div>
        ))}
        <div
          className={'pg add-tile' + (dropAt === pages.length ? ' drop-before' : '')}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            if (!dragKey) return
            e.preventDefault()
            setDropAt(pages.length)
          }}
          onDrop={(e) => {
            if (!dragKey) return
            e.preventDefault()
            e.stopPropagation()
            onDrop(pages.length)
          }}
        >
          <span>➕</span>
          <b>Добавить</b>
          <small className="muted">PDF или картинку</small>
        </div>
      </div>

      <div className="pdf-footer">
        <button className="btn ghost small" onClick={toLibrary} disabled={!!busy}>
          🏷 {n ? 'Выбранные листы' : 'Этот PDF'} — в библиотеку наклеек
        </button>
        <button className="link-btn" onClick={goLibrary}>
          Открыть библиотеку
        </button>
        <span className="grow" />
        <button className="btn ghost small danger" onClick={clearAll}>
          Закрыть всё
        </button>
      </div>

      {busy && (
        <div className="busy-float">
          <span className="mini-spin" /> {busy}
        </div>
      )}
      {split && <SplitDialog pages={pages} selected={selPages} close={() => setSplit(false)} run={async (groups) => {
        setSplit(false)
        setBusy('Разделяем…')
        try {
          await saveGroups(groups, sources, fileName, (i, total) => setBusy(`Разделяем: часть ${i} из ${total}…`))
          toast(groups.length > 1 ? `Готово: ${groups.length} файлов в архиве .zip` : 'Готово')
        } catch (e) {
          toast('Не получилось: ' + (e as Error).message, 'warn')
        }
        setBusy(null)
      }} />}
      {preview && <PreviewModal page={preview} close={() => setPreview(null)} />}
      {cutting && (
        <CutDialog
          page={cutting}
          selectedCount={selPages.filter((p) => p.src).length}
          allCount={pages.filter((p) => p.src).length}
          close={() => setCutting(null)}
          apply={(cells, scope) => cutPages(cells, scope, cutting)}
        />
      )}
      {fragmenting && (
        <FragmentsDialog
          page={fragmenting}
          close={() => setFragmenting(null)}
          apply={(boxes, keep) => cutFragments(boxes, keep, fragmenting)}
          openLines={() => {
            setCutting(fragmenting)
            setFragmenting(null)
          }}
        />
      )}
      {editing && (
        <EditDialog
          page={editing}
          close={() => setEditing(null)}
          save={(edits) => {
            setPages((cur) => cur.map((p) => (p.key === editing.key ? { ...p, edits } : p)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** Миниатюра листа (с обрезкой, правками и поворотом). Рисуем, только когда лист появился на экране. */
function PageThumb({ page, width = 150 }: { page: PageRef; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const turned = page.rot % 180 !== 0
  const boxW = width
  const boxH = turned ? (width * page.w) / page.h : (width * page.h) / page.w

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setVisible(true), io.disconnect()), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !page.src) return
    let alive = true
    const px = width * Math.min(2, devicePixelRatio || 1)
    fullRender(page, turned ? (px * page.w) / page.h : px)
      .then((full) => alive && setUrl(composeDisplay(full, page, px).toDataURL('image/jpeg', 0.85)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [visible, page, width, turned])

  return (
    <div ref={ref} className="pg-img" style={{ width: boxW, height: boxH }}>
      {!page.src ? <div className="blank-page">пустой лист</div> : url ? <img src={url} alt="" draggable={false} /> : <div className="sheet-loading" />}
      {page.edits?.length ? <span className="pg-badge">✏️</span> : null}
    </div>
  )
}

function PreviewModal({ page, close }: { page: PageRef; close: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [close])
  const w = Math.min(760, window.innerWidth - 80, ((window.innerHeight - 120) * (page.rot % 180 ? page.h : page.w)) / (page.rot % 180 ? page.w : page.h))
  return createPortal(
    <div className="modal-back" onClick={close}>
      <div className="preview-box" onClick={(e) => e.stopPropagation()}>
        <PageThumb page={page} width={w} />
        <button className="btn ghost small" onClick={close}>
          Закрыть
        </button>
      </div>
    </div>,
    document.body,
  )
}

function SplitDialog({ pages, selected, close, run }: { pages: PageRef[]; selected: PageRef[]; close: () => void; run: (groups: PageRef[][]) => void }) {
  const [mode, setMode] = useState<SplitMode>(selected.length ? 'selected' : 'each')
  const [every, setEvery] = useState(2)
  const [ranges, setRanges] = useState('')
  const total = pages.length

  let groups: PageRef[][] = []
  let error: string | null = null
  try {
    if (mode === 'each') groups = pages.map((p) => [p])
    else if (mode === 'every') for (let i = 0; i < total; i += Math.max(1, every)) groups.push(pages.slice(i, i + Math.max(1, every)))
    else if (mode === 'ranges') groups = parseRanges(ranges, total).map((g) => g.map((n) => pages[n - 1]))
    else {
      if (!selected.length) throw new Error('Сначала выберите листы (закройте окно и нажмите на нужные листы)')
      groups = [selected]
    }
  } catch (e) {
    error = (e as Error).message
  }

  const opt = (m: SplitMode, title: string, body?: React.ReactNode) => (
    <label className={'split-opt' + (mode === m ? ' on' : '')}>
      <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
      <div>
        <b>{title}</b>
        {mode === m && body}
      </div>
    </label>
  )

  return createPortal(
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>✂️ Разделить PDF</h2>
        <p className="muted">
          В документе {total} {plural(total, 'лист', 'листа', 'листов')}. Как разделить?
        </p>
        {opt('each', 'Каждый лист — отдельный файл')}
        {opt(
          'every',
          'По несколько листов в файле',
          <div className="row gap-s" style={{ marginTop: 6 }}>
            <span className="muted tiny">по</span>
            <input className="num-input" type="number" min={1} max={total} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value || 1))} />
            <span className="muted tiny">{plural(every, 'листу', 'листа', 'листов')}</span>
          </div>,
        )}
        {opt(
          'ranges',
          'Свои части (диапазоны)',
          <div style={{ marginTop: 6 }}>
            <input className="range-input" value={ranges} placeholder="например: 1-3, 4-6, 7" onChange={(e) => setRanges(e.target.value)} autoFocus />
            <div className="muted tiny">Каждая часть через запятую станет отдельным файлом.</div>
          </div>,
        )}
        {opt('selected', `Только выбранные листы — одним файлом${selected.length ? ` (${selected.length})` : ''}`)}
        {error ? (
          mode !== 'ranges' || ranges ? <div className="cloud-status error">{error}</div> : null
        ) : (
          <div className="muted tiny">
            Получится: <b>{groups.length}</b> {plural(groups.length, 'файл', 'файла', 'файлов')}
            {groups.length > 1 ? ' — скачаются одним архивом .zip' : ''}
          </div>
        )}
        <div className="row end gap-s">
          <button className="btn ghost" onClick={close}>
            Отмена
          </button>
          <button className="btn primary" disabled={!!error || !groups.length} onClick={() => run(groups)}>
            Разделить и скачать
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
