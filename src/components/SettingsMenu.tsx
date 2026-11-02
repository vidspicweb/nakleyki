import { useRef, useState } from 'react'
import { useApp } from '../store'
import { exportBackup, importBackup } from '../storage'
import { registerUploadedFont } from '../fonts'

/** Меню «⚙»: резервная копия данных и помощь. */
export function SettingsMenu() {
  const { state, replace, toast } = useApp()
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    const blob = await exportBackup(state)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Наклейки — копия ${new Date().toLocaleDateString('ru-RU')}.nakl`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    toast('Копия сохранена в «Загрузки»')
    setOpen(false)
  }

  const load = async (f: File) => {
    try {
      if (!confirm('Заменить текущие данные данными из копии?')) return
      const s = await importBackup(f)
      for (const font of s.fonts) await registerUploadedFont(font).catch(() => undefined)
      replace(s)
      toast('Данные восстановлены')
      setOpen(false)
    } catch (e) {
      toast((e as Error).message, 'warn')
    }
  }

  return (
    <div className="settings">
      <button className="icon-btn big" onClick={() => setOpen((o) => !o)} title="Резервная копия и помощь">
        ⚙
      </button>
      {open && (
        <div className="settings-pop" onMouseLeave={() => setOpen(false)}>
          <div className="settings-title">Ваши данные</div>
          <p className="muted tiny">Библиотека, ученики и настройки хранятся в этом браузере на этом компьютере. Иногда сохраняйте копию — на случай чистки браузера или переезда на другой компьютер. В копию входят все шаблоны и шрифты.</p>
          <button className="btn soft full" onClick={save}>
            💾 Сохранить копию в файл
          </button>
          <button className="btn ghost full" onClick={() => fileRef.current?.click()}>
            📂 Восстановить из файла
          </button>
          <input ref={fileRef} type="file" hidden accept=".nakl,.json" onChange={(e) => e.target.files?.[0] && load(e.target.files[0]).then(() => (e.target.value = ''))} />
        </div>
      )}
    </div>
  )
}
