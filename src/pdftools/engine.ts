import { PDFDocument, degrees, rgb } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import { zipSync } from 'fflate'
import { forgetPdf, openPdf, renderPage } from '../pdf'
import { FULL, compose, fracToPdf } from './geom'
import type { FRect } from './geom'
import { imageToPdf, isImage, isPdf } from '../importer'
import { uid } from '../util'

/** Исходный файл, открытый в «Работе с PDF». Хранится только в памяти, пока открыта вкладка. */
export interface Source {
  id: string
  name: string
  bytes: ArrayBuffer
}

/**
 * Фрагмент, скопированный в «буфер»: часть какого-то листа.
 * rect — доля от целого исходного листа (как его показывает просмотрщик), viewRot — как лист был повёрнут у нас на экране.
 */
export interface FragmentRef {
  src: string
  index: number
  rect: FRect
  viewRot: number
  fw: number
  fh: number
}

/** Размер фрагмента в пунктах так, как он виден на экране. */
export function fragSize(f: FragmentRef) {
  const w = f.rect.w * f.fw
  const h = f.rect.h * f.fh
  return f.viewRot % 180 ? { w: h, h: w } : { w, h }
}

/**
 * Правка внутри листа. Доли — от (обрезанного) листа без нашего поворота.
 *  copy  — копия области этого же листа;
 *  erase — область, закрашенная белым;
 *  place — вставленный фрагмент из буфера (с любого листа).
 */
export type Edit = { kind: 'copy'; from: FRect; to: FRect } | { kind: 'erase'; rect: FRect } | { kind: 'place'; frag: FragmentRef; to: FRect }

const norm = (d: number) => (((d % 360) + 360) % 360)

/** Один лист в рабочей области: ссылка на лист исходного файла (или пустой лист). */
export interface PageRef {
  key: string
  src: string | null // null — пустой лист
  index: number
  rot: number // дополнительный поворот: 0, 90, 180, 270
  w: number // размер в пунктах (как видно на экране, без нашего поворота; с учётом обрезки)
  h: number
  fw: number // размер целого исходного листа
  fh: number
  crop?: FRect // какая часть исходного листа (после разрезания)
  edits?: Edit[]
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
    pages.push({ key: uid(), src: source.id, index: i, rot: 0, w: v.width, h: v.height, fw: v.width, fh: v.height })
  }
  return { source, pages }
}

export function dropSource(id: string) {
  forgetPdf(docId(id))
}

export function blankPage(like?: PageRef): PageRef {
  const portrait = !like || like.h >= like.w
  const [w, h] = portrait ? [595.28, 841.89] : [841.89, 595.28]
  return { key: uid(), src: null, index: 0, rot: 0, w, h, fw: w, fh: h }
}

