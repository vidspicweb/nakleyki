import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import type { Align, Grid, SchoolClass, Sheet, Student, TextLine } from '../types'
import { PLACEHOLDERS, SAMPLE_CLASS, SAMPLE_STUDENT, fillText } from '../names'
import { cloneLayout, defaultLayout, newLine } from '../render'
import { StickerCanvas } from '../components/StickerCanvas'
import { SheetPreview } from '../components/SheetPreview'
import { FontPicker } from '../components/FontPicker'
import { detectGrid, renderPage } from '../pdf'
import { clamp } from '../util'

const COLORS = ['#1b1f3b', '#000000', '#1d4ed8', '#7c3aed', '#be123c', '#047857', '#c2410c']

export function EditorPage({ goNext, goTemplates }: { goNext: () => void; goTemplates: () => void }) {
  const { state, update, toast } = useApp()
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId) ?? state.sheets[0]
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cellIndex, setCellIndex] = useState(0)
  const [studentIdx, setStudentIdx] = useState(0)
  const [showApply, setShowApply] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const stageWrap = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(640)

  useEffect(() => {
    const el = stageWrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageW(Math.min(760, Math.max(280, el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [sheet?.id])

  const cls: SchoolClass = state.classes.find((c) => c.id === state.activeClassId) ?? state.classes.find((c) => c.students.length) ?? SAMPLE_CLASS
  const students: Student[] = cls.students.length ? cls.students : [SAMPLE_STUDENT]
  const student = students[Math.min(studentIdx, students.length - 1)]

  // самая длинная фамилия — чтобы проверить, что всё влезает
  const longestIdx = useMemo(() => {
    let best = 0
    students.forEach((s, i) => {
      if (s.last.length + s.first.length > students[best].last.length + students[best].first.length) best = i
    })
    return best
  }, [students])

  const sheetItems = useMemo(() => {
    if (!sheet) return []
    const n = sheet.grid.cols * sheet.grid.rows
    return Array.from({ length: n }, (_, i) => ({ student: students[i % students.length], cls }))
  }, [sheet, students, cls])

  if (!sheet)
    return (
      <div className="page">
        <div className="empty card">
          <div className="empty-emoji">🖼️</div>
          <h2>Сначала добавьте шаблон</h2>
          <p>Загрузите PDF с наклейками — и здесь можно будет настроить, где и каким шрифтом писать текст.</p>
          <button className="btn primary big" onClick={goTemplates}>
            Перейти к шаблонам
          </button>
        </div>
      </div>
    )

  const patchSheet = (fn: (s: Sheet) => void) =>
    update((d) => {
      const s = d.sheets.find((x) => x.id === sheet.id)!
      fn(s)
      d.lastLayout = s.layout
    })
  const patchLine = (id: string, p: Partial<TextLine>) =>
    patchSheet((s) => {
      Object.assign(s.layout.lines.find((l) => l.id === id)!, p)
    })

  const selected = sheet.layout.lines.find((l) => l.id === selectedId) ?? null

  const nudge = (dx: number, dy: number) => {
    if (!selected) return
    patchLine(selected.id, { x: clamp(selected.x + dx, 0, 1), y: clamp(selected.y + dy, 0.02, 1) })
  }

  return (
    <div className="page editor-page" onKeyDown={(e) => {
      const tag = (e.target as HTMLElement).tagName
      if (!selected || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const step = e.shiftKey ? 0.02 : 0.003
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (map[e.key]) {
        e.preventDefault()
        nudge(...map[e.key])
      }
    }} tabIndex={-1}>
      <div className="page-head">
        <div>
          <h1>Настройка наклейки</h1>
          <p className="lead">Настройте одну наклейку — все остальные на листе и для всех учеников выровняются так же. Строки можно <b>перетаскивать мышкой</b>.</p>
        </div>
        <button className="btn primary big" onClick={goNext}>
          Дальше: печать →
        </button>
      </div>

      {state.sheets.length > 1 && (
        <div className="sheet-strip">
          {state.sheets.map((s) => (
            <button key={s.id} className={'strip-item' + (s.id === sheet.id ? ' active' : '')} onClick={() => {
              update((d) => void (d.activeSheetId = s.id))
              setSelectedId(null)
              setCellIndex(0)
            }}>
              <SheetPreview sheet={s} width={64} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="editor">
        <section className="editor-main">
          <div className="card stage-card">
            <div className="stage-toolbar">
              <label className="inline-field">
                <span>Пример:</span>
                <select value={Math.min(studentIdx, students.length - 1)} onChange={(e) => setStudentIdx(+e.target.value)}>
                  {students.map((s, i) => (
                    <option key={s.id} value={i}>
                      {s.last} {s.first}
                      {i === longestIdx && students.length > 1 ? '  (самое длинное)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {students.length > 1 && (
                <button className="btn ghost small" onClick={() => setStudentIdx(longestIdx)} title="Проверить, влезает ли самое длинное имя">
                  Проверить самое длинное
                </button>
              )}
              {!cls.students.length && <span className="tag">пример — добавьте учеников на шаге 1</span>}
            </div>
            <div className="stage-wrap" ref={stageWrap}>
              <StickerCanvas
                sheet={sheet}
                cellIndex={cellIndex}
                student={student}
                cls={cls}
                width={stageW}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={(id, x, y) => patchLine(id, { x, y })}
              />
            </div>
            <div className="muted tiny center">Совет: выделите строку и двигайте стрелками на клавиатуре — для точной подгонки. С Shift — быстрее.</div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Так будет на всём листе</h2>
              <div className="row gap-s">
                <button className={'btn small ' + (showGrid ? 'soft' : 'ghost')} onClick={() => setShowGrid((v) => !v)}>
                  📐 {showGrid ? 'Скрыть настройку рамок' : 'Рамки легли неровно?'}
                </button>
              </div>
            </div>
            <div className="sheet-and-grid">
              <SheetPreview
                sheet={sheet}
                width={showGrid ? 300 : 340}
                items={showGrid ? undefined : sheetItems}
                showGrid={showGrid}
                highlightCell={cellIndex}
                onCellClick={setCellIndex}
                className="sheet-big"
              />
              {showGrid ? (
                <GridEditor sheet={sheet} onChange={(g) => patchSheet((s) => void (s.grid = g))} />
              ) : (
                <div className="sheet-side-note">
                  <p>Нажмите на любую наклейку на листе, чтобы настраивать на ней (красная рамка).</p>
                  <p className="muted">Текст ставится на одно и то же место на каждой наклейке.</p>
                  <div className="divider" />
                  <button className="btn soft full" onClick={() => setShowApply(true)} disabled={state.sheets.length < 2}>
                    📋 Применить эту настройку к другим шаблонам
                  </button>
                  <button
                    className="btn ghost full"
                    onClick={() => {
                      if (!confirm('Вернуть строки как было изначально?')) return
                      patchSheet((s) => void (s.layout = defaultLayout()))
                      setSelectedId(null)
                    }}
                  >
                    ↺ Начать заново
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="editor-side">
          <div className="card">
            <div className="card-head">
              <h2>Строки текста</h2>
              <button
                className="btn soft small"
                onClick={() => {
                  const l = newLine({ font: selected?.font ?? sheet.layout.lines.find((x) => x.enabled)?.font ?? 'Nunito', y: 0.5 })
                  patchSheet((s) => void s.layout.lines.push(l))
                  setSelectedId(l.id)
                }}
              >
                + Строка
              </button>
            </div>
            <ul className="lines">
              {sheet.layout.lines.map((l, i) => (
                <li key={l.id} className={(l.id === selectedId ? 'on ' : '') + (l.enabled ? '' : 'off')}>
                  <button
                    className="eye"
                    title={l.enabled ? 'Скрыть строку' : 'Показать строку'}
                    onClick={() => patchLine(l.id, { enabled: !l.enabled })}
                  >
                    {l.enabled ? '👁' : '—'}
                  </button>
                  <button className="line-label" onClick={() => setSelectedId(l.id)}>
                    <span className="line-preview" style={{ fontFamily: `"${l.font}", Nunito`, fontWeight: l.bold ? 700 : 400, fontStyle: l.italic ? 'italic' : 'normal' }}>
                      {fillText(l.text, student, cls, sheet) || <i className="muted">пустая строка</i>}
                    </span>
                  </button>
                  <span className="updown">
                    <button disabled={i === 0} onClick={() => patchSheet((s) => void s.layout.lines.splice(i - 1, 0, ...s.layout.lines.splice(i, 1)))} title="Выше в списке">
                      ▲
                    </button>
                    <button disabled={i === sheet.layout.lines.length - 1} onClick={() => patchSheet((s) => void s.layout.lines.splice(i + 1, 0, ...s.layout.lines.splice(i, 1)))} title="Ниже в списке">
                      ▼
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {selected ? (
            <LineSettings
              key={selected.id}
              line={selected}
              sample={fillText(selected.text, student, cls, sheet) || 'Божко Александр'}
              patch={(p) => patchLine(selected.id, p)}
              nudge={nudge}
              remove={() => {
                patchSheet((s) => void (s.layout.lines = s.layout.lines.filter((l) => l.id !== selected.id)))
                setSelectedId(null)
              }}
              fontForAll={() => {
                patchSheet((s) => s.layout.lines.forEach((l) => (l.font = selected.font)))
                toast('Шрифт поставлен всем строкам')
              }}
            />
          ) : (
            <div className="card hint-card">
              <div className="empty-emoji small">👆</div>
              <b>Нажмите на строку</b>
              <p className="muted">на наклейке или в списке выше — здесь появятся её настройки: текст, шрифт, размер, цвет.</p>
            </div>
          )}
        </aside>
      </div>

      {showApply && <ApplyDialog sheet={sheet} close={() => setShowApply(false)} />}
    </div>
  )
}

function LineSettings({ line, sample, patch, nudge, remove, fontForAll }: {
  line: TextLine
  sample: string
  patch: (p: Partial<TextLine>) => void
  nudge: (dx: number, dy: number) => void
  remove: () => void
  fontForAll: () => void
}) {
  const textRef = useRef<HTMLInputElement>(null)
  const insert = (key: string) => {
    const el = textRef.current
    const start = el?.selectionStart ?? line.text.length
    const end = el?.selectionEnd ?? line.text.length
    const before = line.text.slice(0, start)
    const sep = before && !before.endsWith(' ') ? ' ' : ''
    const next = before + sep + key + line.text.slice(end)
    patch({ text: next })
    requestAnimationFrame(() => {
      el?.focus()
      const pos = (before + sep + key).length
      el?.setSelectionRange(pos, pos)
    })
  }
  return (
    <div className="card line-settings">
      <h2>Настройки строки</h2>

      <label className="field">
        <span>Текст</span>
        <input ref={textRef} value={line.text} onChange={(e) => patch({ text: e.target.value })} />
      </label>
      <div className="chips-label muted tiny">Вставить данные ученика (подставятся сами):</div>
      <div className="chips">
        {PLACEHOLDERS.map((p) => (
          <button key={p.key} className="chip" onClick={() => insert(p.key)} title={p.hint}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="field">
        <span>Шрифт</span>
        <FontPicker value={line.font} onChange={(font) => patch({ font })} sample={sample} />
        <button className="link-btn" onClick={fontForAll}>
          Поставить этот шрифт всем строкам
        </button>
      </div>

      <div className="field">
        <span>Размер</span>
        <div className="size-row">
          <button className="sq" onClick={() => patch({ size: Math.max(4, +(line.size - 0.5).toFixed(1)) })}>
            −
          </button>
          <input type="number" step={0.5} min={4} max={72} value={line.size} onChange={(e) => patch({ size: clamp(+e.target.value || 4, 4, 72) })} />
          <button className="sq" onClick={() => patch({ size: Math.min(72, +(line.size + 0.5).toFixed(1)) })}>
            +
          </button>
          <input type="range" min={6} max={36} step={0.5} value={line.size} onChange={(e) => patch({ size: +e.target.value })} />
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <span>Начертание</span>
          <div className="seg">
            <button className={line.bold ? 'on' : ''} onClick={() => patch({ bold: !line.bold })} title="Жирный">
              <b>Ж</b>
            </button>
            <button className={line.italic ? 'on' : ''} onClick={() => patch({ italic: !line.italic })} title="Курсив">
              <i>К</i>
            </button>
          </div>
        </div>
        <div className="field">
          <span>Выравнивание</span>
          <div className="seg">
            {(['left', 'center', 'right'] as Align[]).map((a) => (
              <button key={a} className={line.align === a ? 'on' : ''} onClick={() => patch({ align: a })} title={{ left: 'По левому краю', center: 'По центру', right: 'По правому краю' }[a]}>
                <AlignIcon a={a} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <span>Цвет</span>
        <div className="colors">
          {COLORS.map((c) => (
            <button key={c} className={'swatch' + (line.color === c ? ' on' : '')} style={{ background: c }} onClick={() => patch({ color: c })} title={c} />
          ))}
          <label className="swatch custom" title="Свой цвет">
            <input type="color" value={line.color} onChange={(e) => patch({ color: e.target.value })} />
            🎨
          </label>
        </div>
      </div>

      <div className="field">
        <span>Сдвинуть</span>
        <div className="nudge">
          <button onClick={() => nudge(0, -0.005)}>↑</button>
          <button onClick={() => nudge(-0.005, 0)}>←</button>
          <button onClick={() => nudge(0.005, 0)}>→</button>
          <button onClick={() => nudge(0, 0.005)}>↓</button>
        </div>
      </div>

      <div className="field">
        <span>
          Не шире, чем {Math.round(line.maxWidth * 100)}% наклейки <small className="muted">— длинные имена уменьшатся сами</small>
        </span>
        <input type="range" min={0.1} max={1} step={0.01} value={line.maxWidth} onChange={(e) => patch({ maxWidth: +e.target.value })} />
      </div>

      <button className="btn ghost danger full" onClick={remove}>
        Удалить строку
      </button>
    </div>
  )
}

function AlignIcon({ a }: { a: Align }) {
  const rows = a === 'left' ? [[2, 14], [2, 10], [2, 12]] : a === 'right' ? [[2, 14], [6, 10], [4, 12]] : [[2, 14], [4, 10], [3, 12]]
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      {rows.map(([x, w], i) => (
        <rect key={i} x={x} y={2 + i * 4} width={w} height={2} rx={1} fill="currentColor" />
      ))}
    </svg>
  )
}

function GridEditor({ sheet, onChange }: { sheet: Sheet; onChange: (g: Grid) => void }) {
  const g = sheet.grid
  const mmW = (sheet.widthPt / 72) * 25.4
  const mmH = (sheet.heightPt / 72) * 25.4
  const slider = (label: string, key: keyof Grid, total: number, max = 40) => (
    <label className="grid-slider">
      <span>
        {label} <b>{(g[key] * total).toFixed(1)} мм</b>
      </span>
      <input type="range" min={0} max={max} step={0.1} value={g[key] * total} onChange={(e) => onChange({ ...g, [key]: +e.target.value / total })} />
    </label>
  )
  return (
    <div className="grid-editor">
      <p className="muted">Рамки должны совпадать с краями наклеек. Обычно программа находит их сама.</p>
      <button
        className="btn soft full"
        onClick={async () => onChange(detectGrid(await renderPage(sheet.templateId, sheet.pageIndex, 400)))}
      >
        🔍 Найти наклейки автоматически
      </button>
      <div className="form-row">
        <label className="field narrow">
          <span>Столбцов</span>
          <input type="number" min={1} max={6} value={g.cols} onChange={(e) => onChange({ ...g, cols: clamp(+e.target.value || 1, 1, 6) })} />
        </label>
        <label className="field narrow">
          <span>Рядов</span>
          <input type="number" min={1} max={12} value={g.rows} onChange={(e) => onChange({ ...g, rows: clamp(+e.target.value || 1, 1, 12) })} />
        </label>
      </div>
      {slider('Отступ сверху', 'top', mmH)}
      {slider('Отступ снизу', 'bottom', mmH)}
      {slider('Отступ слева', 'left', mmW)}
      {slider('Отступ справа', 'right', mmW)}
      {slider('Промежуток между столбцами', 'gapX', mmW, 20)}
      {slider('Промежуток между рядами', 'gapY', mmH, 20)}
    </div>
  )
}

function ApplyDialog({ sheet, close }: { sheet: Sheet; close: () => void }) {
  const { state, update, toast } = useApp()
  const others = state.sheets.filter((s) => s.id !== sheet.id)
  const [ids, setIds] = useState<string[]>(others.map((s) => s.id))
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Применить настройку к другим шаблонам</h2>
        <p className="muted">Строки, шрифты и их места с «{sheet.name}» будут скопированы в выбранные шаблоны.</p>
        <div className="row gap-s">
          <button className="link-btn" onClick={() => setIds(others.map((s) => s.id))}>Выбрать все</button>
          <button className="link-btn" onClick={() => setIds([])}>Снять все</button>
        </div>
        <div className="pick-grid">
          {others.map((s) => (
            <label key={s.id} className={'pick' + (ids.includes(s.id) ? ' on' : '')}>
              <input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => setIds((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))} />
              <SheetPreview sheet={s} width={90} />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
        <div className="row end gap-s">
          <button className="btn ghost" onClick={close}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={!ids.length}
            onClick={() => {
              update((d) => {
                for (const s of d.sheets) if (ids.includes(s.id)) s.layout = cloneLayout(sheet.layout)
              })
              toast(`Настройка применена к ${ids.length} шаблонам`)
              close()
            }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  )
}
