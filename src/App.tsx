import { useState } from 'react'
import { AppProvider, useApp } from './store'
import { StudentsPage } from './pages/StudentsPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { EditorPage } from './pages/EditorPage'
import { PrintPage } from './pages/PrintPage'
import { SettingsMenu } from './components/SettingsMenu'

export type Tab = 'students' | 'templates' | 'editor' | 'print'

const TABS: { id: Tab; num: number; title: string; sub: string; icon: string }[] = [
  { id: 'students', num: 1, title: 'Ученики', sub: 'списки классов', icon: '🧒' },
  { id: 'templates', num: 2, title: 'Шаблоны', sub: 'PDF с наклейками', icon: '🖼️' },
  { id: 'editor', num: 3, title: 'Настройка', sub: 'как разместить текст', icon: '✏️' },
  { id: 'print', num: 4, title: 'Печать', sub: 'готовый PDF', icon: '🖨️' },
]

function Shell() {
  const { state } = useApp()
  const [tab, setTab] = useState<Tab>(() => (state.classes.length ? (state.sheets.length ? 'print' : 'templates') : 'students'))

  const done: Record<Tab, boolean> = {
    students: state.classes.some((c) => c.students.length > 0),
    templates: state.sheets.length > 0,
    editor: state.sheets.length > 0,
    print: false,
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <span>А</span>
          </div>
          <div>
            <div className="brand-name">Наклейки</div>
            <div className="brand-sub">на тетради за пару минут</div>
          </div>
        </div>
        <nav className="steps" aria-label="Шаги">
          {TABS.map((t) => (
            <button key={t.id} className={'step' + (tab === t.id ? ' active' : '') + (done[t.id] ? ' done' : '')} onClick={() => setTab(t.id)}>
              <span className="step-num">{done[t.id] && tab !== t.id ? '✓' : t.num}</span>
              <span className="step-text">
                <b>{t.title}</b>
                <small>{t.sub}</small>
              </span>
            </button>
          ))}
        </nav>
        <SettingsMenu />
      </header>
      <main className="content">
        {tab === 'students' && <StudentsPage goNext={() => setTab('templates')} />}
        {tab === 'templates' && <TemplatesPage goNext={() => setTab('editor')} />}
        {tab === 'editor' && <EditorPage goNext={() => setTab('print')} goTemplates={() => setTab('templates')} />}
        {tab === 'print' && <PrintPage goTab={setTab} />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
