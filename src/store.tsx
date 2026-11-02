import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState } from './types'
import { loadState, saveState } from './storage'
import { registerUploadedFont } from './fonts'

interface Ctx {
  state: AppState
  /** Меняем копию состояния — сохранение происходит автоматически */
  update: (fn: (draft: AppState) => void) => void
  replace: (s: AppState) => void
  toast: (msg: string, kind?: 'ok' | 'warn') => void
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

  useEffect(() => {
    loadState().then(async (s) => {
      for (const f of s.fonts) await registerUploadedFont(f).catch(() => undefined)
      setState(s)
    })
  }, [])

  useEffect(() => {
    if (!state) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => saveState(state).catch((e) => console.error(e)), 300)
  }, [state])

  const update = useCallback((fn: (d: AppState) => void) => {
    setState((s) => {
      if (!s) return s
      const d = structuredClone(s)
      fn(d)
      return d
    })
  }, [])

  const toast = useCallback((msg: string, kind: 'ok' | 'warn' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  if (!state)
    return (
      <div className="loading">
        <div className="spinner" />
        Загружаем ваши данные…
      </div>
    )

  return (
    <AppCtx.Provider value={{ state, update, replace: setState, toast }}>
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
