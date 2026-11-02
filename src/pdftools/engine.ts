import { PDFDocument, degrees } from 'pdf-lib'
import { zipSync } from 'fflate'
import { forgetPdf, openPdf } from '../pdf'
import { imageToPdf, isImage, isPdf } from '../importer'
import { uid } from '../util'

/** Исходный файл, открытый в «Работе с PDF». Хранится только в памяти, пока открыта вкладка. */
export interface Source {
  id: string
  name: string
  bytes: ArrayBuffer
}

/** Один лист в рабочей области: ссылка на лист исходного файла (или пустой лист). */
export interface PageRef {
  key: string
  src: string | null // null — пустой лист
  index: number
  rot: number // дополнительный поворот: 0, 90, 180, 270
  w: number // размер в пунктах (как видно на экране, без нашего поворота)
  h: number
}

export const docId = (srcId: string) => 'tool:' + srcId

export async function loadFile(file: File): Promise<{ source: Source; pages: PageRef[] }> {
  if (!isPdf(file) && !isImage(file)) throw new Error(`«${file.name}» — не PDF и не картинка`)
  const bytes = isPdf(file) ? await file.arrayBuffer() : await imageToPdf(file)
  const source: Source = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), bytes }
  const doc = await openPdf(docId(source.id), bytes)
  const pages: PageRef[] = []
  for (let i = 0; i < doc.numPages; i++) {
    const v = (await doc.getPage(i + 1)).getViewport({ scale: 1 })
    pages.push({ key: uid(), src: source.id, index: i, rot: 0, w: v.width, h: v.height })
  }
  return { source, pages }
}

export function dropSource(id: string) {
  forgetPdf(docId(id))
}

export function blankPage(like?: PageRef): PageRef {
  const portrait = !like || like.h >= like.w
  const [w, h] = portrait ? [595.28, 841.89] : [841.89, 595.28]
  return { key: uid(), src: null, index: 0, rot: 0, w, h }
}

/** Собираем PDF из листов. Листы копируются как есть — без потери качества. */
export async function buildPdf(pages: PageRef[], sources: Map<string, Source>): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const loaded = new Map<string, PDFDocument>()
  for (const p of pages) {
    if (!p.src) {
      out.addPage([p.w, p.h])
      continue
    }
    let src = loaded.get(p.src)
    if (!src) {
      const s = sources.get(p.src)
      if (!s) throw new Error('Исходный файл не найден')
      src = await PDFDocument.load(s.bytes, { ignoreEncryption: true })
      loaded.set(p.src, src)
    }
    const [copy] = await out.copyPages(src, [p.index])
    if (p.rot) copy.setRotation(degrees((copy.getRotation().angle + p.rot) % 360))
    out.addPage(copy)
  }
  return out.save()
}

/** «1-3, 5, 8-10» → [[1,2,3],[5],[8,9,10]] (номера с единицы). */
export function parseRanges(text: string, total: number): number[][] {
  const groups: number[][] = []
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:[-–—](\d+))?$/)
    if (!m) throw new Error(`Не понял «${part}». Пишите так: 1-3, 5, 7-9`)
    const a = +m[1]
    const b = m[2] ? +m[2] : a
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`В файле только ${total} листов, а указано «${part}»`)
    const g: number[] = []
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) g.push(i)
    groups.push(g)
  }
  if (!groups.length) throw new Error('Укажите, какие листы взять, например: 1-3, 5')
  return groups
}

export function download(data: Uint8Array | Blob, name: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/pdf' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** Несколько PDF — одним архивом .zip */
export async function saveGroups(groups: PageRef[][], sources: Map<string, Source>, base: string, onProgress?: (i: number, n: number) => void) {
  if (groups.length === 1) {
    download(await buildPdf(groups[0], sources), base + '.pdf')
    return
  }
  const files: Record<string, Uint8Array> = {}
  const width = String(groups.length).length
  for (let i = 0; i < groups.length; i++) {
    onProgress?.(i + 1, groups.length)
    files[`${base} — часть ${String(i + 1).padStart(width, '0')}.pdf`] = await buildPdf(groups[i], sources)
  }
  const zip = zipSync(files, { level: 0 })
  download(new Blob([zip as BlobPart], { type: 'application/zip' }), base + ' (разделено).zip')
}
