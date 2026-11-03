import { useEffect, useRef, useState } from 'react'
import type { Align, SchoolClass, Sheet, Student, TextLine } from '../types'
import { gridCells, renderPage } from '../pdf'
import { drawCellText } from '../render'
import type { LineBox } from '../render'
import { ensureFonts } from '../fonts'
import { clamp } from '../util'

interface Props {
  sheet: Sheet
  cellIndex: number
  student: Student
  cls: SchoolClass
  width: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onPatch: (id: string, p: Partial<TextLine>) => void
  onEditText: (id: string) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
}

const ALIGN_TITLE: Record<Align, string> = { left: 'По левому краю', center: 'По центру', right: 'По правому краю' }

/**
 * Большая наклейка: строки двигаются мышкой, над выбранной строкой — панель
 * (размер, жирный, курсив, выравнивание…), а за уголок строку можно растянуть.
 */
export function StickerCanvas({ sheet, cellIndex, student, cls, width, selectedId, onSelect, onMove, onPatch, onEditText, onDuplicate, onRemove }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [boxes, setBoxes] = useState<LineBox[]>([])
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const drag = useRef<{ id: string; sx: number; sy: number; lx: number; ly: number } | null>(null)
  const resize = useRef<{ id: string; sx: number; w: number; size: number; dir: number } | null>(null)

  const cells = gridCells(sheet.grid)
  const cell = cells[Math.min(cellIndex, cells.length - 1)]
  const cellWpt = cell.w * sheet.widthPt
  const cellHpt = cell.h * sheet.heightPt
  const height = (width * cellHpt) / cellWpt

  useEffect(() => {
    let cancelled = false
    const dpr = Math.min(2.5, window.devicePixelRatio || 1)
    ;(async () => {
      const bg = await renderPage(sheet.templateId, sheet.pageIndex, 2000)
      await ensureFonts(sheet.layout.lines)
      if (cancelled || !ref.current) return
      const c = ref.current
      c.width = Math.round(width * dpr)
      c.height = Math.round(height * dpr)
      const ctx = c.getContext('2d')!
      ctx.drawImage(bg, cell.x * bg.width, cell.y * bg.height, cell.w * bg.width, cell.h * bg.height, 0, 0, c.width, c.height)
      const pxPerPt = c.width / cellWpt
      const b = drawCellText(ctx, sheet.layout, student, cls, sheet, cellWpt, cellHpt, pxPerPt)
      setBoxes(b.map((x) => ({ ...x, x: x.x / dpr, y: x.y / dpr, w: x.w / dpr, h: x.h / dpr })))
    })().catch(console.error)
    return () => {
      cancelled = true
    }
  }, [sheet, student, cls, width, height, cell.x, cell.y, cell.w, cell.h, cellWpt, cellHpt])

  const lineOf = (id: string) => sheet.layout.lines.find((x) => x.id === id)!

  const down = (e: React.PointerEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(id)
    const l = lineOf(id)
    drag.current = { id, sx: e.clientX, sy: e.clientY, lx: l.x, ly: l.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    let x = clamp(d.lx + (e.clientX - d.sx) / width, 0, 1)
    let y = clamp(d.ly + (e.clientY - d.sy) / height, 0.02, 1)
    // прилипание к другим строкам и к центру — чтобы легко выровнять
    const g: { x?: number; y?: number } = {}
    if (!e.altKey) {
      const others = sheet.layout.lines.filter((l) => l.id !== d.id && l.enabled)
      const tx = 6 / width
      for (const o of others) if (Math.abs(o.x - x) < tx) ((x = o.x), (g.x = o.x))
      if (Math.abs(x - 0.5) < tx) ((x = 0.5), (g.x = 0.5))
      const ty = 4 / height
      for (const o of others) if (Math.abs(o.y - y) < ty) ((y = o.y), (g.y = o.y))
    }
    setGuides(g)
    onMove(d.id, x, y)
  }
  const up = () => {
    drag.current = null
    setGuides({})
  }

  // растягивание строки за уголок = изменение размера шрифта
  const startResize = (e: React.PointerEvent, b: LineBox, dir: number) => {
    e.preventDefault()
    e.stopPropagation()
    resize.current = { id: b.id, sx: e.clientX, w: Math.max(120, b.w), size: lineOf(b.id).size, dir }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const moveResize = (e: React.PointerEvent) => {
    const r = resize.current
    if (!r) return
    // плавно: сдвиг мыши на ширину строки ≈ вдвое крупнее
    const k = Math.max(0.2, 1 + ((e.clientX - r.sx) * r.dir) / r.w)
    onPatch(r.id, { size: clamp(Math.round(r.size * k * 2) / 2, 4, 72) })
  }
  const endResize = () => (resize.current = null)

  const sel = boxes.find((b) => b.id === selectedId)
  const selLine = selectedId ? sheet.layout.lines.find((l) => l.id === selectedId) : null
  const step = (d: number) => selLine && onPatch(selLine.id, { size: clamp(+(selLine.size + d).toFixed(1), 4, 72) })

  return (
    <div className="sticker-wrap" style={{ width, height }}>
      <div className="sticker-stage" style={{ width, height }} onPointerDown={() => onSelect(null)}>
        <canvas ref={ref} style={{ width, height }} />
        {guides.x !== undefined && <div className="guide v" style={{ left: guides.x * width }} />}
        {guides.y !== undefined && <div className="guide h" style={{ top: guides.y * height }} />}
        {boxes.map((b) => (
          <div
            key={b.id}
            className={'line-box' + (b.id === selectedId ? ' selected' : '') + (b.shrunk ? ' shrunk' : '')}
            style={{ left: b.x - 4, top: b.y - 2, width: b.w + 8, height: b.h + 4 }}
            onPointerDown={(e) => down(e, b.id)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onDoubleClick={() => onEditText(b.id)}
            title="Потяните, чтобы передвинуть. Двойной щелчок — изменить текст"
          >
            {b.id === selectedId && (
              <>
                <span className="lb-handle l" onPointerDown={(e) => startResize(e, b, -1)} onPointerMove={moveResize} onPointerUp={endResize} title="Потяните — больше или меньше" />
                <span className="lb-handle r" onPointerDown={(e) => startResize(e, b, 1)} onPointerMove={moveResize} onPointerUp={endResize} title="Потяните — больше или меньше" />
              </>
            )}
            {b.shrunk && b.id === selectedId && <span className="shrunk-note">уменьшено, чтобы влезло</span>}
          </div>
        ))}
      </div>

      {sel && selLine && (
        <div className="line-bar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="lb-name" title="Выбранная строка">
            {selLine.text.replace(/[{}]/g, '') || 'строка'}
          </span>
          <i className="lb-sep" />
          <button onClick={() => step(-0.5)} title="Меньше (клавиша −)">
            A−
          </button>
          <span className="lb-size" title="Размер шрифта">
            {selLine.size}
          </span>
          <button onClick={() => step(0.5)} title="Больше (клавиша +)">
            A+
          </button>
          <i className="lb-sep" />
          <button className={selLine.bold ? 'on' : ''} onClick={() => onPatch(selLine.id, { bold: !selLine.bold })} title="Жирный">
            <b>Ж</b>
          </button>
          <button className={selLine.italic ? 'on' : ''} onClick={() => onPatch(selLine.id, { italic: !selLine.italic })} title="Курсив">
            <i>К</i>
          </button>
          <i className="lb-sep" />
          {(['left', 'center', 'right'] as Align[]).map((a) => (
            <button key={a} className={selLine.align === a ? 'on' : ''} onClick={() => onPatch(selLine.id, { align: a })} title={ALIGN_TITLE[a]}>
              <AlignGlyph a={a} />
            </button>
          ))}
          <i className="lb-sep" />
          <button onClick={() => onEditText(selLine.id)} title="Изменить текст, шрифт и цвет">
            ✎ Текст
          </button>
          <button onClick={() => onDuplicate(selLine.id)} title="Копия строки">
            ⧉
          </button>
          <button onClick={() => onPatch(selLine.id, { enabled: false })} title="Скрыть строку">
            🙈
          </button>
          <button className="danger" onClick={() => onRemove(selLine.id)} title="Удалить строку">
            🗑
          </button>
        </div>
      )}
      {!sel && <div className="line-bar idle">👆 Нажмите на строку на наклейке, чтобы изменить её</div>}
    </div>
  )
}

export function AlignGlyph({ a }: { a: Align }) {
  const rows = a === 'left' ? [[2, 14], [2, 10], [2, 12]] : a === 'right' ? [[2, 14], [6, 10], [4, 12]] : [[2, 14], [4, 10], [3, 12]]
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      {rows.map(([x, w], i) => (
        <rect key={i} x={x} y={2 + i * 4} width={w} height={2} rx={1} fill="currentColor" />
      ))}
    </svg>
  )
}
