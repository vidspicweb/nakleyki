import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { TAG_GROUPS, allTags, customOnly, tagLabel } from '../tags'
import type { SheetFilter } from '../tags'
import type { Sheet } from '../types'

/** Список меток-переключателей + поле «своя метка». */
export function TagChooser({ selected, onToggle }: { selected: string[]; onToggle: (tag: string, on: boolean) => void }) {
  const { state, update } = useApp()
  const [text, setText] = useState('')
  const custom = customOnly(state)
  const add = () => {
    const t = text.trim()
    if (!t) return
    if (!allTags(state).includes(t)) update((d) => void (d.customTags = [...(d.customTags ?? []), t]))
    onToggle(t, true)
    setText('')
  }
  const groups = [...TAG_GROUPS, ...(custom.length ? [{ title: 'Ваши метки', tags: custom }] : [])]
  return (
    <div className="tag-chooser">
      {groups.map((g) => (
        <div key={g.title} className="tag-group">
          <div className="tag-group-title">{g.title}</div>
          <div className="tag-row">
            {g.tags.map((t) => {
              const on = selected.includes(t)
              return (
                <button key={t} className={'tchip' + (on ? ' on' : '')} onClick={() => onToggle(t, !on)}>
                  {on && '✓ '}
                  {tagLabel(t)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="tag-new">
        <input value={text} placeholder="Своя метка: например, «Осень» или «2 класс»" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn soft small" onClick={add} disabled={!text.trim()}>
          Добавить
        </button>
      </div>
    </div>
  )
}

/** Кнопка с выпадающим выбором меток. */
export function TagPopover({ label, selected, onToggle, align = 'left' }: { label: React.ReactNode; selected: string[]; onToggle: (tag: string, on: boolean) => void; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="tag-pop-wrap" ref={ref}>
      <button className="btn ghost small" onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className={'tag-pop ' + align}>
          <TagChooser selected={selected} onToggle={onToggle} />
          <button className="btn primary small full" onClick={() => setOpen(false)}>
            Готово
          </button>
        </div>
      )}
    </div>
  )
}

/** Поиск и фильтр по меткам. */
export function FilterBar({ filter, setFilter, sheets, total, compact }: { filter: SheetFilter; setFilter: (f: SheetFilter) => void; sheets: Sheet[]; total: number; compact?: boolean }) {
  const { state } = useApp()
  const counts = new Map<string, number>()
  for (const s of state.sheets) for (const t of s.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  const tags = allTags(state).filter((t) => counts.get(t) || filter.tags.includes(t))
  const active = filter.q || filter.tags.length
  return (
    <div className={'filter-bar' + (compact ? ' compact' : '')}>
      <div className="search">
        <span aria-hidden>🔍</span>
        <input value={filter.q} placeholder="Поиск по названию, предмету, метке…" onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        {filter.q && (
          <button className="icon-btn" onClick={() => setFilter({ ...filter, q: '' })} title="Очистить">
            ✕
          </button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="tag-row">
          {tags.map((t) => {
            const on = filter.tags.includes(t)
            return (
              <button key={t} className={'tchip' + (on ? ' on' : '')} onClick={() => setFilter({ ...filter, tags: on ? filter.tags.filter((x) => x !== t) : [...filter.tags, t] })}>
                {tagLabel(t)} <span className="tcount">{counts.get(t) ?? 0}</span>
              </button>
            )
          })}
        </div>
      )}
      {active ? (
        <div className="filter-status">
          Найдено: <b>{sheets.length}</b> из {total}
          <button className="link-btn" onClick={() => setFilter({ q: '', tags: [] })}>
            Сбросить фильтр
          </button>
        </div>
      ) : null}
    </div>
  )
}
