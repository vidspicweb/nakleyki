import type { TextLine, UploadedFont } from './types'
import { loadFontFile } from './storage'

/** Шрифты, встроенные в программу: работают всегда, даже без шрифтов на компьютере. */
export const BUILTIN_FONTS = ['Nunito', 'Caveat']

/** Частые шрифты Windows — показываем, даже если браузер не даёт список шрифтов. */
export const COMMON_FONTS = [
  'Arial',
  'Times New Roman',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Georgia',
  'Segoe UI',
  'Segoe Print',
  'Segoe Script',
  'Tahoma',
  'Verdana',
  'Trebuchet MS',
  'Century Gothic',
  'Bookman Old Style',
  'Monotype Corsiva',
  'Arial Narrow',
]

export const canListLocalFonts = () => typeof window !== 'undefined' && 'queryLocalFonts' in window

interface LocalFontData {
  family: string
}

/** Список шрифтов, установленных на компьютере (Chrome / Edge спросят разрешение). */
export async function listLocalFonts(): Promise<string[]> {
  if (!canListLocalFonts()) return []
  const fonts: LocalFontData[] = await (window as unknown as { queryLocalFonts: () => Promise<LocalFontData[]> }).queryLocalFonts()
  return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ru'))
}

/** Если разрешение уже давали раньше — подтягиваем список молча. */
export async function localFontsAlreadyAllowed(): Promise<boolean> {
  try {
    const st = await navigator.permissions.query({ name: 'local-fonts' as PermissionName })
    return st.state === 'granted'
  } catch {
    return false
  }
}

const registered = new Set<string>()

export async function registerUploadedFont(f: UploadedFont, bytes?: ArrayBuffer) {
  if (registered.has(f.id)) return
  const data = bytes ?? (await loadFontFile(f.id))
  if (!data) return
  const face = new FontFace(f.family, data.slice(0))
  await face.load()
  document.fonts.add(face)
  registered.add(f.id)
}

export const fontFamilyFromFile = (name: string) =>
  name
    .replace(/\.(ttf|otf|woff2?|ttc)$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()

export const cssFont = (l: Pick<TextLine, 'font' | 'bold' | 'italic'>, px: number) =>
  `${l.italic ? 'italic ' : ''}${l.bold ? '700 ' : '400 '}${px}px "${l.font}", "Nunito", sans-serif`

/** Дожидаемся загрузки нужных шрифтов (для кириллицы) перед рисованием. */
export async function ensureFonts(lines: TextLine[], sample = 'АаБбЯя Abc 123') {
  await Promise.all(
    lines.map((l) => document.fonts.load(cssFont(l, 32), sample).catch(() => undefined)),
  )
}

/** Есть ли такой шрифт в системе (для подсказки «шрифт не найден»). */
export function fontAvailable(family: string): boolean {
  if (BUILTIN_FONTS.includes(family)) return true
  try {
    const c = document.createElement('canvas').getContext('2d')!
    const test = 'АБВгдеЖЗИ абвгд 12345 mmmmwwwlli'
    const results: number[] = []
    for (const fallback of ['monospace', 'serif']) {
      c.font = `40px ${fallback}`
      const base = c.measureText(test).width
      c.font = `40px "${family}", ${fallback}`
      results.push(c.measureText(test).width - base)
    }
    return results.some((d) => Math.abs(d) > 0.5)
  } catch {
    return true
  }
}
