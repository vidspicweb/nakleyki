import { useState } from 'react'
import { useApp } from '../store'
import { detectGender, genitive, parseStudents } from '../names'
import type { SchoolClass, Student } from '../types'
import { plural, uid } from '../util'
import { markDeleted } from '../cloud/merge'

export function StudentsPage({ goNext }: { goNext: () => void }) {
  const { state, update, toast } = useApp()
  const active = state.classes.find((c) => c.id === state.activeClassId) ?? state.classes[0]

  const addClass = () => {
    const id = uid()
    const prev = active
    update((d) => {
      d.classes.push({ id, grade: prev?.grade ?? '', letter: '', school: prev?.school ?? '', students: [] })
      d.activeClassId = id
    })
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ученики</h1>
          <p className="lead">Добавьте класс и вставьте список учеников. Пол и падеж программа определит сама — вам останется только проверить.</p>
        </div>
        {state.classes.some((c) => c.students.length) && (
          <button className="btn primary big" onClick={goNext}>
            Дальше: шаблоны →
          </button>
        )}
      </div>

      <div className="split">
        <aside className="side">
          <div className="side-title">Классы</div>
          {state.classes.map((c) => (
            <button
              key={c.id}
              className={'class-card' + (c.id === active?.id ? ' active' : '')}
              onClick={() => update((d) => void (d.activeClassId = c.id))}
            >
              <span className="class-badge">{(c.grade || '?') + (c.letter ? ' ' + c.letter : '')}</span>
              <span className="class-info">
                <b>{c.grade ? `${c.grade} «${c.letter || '…'}» класс` : 'Новый класс'}</b>
                <small>
                  {c.students.length} {plural(c.students.length, 'ученик', 'ученика', 'учеников')}
                </small>
              </span>
            </button>
          ))}
          <button className="btn dashed full" onClick={addClass}>
            + Добавить класс
          </button>
        </aside>

        <section className="main-col">
          {!active ? (
            <div className="empty card">
              <div className="empty-emoji">🎒</div>
              <h2>Начнём с класса</h2>
              <p>Нажмите кнопку, чтобы добавить первый класс. Потом просто вставите список учеников из Excel, Word или блокнота.</p>
              <button className="btn primary big" onClick={addClass}>
                + Добавить класс
              </button>
            </div>
          ) : (
            <ClassEditor key={active.id} cls={active} onDelete={() => {
              if (!confirm(`Удалить класс ${active.grade} ${active.letter} со всеми учениками?`)) return
              update((d) => {
                d.classes = d.classes.filter((c) => c.id !== active.id)
                markDeleted(d, [active.id])
                d.activeClassId = d.classes[0]?.id
              })
              toast('Класс удалён')
            }} />
          )}
        </section>
      </div>
    </div>
  )
}

