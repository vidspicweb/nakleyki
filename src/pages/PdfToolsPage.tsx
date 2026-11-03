import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store'
import { importFile } from '../importer'
import { plural } from '../util'
import { blankPage, buildPdf, download, dropSource, fragSize, loadFile, parseRanges, renderDisplay, saveGroups } from '../pdftools/engine'
import type { Edit, FragmentRef, PageRef, Source } from '../pdftools/engine'
import { CopyMode, CutMode, FragmentsMode } from '../pdftools/dialogs'
import type { CutScope, EditorCommon, EditorMode } from '../pdftools/dialogs'
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
  /** Открытый редактор листа: какой лист и какая вкладка */
  const [editor, setEditor] = useState<{ key: string; mode: EditorMode; paste?: boolean } | null>(null)
  const [thumbW, setThumbW] = useState(() => {
    try {
      return Number(localStorage.getItem('nakl-thumb')) || 150
    } catch {
      return 150
    }
  })
  const [clip, setClip] = useState<FragmentRef | null>(null)
  const [clipUrl, setClipUrl] = useState<string | null>(null)
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
    const edits = p.edits?.map((e): Edit =>
      e.kind === 'copy' ? { ...e, from: rebase(e.from, piece), to: rebase(e.to, piece) } : e.kind === 'place' ? { ...e, to: rebase(e.to, piece) } : { ...e, rect: rebase(e.rect, piece) },
    )
    return { ...p, key: uid(), crop, edits, w: crop.w * p.fw, h: crop.h * p.fh }
  }

  /** Кладём фрагмент в «буфер»: его можно вставлять на любые листы сколько угодно раз. */
  const copyFragment = (f: FragmentRef) => {
    setClip(f)
    // маленькая картинка фрагмента для плашки внизу
    const fs = fragSize(f)
    const probe: PageRef = { key: 'clip', src: f.src, index: f.index, rot: f.viewRot, w: f.rect.w * f.fw, h: f.rect.h * f.fh, fw: f.fw, fh: f.fh, crop: f.rect }
    renderDisplay(probe, fs.w >= fs.h ? 120 : (120 * fs.w) / fs.h)
      .then((c) => setClipUrl(c.toDataURL('image/png')))
      .catch(() => setClipUrl(null))
    toast('Фрагмент скопирован — его можно вставить на любой лист')
  }

  /** Новый пустой лист сразу с вставленным фрагментом. */
  const pasteToNewPage = () => {
    if (!clip) return
    const fs = fragSize(clip)
    const b = blankPage(fs.w > fs.h * 1.15 ? { ...blankPage(), w: 842, h: 595 } as PageRef : undefined)
    const lastSel = pagesRef.current.reduce((acc, p, i) => (sel.has(p.key) ? i : acc), -1)
    setPages((cur) => (lastSel >= 0 ? [...cur.slice(0, lastSel + 1), b, ...cur.slice(lastSel + 1)] : [...cur, b]))
    setEditor({ key: b.key, mode: 'copy', paste: true })
  }

  const cutFragments = (boxes: FRect[], keep: boolean, around: PageRef) => {
    const pieces = boxes.map((b) => pieceOf(around, b))
    setPages((cur) => cur.flatMap((p) => (p.key === around.key ? (keep ? [p, ...pieces] : pieces) : [p])))
    setSelected(pieces.map((p) => p.key))
    setEditor(null)
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
    setEditor(null)
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
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || split || editor) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') (e.preventDefault(), undo())
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'ф') && pages.length) (e.preventDefault(), setSelected(pages.map((p) => p.key)))
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) (e.preventDefault(), remove(selected))
      else if (e.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // уведомления поднимаем над нижней панелью действий
  useEffect(() => {
    const on = selected.length > 0 && !editor
    document.body.classList.toggle('has-dock', on)
    return () => document.body.classList.remove('has-dock')
  }, [selected.length, editor])

  const openEditor = (p: PageRef, mode?: EditorMode, paste?: boolean) => setEditor({ key: p.key, mode: mode ?? (p.src ? 'fragments' : 'copy'), paste })
  const setThumb = (w: number) => {
    setThumbW(w)
    try {
      localStorage.setItem('nakl-thumb', String(w))
    } catch {
      /* не важно */
    }
  }

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
  const edIndex = editor ? pages.findIndex((p) => p.key === editor.key) : -1
  const edPage = edIndex >= 0 ? pages[edIndex] : null
  const common: EditorCommon | null = edPage
    ? {
        page: edPage,
        pageNo: edIndex + 1,
        pageCount: pages.length,
        close: () => setEditor(null),
        switchMode: (m) => setEditor({ key: edPage.key, mode: m }),
      }
    : null

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

      {/* шапка документа */}
      <div className="doc-head">
        <div className="doc-title">
          <label className="doc-name">
            <span aria-hidden>📄</span>
            <input value={name} placeholder="Документ" style={{ width: `${Math.min(40, Math.max(8, name.length + 2))}ch` }} onChange={(e) => setName(e.target.value)} title="Название файла — можно изменить" />
            <span className="doc-pen" aria-hidden>
              ✎
            </span>
          </label>
          <span className="muted tiny">
            {pages.length} {plural(pages.length, 'лист', 'листа', 'листов')}
          </span>
        </div>
        <div className="doc-actions">
          <button className="btn ghost" onClick={() => setSplit(true)}>
            ✂️ Разделить на файлы
          </button>
          <button className="btn primary" onClick={() => save(pages)} disabled={!!busy}>
            ⬇ Скачать PDF
          </button>
        </div>
      </div>

      {/* панель */}
      <div className="pdf-toolbar">
        <button className="btn soft small" onClick={() => fileRef.current?.click()}>
          ➕ Добавить файлы
        </button>
        <button className="btn ghost small" onClick={addBlank}>
          ⬜ Пустой лист
        </button>
        <button className="btn ghost small" onClick={undo} disabled={!history.length} title="Ctrl+Z">
          ↶ Отменить
        </button>
        <span className="grow" />
        <label className="zoom" title="Размер листов на экране">
          <span>🔍</span>
          <input type="range" min={100} max={260} step={10} value={thumbW} onChange={(e) => setThumb(+e.target.value)} />
        </label>
        <button className="btn ghost small" onClick={() => setSelected(n === pages.length ? [] : pages.map((p) => p.key))}>
          {n === pages.length ? 'Снять выбор' : 'Выбрать все'}
        </button>
      </div>

      {clip ? (
        <div className="clip-bar">
          {clipUrl ? <img src={clipUrl} alt="" /> : <span>📋</span>}
          <div className="clip-text">
            <b>Фрагмент скопирован</b>
            <span className="muted tiny">Чтобы вставить: откройте лист → вкладка «Копировать и вставить». Или сразу:</span>
          </div>
          <button className="btn primary small" onClick={pasteToNewPage}>
            ➕ Вставить на новый лист
          </button>
          <button className="icon-btn" title="Забыть скопированный фрагмент" onClick={() => (setClip(null), setClipUrl(null))}>
            ✕
          </button>
        </div>
      ) : (
        <div className="pdf-help muted tiny">
          <b>Щёлкните по листу</b>, чтобы выбрать его (внизу появятся действия). <b>«✏️ Открыть»</b> на листе — вырезать фрагменты, копировать и вставлять, разрезать. Порядок листов меняйте перетаскиванием.
        </div>
      )}

      <div className={'page-grid' + (fileOver ? ' file-over' : '')} style={{ ['--thumb' as string]: thumbW + 'px' }}>
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
            onDoubleClick={() => openEditor(p)}
            title="Щелчок — выбрать. Двойной щелчок — открыть"
          >
            <div className="pg-thumb">
              <PageThumb page={p} width={thumbW} />
              <span className="pg-check" aria-hidden>
                {sel.has(p.key) ? '✓' : ''}
              </span>
              <button
                className="pg-open"
                onClick={(e) => {
                  e.stopPropagation()
                  openEditor(p)
                }}
              >
                ✏️ Открыть
              </button>
            </div>
            <span className="pg-num">
              {i + 1}
              {p.crop ? <small> · фрагмент</small> : null}
              {!p.src ? <small> · пустой</small> : null}
            </span>
          </div>
        ))}
        <div
          className={'pg add-tile' + (dropAt === pages.length ? ' drop-before' : '')}
          style={{ width: thumbW, height: thumbW * 1.41 }}
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
          🏷 Весь PDF — в библиотеку наклеек
        </button>
        <button className="link-btn" onClick={goLibrary}>
          Открыть библиотеку
        </button>
        <span className="grow" />
        <button className="btn ghost small danger" onClick={clearAll}>
          Закрыть все листы
        </button>
      </div>

      {/* действия с выбранными листами — внизу экрана */}
      {n > 0 && !editor && (
        <div className="sel-dock" role="toolbar" aria-label="Действия с выбранными листами">
          <b className="sel-count">
            Выбрано: {n} {plural(n, 'лист', 'листа', 'листов')}
          </b>
          {n === 1 && (
            <button className="btn primary small" onClick={() => openEditor(selPages[0])}>
              ✏️ Открыть
            </button>
          )}
          <button className="btn ghost small" onClick={() => rotate(selected, 90)}>
            ⟳ Повернуть
          </button>
          <button className="btn ghost small" onClick={() => duplicate(selected)}>
            ⧉ Дублировать
          </button>
          {n > 1 && selPages.some((p) => p.src) && (
            <button className="btn ghost small" onClick={() => openEditor(selPages.find((p) => p.src)!, 'cut')}>
              ✂ Разрезать
            </button>
          )}
          <button className="btn ghost small" onClick={() => save(selPages, ' (выбранные листы)')}>
            📤 Сохранить отдельно
          </button>
          <button className="btn ghost small" onClick={toLibrary}>
            🏷 В наклейки
          </button>
          <button className="btn ghost small danger" onClick={() => remove(selected)}>
            🗑 Удалить
          </button>
          <button className="icon-btn" onClick={() => setSelected([])} title="Снять выбор (Esc)">
            ✕
          </button>
        </div>
      )}

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

      {/* редактор листа — на весь экран */}
      {editor && common && edPage && (
        <>
          {editor.mode === 'fragments' && edPage.src && (
            <FragmentsMode key={edPage.key} common={common} apply={(boxes, keep) => cutFragments(boxes, keep, edPage)} onCopy={copyFragment} />
          )}
          {editor.mode === 'cut' && edPage.src && (
            <CutMode
              key={edPage.key}
              common={common}
              selectedCount={selPages.filter((p) => p.src).length}
              allCount={pages.filter((p) => p.src).length}
              apply={(cells, scope) => cutPages(cells, scope, edPage)}
            />
          )}
          {(editor.mode === 'copy' || !edPage.src) && (
            <CopyMode
              key={edPage.key + (editor.paste ? ':paste' : '')}
              common={common}
              clip={clip}
              clipUrl={clipUrl}
              pasteOnOpen={editor.paste}
              onCopy={copyFragment}
              save={(edits) => {
                setPages((cur) => cur.map((p) => (p.key === edPage.key ? { ...p, edits } : p)))
                setEditor(null)
              }}
            />
          )}
        </>
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
    if (!visible || (!page.src && !page.edits?.length)) return
    let alive = true
    const px = width * Math.min(2, devicePixelRatio || 1)
    renderDisplay(page, px)
      .then((c) => alive && setUrl(c.toDataURL('image/jpeg', 0.85)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [visible, page, width, turned])

  return (
    <div ref={ref} className="pg-img" style={{ width: boxW, height: boxH }}>
      {!page.src && !page.edits?.length ? <div className="blank-page">пустой лист</div> : url ? <img src={url} alt="" draggable={false} /> : <div className="sheet-loading" />}
      {page.edits?.length ? <span className="pg-badge">✏️</span> : null}
    </div>
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
