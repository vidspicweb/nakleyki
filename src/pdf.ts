import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import type { Grid, Rect } from './types'
import { loadPdf } from './storage'

// Рабочий поток pdf.js встраиваем прямо в страницу, чтобы всё работало даже из одного файла.
// Запускаем его как обычный (не модульный) скрипт: при открытии файла двойным щелчком (file://)
// браузер не разрешает модульные потоки. Для этого убираем завершающий `export {...}`.
const classicWorker = workerSrc.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '')
pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([classicWorker], { type: 'text/javascript' })))

const docs = new Map<string, Promise<PDFDocumentProxy>>()

export function openPdf(templateId: string, bytes?: ArrayBuffer): Promise<PDFDocumentProxy> {
  let p = docs.get(templateId)
  if (!p) {
    p = (async () => {
      const b = bytes ?? (await loadPdf(templateId))
      if (!b) throw new Error('Файл шаблона не найден')
      // pdf.js забирает буфер себе — отдаём копию
      return pdfjs.getDocument({ data: new Uint8Array(b.slice(0)) }).promise
    })()
    docs.set(templateId, p)
    p.catch(() => docs.delete(templateId))
  }
  return p
}

export function forgetPdf(templateId: string) {
  docs.delete(templateId)
}

const renders = new Map<string, Promise<HTMLCanvasElement>>()

/** Картинка страницы шириной примерно `width` пикселей (с кэшем). */
export function renderPage(templateId: string, pageIndex: number, width: number): Promise<HTMLCanvasElement> {
  const key = `${templateId}:${pageIndex}:${width}`
  let p = renders.get(key)
  if (!p) {
    p = (async () => {
      const doc = await openPdf(templateId)
      const page = await doc.getPage(pageIndex + 1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      return canvas
    })()
    renders.set(key, p)
    p.catch(() => renders.delete(key))
  }
  return p
}

export async function pageSizePt(templateId: string, pageIndex: number) {
  const doc = await openPdf(templateId)
  const page = await doc.getPage(pageIndex + 1)
  const v = page.getViewport({ scale: 1 })
  return { widthPt: v.width, heightPt: v.height }
}

export function gridCells(g: Grid): Rect[] {
  const w = (1 - g.left - g.right - g.gapX * (g.cols - 1)) / g.cols
  const h = (1 - g.top - g.bottom - g.gapY * (g.rows - 1)) / g.rows
  const cells: Rect[] = []
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) cells.push({ x: g.left + c * (w + g.gapX), y: g.top + r * (h + g.gapY), w, h })
  return cells
}

export const DEFAULT_GRID: Grid = { cols: 2, rows: 4, left: 0.01, top: 0.01, right: 0.01, bottom: 0.01, gapX: 0.01, gapY: 0.008 }

/**
 * Ищем сетку наклеек. Наклейки на листе — одинаковые копии, поэтому проверяем,
 * с каким шагом картинка повторяется по горизонтали и вертикали.
 * Если найти не получилось — ставим обычную сетку 2×4 (её можно поправить вручную).
 */
export function detectGrid(canvas: HTMLCanvasElement): Grid {
  const W = canvas.width
  const H = canvas.height
  const data = canvas.getContext('2d')!.getImageData(0, 0, W, H).data
  const gray = new Float32Array(W * H)
  const colWhite = new Float32Array(W)
  const rowWhite = new Float32Array(H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      gray[y * W + x] = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) {
        colWhite[x]++
        rowWhite[y]++
      }
    }
  for (let x = 0; x < W; x++) colWhite[x] /= H
  for (let y = 0; y < H; y++) rowWhite[y] /= W

  const trim = (prof: Float32Array) => {
    let s = 0
    let e = prof.length
    while (s < e && prof[s] > 0.95) s++
    while (e > s && prof[e - 1] > 0.95) e--
    return [s, e] as const
  }

  // средняя разница между картинкой и ею же, сдвинутой на sh пикселей
  const diff = (axis: 'x' | 'y', s: number, e: number, sh: number) => {
    let tot = 0
    let cnt = 0
    if (axis === 'x') {
      for (let y = 0; y < H; y += 2) for (let x = s; x < e - sh; x += 2) (tot += Math.abs(gray[y * W + x] - gray[y * W + x + sh])), cnt++
    } else {
      for (let y = s; y < e - sh; y += 2) for (let x = 0; x < W; x += 2) (tot += Math.abs(gray[y * W + x] - gray[(y + sh) * W + x])), cnt++
    }
    return cnt ? tot / cnt : Infinity
  }

  const count = (axis: 'x' | 'y', s: number, e: number, maxC: number) => {
    for (let c = maxC; c >= 2; c--) {
      const P = (e - s) / c
      let d = Infinity
      for (let k = -2; k <= 2; k++) d = Math.min(d, diff(axis, s, e, Math.round(P) + k))
      const half = diff(axis, s, e, Math.round(P / 2))
      if (d < 0.3 * half) return c
    }
    return 1
  }

  // ширина белой полоски между наклейками (если она есть)
  const gapWidth = (prof: Float32Array, s: number, e: number, c: number) => {
    if (c < 2) return 0
    const widths: number[] = []
    const tol = Math.max(3, Math.round(prof.length * 0.015))
    for (let q = 1; q < c; q++) {
      const pos = Math.round(s + (q * (e - s)) / c)
      let w = 0
      for (let i = pos - tol; i <= pos + tol; i++) if (prof[i] > 0.6) w++
      widths.push(w)
    }
    return widths.reduce((a, b) => a + b, 0) / widths.length / prof.length
  }

  const [cs, ce] = trim(colWhite)
  const [rs, re] = trim(rowWhite)
  if (ce - cs < W * 0.2 || re - rs < H * 0.2) return { ...DEFAULT_GRID }
  const cols = count('x', cs, ce, 4)
  const rows = count('y', rs, re, 10)
  if (cols * rows < 2) return { ...DEFAULT_GRID }
  return {
    cols,
    rows,
    left: cs / W,
    right: 1 - ce / W,
    top: rs / H,
    bottom: 1 - re / H,
    gapX: gapWidth(colWhite, cs, ce, cols),
    gapY: gapWidth(rowWhite, rs, re, rows),
  }
}