function ClassEditor({ cls, onDelete }: { cls: SchoolClass; onDelete: () => void }) {
  const { update, toast } = useApp()
  const [paste, setPaste] = useState('')
  const preview = parseStudents(paste)

  const patchClass = (p: Partial<SchoolClass>) =>
    update((d) => {
      const c = d.classes.find((x) => x.id === cls.id)!
      Object.assign(c, p)
    })

  const patchStudent = (id: string, p: Partial<Student>) =>
    update((d) => {
      const s = d.classes.find((x) => x.id === cls.id)!.students.find((x) => x.id === id)!
      Object.assign(s, p)
    })

  const addPasted = () => {
    if (!preview.length) return
    update((d) => {
      d.classes.find((x) => x.id === cls.id)!.students.push(...preview)
    })
    setPaste('')
    const unsure = preview.filter((s) => !s.genderSure).length
    toast(
      `Добавлено: ${preview.length} ${plural(preview.length, 'ученик', 'ученика', 'учеников')}` +
        (unsure ? `. Проверьте пол у отмеченных жёлтым (${unsure})` : ''),
      unsure ? 'warn' : 'ok',
    )
  }

  const sortAbc = () =>
    update((d) => {
      d.classes.find((x) => x.id === cls.id)!.students.sort((a, b) => (a.last + ' ' + a.first).localeCompare(b.last + ' ' + b.first, 'ru'))
    })

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>Данные класса</h2>
          <button className="btn ghost danger small" onClick={onDelete}>
            Удалить класс
          </button>
        </div>
        <div className="form-row">
          <label className="field narrow">
            <span>Класс (цифра)</span>
            <input value={cls.grade} placeholder="4" onChange={(e) => patchClass({ grade: e.target.value })} />
          </label>
          <label className="field narrow">
            <span>Буква</span>
            <input value={cls.letter} placeholder="А" onChange={(e) => patchClass({ letter: e.target.value.toUpperCase() })} />
          </label>
          <label className="field grow">
            <span>Школа — как написать на наклейке</span>
            <input value={cls.school} placeholder="МБОУ Рассветовской СОШ" onChange={(e) => patchClass({ school: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Добавить учеников</h2>
        <p className="muted">
          Скопируйте список из Excel, Word или блокнота и вставьте сюда. <b>Каждый ученик — с новой строки</b>, сначала фамилия, потом имя. Номера и отчества можно не убирать.
        </p>
        <div className="paste-grid">
          <textarea
            className="paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'Божко Александр\nИванова Мария\nПетров Илья\n…'}
            rows={6}
          />
          <div className="paste-preview">
            {preview.length === 0 ? (
              <div className="muted center">Здесь появится, как программа поняла список</div>
            ) : (
              <>
                <ul>
                  {preview.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <span className={'g-dot ' + s.gender}>{s.gender === 'm' ? '👦' : '👧'}</span> {s.last} {s.first}
                      {!s.genderSure && <span className="tag warn">проверить</span>}
                    </li>
                  ))}
                  {preview.length > 8 && <li className="muted">… и ещё {preview.length - 8}</li>}
                </ul>
                <button className="btn primary full" onClick={addPasted}>
                  Добавить {preview.length} {plural(preview.length, 'ученика', 'учеников', 'учеников')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>
            Список класса <span className="count">{cls.students.length}</span>
          </h2>
          <div className="row gap-s">
            {cls.students.length > 1 && (
              <button className="btn ghost small" onClick={sortAbc}>
                По алфавиту
              </button>
            )}
            <button
              className="btn ghost small"
              onClick={() => {
                const g = detectGender('', '')
                update((d) => {
                  d.classes.find((x) => x.id === cls.id)!.students.push({ id: uid(), last: '', first: '', gender: g.gender, genderSure: false })
                })
              }}
            >
              + Один ученик
            </button>
          </div>
        </div>

        {cls.students.length === 0 ? (
          <div className="muted center pad">Пока никого нет — вставьте список выше.</div>
        ) : (
          <div className="table-wrap">
            <table className="students">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Фамилия</th>
                  <th>Имя</th>
                  <th>Кто</th>
                  <th>
                    Как будет на наклейке <small className="muted">(можно поправить)</small>
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cls.students.map((s, i) => (
                  <StudentRow key={s.id} n={i + 1} s={s} cls={cls} patch={(p) => patchStudent(s.id, p)} remove={() =>
                    update((d) => {
                      const c = d.classes.find((x) => x.id === cls.id)!
                      c.students = c.students.filter((x) => x.id !== s.id)
                    })
                  } />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StudentRow({ n, s, cls, patch, remove }: { n: number; s: Student; cls: SchoolClass; patch: (p: Partial<Student>) => void; remove: () => void }) {
  const auto = genitive({ ...s, lastGen: undefined, firstGen: undefined })
  const g = genitive(s)
  const rename = (p: { last?: string; first?: string }) => {
    const last = p.last ?? s.last
    const first = p.first ?? s.first
    const det = detectGender(first, last)
    patch({ ...p, gender: det.gender, genderSure: det.sure, lastGen: undefined, firstGen: undefined })
  }
  return (
    <tr className={s.genderSure ? '' : 'unsure'}>
      <td className="num">{n}</td>
      <td>
        <input className="cell-input" value={s.last} onChange={(e) => rename({ last: e.target.value })} placeholder="Фамилия" />
      </td>
      <td>
        <input className="cell-input" value={s.first} onChange={(e) => rename({ first: e.target.value })} placeholder="Имя" />
      </td>
      <td>
        <div className="seg" role="group" aria-label="Пол">
          <button className={s.gender === 'm' ? 'on m' : ''} onClick={() => patch({ gender: 'm', genderSure: true, lastGen: undefined, firstGen: undefined })} title="Мальчик">
            👦 <span>ученик</span>
          </button>
          <button className={s.gender === 'f' ? 'on f' : ''} onClick={() => patch({ gender: 'f', genderSure: true, lastGen: undefined, firstGen: undefined })} title="Девочка">
            👧 <span>ученица</span>
          </button>
        </div>
        {!s.genderSure && <div className="tag warn">проверьте</div>}
      </td>
      <td className="result">
        <span className="muted">{s.gender === 'f' ? 'ученицы' : 'ученика'} {cls.grade} класса {cls.letter}</span>{' '}
        <input
          className={'cell-input gen' + (s.lastGen ? ' edited' : '')}
          value={g.last}
          size={Math.max(4, g.last.length)}
          onChange={(e) => patch({ lastGen: e.target.value === auto.last ? undefined : e.target.value })}
          title="Фамилия в родительном падеже (кого?)"
        />{' '}
        <input
          className={'cell-input gen' + (s.firstGen ? ' edited' : '')}
          value={g.first}
          size={Math.max(4, g.first.length)}
          onChange={(e) => patch({ firstGen: e.target.value === auto.first ? undefined : e.target.value })}
          title="Имя в родительном падеже (кого?)"
        />
      </td>
      <td>
        <button className="icon-btn" title="Удалить ученика" onClick={remove}>
          ✕
        </button>
      </td>
    </tr>
  )
}
