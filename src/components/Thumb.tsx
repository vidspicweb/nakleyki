import { useEffect, useState } from 'react'
import type { Sheet } from '../types'
import { gridCells, renderPage } from '../pdf'
import { loadThumb, saveThumb } from '../storage'
import { makeThumb } from '../importer'

const urls = new Map<string, Promise<string>>()

function thumbUrl(sheet: Sheet): Promise<string> {
  let p = urls.get(sheet.id)
  if (!p) {
    p = (async () => {
      let blob = await loadThumb(sheet.id)
      if (!blob) {
        // старые шаблоны без миниатюры — делаем один раз и запоминаем
        blob = await makeThumb(await renderPage(sheet.templateId, sheet.pageIndex, 400))
        await saveThumb(sheet.id, blob)
      }
      return URL.createObjectURL(blob)
    })()
    urls.set(sheet.id, p)
    p.catch(() => urls.delete(sheet.id))
  }
  return p
}

/** Быстрая миниатюра листа (из сохранённой картинки) с рамками наклеек. */
export function Thumb({ sheet, width, showGrid }: { sheet: Sheet; width: number; showGrid?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const h = (width * sheet.heightPt) / sheet.widthPt
  useEffect(() => {
    let alive = true
    thumbUrl(sheet).then((u) => alive && setUrl(u), console.error)
    return () => {
      alive = false
    }
  }, [sheet])
  return (
    <div className="sheet-preview thumb" style={{ width, height: h }}>
      {url ? <img src={url} alt="" draggable={false} style={{ width, height: h }} /> : <div className="sheet-loading" />}
      {showGrid && url && (
        <svg className="thumb-grid" viewBox="0 0 1 1" preserveAspectRatio="none">
          {gridCells(sheet.grid).map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
    </div>
  )
}
