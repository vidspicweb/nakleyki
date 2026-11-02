import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState } from './types'
import { loadState, saveState } from './storage'
import { registerUploadedFont } from './fonts'
import { CloudSync } from './cloud/sync'
import type { SyncStatus } from './cloud/sync'
import { YANDEX_CLIENT_ID } from './cloud/config'
import { clearToken, loadToken, loginUrl, takeTokenFromUrl } from './cloud/yadisk'

export interface CloudCtx {
  configured: boolean
  connected: boolean
  status: SyncStatus
  user: { name: string; usedMb: number; totalMb: number } | null
  login: () => void
  logout: () => void
  syncNow: () => void
}

interface Ctx {
  state: AppState
  /** Меняем копию состояния — сохранение происходит автоматически */
  update: (fn: (draft: AppState) => void) => void
  replace: (s: AppState) => void
  toast: (msg: string, kind?: 'ok' | 'warn') => void
  cloud: CloudCtx
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('no store')
  return c
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([])
  const timer = useRef<number | undefined>(undefined)

  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const fromCloud = useRef<AppState | null>(null)
  const sync = useRef<CloudSync | null>(null)
  const [status, setStatus] = useState<SyncStatus>({ kind: 'off' })
  const [connected, setConnected] = useState(false)
  const [user, setUser] = useState<CloudCtx['user']>(null)

  const toast = useCallback((msg: string, kind: 'ok' | 'warn' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'warn' ? 6000 : 3500)
  }, [])

  const startCloud = useCallback(
    (token: string) => {
      sync.current?.stop()
      const s = new CloudSync(
        token,
        () => stateRef.current!,
        (next) => {
          fromCloud.current = next
          setState(next)
          for (const f of next.fonts) registerUploadedFont(f).catch(() => undefined)
        },
        (st) => {
          setStatus(st)
          if (st.kind === 'error' && st.auth) {
            setConnected(false)
            setUser(null)
            toast(st.msg, 'warn')
          }
        },
      )
      sync.current = s
      setConnected(true)
      s.start()
      s.info()
        .then((i) => setUser({ name: i.user?.display_name || i.user?.login || 'Яндекс', usedMb: i.used_space / 1048576, totalMb: i.total_space / 1048576 }))
        .catch(() => undefined)
    },
    [toast],
  )

  useEffect(() => {
    const back = takeTokenFromUrl()
    loadState().then(async (s) => {
      for (const f of s.fonts) await registerUploadedFont(f).catch(() => undefined)
      stateRef.current = s
      setState(s)
      if (back.error) toast(back.error, 'warn')
      const token = back.token ?? loadToken()
      if (token && YANDEX_CLIENT_ID) {
        if (back.token) toast('Яндекс Диск подключён — библиотека будет сохраняться туда')
        startCloud(token.value)
      }
    })
    return () => sync.current?.stop()
  }, [startCloud, toast])

  useEffect(() => {
    if (!state) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => saveState(state).catch((e) => console.error(e)), 300)
    // изменения, пришедшие с Диска, обратно не отправляем
    if (fromCloud.current === state) fromCloud.current = null
    else sync.current?.changed()
  }, [state])

  const update = useCallback((fn: (d: AppState) => void) => {
    setState((s) => {
      if (!s) return s
      const d = structuredClone(s)
      fn(d)
      d.updatedAt = Date.now()
      return d
    })
  }, [])

  const replace = useCallback((s: AppState) => setState({ ...s, updatedAt: Date.now() }), [])

  const cloud: CloudCtx = {
    configured: !!YANDEX_CLIENT_ID,
    connected,
    status,
    user,
    login: () => {
      location.href = loginUrl()
    },
    logout: () => {
      sync.current?.stop()
      sync.current = null
      clearToken()
      setConnected(false)
      setUser(null)
      setStatus({ kind: 'off' })
      toast('Вы вышли из Яндекс Диска. Данные на этом компьютере остались.')
    },
    syncNow: () => sync.current?.syncNow(),
  }

  if (!state)
    return (
      <div className="loading">
        <div className="spinner" />
        Загружаем ваши данные…
      </div>
    )

  return (
    <AppCtx.Provider value={{ state, update, replace, toast, cloud }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            {t.msg}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  )
}
