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

export type FileKind = 'pdf' | 'font' | 'thumb'

/**
 * Если файла нет в этом браузере, его можно попросить из облака (Яндекс Диск).
 * Модуль синхронизации подставляет сюда свою функцию после входа.
 */
let remote: ((kind: FileKind, id: string) => Promise<Blob | null>) | null = null
export const setRemoteFetcher = (fn: typeof remote) => (remote = fn)

const pending = new Map<string, Promise<unknown>>()
async function getWithRemote<T>(kind: FileKind, id: string, asBlob: boolean): Promise<T | undefined> {
  const local = await get<T>(kind + ':' + id, store)
  if (local || !remote) return local
  const key = kind + ':' + id
  let p = pending.get(key) as Promise<T | undefined> | undefined
  if (!p) {
    p = (async () => {
      const blob = await remote!(kind, id).catch((e) => {
        console.warn('Не удалось взять файл из облака', key, e)
        return null
      })
      if (!blob) return undefined
      const val = (asBlob ? blob : await blob.arrayBuffer()) as T
      await set(key, val, store)
      return val
    })()
    pending.set(key, p)
    p.finally(() => pending.delete(key))
  }
  return p
}

export const savePdf = (id: string, bytes: ArrayBuffer) => set('pdf:' + id, bytes, store)
export const loadPdf = (id: string) => getWithRemote<ArrayBuffer>('pdf', id, false)
export const loadPdfLocal = (id: string) => get<ArrayBuffer>('pdf:' + id, store)
export const deletePdf = (id: string) => del('pdf:' + id, store)

export const saveFontFile = (id: string, bytes: ArrayBuffer) => set('font:' + id, bytes, store)
export const loadFontFile = (id: string) => getWithRemote<ArrayBuffer>('font', id, false)
export const loadFontLocal = (id: string) => get<ArrayBuffer>('font:' + id, store)
export const deleteFontFile = (id: string) => del('font:' + id, store)

export const saveThumb = (sheetId: string, blob: Blob) => set('thumb:' + sheetId, blob, store)
export const loadThumb = (sheetId: string) => getWithRemote<Blob>('thumb', sheetId, true)
export const loadThumbLocal = (sheetId: string) => get<Blob>('thumb:' + sheetId, store)
export const deleteThumb = (sheetId: string) => del('thumb:' + sheetId, store)

/** Просим браузер не удалять библиотеку при нехватке места. */
export async function askPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* не страшно */
  }
}

export async function storageInfo(): Promise<{ usedMb: number; quotaMb: number; persisted: boolean } | null> {
  try {
    const e = await navigator.storage.estimate()
    const persisted = (await navigator.storage.persisted?.()) ?? false
    return { usedMb: (e.usage ?? 0) / 1048576, quotaMb: (e.quota ?? 0) / 1048576, persisted }
  } catch {
    return null
  }
}

// ---------- резервная копия всех данных в один файл ----------

const fromB64 = (b64: string) => {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}

/*
 * Формат копии: «NAKL2» + длина заголовка (4 байта) + JSON-заголовок + файлы подряд.
 * Файлы не превращаем в текст — так копия библиотеки на сотни мегабайт не «подвешивает» браузер.
 */
const MAGIC = 'NAKL2'

export async function exportBackup(state: AppState): Promise<Blob> {
  const parts: BlobPart[] = []
  const index: { kind: 'pdf' | 'font'; id: string; size: number }[] = []
  for (const t of state.templates) {
    const b = await loadPdf(t.id)
    if (b) (index.push({ kind: 'pdf', id: t.id, size: b.byteLength }), parts.push(b))
  }
  for (const f of state.fonts) {
    const b = await loadFontFile(f.id)
    if (b) (index.push({ kind: 'font', id: f.id, size: b.byteLength }), parts.push(b))
  }
  const head = new TextEncoder().encode(JSON.stringify({ app: 'nakleyki', state, index }))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, head.byteLength)
  return new Blob([MAGIC, len, head, ...parts], { type: 'application/octet-stream' })
}

export async function importBackup(file: File): Promise<AppState> {
  const magic = await file.slice(0, 5).text()
  if (magic === MAGIC) {
    const len = new DataView(await file.slice(5, 9).arrayBuffer()).getUint32(0)
    const data = JSON.parse(await file.slice(9, 9 + len).text())
    let pos = 9 + len
    for (const it of data.index as { kind: string; id: string; size: number }[]) {
      const buf = await file.slice(pos, pos + it.size).arrayBuffer()
      pos += it.size
      if (it.kind === 'pdf') await savePdf(it.id, buf)
      else await saveFontFile(it.id, buf)
    }
    const state = { ...DEFAULT_STATE, ...data.state } as AppState
    await saveState(state)
    return state
  }
  // старый формат (JSON)
  const data = JSON.parse(await file.text())
  if (data?.app !== 'nakleyki' || !data.state) throw new Error('Это не файл резервной копии наклеек')
  for (const [id, b64] of Object.entries<string>(data.pdfs ?? {})) await savePdf(id, fromB64(b64))
  for (const [id, b64] of Object.entries<string>(data.fonts ?? {})) await saveFontFile(id, fromB64(b64))
  const state = { ...DEFAULT_STATE, ...data.state } as AppState
  await saveState(state)
  return state
}
