import { PDFDocument } from 'pdf-lib'
import type { Sheet, TemplateFile } from './types'
import { detectGrid, openPdf, pageSizePt, renderPage } from './pdf'
import { askPersistentStorage, savePdf, saveThumb } from './storage'
import { cloneLayout, defaultLayout } from './render'
import type { Layout } from './types'
import { applyTag } from './tags'
import { uid } from './util'

const A4 = { w: 595.28, h: 841.89 }

export const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
export const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)

/** Картинку превращаем в PDF из одной страницы — дальше с ней работаем как с обычным шаблоном. */
export async function imageToPdf(file: File): Promise<ArrayBuffer> {
  const bytes = await file.arrayBuffer()
  const doc = await PDFDocument.create()
  let img
  if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name)) img = await doc.embedJpg(bytes)
  else if (/png$/i.test(file.type) || /\.png$/i.test(file.name)) img = await doc.embedPng(bytes)
  else {
    // webp, gif, bmp — перерисовываем в PNG
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'))
    img = await doc.embedPng(await png.arrayBuffer())
  }
  const ratio = img.height / img.width
  // похоже на A4 — делаем ровно A4, иначе сохраняем пропорции картинки
  let w = A4.w
  let h = A4.w * ratio
  if (Math.abs(ratio - A4.h / A4.w) < 0.04) h = A4.h
  else if (Math.abs(ratio - A4.w / A4.h) < 0.04) ((w = A4.h), (h = A4.w))
  else if (ratio < 1) ((w = A4.h), (h = A4.h * ratio))
  const page = doc.addPage([w, h])
  page.drawImage(img, { x: 0, y: 0, width: w, height: h })
  const out = await doc.save()
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

export async function makeThumb(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('thumb'))), 'image/jpeg', 0.82))
}

/** Добавляем файл в библиотеку: каждая страница — отдельный шаблон. */
export async function importFile(
  file: File,
  opts: { tags: string[]; baseLayout?: Layout; onStep?: (msg: string) => void },
): Promise<{ template: TemplateFile; sheets: Sheet[] }> {
  void askPersistentStorage() // не ждём: браузер может спросить разрешение
  const image = !isPdf(file)
  opts.onStep?.(`Читаем «${file.name}»…`)
  const bytes = image ? await imageToPdf(file) : await file.arrayBuffer()
  const id = uid()
  const doc = await openPdf(id, bytes)
  await savePdf(id, bytes)
  const name = file.name.replace(/\.[^.]+$/, '')
  const now = Date.now()
  const template: TemplateFile = { id, name, pageCount: doc.numPages, kind: image ? 'image' : 'pdf', addedAt: now }
  const sheets: Sheet[] = []
  for (let i = 0; i < doc.numPages; i++) {
    opts.onStep?.(doc.numPages > 1 ? `«${name}»: лист ${i + 1} из ${doc.numPages}…` : `Ищем наклейки в «${name}»…`)
    const size = await pageSizePt(id, i)
    const canvas = await renderPage(id, i, 400)
    const sheet: Sheet = {
      id: uid(),
      templateId: id,
      pageIndex: i,
      name: doc.numPages > 1 ? `${name} — лист ${i + 1}` : name,
      subject: '',
      grid: detectGrid(canvas),
      layout: cloneLayout(opts.baseLayout ?? defaultLayout()),
      tags: [],
      addedAt: now,
      ...size,
    }
    for (const t of opts.tags) applyTag(sheet, t, true)
    await saveThumb(sheet.id, await makeThumb(canvas))
    sheets.push(sheet)
  }
  return { template, sheets }
}
