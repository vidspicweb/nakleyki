import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import {
  BUILTIN_FONTS,
  COMMON_FONTS,
  canListLocalFonts,
  fontAvailable,
  fontFamilyFromFile,
  listLocalFonts,
  localFontsAlreadyAllowed,
  registerUploadedFont,
} from '../fonts'
import { saveFontFile } from '../storage'
import { uid } from '../util'

let localCache: string[] | null = null

export function FontPicker({ value, onChange, sample }: { value: string; onChange: (f: string) => void; sample: string }) {
  const { state, update, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [local, setLocal] = useState<string[] | null>(localCache)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (localCache) return
    localFontsAlreadyAllowed().then((ok) => {
      if (ok) listLocalFonts().then((l) => setLocal((localCache = l)))
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const askLocal = async () => {
    try {
      const l = await listLocalFonts()
      localCache = l
      setLocal(l)
      toast(`Найдено шрифтов на компьютере: ${l.length}`)
    } catch {
      toast('Браузер не дал доступ к шрифтам. Нажмите «Разрешить», когда он спросит.', 'warn')
    }
  }

  const upload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        const bytes = await file.arrayBuffer()
        const family = fontFamilyFromFile(file.name)
        const f = { id: uid(), family }
        await registerUploadedFont(f, bytes)
        await saveFontFile(f.id, bytes)
        update((d) => void d.fonts.push(f))
        onChange(family)
        toast(`Шрифт «${family}» добавлен`)
      } catch (e) {
        console.error(e)
        toast(`Не удалось прочитать шрифт «${file.name}»`, 'warn')
      }
    }
  }

  const groups = useMemo(() => {
    const filter = (arr: string[]) => arr.filter((f) => f.toLowerCase().includes(q.toLowerCase()))
    const uploaded = state.fonts.map((f) => f.family)
    const g: { title: string; fonts: string[] }[] = [
      { title: 'Встроенные в программу', fonts: filter(BUILTIN_FONTS) },
      { title: 'Загруженные вами', fonts: filter(uploaded) },
    ]
    if (local) g.push({ title: 'Шрифты этого компьютера', fonts: filter(local) })
    else g.push({ title: 'Популярные шрифты', fonts: filter(COMMON_FONTS.filter(fontAvailable)) })
    return g.filter((x) => x.fonts.length)
  }, [q, local, state.fonts])

  const missing = !fontAvailable(value)

  return (
    <div className="font-picker" ref={boxRef}>
      <button className={'font-current' + (missing ? ' missing' : '')} onClick={() => setOpen((o) => !o)} style={{ fontFamily: `"${value}", Nunito` }}>
        <span>{value}</span>
        <span className="chev">▾</span>
      </button>
      {missing && <div className="tag warn">Этого шрифта нет на компьютере — будет заменён</div>}
      {open && (
        <div className="font-pop">
          <input autoFocus className="font-search" placeholder="Поиск шрифта…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="font-actions">
            {canListLocalFonts() && !local && (
              <button className="btn soft small" onClick={askLocal}>
                💻 Показать все шрифты компьютера
              </button>
            )}
            <button className="btn ghost small" onClick={() => fileRef.current?.click()}>
              ⬆ Добавить файл шрифта
            </button>
            <input ref={fileRef} type="file" hidden multiple accept=".ttf,.otf,.woff,.woff2" onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ''))} />
          </div>
          {!canListLocalFonts() && (
            <div className="hint">Чтобы видеть все шрифты компьютера, откройте программу в Google Chrome или Яндекс Браузере. Или добавьте файл шрифта (.ttf / .otf).</div>
          )}
          <div className="font-list">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="font-group">{g.title}</div>
                {g.fonts.map((f) => (
                  <button
                    key={g.title + f}
                    className={'font-item' + (f === value ? ' on' : '')}
                    onClick={() => {
                      onChange(f)
                      setOpen(false)
                    }}
                  >
                    <span className="font-name">{f}</span>
                    <span className="font-sample" style={{ fontFamily: `"${f}", Nunito` }}>
                      {sample}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="muted center pad">Ничего не нашлось</div>}
          </div>
        </div>
      )}
    </div>
  )
}
