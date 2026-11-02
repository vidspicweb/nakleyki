import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_GRID, detectGrid, gridCells } from '../pdf'
import { plural } from '../util'
import { composeDisplay, fullRender } from './engine'
import type { Edit, PageRef } from './engine'
import { cellsFromLines, clamp01, toBase, toDisplay } from './geom'
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
    let alive = true
    const turned = page.rot % 180 !== 0
    const pieceW = turned ? (width * page.w) / page.h : width
    fullRender(page, pieceW * Math.min(2, devicePixelRatio || 1)).then((c) => alive && setFull(c))
    return () => {
      alive = false
    }
  }, [page, width])
  useEffect(() => {
    if (!full || !ref.current) return
    const dpr = Math.min(2, devicePixelRatio || 1)
    const c = composeDisplay(full, page, width * dpr, edits)
    const el = ref.current
    el.width = c.width
    el.height = c.height
    el.getContext('2d')!.drawImage(c, 0, 0)
  }, [full, page, width, edits])
  return { ref, full }
}

/* ============================== РАЗРЕЗАТЬ ============================== */

export type CutScope = 'one' | 'selected' | 'all'

export function CutDialog({
  page,
  selectedCount,
  allCount,
  close,
  apply,
}: {
  page: PageRef
  selectedCount: number
  allCount: number
  close: () => void
  apply: (cells: FRect[], scope: CutScope) => void
}) {
  const size = fitSize(page, Math.min(640, window.innerWidth - 420), window.innerHeight - 220)
  const { ref, full } = useDisplayCanvas(page, size.w)
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
      const nx = [...new Set(cs.map((r) => r.x))].sort((a, b) => a - b).slice(1).map((x) => x - g.gapX / 2)
      const ny = [...new Set(cs.map((r) => r.y))].sort((a, b) => a - b).slice(1).map((y) => y - g.gapY / 2)
      setXs(nx)
      setYs(ny)
      setNote(`Нашли ${g.cols * g.rows} ${plural(g.cols * g.rows, 'карточку', 'карточки', 'карточек')}`)
      return
    }
    // карточки разные — ищем широкую белую полосу посередине
    const gap = whiteGap(c)
    if (gap.x !== null || gap.y !== null) {
      setXs(gap.x !== null ? [gap.x] : [])
      setYs(gap.y !== null ? [gap.y] : [])
      setNote('Нашли промежуток между карточками')
    } else setNote('Не получилось найти карточки сами — выберите вариант слева или передвиньте линии мышкой')
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

  return createPortal(
    <div className="modal-back" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>✂️ Разрезать лист на части</h2>
        <div className="cut-layout">
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
          <div className="cut-side">
            <div className="muted tiny">Как разрезать:</div>
            <div className="cut-presets">
              <button className="btn ghost small" onClick={() => grid(1, 2)}>▤ Пополам: верх / низ</button>
              <button className="btn ghost small" onClick={() => grid(2, 1)}>◫ Пополам: лево / право</button>
              <button className="btn ghost small" onClick={() => grid(2, 2)}>⊞ На 4 части</button>
              <button className="btn ghost small" onClick={() => grid(1, 3)}>☰ На 3 по высоте</button>
              <button className="btn ghost small" onClick={() => grid(2, 3)}>На 6 (2 × 3)</button>
              <button className="btn ghost small" onClick={() => grid(2, 4)}>На 8 (2 × 4)</button>
            </div>
            <button className="btn soft small full" onClick={auto} disabled={!full}>
              🔍 Найти карточки автоматически
            </button>
            {note && <div className="hint">{note}</div>}
            <div className="row gap-s wrap">
              <button className="link-btn" onClick={() => setYs((a) => [...a, 0.5])}>+ линия поперёк</button>
              <button className="link-btn" onClick={() => setXs((a) => [...a, 0.5])}>+ линия вдоль</button>
              <button className="link-btn" onClick={() => (setXs([]), setYs([]))}>убрать все</button>
            </div>
            <div className="muted tiny">Линии с ножницами можно двигать мышкой. Двойной щелчок по линии — убрать её.</div>

            <div className="divider" />
            <div className="muted tiny">Какие листы резать:</div>
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
            <div className="cut-result">
              Каждый лист → <b>{cells.length}</b> {plural(cells.length, 'часть', 'части', 'частей')}. Всего получится{' '}
              <b>{cells.length * count}</b> {plural(cells.length * count, 'лист', 'листа', 'листов')}.
            </div>
            <div className="row end gap-s">
              <button className="btn ghost" onClick={close}>
                Отмена
              </button>
              <button className="btn primary" disabled={cells.length < 2} onClick={() => apply(cells, scope)}>
                ✂️ Разрезать
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
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

/* ============================== ПРАВИТЬ ============================== */

type Drag =
  | { mode: 'new'; sx: number; sy: number }
  | { mode: 'move'; i: number; sx: number; sy: number; start: FRect }
  | { mode: 'resize'; i: number; sx: number; sy: number; start: FRect; keep: boolean }

export function EditDialog({ page, close, save }: { page: PageRef; close: () => void; save: (edits: Edit[]) => void }) {
  const size = fitSize(page, Math.min(760, window.innerWidth - 400), window.innerHeight - 200)
  const [edits, setEdits] = useState<Edit[]>(page.edits ?? [])
  const { ref } = useDisplayCanvas(page, size.w, edits)
  const [sel, setSel] = useState<FRect | null>(null) // выделение (как видно на экране)
  const [active, setActive] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const disp = (r: FRect) => toDisplay(r, page.rot)
  const base = (r: FRect) => toBase(r, page.rot)
  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }
  const editRect = (e: Edit) => (e.kind === 'copy' ? e.to : e.rect)
  const setEditRect = (i: number, r: FRect) =>
    setEdits((all) => all.map((e, j) => (j !== i ? e : e.kind === 'copy' ? { ...e, to: base(r) } : { ...e, rect: base(r) })))

  const down = (e: React.PointerEvent) => {
    const p = pos(e)
    drag.current = { mode: 'new', sx: p.x, sy: p.y }
    setSel({ x: p.x, y: p.y, w: 0, h: 0 })
    setActive(null)
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
    drag.current = mode === 'move' ? { mode, i, sx: p.x, sy: p.y, start } : { mode, i, sx: p.x, sy: p.y, start, keep: edits[i].kind === 'copy' }
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
  const removeEdit = (i: number) => {
    setEdits((a) => a.filter((_, j) => j !== i))
    setActive(null)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (sel ? setSel(null) : close())
      if ((e.key === 'Delete' || e.key === 'Backspace') && active !== null) removeEdit(active)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const pct = (r: FRect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` })
  const act = active !== null ? edits[active] : null

  return createPortal(
    <div className="modal-back" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>✏️ Править лист</h2>
        <div className="cut-layout">
          <div className="edit-stage" ref={box} style={{ width: size.w, height: size.h }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
            <canvas ref={ref} style={{ width: size.w, height: size.h }} />
            {act?.kind === 'copy' && <div className="edit-src" style={pct(disp(act.from))} />}
            {edits.map((e, i) => (
              <div
                key={i}
                className={'edit-box ' + e.kind + (active === i ? ' on' : '')}
                style={pct(disp(editRect(e)))}
                onPointerDown={(ev) => startEditDrag(ev, i, 'move')}
                title={e.kind === 'copy' ? 'Копия — потяните, чтобы переставить' : 'Убранная область'}
              >
                <span className="edit-handle" onPointerDown={(ev) => startEditDrag(ev, i, 'resize')} title="Потяните, чтобы изменить размер" />
                {active === i && (
                  <button className="edit-del" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => removeEdit(i)} title="Удалить">
                    ✕
                  </button>
                )}
              </div>
            ))}
            {sel && sel.w > 0 && <div className="edit-sel" style={pct(sel)} />}
          </div>
          <div className="cut-side">
            {!sel ? (
              <div className="hint">
                <b>Обведите мышкой</b> карточку, надпись или картинку на листе — появятся кнопки «Дублировать» и «Убрать».
              </div>
            ) : (
              <div className="sel-box">
                <b>Выделенная область</b>
                <button className="btn primary full" onClick={duplicate} disabled={sel.w < 0.01}>
                  ⧉ Дублировать
                </button>
                <button className="btn ghost full" onClick={erase} disabled={sel.w < 0.01}>
                  ⬜ Убрать (закрасить белым)
                </button>
                <button className="link-btn" onClick={() => setSel(null)}>
                  Снять выделение
                </button>
              </div>
            )}
            <ul className="muted tiny tips">
              <li>Копию можно перетаскивать и менять размер за уголок — пропорции сохранятся.</li>
              <li>Чтобы переместить элемент: дублируйте его, поставьте копию на место, а оригинал уберите.</li>
              <li>Копия остаётся такой же чёткой, как оригинал: текст остаётся текстом.</li>
            </ul>
            {edits.length > 0 && (
              <>
                <div className="divider" />
                <div className="muted tiny">Правки на листе: {edits.length}</div>
                <div className="edit-list">
                  {edits.map((e, i) => (
                    <div key={i} className={'edit-row' + (active === i ? ' on' : '')} onClick={() => setActive(i)}>
                      <span>{e.kind === 'copy' ? '⧉ Копия' : '⬜ Убрано'}</span>
                      <button className="icon-btn" onClick={(ev) => (ev.stopPropagation(), removeEdit(i))} title="Удалить правку">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button className="link-btn" onClick={() => (setEdits([]), setActive(null))}>
                  Убрать все правки
                </button>
              </>
            )}
            <div className="row end gap-s" style={{ marginTop: 'auto' }}>
              <button className="btn ghost" onClick={close}>
                Отмена
              </button>
              <button className="btn primary" onClick={() => save(edits)}>
                Готово
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
