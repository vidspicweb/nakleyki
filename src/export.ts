import { PDFDocument } from 'pdf-lib'
import type { PDFEmbeddedPage } from 'pdf-lib'
import type { SchoolClass, Sheet, Student } from './types'
import { loadPdf } from './storage'
import { gridCells } from './pdf'
import { drawCellText } from './render'
import { ensureFonts } from './fonts'
import { fillText } from './names'

export interface PrintItem {
  student: Student
  cls: SchoolClass
}

export interface PlannedPage {
  sheet: Sheet
  items: (PrintItem | null)[] // по одной на каждую ячейку
}

export function planPages(sheets: Sheet[], classes: SchoolClass[], copies: number): PlannedPage[] {
  const items: PrintItem[] = []
  for (const cls of classes) for (const s of cls.students) for (let i = 0; i < copies; i++) items.push({ student: s, cls })
  const pages: PlannedPage[] = []
  for (const sheet of sheets) {
    const per = sheet.grid.cols * sheet.grid.rows
    for (let i = 0; i < items.length; i += per) {
      const chunk: (PrintItem | null)[] = items.slice(i, i + per)
      while (chunk.length < per) chunk.push(null)
      pages.push({ sheet, items: chunk })
    }
  }
  return pages
}

const DPI = 300

export async function buildPdf(pages: PlannedPage[], onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  out.setTitle('Наклейки на тетради')
  out.setCreator('Наклейки — школьный помощник')

  const srcDocs = new Map<string, PDFDocument>()
  const embedded = new Map<string, PDFEmbeddedPage>()

  // заранее подгружаем шрифты со всеми буквами, которые встретятся
  for (const sheet of new Set(pages.map((p) => p.sheet))) {
    const texts = pages
      .filter((p) => p.sheet === sheet)
      .flatMap((p) => p.items.filter(Boolean).flatMap((it) => sheet.layout.lines.map((l) => fillText(l.text, it!.student, it!.cls, sheet))))
    await ensureFonts(sheet.layout.lines, [...new Set(texts.join(''))].join('') + 'Aa1')
  }

  let done = 0
  for (const p of pages) {
    const sheet = p.sheet
    let src = srcDocs.get(sheet.templateId)
    if (!src) {
      const bytes = await loadPdf(sheet.templateId)
      if (!bytes) throw new Error(`Не найден файл шаблона «${sheet.name}»`)
      src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      srcDocs.set(sheet.templateId, src)
    }
    const key = sheet.templateId + ':' + sheet.pageIndex
    let emb = embedded.get(key)
    if (!emb) {
      emb = await out.embedPage(src.getPage(sheet.pageIndex))
      embedded.set(key, emb)
    }
    const W = emb.width
    const H = emb.height
    const page = out.addPage([W, H])
    page.drawPage(emb, { x: 0, y: 0, width: W, height: H })

    const cells = gridCells(sheet.grid)
    for (let i = 0; i < cells.length; i++) {
      const it = p.items[i]
      if (!it) continue
      const c = cells[i]
      const cw = c.w * W
      const ch = c.h * H
      const k = DPI / 72
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(cw * k)
      canvas.height = Math.ceil(ch * k)
      const ctx = canvas.getContext('2d')!
      drawCellText(ctx, sheet.layout, it.student, it.cls, sheet, cw, ch, k)
      const png = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'))
      const img = await out.embedPng(await png.arrayBuffer())
      page.drawImage(img, { x: c.x * W, y: H - (c.y + c.h) * H, width: cw, height: ch })
    }
    done++
    onProgress?.(done, pages.length)
    await new Promise((r) => setTimeout(r, 0))
  }
  return out.save()
}
