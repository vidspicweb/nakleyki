import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_GRID, detectGrid, gridCells } from '../pdf'
import { plural } from '../util'
import { composeDisplay, fragSize, fullRender, renderDisplay } from './engine'
import type { Edit, FragmentRef, PageRef } from './engine'
import { FULL, cellsFromLines, clamp01, compose, toBase, toDisplay } from './geom'
import type { FRect } from './geom'

/** Размер картинки листа в окне: влезает и по ширине, и по высоте. */
function fitSize(page: PageRef, maxW: number, maxH: number) {
  const turned = page.rot % 180 !== 0
  const aspect = turned ? page.w / page.h : page.h / page.w // высота / ширина на экране
  const w = Math.min(maxW, maxH / aspect)
  return { w, h: w * aspect }
}

function useDisplayCanvas(page: PageRef, width: number, edits?: Edit[]) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [full, setFull] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (width <= 0) return
    let alive = true
    const turned = page.rot % 180 !== 0
    const pieceW = turned ? (width * page.w) / page.h : width
    fullRender(page, pieceW * Math.min(2, devicePixelRatio || 1)).then((c) => alive && setFull(c))
    return () => {
      alive = false
    }
  }, [page, width])
  useEffect(() => {
    if (width <= 0) return
    let alive = true
    const dpr = Math.min(2, devicePixelRatio || 1)
    renderDisplay(page, width * dpr, edits ?? page.edits ?? []).then((c) => {
      const el = ref.current
      if (!alive || !el) return
      el.width = c.width
      el.height = c.height
      el.getContext('2d')!.drawImage(c, 0, 0)
    })
    return () => {
      alive = false
    }
  }, [page, width, edits])
  return { ref, full }
}

/** Фрагмент из рамки (как видна на экране) на листе page. */
export function fragmentFrom(page: PageRef, box: FRect): FragmentRef {
  return { src: page.src!, index: page.index, rect: compose(page.crop ?? FULL, toBase(box, page.rot)), viewRot: page.rot, fw: page.fw, fh: page.fh }
}

/** Где поставить фрагмент на листе (доли, как видно на экране): по центру, в натуральную величину или меньше. */
function placeCentered(page: PageRef, frag: FragmentRef, shift = 0): FRect {
  const pw = page.rot % 180 ? page.h : page.w
  const ph = page.rot % 180 ? page.w : page.h
  const fs = fragSize(frag)
  let w = fs.w / pw
  let h = fs.h / ph
  const k = Math.min(1, 0.9 / w, 0.9 / h)
  w *= k
  h *= k
  return { x: Math.min(1 - w, Math.max(0, (1 - w) / 2 + shift)), y: Math.min(1 - h, Math.max(0, (1 - h) / 2 + shift)), w, h }
}

