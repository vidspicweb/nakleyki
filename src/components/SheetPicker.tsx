import { useMemo, useState } from 'react'
import { useApp } from '../store'
import type { Sheet } from '../types'
import { filterSheets } from '../tags'
import type { SheetFilter } from '../tags'
import { FilterBar } from './Tags'
import { Thumb } from './Thumb'

/** Выбор нескольких шаблонов из библиотеки — с поиском и фильтром по меткам. */
export function SheetPicker({ sheets, selected, onChange }: { sheets: Sheet[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const { state } = useApp()
  const [filter, setFilter] = useState<SheetFilter>({ q: '', tags: [] })
  const [limit, setLimit] = useState(60)
  const fileName = useMemo(() => {
    const m = new Map(state.templates.map((t) => [t.id, t.name]))
    return (s: Sheet) => m.get(s.templateId) ?? ''
  }, [state.templates])
  const shown = filterSheets(sheets, filter, fileName)
  const shownIds = shown.map((s) => s.id)
  return (
    <div className="sheet-picker">
      <FilterBar compact filter={filter} setFilter={(f) => (setFilter(f), setLimit(60))} sheets={shown} total={sheets.length} />
      <div className="row gap-s wrap">
        <button className="link-btn" onClick={() => onChange([...new Set([...selected, ...shownIds])])}>
          Выбрать {filter.q || filter.tags.length ? 'все найденные' : 'все'} ({shown.length})
        </button>
        <button className="link-btn" onClick={() => onChange(selected.filter((id) => !shownIds.includes(id)))}>
          Снять {filter.q || filter.tags.length ? 'с найденных' : 'все'}
        </button>
        {selected.length > 0 && <span className="muted tiny">Выбрано: {selected.length}</span>}
      </div>
      <div className="pick-grid">
        {shown.slice(0, limit).map((s) => {
          const on = selected.includes(s.id)
          return (
            <label key={s.id} className={'pick' + (on ? ' on' : '')}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])} />
              <Thumb sheet={s} width={96} />
              <span>{s.name}</span>
            </label>
          )
        })}
      </div>
      {shown.length > limit && (
        <button className="btn soft small full" onClick={() => setLimit((l) => l + 60)}>
          Показать ещё ({shown.length - limit})
        </button>
      )}
    </div>
  )
}
