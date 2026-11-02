import type { AppState } from '../types'

/** Запоминаем, что удалено, — чтобы на других компьютерах это тоже исчезло. */
export function markDeleted(d: AppState, ids: string[]) {
  d.deleted = { ...(d.deleted ?? {}) }
  for (const id of ids) d.deleted[id] = Date.now()
}

type Keyed = { id: string }
const LISTS = ['classes', 'templates', 'sheets', 'fonts'] as const

/**
 * Соединяем две версии данных: за основу берём более свежую,
 * а то, что было добавлено только в другой (и не удалено), — дописываем.
 */
export function mergeStates(a: AppState, b: AppState): AppState {
  const [newer, older] = (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? [a, b] : [b, a]
  const deleted: Record<string, number> = { ...(older.deleted ?? {}), ...(newer.deleted ?? {}) }
  // старые отметки об удалении (больше полугода) больше не нужны
  const cutoff = Date.now() - 183 * 864e5
  for (const [id, t] of Object.entries(deleted)) if (t < cutoff) delete deleted[id]

  const out: AppState = structuredClone(newer)
  for (const key of LISTS) {
    const list = out[key] as Keyed[]
    const have = new Set(list.map((x) => x.id))
    for (const item of older[key] as Keyed[]) if (!have.has(item.id) && !deleted[item.id]) list.push(structuredClone(item))
    ;(out as unknown as Record<string, Keyed[]>)[key] = list.filter((x) => !deleted[x.id])
  }
  out.customTags = [...new Set([...(newer.customTags ?? []), ...(older.customTags ?? [])])]
  out.deleted = deleted
  out.updatedAt = Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0)
  return out
}

/** Совпадают ли данные по существу (без учёта того, что открыто на экране). */
export function sameData(a: AppState, b: AppState) {
  const strip = (s: AppState) => JSON.stringify({ ...s, activeClassId: 0, activeSheetId: 0, updatedAt: 0, print: 0 })
  return strip(a) === strip(b)
}
