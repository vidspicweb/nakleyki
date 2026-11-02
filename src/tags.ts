import type { AppState, Sheet } from './types'

/** Готовые метки. Свои метки можно добавлять сколько угодно. */
export const TAG_GROUPS: { title: string; tags: string[] }[] = [
  { title: 'Предмет', tags: ['Русский язык', 'Математика', 'Чтение', 'Окружающий мир', 'Английский язык', 'Другой предмет'] },
  { title: 'Для кого', tags: ['Для девочек', 'Для мальчиков', 'Для всех'] },
]

const EMOJI: Record<string, string> = {
  'Русский язык': '📘',
  'Математика': '➗',
  'Чтение': '📖',
  'Окружающий мир': '🌍',
  'Английский язык': '🇬🇧',
  'Другой предмет': '📚',
  'Для девочек': '👧',
  'Для мальчиков': '👦',
  'Для всех': '🧒',
}

export const tagLabel = (t: string) => (EMOJI[t] ? EMOJI[t] + ' ' + t : '🏷 ' + t)

/** Если метка — предмет, подставляем его в «по …» на наклейке. */
export const SUBJECT_BY_TAG: Record<string, string> = {
  'Русский язык': 'русскому языку',
  'Математика': 'математике',
  'Чтение': 'литературному чтению',
  'Окружающий мир': 'окружающему миру',
  'Английский язык': 'английскому языку',
}

export function allTags(state: AppState): string[] {
  const used = new Set(state.sheets.flatMap((s) => s.tags ?? []))
  const base = TAG_GROUPS.flatMap((g) => g.tags)
  const extra = [...new Set([...(state.customTags ?? []), ...used])].filter((t) => !base.includes(t)).sort((a, b) => a.localeCompare(b, 'ru'))
  return [...base, ...extra]
}

export const customOnly = (state: AppState) => allTags(state).filter((t) => !TAG_GROUPS.some((g) => g.tags.includes(t)))

export interface SheetFilter {
  q: string
  tags: string[]
}

export const EMPTY_FILTER: SheetFilter = { q: '', tags: [] }

export function filterSheets(sheets: Sheet[], f: SheetFilter, fileName: (s: Sheet) => string = () => ''): Sheet[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
  return sheets.filter((s) => {
    if (f.tags.some((t) => !(s.tags ?? []).includes(t))) return false
    if (!words.length) return true
    const hay = [s.name, s.subject, fileName(s), ...(s.tags ?? [])].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export function applyTag(s: Sheet, tag: string, on: boolean) {
  const tags = new Set(s.tags ?? [])
  if (on) tags.add(tag)
  else tags.delete(tag)
  s.tags = [...tags]
  if (on && !s.subject && SUBJECT_BY_TAG[tag]) s.subject = SUBJECT_BY_TAG[tag]
}
