import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import type { Tab } from '../App'
import { buildPdf, planPages } from '../export'
import { SheetPreview } from '../components/SheetPreview'
import { SheetPicker } from '../components/SheetPicker'
import { plural } from '../util'
import { resolveSheet } from '../layouts'

export function PrintPage({ goTab }: { goTab: (t: Tab) => void }) {
  const { state, update, toast } = useApp()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ url: string; name: string; pages: number } | null>(null)

  const classIds = state.print.classIds.filter((id) => state.classes.some((c) => c.id === id))
  const sheetIds = state.print.sheetIds.filter((id) => state.sheets.some((s) => s.id === id))
  const classes = state.classes.filter((c) => classIds.includes(c.id))
  const sheets = useMemo(() => state.sheets.filter((s) => sheetIds.includes(s.id)).map((s) => resolveSheet(state, s)), [state, sheetIds.join()])
  const copies = state.print.copies

  // при первом заходе — выбрать что-нибудь, чтобы не было пусто
  useEffect(() => {
    if (!classIds.length && state.classes.length)
      update((d) => void (d.print.classIds = [d.activeClassId ?? d.classes[0].id].filter((id) => d.classes.some((c) => c.id === id))))
    if (!sheetIds.length && state.sheets.length) update((d) => void (d.print.sheetIds = [d.activeSheetId ?? d.sheets[0].id]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result])

  const pages = useMemo(() => planPages(sheets, classes, copies), [sheets, classes, copies])
  const studentsCount = classes.reduce((a, c) => a + c.students.length, 0)
  const stickers = studentsCount * copies * sheets.length

  const toggle = (key: 'classIds' | 'sheetIds', id: string) =>
    update((d) => {
      const arr = d.print[key]
      d.print[key] = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
    })

  const make = async () => {
    setResult(null)
    setProgress({ done: 0, total: pages.length })
    try {
      const bytes = await buildPdf(pages, (done, total) => setProgress({ done, total }))
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const name = `Наклейки ${classes.map((c) => c.grade + c.letter).join(', ')}.pdf`
      setResult({ url: URL.createObjectURL(blob), name, pages: pages.length })
    } catch (e) {
      console.error(e)
      toast('Что-то пошло не так при создании PDF: ' + (e as Error).message, 'warn')
    }
    setProgress(null)
  }

  const missing = !state.classes.some((c) => c.students.length) ? 'students' : !state.sheets.length ? 'templates' : null

  if (missing)
    return (
      <div className="page">
        <div className="empty card">
          <div className="empty-emoji">{missing === 'students' ? '🧒' : '🖼️'}</div>
          <h2>{missing === 'students' ? 'Пока нет учеников' : 'Пока нет шаблонов'}</h2>
          <p>{missing === 'students' ? 'Добавьте класс и список учеников — и можно печатать.' : 'Загрузите PDF с наклейками.'}</p>
          <button className="btn primary big" onClick={() => goTab(missing)}>
            {missing === 'students' ? 'Добавить учеников' : 'Загрузить шаблон'}
          </button>
        </div>
      </div>
    )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Печать</h1>
          <p className="lead">Выберите класс и шаблоны — программа сама разложит всех учеников по листам и сделает PDF для печати.</p>
        </div>
      </div>

      <div className="print-layout">
        <div className="stack">
          <div className="card">
            <h2>
              <span className="n-badge">1</span> Для кого
            </h2>
            <div className="pick-list">
              {state.classes.map((c) => (
                <label key={c.id} className={'pick-row' + (classIds.includes(c.id) ? ' on' : '')}>
                  <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggle('classIds', c.id)} />
                  <span className="class-badge">{c.grade + ' ' + c.letter}</span>
                  <span>
                    {c.students.length} {plural(c.students.length, 'ученик', 'ученика', 'учеников')}
                  </span>
                </label>
              ))}
            </div>
            <div className="field inline-copies">
              <span>Наклеек на каждого ученика (с каждого шаблона)</span>
              <div className="size-row">
                <button className="sq" onClick={() => update((d) => void (d.print.copies = Math.max(1, d.print.copies - 1)))}>
                  −
                </button>
                <input type="number" min={1} max={20} value={copies} onChange={(e) => update((d) => void (d.print.copies = Math.min(20, Math.max(1, +e.target.value || 1))))} />
                <button className="sq" onClick={() => update((d) => void (d.print.copies = Math.min(20, d.print.copies + 1)))}>
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>
              <span className="n-badge">2</span> Какие наклейки
            </h2>
            <SheetPicker sheets={state.sheets} selected={sheetIds} onChange={(ids) => update((d) => void (d.print.sheetIds = ids))} />
          </div>
        </div>

        <div className="card print-summary">
          <h2>
            <span className="n-badge">3</span> Готово к печати
          </h2>
          {stickers === 0 ? (
            <p className="muted">Выберите хотя бы один класс и один шаблон.</p>
          ) : (
            <>
              <div className="big-numbers">
                <div>
                  <b>{stickers}</b>
                  <span>{plural(stickers, 'наклейка', 'наклейки', 'наклеек')}</span>
                </div>
                <div>
                  <b>{pages.length}</b>
                  <span>{plural(pages.length, 'лист', 'листа', 'листов')} A4</span>
                </div>
              </div>
              <div className="preview-row">
                {pages.slice(0, 3).map((p, i) => (
                  <SheetPreview key={i} sheet={p.sheet} width={150} items={p.items} />
                ))}
                {pages.length > 3 && <div className="more">+{pages.length - 3}</div>}
              </div>
              {progress ? (
                <div className="progress">
                  <div className="bar">
                    <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                  <span>
                    Делаем лист {Math.min(progress.done + 1, progress.total)} из {progress.total}…
                  </span>
                </div>
              ) : (
                <button className="btn primary big full" onClick={make}>
                  🖨️ Создать PDF
                </button>
              )}
              {result && (
                <div className="result-box">
                  <div className="ok-big">✅ PDF готов — {result.pages} {plural(result.pages, 'лист', 'листа', 'листов')}</div>
                  <div className="row gap-s wrap">
                    <a className="btn primary grow" href={result.url} download={result.name}>
                      ⬇ Скачать PDF
                    </a>
                    <a className="btn soft grow" href={result.url} target="_blank" rel="noreferrer">
                      👀 Открыть и напечатать
                    </a>
                  </div>
                  <p className="hint">
                    При печати выберите <b>«Реальный размер»</b> или <b>масштаб 100%</b>, чтобы наклейки не сдвинулись.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
