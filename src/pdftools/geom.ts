/** Прямоугольник в долях (0..1) от ширины и высоты листа, отсчёт от левого верхнего угла. */
export interface FRect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: FRect = { x: 0, y: 0, w: 1, h: 1 }

const norm = (deg: number) => (((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270

/** Из того, что видно на экране (лист повёрнут на rot), — в координаты неповёрнутого листа. */
export function toBase(r: FRect, rot: number): FRect {
  switch (norm(rot)) {
    case 90:
      return { x: r.y, y: 1 - (r.x + r.w), w: r.h, h: r.w }
    case 180:
      return { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h }
    case 270:
      return { x: 1 - (r.y + r.h), y: r.x, w: r.h, h: r.w }
    default:
      return { ...r }
  }
}

/** Обратно: из неповёрнутого листа — в то, что видно на экране. */
export const toDisplay = (r: FRect, rot: number) => toBase(r, 360 - norm(rot))

/** Прямоугольник inner внутри outer → в координатах того, в чём лежит outer. */
export const compose = (o: FRect, i: FRect): FRect => ({ x: o.x + i.x * o.w, y: o.y + i.y * o.h, w: i.w * o.w, h: i.h * o.h })

/** Обратная операция: r (в координатах родителя) → относительно piece. */
export const rebase = (r: FRect, p: FRect): FRect => ({ x: (r.x - p.x) / p.w, y: (r.y - p.y) / p.h, w: r.w / p.w, h: r.h / p.h })

/**
 * Доли от листа (как его показывает просмотрщик, с учётом поворота r0, записанного в самом PDF)
 * → координаты PDF (в пунктах, начало внизу слева).
 */
export function fracToPdf(f: FRect, box: { x: number; y: number; width: number; height: number }, r0: number) {
  const W = box.width
  const H = box.height
  const map = (u: number, v: number): [number, number] => {
    switch (norm(r0)) {
      case 90:
        return [v * W, u * H]
      case 180:
        return [(1 - u) * W, v * H]
      case 270:
        return [(1 - v) * W, (1 - u) * H]
      default:
        return [u * W, (1 - v) * H]
    }
  }
  const [ax, ay] = map(f.x, f.y)
  const [bx, by] = map(f.x + f.w, f.y + f.h)
  return { x: box.x + Math.min(ax, bx), y: box.y + Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

/** Куски листа по линиям разреза (в порядке чтения: слева направо, сверху вниз). */
export function cellsFromLines(xs: number[], ys: number[]): FRect[] {
  const X = [0, ...[...xs].sort((a, b) => a - b), 1]
  const Y = [0, ...[...ys].sort((a, b) => a - b), 1]
  const out: FRect[] = []
  for (let j = 0; j < Y.length - 1; j++)
    for (let i = 0; i < X.length - 1; i++) {
      const w = X[i + 1] - X[i]
      const h = Y[j + 1] - Y[j]
      if (w > 0.01 && h > 0.01) out.push({ x: X[i], y: Y[j], w, h })
    }
  return out
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
