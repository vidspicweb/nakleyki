import type { AppState } from '../types'
import { loadFontLocal, loadPdfLocal, loadThumbLocal, setRemoteFetcher } from '../storage'
import type { FileKind } from '../storage'
import { AuthError, YaDisk, clearToken } from './yadisk'
import { mergeStates, sameData } from './merge'

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'busy'; msg: string }
  | { kind: 'ok'; at: number }
  | { kind: 'error'; msg: string; auth?: boolean }

const META_KEY = 'nakl-sync-meta'
const DIRS: Record<FileKind, string> = { pdf: 'app:/pdf', font: 'app:/fonts', thumb: 'app:/thumbs' }
const fileName = (kind: FileKind, id: string) => (kind === 'pdf' ? id + '.pdf' : kind === 'thumb' ? id + '.jpg' : id + '.font')
const pathOf = (kind: FileKind, id: string) => DIRS[kind] + '/' + fileName(kind, id)
const STATE_PATH = 'app:/state.json'

interface Meta {
  md5?: string // какая версия state.json на Диске уже учтена
}

/**
 * Синхронизация с Яндекс Диском:
 *  — state.json: ученики, метки, настройки наклеек;
 *  — pdf/, thumbs/, fonts/: сами файлы шаблонов, миниатюры и шрифты.
 * Файлы скачиваются только когда понадобятся, поэтому на новом компьютере всё открывается быстро.
 */
export class CloudSync {
  private disk: YaDisk
  private queue: Promise<unknown> = Promise.resolve()
  private pushTimer: number | undefined
  private pollTimer: number | undefined
  private remoteFiles: Record<FileKind, Set<string>> = { pdf: new Set(), font: new Set(), thumb: new Set() }
  private meta: Meta
  private stopped = false

  private getState: () => AppState
  private setState: (s: AppState) => void
  private onStatus: (s: SyncStatus) => void

  constructor(token: string, getState: () => AppState, setState: (s: AppState) => void, onStatus: (s: SyncStatus) => void) {
    this.getState = getState
    this.setState = setState
    this.onStatus = onStatus
    this.disk = new YaDisk(token)
    try {
      this.meta = JSON.parse(localStorage.getItem(META_KEY) ?? '{}')
    } catch {
      this.meta = {}
    }
  }

  private saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(this.meta))
  }

  /** Все операции — строго по очереди. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  private fail(e: unknown) {
    console.error(e)
    if (e instanceof AuthError) {
      clearToken()
      this.stop()
      this.onStatus({ kind: 'error', msg: e.message, auth: true })
    } else this.onStatus({ kind: 'error', msg: (e as Error).message || 'Ошибка синхронизации' })
  }

  async start() {
    setRemoteFetcher((kind, id) => (this.stopped ? Promise.resolve(null) : this.disk.download(pathOf(kind, id))))
    await this.run(async () => {
      try {
        this.onStatus({ kind: 'busy', msg: 'Подключаемся к Диску…' })
        for (const d of Object.values(DIRS)) await this.disk.mkdir(d)
        for (const kind of Object.keys(DIRS) as FileKind[]) {
          const names = await this.disk.list(DIRS[kind])
          this.remoteFiles[kind] = new Set(names.map((n) => n.replace(/\.[^.]+$/, '')))
        }
        await this.pullInner(true)
        await this.pushInner()
      } catch (e) {
        this.fail(e)
      }
    })
    this.pollTimer = window.setInterval(() => this.checkRemote(), 60_000)
    window.addEventListener('focus', this.onFocus)
  }

  stop() {
    this.stopped = true
    setRemoteFetcher(null)
    window.clearInterval(this.pollTimer)
    window.clearTimeout(this.pushTimer)
    window.removeEventListener('focus', this.onFocus)
  }

  private onFocus = () => this.checkRemote()

  /** Данные поменялись на этом компьютере — через пару секунд отправим. */
  changed() {
    if (this.stopped) return
    window.clearTimeout(this.pushTimer)
    this.pushTimer = window.setTimeout(() => this.syncNow(), 2500)
  }

  syncNow() {
    return this.run(async () => {
      try {
        await this.pullInner(false)
        await this.pushInner()
      } catch (e) {
        this.fail(e)
      }
    })
  }

  /** Проверяем, не изменилось ли что-то на Диске (с другого компьютера). */
  private checkRemote() {
    if (this.stopped) return
    this.run(async () => {
      try {
        const m = await this.disk.meta(STATE_PATH)
        if (m?.md5 && m.md5 !== this.meta.md5) {
          await this.pullInner(false)
          await this.pushInner()
        }
      } catch (e) {
        this.fail(e)
      }
    })
  }

  private async pullInner(first: boolean) {
    const m = await this.disk.meta(STATE_PATH)
    if (!m) return // на Диске ещё ничего нет — просто отправим своё
    if (!first && m.md5 === this.meta.md5) return
    this.onStatus({ kind: 'busy', msg: 'Получаем изменения…' })
    const blob = await this.disk.download(STATE_PATH)
    if (!blob) return
    const remote = JSON.parse(await blob.text()) as AppState
    const local = this.getState()
    const merged = mergeStates(local, remote)
    // то, что открыто на экране, оставляем как было
    merged.activeClassId = local.activeClassId
    merged.activeSheetId = local.activeSheetId
    merged.print = local.print
    if (!sameData(merged, local)) this.setState(merged)
    this.meta.md5 = m.md5
    this.saveMeta()
  }

  private async pushInner() {
    const state = this.getState()
    const need: { kind: FileKind; id: string }[] = []
    for (const t of state.templates) if (!this.remoteFiles.pdf.has(t.id)) need.push({ kind: 'pdf', id: t.id })
    for (const f of state.fonts) if (!this.remoteFiles.font.has(f.id)) need.push({ kind: 'font', id: f.id })
    for (const s of state.sheets) if (!this.remoteFiles.thumb.has(s.id)) need.push({ kind: 'thumb', id: s.id })

    let done = 0
    for (const { kind, id } of need) {
      this.onStatus({ kind: 'busy', msg: `Сохраняем на Диск: ${++done} из ${need.length}…` })
      const data = kind === 'pdf' ? await loadPdfLocal(id) : kind === 'font' ? await loadFontLocal(id) : await loadThumbLocal(id)
      if (!data) continue
      await this.disk.upload(pathOf(kind, id), data)
      this.remoteFiles[kind].add(id)
    }

    // удалённое на этом или другом компьютере убираем и с Диска
    const deleted = state.deleted ?? {}
    for (const kind of Object.keys(DIRS) as FileKind[])
      for (const id of [...this.remoteFiles[kind]])
        if (deleted[id]) {
          await this.disk.remove(pathOf(kind, id))
          this.remoteFiles[kind].delete(id)
        }

    const remoteMeta = await this.disk.meta(STATE_PATH)
    const body = new Blob([JSON.stringify(state)], { type: 'application/json' })
    // отправляем state.json, только если он отличается от того, что на Диске
    if (!remoteMeta || remoteMeta.md5 !== this.meta.md5 || this.dirtySincePush(state)) {
      await this.disk.upload(STATE_PATH, body)
      const m = await this.disk.meta(STATE_PATH)
      this.meta.md5 = m?.md5
      this.lastPushed = state.updatedAt ?? 0
      this.saveMeta()
    }
    this.onStatus({ kind: 'ok', at: Date.now() })
  }

  private lastPushed = -1
  private dirtySincePush(s: AppState) {
    return (s.updatedAt ?? 0) !== this.lastPushed
  }

  async info() {
    return this.disk.info()
  }
}
