import { useState } from 'react'
import { AppProvider, useApp } from './store'
import { StudentsPage } from './pages/StudentsPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { EditorPage } from './pages/EditorPage'
import { PrintPage } from './pages/PrintPage'
import { PdfToolsPage } from './pages/PdfToolsPage'
import { SettingsMenu } from './components/SettingsMenu'
import { CloudButton } from './components/CloudButton'

export type Tab = 'students' | 'templates' | 'editor' | 'print'

/** Разделы платформы — список справа. Новые окна добавляются сюда. */
type Section = 'stickers' | 'pdf'
const SECTIONS: { id: Section; icon: string; title: string; sub: string }[] = [
  { id: 'stickers', icon: '🏷', title: 'Наклейки', sub: 'на тетради и шаблоны' },
  { id: 'pdf', icon: '📄', title: 'Работа с PDF', sub: 'разделить, удалить, добавить листы' },
]
const SECTION_KEY = 'nakl-section'

const TABS: { id: Tab; num: number; title: string; sub: string }[] = [
  { id: 'students', num: 1, title: 'Ученики', sub: 'списки классов' },
  { id: 'templates', num: 2, title: 'Библиотека', sub: 'ваши шаблоны' },
  { id: 'editor', num: 3, title: 'Настройка', sub: 'как разместить текст' },
  { id: 'print', num: 4, title: 'Печать', sub: 'готовый PDF' },
]

function Shell() {
  const { state } = useApp()
  const [tab, setTab] = useState<Tab>(() => (state.classes.length ? (state.sheets.length ? 'print' : 'templates') : 'students'))
  const [section, setSectionState] = useState<Section>(() => {
    try {
      return localStorage.getItem(SECTION_KEY) === 'pdf' ? 'pdf' : 'stickers'
    } catch {
      return 'stickers'
    }
  })
  const setSection = (s: Section) => {
    setSectionState(s)
    try {
      localStorage.setItem(SECTION_KEY, s)
    } catch {
      /* не важно */
    }
    window.scrollTo({ top: 0 })
  }

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
            <div className="brand-name">Школьный помощник</div>
            <div className="brand-sub">{SECTIONS.find((s) => s.id === section)!.title}</div>
          </div>
        </div>
        {section === 'stickers' ? (
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
        ) : (
          <div className="steps" />
        )}
        <div className="top-actions">
          <CloudButton />
          <SettingsMenu />
        </div>
      </header>
      <div className="layout">
        <main className="content">
          {section === 'stickers' && (
            <>
              {tab === 'students' && <StudentsPage goNext={() => setTab('templates')} />}
              {tab === 'templates' && <TemplatesPage goNext={() => setTab('editor')} />}
              {tab === 'editor' && <EditorPage goNext={() => setTab('print')} goTemplates={() => setTab('templates')} />}
              {tab === 'print' && <PrintPage goTab={setTab} />}
            </>
          )}
          {/* окно PDF не закрываем при переключении — чтобы не потерять открытые файлы */}
          <div hidden={section !== 'pdf'}>
            <PdfToolsPage
              goLibrary={() => {
                setSection('stickers')
                setTab('templates')
              }}
            />
          </div>
        </main>
        <aside className="sidenav" aria-label="Разделы">
          <div className="side-title">Разделы</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={'nav-item' + (section === s.id ? ' active' : '')} onClick={() => setSection(s.id)}>
              <span className="nav-icon">{s.icon}</span>
              <span className="nav-text">
                <b>{s.title}</b>
                <small>{s.sub}</small>
              </span>
            </button>
          ))}
        </aside>
      </div>
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
