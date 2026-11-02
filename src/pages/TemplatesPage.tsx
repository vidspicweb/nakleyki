import { useRef, useState } from 'react'
import { useApp } from '../store'
import { detectGrid, forgetPdf, openPdf, pageSizePt, renderPage } from '../pdf'
import { deletePdf, savePdf } from '../storage'
import { cloneLayout, defaultLayout } from '../render'
import type { Sheet, TemplateFile } from '../types'
import { plural, uid } from '../util'
import { SheetPreview } from '../components/SheetPreview'

export function TemplatesPage({ goNext }: { goNext: () => void }) {
  const { state, update, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        toast(`«${file.name}» — это не PDF`, 'warn')
        continue
      }
      try {
        setBusy(`Читаем «${file.name}»…`)
        const bytes = await file.arrayBuffer()
        const id = uid()
        const doc = await openPdf(id, bytes)
        await savePdf(id, bytes)
        const tpl: TemplateFile = { id, name: file.name.replace(/\.pdf$/i, ''), pageCount: doc.numPages }
        const sheets: Sheet[] = []
        for (let i = 0; i < doc.numPages; i++) {
          setBusy(`Ищем наклейки на странице ${i + 1} из ${doc.numPages}…`)
          const size = await pageSizePt(id, i)
          const canvas = await renderPage(id, i, 400)
          const base = state.lastLayout ?? defaultLayout()
          sheets.push({
            id: uid(),
            templateId: id,
            pageIndex: i,
            name: `Шаблон ${state.sheets.length + i + 1}`,
            subject: '',
            grid: detectGrid(canvas),
            layout: cloneLayout(base),
            ...size,
          })
        }
        update((d) => {
          d.templates.push(tpl)
          d.sheets.push(...sheets)
          if (!d.activeSheetId) d.activeSheetId = sheets[0]?.id
        })
        toast(`Готово! Добавлено ${sheets.length} ${plural(sheets.length, 'шаблон', 'шаблона', 'шаблонов')}`)
      } catch (e) {
        console.error(e)
        toast(`Не получилось открыть «${file.name}». Возможно, файл повреждён.`, 'warn')
      }
    }
    setBusy(null)
  }

  const removeSheet = (s: Sheet) => {
    if (!confirm(`Удалить «${s.name}»?`)) return
    update((d) => {
      d.sheets = d.sheets.filter((x) => x.id !== s.id)
      // если от файла не осталось страниц — удаляем и сам файл
      const left = d.sheets.some((x) => x.templateId === s.templateId)
      if (!left) {
        d.templates = d.templates.filter((t) => t.id !== s.templateId)
        deletePdf(s.templateId)
        forgetPdf(s.templateId)
      }
      if (d.activeSheetId === s.id) d.activeSheetId = d.sheets[0]?.id
      d.print.sheetIds = d.print.sheetIds.filter((x) => x !== s.id)
    })
  }

  const patch = (id: string, p: Partial<Sheet>) =>
    update((d) => {
      Object.assign(d.sheets.find((x) => x.id === id)!, p)
    })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Шаблоны</h1>
          <p className="lead">Загрузите PDF с наклейками (как вы скачиваете из интернета). Каждая страница станет отдельным шаблоном — программа сама найдёт, где какая наклейка.</p>
        </div>
        {state.sheets.length > 0 && (
          <button className="btn primary big" onClick={goNext}>
            Дальше: настроить текст →
          </button>
        )}
      </div>

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
          addFiles(e.dataTransfer.files)
        }}
        onClick={() => !busy && input.current?.click()}
      >
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files).then(() => (e.target.value = ''))} />
        {busy ? (
          <>
            <div className="spinner" />
            <b>{busy}</b>
          </>
        ) : (
          <>
            <div className="drop-icon">📄</div>
            <b>Перетащите PDF сюда</b>
            <span className="muted">или нажмите, чтобы выбрать файл на компьютере</span>
          </>
        )}
      </div>

      {state.sheets.length > 0 && (
        <>
          <h2 className="section-title">
            Ваши шаблоны <span className="count">{state.sheets.length}</span>
          </h2>
          <p className="muted small-gap">Синие пунктирные рамки — это найденные наклейки. Если рамки легли криво, это можно поправить на шаге «Настройка».</p>
          <div className="sheet-grid">
            {state.sheets.map((s) => (
              <div key={s.id} className="sheet-card card">
                <SheetPreview sheet={s} width={220} showGrid />
                <div className="sheet-card-body">
                  <input className="title-input" value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} title="Название шаблона" />
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
                    <button className="icon-btn" title="Удалить шаблон" onClick={() => removeSheet(s)}>
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
