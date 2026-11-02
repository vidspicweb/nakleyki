import { createStore, del, get, set } from 'idb-keyval'
import type { AppState } from './types'

// Всё хранится только в этом браузере на этом компьютере (IndexedDB).
const store = createStore('nakleyki-db', 'kv')

export const DEFAULT_STATE: AppState = {
  version: 1,
  classes: [],
  templates: [],
  sheets: [],
  fonts: [],
  print: { classIds: [], sheetIds: [], copies: 1 },
}

export async function loadState(): Promise<AppState> {
  try {
    const s = await get<AppState>('state', store)
    if (s && s.version === 1) return { ...DEFAULT_STATE, ...s }
  } catch (e) {
    console.warn('Не удалось прочитать сохранённые данные', e)
  }
  return structuredClone(DEFAULT_STATE)
}

export const saveState = (s: AppState) => set('state', s, store)

export const savePdf = (id: string, bytes: ArrayBuffer) => set('pdf:' + id, bytes, store)
export const loadPdf = (id: string) => get<ArrayBuffer>('pdf:' + id, store)
export const deletePdf = (id: string) => del('pdf:' + id, store)

export const saveFontFile = (id: string, bytes: ArrayBuffer) => set('font:' + id, bytes, store)
export const loadFontFile = (id: string) => get<ArrayBuffer>('font:' + id, store)
export const deleteFontFile = (id: string) => del('font:' + id, store)

// ---------- резервная копия всех данных в один файл ----------

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (b64: string) => {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}

export async function exportBackup(state: AppState): Promise<Blob> {
  const pdfs: Record<string, string> = {}
  for (const t of state.templates) {
    const b = await loadPdf(t.id)
    if (b) pdfs[t.id] = toB64(b)
  }
  const fonts: Record<string, string> = {}
  for (const f of state.fonts) {
    const b = await loadFontFile(f.id)
    if (b) fonts[f.id] = toB64(b)
  }
  return new Blob([JSON.stringify({ app: 'nakleyki', state, pdfs, fonts })], { type: 'application/json' })
}

export async function importBackup(file: File): Promise<AppState> {
  const data = JSON.parse(await file.text())
  if (data?.app !== 'nakleyki' || !data.state) throw new Error('Это не файл резервной копии наклеек')
  for (const [id, b64] of Object.entries<string>(data.pdfs ?? {})) await savePdf(id, fromB64(b64))
  for (const [id, b64] of Object.entries<string>(data.fonts ?? {})) await saveFontFile(id, fromB64(b64))
  const state = { ...DEFAULT_STATE, ...data.state } as AppState
  await saveState(state)
  return state
}
