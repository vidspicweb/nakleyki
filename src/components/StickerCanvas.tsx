import { useEffect, useRef, useState } from 'react'
import type { SchoolClass, Sheet, Student } from '../types'
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
}

/** Большая наклейка, на которой строки можно двигать мышкой. */
export function StickerCanvas({ sheet, cellIndex, student, cls, width, selectedId, onSelect, onMove }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [boxes, setBoxes] = useState<LineBox[]>([])
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const drag = useRef<{ id: string; sx: number; sy: number; lx: number; ly: number } | null>(null)

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

  const down = (e: React.PointerEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(id)
    const l = sheet.layout.lines.find((x) => x.id === id)!
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

  return (
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
          title="Потяните, чтобы передвинуть"
        >
          {b.shrunk && b.id === selectedId && <span className="shrunk-note">уменьшено, чтобы влезло</span>}
        </div>
      ))}
    </div>
  )
}
