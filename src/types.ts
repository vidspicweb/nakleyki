export type Gender = 'm' | 'f'

export interface Student {
  id: string
  last: string // фамилия (им. падеж)
  first: string // имя (им. падеж)
  gender: Gender
  genderSure: boolean // false — программа не уверена, стоит проверить
  lastGen?: string // ручная правка родительного падежа
  firstGen?: string
}

export interface SchoolClass {
  id: string
  grade: string // "4"
  letter: string // "А"
  school: string // "МБОУ Рассветовской СОШ" — как писать на наклейке
  students: Student[]
}

export type Align = 'left' | 'center' | 'right'

export interface TextLine {
  id: string
  text: string // с подстановками {Фамилия} и т.п.
  font: string // имя семейства шрифта
  size: number // кегль в пунктах (pt), как в Word
  bold: boolean
  italic: boolean
  color: string
  align: Align
  x: number // 0..1 — точка привязки по ширине наклейки
  y: number // 0..1 — базовая линия по высоте наклейки
  maxWidth: number // 0..1 — если текст шире, он аккуратно уменьшится
  enabled: boolean
}

export interface Layout {
  lines: TextLine[]
}

/** Равномерная сетка наклеек на листе. Все значения — доли от размера листа. */
export interface Grid {
  cols: number
  rows: number
  left: number
  top: number
  right: number
  bottom: number
  gapX: number
  gapY: number
}

export interface TemplateFile {
  id: string
  name: string
  pageCount: number
  kind?: 'pdf' | 'image'
  addedAt?: number
}

/** Одна страница PDF = один дизайн наклеек */
export interface Sheet {
  id: string
  templateId: string
  pageIndex: number
  name: string
  subject: string
  grid: Grid
  layout: Layout
  widthPt: number
  heightPt: number
  tags?: string[] // метки для поиска: «Математика», «Для девочек»…
  ownLayout?: boolean // true — своя раскладка строк; иначе используется общая (AppState.commonLayout)
  addedAt?: number
}

export interface UploadedFont {
  id: string
  family: string
}

export interface AppState {
  version: 1
  classes: SchoolClass[]
  templates: TemplateFile[]
  sheets: Sheet[]
  fonts: UploadedFont[]
  activeClassId?: string
  activeSheetId?: string
  lastLayout?: Layout // устарело: раньше раскладка копировалась из последней настроенной
  commonLayout?: Layout // общая раскладка строк для всех шаблонов
  customTags?: string[] // метки, которые пользователь придумал сам
  updatedAt?: number // когда данные менялись в последний раз (для синхронизации)
  deleted?: Record<string, number> // что удалено: id → когда (чтобы удаление дошло до других компьютеров)
  print: { classIds: string[]; sheetIds: string[]; copies: number }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
