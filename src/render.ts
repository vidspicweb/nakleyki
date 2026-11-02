import type { Layout, SchoolClass, Sheet, Student, TextLine } from './types'
import { cssFont } from './fonts'
import { fillText } from './names'

export interface LineBox {
  id: string
  x: number
  y: number
  w: number
  h: number
  shrunk: boolean
}

/**
 * Рисует текст одной наклейки. Размер наклейки задаётся в пунктах (cellWpt × cellHpt),
 * pxPerPt — сколько пикселей холста приходится на один пункт.
 * Одна и та же функция используется и в редакторе, и при создании PDF — поэтому
 * результат в PDF выглядит ровно так же, как на экране.
 */
export function drawCellText(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  student: Student,
  cls: SchoolClass,
  sheet: Pick<Sheet, 'subject'>,
  cellWpt: number,
  cellHpt: number,
  pxPerPt: number,
  offsetX = 0,
  offsetY = 0,
): LineBox[] {
  const boxes: LineBox[] = []
  const W = cellWpt * pxPerPt
  const H = cellHpt * pxPerPt
  for (const line of layout.lines) {
    if (!line.enabled) continue
    const text = fillText(line.text, student, cls, sheet).trim()
    if (!text) continue
    let px = line.size * pxPerPt
    ctx.font = cssFont(line, px)
    let m = ctx.measureText(text)
    const maxW = line.maxWidth * W
    let shrunk = false
    if (m.width > maxW && maxW > 0) {
      px = Math.max(1, (px * maxW) / m.width)
      ctx.font = cssFont(line, px)
      m = ctx.measureText(text)
      shrunk = true
    }
    const ax = offsetX + line.x * W
    const by = offsetY + line.y * H
    ctx.fillStyle = line.color
    ctx.textAlign = line.align
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, ax, by)
    const left = line.align === 'left' ? ax : line.align === 'center' ? ax - m.width / 2 : ax - m.width
    const asc = m.fontBoundingBoxAscent ?? px * 0.8
    const desc = m.fontBoundingBoxDescent ?? px * 0.25
    boxes.push({ id: line.id, x: left, y: by - asc, w: m.width, h: asc + desc, shrunk })
  }
  return boxes
}

let n = 0
const lid = () => 'l' + Date.now().toString(36) + (n++).toString(36)

export function newLine(partial: Partial<TextLine> = {}): TextLine {
  return {
    id: lid(),
    text: 'Новая строка',
    font: 'Nunito',
    size: 12,
    bold: false,
    italic: false,
    color: '#1b1f3b',
    align: 'center',
    x: 0.45,
    y: 0.5,
    maxWidth: 0.6,
    enabled: true,
    ...partial,
  }
}

/** Раскладка «как на фото»: класс, школа, фамилия, имя — в свободной белой части наклейки. */
export function defaultLayout(): Layout {
  return {
    lines: [
      newLine({ text: 'Тетрадь № 1', bold: true, size: 14, y: 0.3, enabled: false }),
      newLine({ text: 'для работ по {предмет}', size: 11, y: 0.4, enabled: false }),
      newLine({ text: '{ученика} {класс} класса {буква}', font: 'Caveat', size: 13, y: 0.6 }),
      newLine({ text: '{школа}', font: 'Caveat', size: 13, y: 0.69 }),
      newLine({ text: '{Фамилия}', bold: true, size: 13, y: 0.78, x: 0.4 }),
      newLine({ text: '{Имя}', bold: true, size: 13, y: 0.87, x: 0.5 }),
    ],
  }
}

export function cloneLayout(l: Layout): Layout {
  return { lines: l.lines.map((x) => ({ ...x, id: lid() })) }
}