/** Собираем PDF из листов. Листы копируются как есть — без потери качества. */
export async function buildPdf(pages: PageRef[], sources: Map<string, Source>): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const loaded = new Map<string, PDFDocument>()
  const getSrc = async (id: string) => {
    let d = loaded.get(id)
    if (!d) {
      const s = sources.get(id)
      if (!s) throw new Error('Исходный файл не найден')
      d = await PDFDocument.load(s.bytes, { ignoreEncryption: true })
      loaded.set(id, d)
    }
    return d
  }

  /** Вставляем фрагмент в прямоугольник T (координаты PDF) листа, который на экране повёрнут на totalTgt. */
  const drawPlace = async (target: PDFPage, frag: FragmentRef, T: { x: number; y: number; w: number; h: number }, totalTgt: number) => {
    const sp = (await getSrc(frag.src)).getPage(frag.index)
    const r0s = sp.getRotation().angle
    const F = fracToPdf(frag.rect, sp.getCropBox(), r0s)
    const emb = await out.embedPage(sp, { left: F.x, bottom: F.y, right: F.x + F.w, top: F.y + F.h })
    // насколько повернуть фрагмент, чтобы он выглядел так же, как там, откуда его скопировали
    const phi = norm(totalTgt - (r0s + frag.viewRot))
    if (phi === 90) target.drawPage(emb, { x: T.x + T.w, y: T.y, width: T.h, height: T.w, rotate: degrees(90) })
    else if (phi === 180) target.drawPage(emb, { x: T.x + T.w, y: T.y + T.h, width: T.w, height: T.h, rotate: degrees(180) })
    else if (phi === 270) target.drawPage(emb, { x: T.x, y: T.y + T.h, width: T.h, height: T.w, rotate: degrees(270) })
    else target.drawPage(emb, { x: T.x, y: T.y, width: T.w, height: T.h })
  }

  for (const p of pages) {
    if (!p.src) {
      const blank = out.addPage([p.w, p.h])
      const box = { x: 0, y: 0, width: p.w, height: p.h }
      for (const e of p.edits ?? []) if (e.kind === 'place') await drawPlace(blank, e.frag, fracToPdf(e.to, box, 0), p.rot)
      if (p.rot) blank.setRotation(degrees(p.rot))
      continue
    }
    const src = await getSrc(p.src)
    const [copy] = await out.copyPages(src, [p.index])
    if (p.crop || p.edits?.length) {
      const orig = src.getPage(p.index)
      const box = orig.getCropBox()
      const r0 = orig.getRotation().angle
      const crop = p.crop ?? FULL
      for (const e of p.edits ?? []) {
        if (e.kind === 'erase') {
          const R = fracToPdf(compose(crop, e.rect), box, r0)
          copy.drawRectangle({ x: R.x, y: R.y, width: R.w, height: R.h, color: rgb(1, 1, 1) })
        } else if (e.kind === 'copy') {
          // копия области — векторная, без потери качества
          const F = fracToPdf(compose(crop, e.from), box, r0)
          const T = fracToPdf(compose(crop, e.to), box, r0)
          const emb = await out.embedPage(orig, { left: F.x, bottom: F.y, right: F.x + F.w, top: F.y + F.h })
          copy.drawPage(emb, { x: T.x, y: T.y, width: T.w, height: T.h })
        } else {
          await drawPlace(copy, e.frag, fracToPdf(compose(crop, e.to), box, r0), r0 + p.rot)
        }
      }
      if (p.crop) {
        const C = fracToPdf(p.crop, box, r0)
        copy.setMediaBox(C.x, C.y, C.w, C.h)
        copy.setCropBox(C.x, C.y, C.w, C.h)
        copy.setTrimBox(C.x, C.y, C.w, C.h)
        copy.setBleedBox(C.x, C.y, C.w, C.h)
        copy.setArtBox(C.x, C.y, C.w, C.h)
      }
    }
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

// ---------- картинки листов для экрана ----------

/** Целый исходный лист картинкой, достаточно крупной для нужной ширины куска. */
export function fullRender(p: PageRef, pieceWidthPx: number): Promise<HTMLCanvasElement> {
  const need = pieceWidthPx / (p.crop?.w ?? 1)
  const w = need > 1200 ? 2000 : need > 600 ? 1200 : need > 300 ? 600 : 300
  if (!p.src) {
    // пустой лист — просто белый
    const c = document.createElement('canvas')
    c.width = w
    c.height = Math.round((w * p.fh) / p.fw)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    return Promise.resolve(c)
  }
  return renderPage(docId(p.src), p.index, w)
}

export type SourceCanvases = Map<string, HTMLCanvasElement>

/** Картинки листов, с которых взяты вставленные фрагменты. */
export async function placeSources(edits: Edit[] = []): Promise<SourceCanvases> {
  const m: SourceCanvases = new Map()
  for (const e of edits)
    if (e.kind === 'place') {
      const k = e.frag.src + ':' + e.frag.index
      if (!m.has(k)) m.set(k, await renderPage(docId(e.frag.src), e.frag.index, 1200))
    }
  return m
}

/** Лист картинкой, как он будет в PDF (обрезка, правки, вставки, поворот). */
export async function renderDisplay(p: PageRef, widthPx: number, edits = p.edits ?? []): Promise<HTMLCanvasElement> {
  const turned = p.rot % 180 !== 0
  const full = await fullRender(p, turned ? (widthPx * p.w) / p.h : widthPx)
  return composeDisplay(full, p, widthPx, edits, await placeSources(edits))
}

/**
 * Рисует лист так, как он будет в PDF: обрезка, правки, поворот.
 * edits можно передать свои — для живого просмотра в редакторе.
 */
export function composeDisplay(full: HTMLCanvasElement, p: PageRef, widthPx: number, edits = p.edits ?? [], srcs: SourceCanvases = new Map()): HTMLCanvasElement {
  const crop = p.crop ?? FULL
  const FW = full.width
  const FH = full.height
  const px = (r: FRect) => ({ x: r.x * FW, y: r.y * FH, w: r.w * FW, h: r.h * FH })
  let base = full
  if (edits.length) {
    base = document.createElement('canvas')
    base.width = FW
    base.height = FH
    const b = base.getContext('2d')!
    b.drawImage(full, 0, 0)
    for (const e of edits) {
      if (e.kind === 'erase') {
        const r = px(compose(crop, e.rect))
        b.fillStyle = '#fff'
        b.fillRect(r.x, r.y, r.w, r.h)
      } else if (e.kind === 'copy') {
        const f = px(compose(crop, e.from))
        const t = px(compose(crop, e.to))
        if (f.w > 0 && f.h > 0) b.drawImage(full, f.x, f.y, f.w, f.h, t.x, t.y, t.w, t.h)
      } else {
        const sc = srcs.get(e.frag.src + ':' + e.frag.index)
        if (!sc) continue
        const t = px(compose(crop, e.to))
        const theta = norm(e.frag.viewRot - p.rot)
        const fr = e.frag.rect
        b.save()
        b.translate(t.x + t.w / 2, t.y + t.h / 2)
        b.rotate((theta * Math.PI) / 180)
        const dw = theta % 180 ? t.h : t.w
        const dh = theta % 180 ? t.w : t.h
        b.drawImage(sc, fr.x * sc.width, fr.y * sc.height, fr.w * sc.width, fr.h * sc.height, -dw / 2, -dh / 2, dw, dh)
        b.restore()
      }
    }
  }
  const c = px(crop)
  const turned = p.rot % 180 !== 0
  const outW = Math.max(1, Math.round(widthPx))
  const outH = Math.max(1, Math.round(turned ? (widthPx * c.w) / c.h : (widthPx * c.h) / c.w))
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, outW, outH)
  ctx.translate(outW / 2, outH / 2)
  ctx.rotate((p.rot * Math.PI) / 180)
  const dw = turned ? outH : outW
  const dh = turned ? outW : outH
  ctx.drawImage(base, c.x, c.y, c.w, c.h, -dw / 2, -dh / 2, dw, dh)
  return out
}
