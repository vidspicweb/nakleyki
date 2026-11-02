import { useEffect, useRef, useState } from 'react'
import type { SchoolClass, Sheet, Student } from '../types'
import { gridCells, renderPage } from '../pdf'
import { drawCellText } from '../render'
import { ensureFonts } from '../fonts'

interface Props {
  sheet: Sheet
  width: number // ширина рисунка в CSS-пикселях
  showGrid?: boolean
  items?: ({ student: Student; cls: SchoolClass } | null)[]
  highlightCell?: number
  onCellClick?: (i: number) => void
  className?: string
}

/** Картинка листа: фон из PDF + (по желанию) сетка и вписанный текст. */
export function SheetPreview({ sheet, width, showGrid, items, highlightCell, onCellClick, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const aspect = sheet.heightPt / sheet.widthPt

  useEffect(() => {
    let cancelled = false
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pxW = Math.round(width * dpr)
    ;(async () => {
      try {
        const bg = await renderPage(sheet.templateId, sheet.pageIndex, pxW >= 700 ? 1400 : pxW > 350 ? 800 : 400)
        if (items) await ensureFonts(sheet.layout.lines)
        if (cancelled || !ref.current) return
        const c = ref.current
        c.width = pxW
        c.height = Math.round(pxW * aspect)
        const ctx = c.getContext('2d')!
        ctx.drawImage(bg, 0, 0, c.width, c.height)
        const cells = gridCells(sheet.grid)
        const pxPerPt = c.width / sheet.widthPt
        if (items) {
          cells.forEach((cell, i) => {
            const it = items[i]
            if (!it) return
            ctx.save()
            ctx.beginPath()
            ctx.rect(cell.x * c.width, cell.y * c.height, cell.w * c.width, cell.h * c.height)
            ctx.clip()
            drawCellText(ctx, sheet.layout, it.student, it.cls, sheet, cell.w * sheet.widthPt, cell.h * sheet.heightPt, pxPerPt, cell.x * c.width, cell.y * c.height)
            ctx.restore()
          })
        }
        if (showGrid) {
          ctx.lineWidth = Math.max(1.5, dpr * 1.5)
          cells.forEach((cell, i) => {
            ctx.strokeStyle = i === highlightCell ? '#ff5a5f' : 'rgba(46, 108, 255, .9)'
            ctx.setLineDash(i === highlightCell ? [] : [6 * dpr, 4 * dpr])
            ctx.strokeRect(cell.x * c.width, cell.y * c.height, cell.w * c.width, cell.h * c.height)
          })
        }
        setReady(true)
      } catch (e) {
        console.error(e)
        if (!cancelled) setErr('Не удалось показать страницу')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sheet, width, showGrid, items, highlightCell, aspect])

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onCellClick) return
    const r = e.currentTarget.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const i = gridCells(sheet.grid).findIndex((c) => fx >= c.x && fx <= c.x + c.w && fy >= c.y && fy <= c.y + c.h)
    if (i >= 0) onCellClick(i)
  }

  return (
    <div className={'sheet-preview ' + (className ?? '')} style={{ width, height: width * aspect }}>
      {err ? <div className="muted center pad">{err}</div> : <canvas ref={ref} style={{ width, height: width * aspect, cursor: onCellClick ? 'pointer' : undefined }} onClick={click} />}
      {!ready && !err && <div className="sheet-loading" />}
    </div>
  )
}