/** Раскладываем копии фрагмента сеткой cols × rows по листу. */
function placeGrid(page: PageRef, frag: FragmentRef, cols: number, rows: number): FRect[] {
  const pw = page.rot % 180 ? page.h : page.w
  const ph = page.rot % 180 ? page.w : page.h
  const fs = fragSize(frag)
  const m = 0.03
  const g = 0.015
  const cw = (1 - 2 * m - g * (cols - 1)) / cols
  const ch = (1 - 2 * m - g * (rows - 1)) / rows
  // вписываем, сохраняя пропорции фрагмента (в пунктах)
  const k = Math.min((cw * pw) / fs.w, (ch * ph) / fs.h)
  const w = (fs.w * k) / pw
  const h = (fs.h * k) / ph
  const out: FRect[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push({ x: m + c * (cw + g) + (cw - w) / 2, y: m + r * (ch + g) + (ch - h) / 2, w, h })
  return out
}

/* ============================== ОБЩЕЕ ОКНО РЕДАКТОРА ============================== */

export type EditorMode = 'fragments' | 'copy' | 'cut'

const MODES: { id: EditorMode; icon: string; title: string; sub: string }[] = [
  { id: 'fragments', icon: '⬚', title: 'Вырезать фрагменты', sub: 'рамка → отдельный лист' },
  { id: 'copy', icon: '⧉', title: 'Копировать и вставить', sub: 'дублировать, убрать' },
  { id: 'cut', icon: '✂', title: 'Разрезать на части', sub: 'ровно, линиями' },
]

/** Свободное место под лист: измеряем, чтобы лист был как можно крупнее и ничего не обрезалось. */
function useAreaSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export interface EditorCommon {
  page: PageRef
  pageNo: number
  pageCount: number
  close: () => void
  switchMode: (m: EditorMode) => void
}

/**
 * Полноэкранный редактор листа: сверху — вкладки и главные кнопки, слева — крупный лист, справа — подсказки и настройки.
 */
function EditorShell({
  mode,
  common,
  dirty,
  areaRef,
  primary,
  side,
  children,
}: {
  mode: EditorMode
  common: EditorCommon
  dirty: boolean
  areaRef: React.RefObject<HTMLDivElement | null>
  primary: ReactNode
  side: ReactNode
  children: ReactNode
}) {
  const leave = (fn: () => void) => {
    if (!dirty || confirm('Изменения на этом листе ещё не применены. Выйти без них?')) fn()
  }
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  return createPortal(
    <div className="ed-full" role="dialog" aria-label="Редактор листа">
      <header className="ed-head">
        <button className="btn ghost" onClick={() => leave(common.close)}>
          ← К листам
        </button>
        <div className="ed-title">
          <b>Редактор листа</b>
          <span>
            Лист {common.pageNo} из {common.pageCount}
          </span>
        </div>
        <nav className="ed-tabs" aria-label="Что сделать с листом">
          {MODES.filter((m) => common.page.src || m.id === 'copy').map((m) => (
            <button key={m.id} className={'ed-tab' + (m.id === mode ? ' on' : '')} onClick={() => m.id !== mode && leave(() => common.switchMode(m.id))}>
              <span className="ed-tab-icon">{m.icon}</span>
              <span className="ed-tab-text">
                <b>{m.title}</b>
                <small>{m.sub}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="ed-actions">
          <button className="btn ghost" onClick={() => leave(common.close)}>
            Отмена
          </button>
          {primary}
        </div>
      </header>
      <div className="ed-body">
        <div className="ed-area" ref={areaRef}>
          {children}
        </div>
        <aside className="ed-side">{side}</aside>
      </div>
    </div>,
    document.body,
  )
}

/** Пронумерованные шаги в правой панели. */
function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="ed-steps">
      {items.map((t, i) => (
        <li key={i}>
          <span className="ed-step-n">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  )
}

const pct = (r: FRect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` })
const PAD = 48

/* ============================== РАЗРЕЗАТЬ НА ЧАСТИ ============================== */

export type CutScope = 'one' | 'selected' | 'all'

export function CutMode({
  common,
  selectedCount,
  allCount,
  apply,
}: {
  common: EditorCommon
  selectedCount: number
  allCount: number
  apply: (cells: FRect[], scope: CutScope) => void
}) {
  const { page } = common
  const [areaRef, area] = useAreaSize()
  const size = fitSize(page, Math.max(100, area.w - PAD), Math.max(100, area.h - PAD))
  const { ref, full } = useDisplayCanvas(page, area.w ? size.w : 0)
  const [xs, setXs] = useState<number[]>([])
  const [ys, setYs] = useState<number[]>([0.5])
  const [scope, setScope] = useState<CutScope>(selectedCount > 1 ? 'selected' : 'one')
  const [note, setNote] = useState<string | null>(null)
  const drag = useRef<{ axis: 'x' | 'y'; i: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const cells = cellsFromLines(xs, ys)
  const grid = (c: number, r: number) => {
    setXs(Array.from({ length: c - 1 }, (_, i) => (i + 1) / c))
    setYs(Array.from({ length: r - 1 }, (_, i) => (i + 1) / r))
    setNote(null)
  }

  const auto = () => {
    if (!full) return
    const c = composeDisplay(full, page, 500)
    const g = detectGrid(c)
    if (JSON.stringify(g) !== JSON.stringify(DEFAULT_GRID) && g.cols * g.rows > 1) {
      const cs = gridCells(g)
      setXs([...new Set(cs.map((r) => r.x))].sort((a, b) => a - b).slice(1).map((x) => x - g.gapX / 2))
      setYs([...new Set(cs.map((r) => r.y))].sort((a, b) => a - b).slice(1).map((y) => y - g.gapY / 2))
      setNote(`Нашли ${g.cols * g.rows} ${plural(g.cols * g.rows, 'карточку', 'карточки', 'карточек')}`)
      return
    }
    const gap = whiteGap(c)
    if (gap.x !== null || gap.y !== null) {
      setXs(gap.x !== null ? [gap.x] : [])
      setYs(gap.y !== null ? [gap.y] : [])
      setNote('Нашли промежуток между карточками')
    } else setNote('Не получилось найти карточки сами — выберите готовый вариант или передвиньте линии мышкой')
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !box.current) return
    const r = box.current.getBoundingClientRect()
    const v = clamp01(d.axis === 'x' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height)
    if (d.axis === 'x') setXs((a) => a.map((x, i) => (i === d.i ? v : x)))
    else setYs((a) => a.map((y, i) => (i === d.i ? v : y)))
  }

  const line = (axis: 'x' | 'y', v: number, i: number) => (
    <div
      key={axis + i}
      className={'cut-line ' + axis}
      style={axis === 'x' ? { left: `${v * 100}%` } : { top: `${v * 100}%` }}
      onPointerDown={(e) => {
        e.preventDefault()
        drag.current = { axis, i }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => (axis === 'x' ? setXs((a) => a.filter((_, j) => j !== i)) : setYs((a) => a.filter((_, j) => j !== i)))}
      title="Потяните, чтобы передвинуть. Двойной щелчок — убрать линию"
    >
      <span className="cut-knob">✂</span>
    </div>
  )

  const count = scope === 'one' ? 1 : scope === 'selected' ? selectedCount : allCount
  const presets: [number, number, string][] = [
    [1, 2, 'Пополам: верх и низ'],
    [2, 1, 'Пополам: лево и право'],
    [2, 2, 'На 4 части'],
    [1, 3, 'На 3 по высоте'],
    [2, 3, 'На 6 частей'],
    [2, 4, 'На 8 частей'],
  ]

  return (
    <EditorShell
      mode="cut"
      common={common}
      dirty={false}
      areaRef={areaRef}
      primary={
        <button className="btn primary" disabled={cells.length < 2} onClick={() => apply(cells, scope)}>
          ✂ Разрезать на {cells.length} {plural(cells.length, 'часть', 'части', 'частей')}
        </button>
      }
      side={
        <>
          <Steps
            items={[
              'Выберите, как разрезать — или нажмите «Найти карточки».',
              'Если нужно, передвиньте красные линии мышкой.',
              <>
                Нажмите <b>«Разрезать»</b> вверху справа.
              </>,
            ]}
          />
          <div className="ed-group">
            <div className="ed-label">Готовые варианты</div>
            <div className="preset-grid">
              {presets.map(([c, r, t]) => (
                <button key={t} className="preset" onClick={() => grid(c, r)}>
                  <span className="preset-pic" style={{ gridTemplateColumns: `repeat(${c}, 1fr)` }}>
                    {Array.from({ length: c * r }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  {t}
                </button>
              ))}
            </div>
            <button className="btn soft full" onClick={auto} disabled={!full}>
              🔍 Найти карточки автоматически
            </button>
            {note && <div className="hint">{note}</div>}
          </div>
          <div className="ed-group">
            <div className="ed-label">Линии</div>
            <div className="row gap-s wrap">
              <button className="btn ghost small" onClick={() => setYs((a) => [...a, 0.5])}>
                + Поперёк
              </button>
              <button className="btn ghost small" onClick={() => setXs((a) => [...a, 0.5])}>
                + Вдоль
              </button>
              <button className="btn ghost small" onClick={() => (setXs([]), setYs([]))}>
                Убрать все
              </button>
            </div>
            <div className="muted tiny">Двойной щелчок по линии — убрать её.</div>
          </div>
          {(selectedCount > 1 || allCount > 1) && (
            <div className="ed-group">
              <div className="ed-label">Какие листы резать</div>
              <label className="radio-row">
                <input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} /> Только этот лист
              </label>
              {selectedCount > 1 && (
                <label className="radio-row">
                  <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Выбранные листы ({selectedCount})
                </label>
              )}
              {allCount > 1 && (
                <label className="radio-row">
                  <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> Все листы документа ({allCount})
                </label>
              )}
            </div>
          )}
          <div className="cut-result">
            Получится <b>{cells.length * count}</b> {plural(cells.length * count, 'лист', 'листа', 'листов')}
            {count > 1 ? ` (по ${cells.length} из каждого)` : ''}.
          </div>
        </>
      }
    >
      <div className="cut-stage" ref={box} style={{ width: size.w, height: size.h }}>
        <canvas ref={ref} style={{ width: size.w, height: size.h }} />
        {cells.map((c, i) => (
          <span key={i} className="cut-num" style={{ left: `${(c.x + c.w / 2) * 100}%`, top: `${(c.y + c.h / 2) * 100}%` }}>
            {i + 1}
          </span>
        ))}
        {xs.map((v, i) => line('x', v, i))}
        {ys.map((v, i) => line('y', v, i))}
      </div>
    </EditorShell>
  )
}

/* ============================== КОПИРОВАТЬ И ВСТАВИТЬ ============================== */

type Drag =
  | { mode: 'new'; sx: number; sy: number }
  | { mode: 'move'; i: number; sx: number; sy: number; start: FRect }
  | { mode: 'resize'; i: number; sx: number; sy: number; start: FRect; keep: boolean }

export function CopyMode({
  common,
  save,
  clip,
  clipUrl,
  onCopy,
  pasteOnOpen,
}: {
  common: EditorCommon
  save: (edits: Edit[]) => void
  clip: FragmentRef | null
  clipUrl: string | null
  onCopy: (f: FragmentRef) => void
  pasteOnOpen?: boolean
}) {
  const { page } = common
  const [areaRef, area] = useAreaSize()
  const size = fitSize(page, Math.max(100, area.w - PAD), Math.max(100, area.h - PAD))
  const [edits, setEdits] = useState<Edit[]>(() => {
    const base0 = page.edits ?? []
    if (pasteOnOpen && clip) return [...base0, { kind: 'place', frag: clip, to: toBase(placeCentered(page, clip), page.rot) }]
    return base0
  })
  const { ref } = useDisplayCanvas(page, area.w ? size.w : 0, edits)
  const [sel, setSel] = useState<FRect | null>(null) // выделение (как видно на экране)
  const [active, setActive] = useState<number | null>(() => (pasteOnOpen && clip ? (page.edits ?? []).length : null))
  const [copied, setCopied] = useState(false)
  const drag = useRef<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const dirty = JSON.stringify(edits) !== JSON.stringify(page.edits ?? [])

  const disp = (r: FRect) => toDisplay(r, page.rot)
  const base = (r: FRect) => toBase(r, page.rot)
  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }
  const editRect = (e: Edit) => (e.kind === 'erase' ? e.rect : e.to)
  const setEditRect = (i: number, r: FRect) =>
    setEdits((all) => all.map((e, j) => (j !== i ? e : e.kind === 'erase' ? { ...e, rect: base(r) } : { ...e, to: base(r) })))

  const down = (e: React.PointerEvent) => {
    const p = pos(e)
    drag.current = { mode: 'new', sx: p.x, sy: p.y }
    setSel({ x: p.x, y: p.y, w: 0, h: 0 })
    setActive(null)
    setCopied(false)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = pos(e)
    if (d.mode === 'new') setSel({ x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) })
    else if (d.mode === 'move') {
      const r = d.start
      setEditRect(d.i, { ...r, x: Math.min(1 - r.w, Math.max(0, r.x + p.x - d.sx)), y: Math.min(1 - r.h, Math.max(0, r.y + p.y - d.sy)) })
    } else {
      const r = d.start
      let w = Math.max(0.02, Math.min(1 - r.x, r.w + p.x - d.sx))
      let h = Math.max(0.02, Math.min(1 - r.y, r.h + p.y - d.sy))
      if (d.keep) {
        // копия сохраняет пропорции, чтобы не исказилась
        const k = Math.min(w / r.w, h / r.h)
        w = r.w * k
        h = r.h * k
      }
      setEditRect(d.i, { ...r, w, h })
    }
  }
  const up = () => {
    if (drag.current?.mode === 'new' && sel && (sel.w < 0.01 || sel.h < 0.01)) setSel(null)
    drag.current = null
  }

  const startEditDrag = (e: React.PointerEvent, i: number, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    const p = pos(e)
    const start = disp(editRect(edits[i]))
    drag.current = mode === 'move' ? { mode, i, sx: p.x, sy: p.y, start } : { mode, i, sx: p.x, sy: p.y, start, keep: edits[i].kind !== 'erase' }
    setActive(i)
    setSel(null)
    box.current?.setPointerCapture(e.pointerId)
  }

  const duplicate = () => {
    if (!sel) return
    const to = { ...sel, x: Math.min(1 - sel.w, sel.x + 0.04), y: Math.min(1 - sel.h, sel.y + 0.04) }
    setEdits((a) => [...a, { kind: 'copy', from: base(sel), to: base(to) }])
    setActive(edits.length)
    setSel(null)
  }
  const erase = () => {
    if (!sel) return
    setEdits((a) => [...a, { kind: 'erase', rect: base(sel) }])
    setSel(null)
  }
  const copySel = () => {
    if (!sel || !page.src) return
    onCopy(fragmentFrom(page, sel))
    setCopied(true)
  }
  const paste = () => {
    if (!clip) return
    const n = edits.filter((e) => e.kind === 'place').length
    setEdits((a) => [...a, { kind: 'place', frag: clip, to: base(placeCentered(page, clip, (n % 5) * 0.03)) }])
    setActive(edits.length)
  }
  const pasteGrid = (c: number, r: number) => {
    if (!clip) return
    const cells = placeGrid(page, clip, c, r)
    const before = (page.edits ?? []).length
    // вставки, сделанные в этом окне, заменяем сеткой (иначе копии лягут друг на друга)
    setEdits((a) => [...a.filter((e, i) => i < before || e.kind !== 'place'), ...cells.map((cell): Edit => ({ kind: 'place', frag: clip, to: base(cell) }))])
    setActive(null)
  }
  const removeEdit = (i: number) => {
    setEdits((a) => a.filter((_, j) => j !== i))
    setActive(null)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sel) setSel(null)
      if ((e.key === 'Delete' || e.key === 'Backspace') && active !== null) removeEdit(active)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const act = active !== null ? edits[active] : null
  const kindName = (e: Edit) => (e.kind === 'copy' ? '⧉ Копия' : e.kind === 'place' ? '📋 Вставка' : '⬜ Закрашено')

  return (
    <EditorShell
      mode="copy"
      common={common}
      dirty={dirty}
      areaRef={areaRef}
      primary={
        <button className="btn primary" onClick={() => save(edits)}>
          ✓ Сохранить
        </button>
      }
      side={
        <>
          {clip && (
            <div className="ed-group clip-box">
              <div className="ed-label">📋 Скопированный фрагмент</div>
              <div className="clip-preview">{clipUrl ? <img src={clipUrl} alt="" /> : '📋'}</div>
              <button className="btn primary full" onClick={paste}>
                Вставить на этот лист
              </button>
              <div className="muted tiny">или заполнить весь лист копиями:</div>
              <div className="grid-btns">
                {[
                  [1, 2],
                  [2, 2],
                  [2, 3],
                  [2, 4],
                  [3, 3],
                  [3, 4],
                ].map(([c, r]) => (
                  <button key={c + 'x' + r} className="btn ghost small" onClick={() => pasteGrid(c, r)} title={`${c * r} копий`}>
                    {c} × {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sel && sel.w >= 0.01 ? (
            <div className="ed-group sel-box">
              <div className="ed-label">Что сделать с выделенным?</div>
              <button className="btn primary full" onClick={duplicate}>
                ⧉ Дублировать на этом листе
              </button>
              {page.src && (
                <button className="btn soft full" onClick={copySel}>
                  {copied ? '✓ Скопировано — откройте другой лист' : '📋 Копировать для других листов'}
                </button>
              )}
              <button className="btn ghost full" onClick={erase}>
                ⬜ Закрасить белым
              </button>
              <button className="link-btn" onClick={() => setSel(null)}>
                Снять выделение
              </button>
            </div>
          ) : (
            <Steps
              items={[
                <>
                  <b>Обведите мышкой</b> карточку, надпись или картинку на листе.
                </>,
                'Выберите: дублировать здесь, скопировать для других листов или закрасить.',
                'Копию перетащите на нужное место. Размер — за синий уголок.',
                <>
                  Нажмите <b>«Сохранить»</b> вверху справа.
                </>,
              ]}
            />
          )}

          {edits.length > 0 && (
            <div className="ed-group">
              <div className="ed-label">Изменения на листе ({edits.length})</div>
              <div className="edit-list">
                {edits.map((e, i) => (
                  <div key={i} className={'edit-row' + (active === i ? ' on' : '')} onClick={() => setActive(i)}>
                    <span>{kindName(e)}</span>
                    <button className="icon-btn" onClick={(ev) => (ev.stopPropagation(), removeEdit(i))} title="Убрать">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="link-btn" onClick={() => (setEdits([]), setActive(null))}>
                Убрать все изменения
              </button>
            </div>
          )}
          <div className="muted tiny">Копии остаются такими же чёткими, как оригинал. Чтобы переместить элемент: продублируйте его, поставьте на место, а оригинал закрасьте.</div>
        </>
      }
    >
      <div className="edit-stage" ref={box} style={{ width: size.w, height: size.h }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <canvas ref={ref} style={{ width: size.w, height: size.h }} />
        {act?.kind === 'copy' && <div className="edit-src" style={pct(disp(act.from))} />}
        {edits.map((e, i) => (
          <div
            key={i}
            className={'edit-box ' + (e.kind === 'erase' ? 'erase' : 'copy') + (active === i ? ' on' : '')}
            style={pct(disp(editRect(e)))}
            onPointerDown={(ev) => startEditDrag(ev, i, 'move')}
            title={e.kind === 'erase' ? 'Закрашенная область' : 'Копия — потяните, чтобы переставить'}
          >
            <span className="edit-handle" onPointerDown={(ev) => startEditDrag(ev, i, 'resize')} title="Потяните, чтобы изменить размер" />
            {active === i && (
              <button className="edit-del" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => removeEdit(i)} title="Убрать">
                ✕
              </button>
            )}
          </div>
        ))}
        {sel && sel.w > 0 && <div className="edit-sel" style={pct(sel)} />}
      </div>
    </EditorShell>
  )
}

/* ============================== ВЫРЕЗАТЬ ФРАГМЕНТЫ ============================== */

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type FDrag =
  | { mode: 'new'; sx: number; sy: number }
  | { mode: 'move'; i: number; sx: number; sy: number; start: FRect }
  | { mode: 'resize'; i: number; corner: Corner; start: FRect }

/**
 * Рисуем рамки вокруг нужных фрагментов — каждая рамка станет отдельным листом.
 * Рамки в долях от листа, как он виден на экране.
 */
export function FragmentsMode({
  common,
  apply,
  onCopy,
}: {
  common: EditorCommon
  apply: (boxes: FRect[], keepOriginal: boolean) => void
  onCopy: (f: FragmentRef) => void
}) {
  const { page } = common
  const [areaRef, area] = useAreaSize()
  const size = fitSize(page, Math.max(100, area.w - PAD), Math.max(100, area.h - PAD))
  const { ref, full } = useDisplayCanvas(page, area.w ? size.w : 0)
  const [boxes, setBoxes] = useState<FRect[]>([])
  const [active, setActive] = useState<number | null>(null)
  const [drawing, setDrawing] = useState<FRect | null>(null)
  const [keep, setKeep] = useState(true)
  const [trim, setTrim] = useState(true)
  const [copiedNo, setCopiedNo] = useState<number | null>(null)
  const drag = useRef<FDrag | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const down = (e: React.PointerEvent) => {
    const p = pos(e)
    drag.current = { mode: 'new', sx: p.x, sy: p.y }
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 })
    setActive(null)
    box.current?.setPointerCapture(e.pointerId)
  }
  const startBoxDrag = (e: React.PointerEvent, i: number, corner?: Corner) => {
    e.stopPropagation()
    e.preventDefault()
    const p = pos(e)
    drag.current = corner ? { mode: 'resize', i, corner, start: boxes[i] } : { mode: 'move', i, sx: p.x, sy: p.y, start: boxes[i] }
    setActive(i)
    box.current?.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = pos(e)
    if (d.mode === 'new') setDrawing({ x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) })
    else if (d.mode === 'move') {
      const r = d.start
      const nb = { ...r, x: Math.min(1 - r.w, Math.max(0, r.x + p.x - d.sx)), y: Math.min(1 - r.h, Math.max(0, r.y + p.y - d.sy)) }
      setBoxes((all) => all.map((b, j) => (j === d.i ? nb : b)))
    } else {
      const r = d.start
      let x1 = r.x
      let y1 = r.y
      let x2 = r.x + r.w
      let y2 = r.y + r.h
      if (d.corner.includes('w')) x1 = Math.min(p.x, x2 - 0.02)
      if (d.corner.includes('e')) x2 = Math.max(p.x, x1 + 0.02)
      if (d.corner.includes('n')) y1 = Math.min(p.y, y2 - 0.02)
      if (d.corner.includes('s')) y2 = Math.max(p.y, y1 + 0.02)
      setBoxes((all) => all.map((b, j) => (j === d.i ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : b)))
    }
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'new' && drawing) {
      if (drawing.w > 0.015 && drawing.h > 0.015) {
        setBoxes((b) => [...b, drawing])
        setActive(boxes.length)
      }
      setDrawing(null)
    }
  }
  const remove = (i: number) => {
    setBoxes((b) => b.filter((_, j) => j !== i))
    setActive(null)
    setCopiedNo(null)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && active !== null) remove(active)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  /** Подрезаем белые поля внутри рамки, чтобы фрагмент был ровно по содержимому. */
  const trimBoxes = (list: FRect[]): FRect[] => {
    if (!trim || !full) return list
    const c = composeDisplay(full, page, 900)
    const W = c.width
    const H = c.height
    const data = c.getContext('2d')!.getImageData(0, 0, W, H).data
    return list.map((b) => {
      const x0 = Math.floor(b.x * W)
      const y0 = Math.floor(b.y * H)
      const x1 = Math.ceil((b.x + b.w) * W)
      const y1 = Math.ceil((b.y + b.h) * H)
      let minX = x1
      let minY = y1
      let maxX = x0
      let maxY = y0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4
          if (data[i] < 242 || data[i + 1] < 242 || data[i + 2] < 242) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      if (maxX <= minX || maxY <= minY) return b
      const pad = 2
      const nx = Math.max(x0, minX - pad) / W
      const ny = Math.max(y0, minY - pad) / H
      return { x: nx, y: ny, w: Math.min(x1, maxX + pad + 1) / W - nx, h: Math.min(y1, maxY + pad + 1) / H - ny }
    })
  }

  return (
    <EditorShell
      mode="fragments"
      common={common}
      dirty={boxes.length > 0}
      areaRef={areaRef}
      primary={
        <button className="btn primary" disabled={!boxes.length} onClick={() => apply(trimBoxes(boxes), keep)}>
          ⬚ Вырезать{boxes.length ? ` ${boxes.length} ${plural(boxes.length, 'фрагмент', 'фрагмента', 'фрагментов')}` : ''}
        </button>
      }
      side={
        <>
          <Steps
            items={[
              <>
                <b>Нарисуйте мышкой рамку</b> вокруг нужной части листа.
              </>,
              'Нарисуйте ещё рамки, если нужно. Рамку можно двигать, а размер менять за уголки.',
              <>
                Нажмите <b>«Вырезать»</b> вверху справа — каждая рамка станет отдельным листом.
              </>,
            ]}
          />
          {boxes.length > 0 && (
            <div className="ed-group">
              <div className="ed-label">Рамки ({boxes.length})</div>
              <div className="edit-list">
                {boxes.map((_, i) => (
                  <div key={i} className={'edit-row' + (active === i ? ' on' : '')} onClick={() => setActive(i)}>
                    <span>Рамка {i + 1}</span>
                    <span className="row gap-s">
                      <button
                        className="btn ghost small"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onCopy(fragmentFrom(page, trimBoxes([boxes[i]])[0]))
                          setCopiedNo(i)
                        }}
                        title="Скопировать, чтобы вставить на другой лист"
                      >
                        {copiedNo === i ? '✓ Скопировано' : '📋 Копировать'}
                      </button>
                      <button className="icon-btn" onClick={(ev) => (ev.stopPropagation(), remove(i))} title="Убрать рамку">
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="muted tiny">«Копировать» — чтобы вставить этот фрагмент на другие листы (вкладка «Копировать и вставить» любого листа).</div>
            </div>
          )}
          <div className="ed-group">
            <div className="ed-label">Настройки</div>
            <label className="radio-row">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> Подрезать лишние белые поля
            </label>
            <div className="muted tiny" style={{ marginTop: 6 }}>
              Исходный лист:
            </div>
            <label className="radio-row">
              <input type="radio" checked={keep} onChange={() => setKeep(true)} /> оставить, фрагменты — после него
            </label>
            <label className="radio-row">
              <input type="radio" checked={!keep} onChange={() => setKeep(false)} /> заменить фрагментами
            </label>
          </div>
        </>
      }
    >
      <div className="edit-stage frag-stage" ref={box} style={{ width: size.w, height: size.h }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <canvas ref={ref} style={{ width: size.w, height: size.h }} />
        {boxes.length > 0 && <div className="frag-dim" style={{ clipPath: dimPath(boxes) }} />}
        {boxes.map((b, i) => (
          <div key={i} className={'frag-box' + (active === i ? ' on' : '')} style={pct(b)} onPointerDown={(e) => startBoxDrag(e, i)}>
            <span className="frag-num">{i + 1}</span>
            {(['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
              <span key={c} className={'frag-h ' + c} onPointerDown={(e) => startBoxDrag(e, i, c)} />
            ))}
            <button className="edit-del" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(i)} title="Убрать рамку">
              ✕
            </button>
          </div>
        ))}
        {drawing && drawing.w > 0 && <div className="frag-box drawing" style={pct(drawing)} />}
      </div>
    </EditorShell>
  )
}

/** Самая широкая почти белая полоса в середине листа (между двумя разными карточками). */
function whiteGap(c: HTMLCanvasElement): { x: number | null; y: number | null } {
  const W = c.width
  const H = c.height
  const d = c.getContext('2d')!.getImageData(0, 0, W, H).data
  const col = new Float32Array(W)
  const row = new Float32Array(H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) (col[x]++, row[y]++)
    }
  const best = (prof: Float32Array, len: number, total: number) => {
    let bestLen = 0
    let bestMid: number | null = null
    let start = -1
    for (let i = Math.floor(len * 0.2); i <= Math.ceil(len * 0.8); i++) {
      const white = i < len && prof[i] / total > 0.985
      if (white && start < 0) start = i
      if (!white && start >= 0) {
        if (i - start > bestLen) ((bestLen = i - start), (bestMid = (start + i) / 2 / len))
        start = -1
      }
    }
    return bestLen >= Math.max(2, len * 0.006) ? bestMid : null
  }
  return { x: best(col, W, H), y: best(row, H, W) }
}

/** Затемняем всё, кроме рамок (обводка-«дырки» через clip-path с правилом evenodd). */
function dimPath(boxes: FRect[]) {
  const p = (x: number, y: number) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`
  const rects = boxes.map((b) => `${p(b.x, b.y)}, ${p(b.x + b.w, b.y)}, ${p(b.x + b.w, b.y + b.h)}, ${p(b.x, b.y + b.h)}, ${p(b.x, b.y)}`)
  return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${rects.join(', 0% 0%, ')}, 0% 0%)`
}
