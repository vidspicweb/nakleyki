import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { forgetPdf } from '../pdf'
import { deletePdf, deleteThumb, storageInfo } from '../storage'
import { importFile, isImage, isPdf } from '../importer'
import type { Sheet } from '../types'
import { plural } from '../util'
import { markDeleted } from '../cloud/merge'
import { ensureCommon } from '../layouts'
import { Thumb } from '../components/Thumb'
import { FilterBar, TagPopover } from '../components/Tags'
import { applyTag, filterSheets, tagLabel } from '../tags'
import type { SheetFilter } from '../tags'

const PAGE = 48

export function TemplatesPage({ goNext }: { goNext: () => void }) {
  const { state, update, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [uploadTags, setUploadTags] = useState<string[]>([])
  const [filter, setFilter] = useState<SheetFilter>({ q: '', tags: [] })
  const [sort, setSort] = useState<'new' | 'name'>('new')
  const [selected, setSelected] = useState<string[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [usage, setUsage] = useState<string>('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    storageInfo().then((i) => i && setUsage(`${i.usedMb < 1 ? '<1' : Math.round(i.usedMb)} МБ из ~${Math.round(i.quotaMb / 1024)} ГБ`))
  }, [state.sheets.length])

  const fileName = useMemo(() => {
    const m = new Map(state.templates.map((t) => [t.id, t]))
    return (s: Sheet) => m.get(s.templateId)?.name ?? ''
  }, [state.templates])

  const shown = useMemo(() => {
    const list = filterSheets(state.sheets, filter, fileName)
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
    // новые сверху, внутри одного файла — по порядку листов
    return [...list].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || a.pageIndex - b.pageIndex)
  }, [state.sheets, filter, sort, fileName])

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    let added = 0
    for (const [n, file] of list.entries()) {
      if (!isPdf(file) && !isImage(file)) {
        toast(`«${file.name}» — не PDF и не картинка, пропускаем`, 'warn')
        continue
      }
      try {
        const prefix = list.length > 1 ? `Файл ${n + 1} из ${list.length}. ` : ''
        const { template, sheets } = await importFile(file, {
          tags: uploadTags,
          baseLayout: state.commonLayout ?? state.lastLayout,
          onStep: (m) => setBusy(prefix + m),
        })
        update((d) => {
          d.templates.push(template)
          d.sheets.push(...sheets)
          ensureCommon(d)
          if (!d.activeSheetId) d.activeSheetId = sheets[0]?.id
        })
        added += sheets.length
      } catch (e) {
        console.error(e)
        toast(`Не получилось открыть «${file.name}». Возможно, файл повреждён.`, 'warn')
      }
    }
    setBusy(null)
    if (added) {
      toast(`Готово! В библиотеку добавлено ${added} ${plural(added, 'шаблон', 'шаблона', 'шаблонов')}`)
      setSort('new')
    }
  }

  const removeSheets = (ids: string[]) => {
    const n = ids.length
    if (!confirm(n === 1 ? `Удалить «${state.sheets.find((s) => s.id === ids[0])?.name}»?` : `Удалить ${n} ${plural(n, 'шаблон', 'шаблона', 'шаблонов')}?`)) return
    update((d) => {
      const removed = d.sheets.filter((x) => ids.includes(x.id))
      d.sheets = d.sheets.filter((x) => !ids.includes(x.id))
      markDeleted(d, ids)
      for (const s of removed) deleteThumb(s.id)
      // файлы, от которых не осталось ни одного листа, удаляем совсем
      for (const tid of new Set(removed.map((s) => s.templateId))) {
        if (!d.sheets.some((x) => x.templateId === tid)) {
          d.templates = d.templates.filter((t) => t.id !== tid)
          markDeleted(d, [tid])
          deletePdf(tid)
          forgetPdf(tid)
        }
      }
      if (d.activeSheetId && ids.includes(d.activeSheetId)) d.activeSheetId = d.sheets[0]?.id
      d.print.sheetIds = d.print.sheetIds.filter((x) => !ids.includes(x))
    })
    setSelected((v) => v.filter((x) => !ids.includes(x)))
  }

  const patch = (id: string, p: Partial<Sheet>) =>
    update((d) => {
      Object.assign(d.sheets.find((x) => x.id === id)!, p)
    })

  const tagSheets = (ids: string[], tag: string, on: boolean) =>
    update((d) => {
      for (const s of d.sheets) if (ids.includes(s.id)) applyTag(s, tag, on)
    })

  const selSheets = state.sheets.filter((s) => selected.includes(s.id))
  const commonTags = selSheets.length ? (selSheets[0].tags ?? []).filter((t) => selSheets.every((s) => (s.tags ?? []).includes(t))) : []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Библиотека шаблонов</h1>
          <p className="lead">Храните здесь все свои наклейки: PDF на любое число листов и картинки. Отмечайте их метками — потом легко найти нужные.</p>
        </div>
        {state.sheets.length > 0 && (
          <button className="btn primary big" onClick={goNext}>
            Дальше: настроить текст →
          </button>
        )}
      </div>

      <div className="upload-card card">
        <div
          className={'dropzone' + (drag ? ' drag' : '')}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            if (!busy) addFiles(e.dataTransfer.files)
          }}
          onClick={() => !busy && input.current?.click()}
        >
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            multiple
            hidden
            onChange={(e) => e.target.files && addFiles(e.target.files).then(() => (e.target.value = ''))}
          />
          {busy ? (
            <>
              <div className="spinner" />
              <b>{busy}</b>
            </>
          ) : (
            <>
              <div className="drop-icon">📥</div>
              <b>Перетащите сюда PDF или картинки</b>
              <span className="muted">можно сразу несколько файлов · или нажмите, чтобы выбрать</span>
            </>
          )}
        </div>
        <div className="upload-tags">
          <span className="muted">Сразу отметить новые шаблоны:</span>
          {uploadTags.map((t) => (
            <span key={t} className="tchip on static">
              {tagLabel(t)}
              <button onClick={() => setUploadTags((v) => v.filter((x) => x !== t))} title="Убрать">
                ✕
              </button>
            </span>
          ))}
          <TagPopover
            label={uploadTags.length ? '+ ещё метка' : '🏷 Выбрать метки'}
            selected={uploadTags}
            onToggle={(t, on) => setUploadTags((v) => (on ? [...new Set([...v, t])] : v.filter((x) => x !== t)))}
          />
        </div>
      </div>

      {state.sheets.length > 0 && (
        <>
          <div className="lib-head">
            <h2 className="section-title">
              Ваши шаблоны <span className="count">{state.sheets.length}</span>
            </h2>
            <div className="row gap-s">
              {usage && <span className="muted tiny">Занято: {usage}</span>}
              <select className="sort" value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'name')}>
                <option value="new">Сначала новые</option>
                <option value="name">По названию</option>
              </select>
            </div>
          </div>

          <FilterBar filter={filter} setFilter={(f) => (setFilter(f), setLimit(PAGE))} sheets={shown} total={state.sheets.length} />

          {selected.length > 0 && (
            <div className="bulk-bar">
              <b>
                Выбрано: {selected.length}
              </b>
              <TagPopover label="🏷 Метки для выбранных" selected={commonTags} onToggle={(t, on) => tagSheets(selected, t, on)} />
              <button className="btn ghost small" onClick={() => setSelected(shown.map((s) => s.id))}>
                Выбрать все найденные ({shown.length})
              </button>
              <button className="btn ghost small" onClick={() => setSelected([])}>
                Снять выбор
              </button>
              <button className="btn ghost small danger" onClick={() => removeSheets(selected)}>
                🗑 Удалить
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="card muted center pad">Ничего не нашлось. Попробуйте убрать часть меток или изменить поиск.</div>
          ) : (
            <div className="sheet-grid">
              {shown.slice(0, limit).map((s) => {
                const sel = selected.includes(s.id)
                const tpl = state.templates.find((t) => t.id === s.templateId)
                return (
                  <div key={s.id} className={'sheet-card card' + (sel ? ' selected' : '')}>
                    <label className="card-check" title="Выбрать">
                      <input type="checkbox" checked={sel} onChange={(e) => setSelected((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))} />
                    </label>
                    <Thumb sheet={s} width={200} showGrid />
                    <div className="sheet-card-body">
                      <input className="title-input" value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} title="Название шаблона" />
                      {tpl && tpl.pageCount > 1 && (
                        <button className="file-link" onClick={() => setFilter({ ...filter, q: tpl.name })} title="Показать все листы этого файла">
                          📄 {tpl.name} · {tpl.pageCount} {plural(tpl.pageCount, 'лист', 'листа', 'листов')}
                        </button>
                      )}
                      <div className="card-tags">
                        {(s.tags ?? []).map((t) => (
                          <span key={t} className="tchip small static">
                            {tagLabel(t)}
                            <button onClick={() => tagSheets([s.id], t, false)} title="Убрать метку">
                              ✕
                            </button>
                          </span>
                        ))}
                        <TagPopover label="+ метка" selected={s.tags ?? []} onToggle={(t, on) => tagSheets([s.id], t, on)} />
                      </div>
                      <label className="field compact">
                        <span>Предмет (по чему?) — необязательно</span>
                        <input value={s.subject} placeholder="математике" onChange={(e) => patch(s.id, { subject: e.target.value })} />
                      </label>
                      <div className="muted tiny">
                        {s.grid.cols * s.grid.rows} {plural(s.grid.cols * s.grid.rows, 'наклейка', 'наклейки', 'наклеек')} на листе
                      </div>
                      <div className="row gap-s">
                        <button
                          className="btn soft small grow"
                          onClick={() => {
                            update((d) => void (d.activeSheetId = s.id))
                            goNext()
                          }}
                        >
                          ✏️ Настроить
                        </button>
                        <button className="icon-btn" title="Удалить шаблон" onClick={() => removeSheets([s.id])}>
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {shown.length > limit && (
            <div className="center pad">
              <button className="btn soft big" onClick={() => setLimit((l) => l + PAGE)}>
                Показать ещё ({shown.length - limit})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
