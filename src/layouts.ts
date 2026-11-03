import type { AppState, Layout, Sheet } from './types'

/*
 * Раскладка строк (где и каким шрифтом писать текст).
 * По умолчанию она ОБЩАЯ для всех шаблонов: настроили один раз — все шаблоны выглядят так же.
 * Если шаблону нужна своя раскладка, у него включается ownLayout, и тогда используется sheet.layout.
 */

const strip = (l: Layout) => JSON.stringify(l.lines.map(({ id: _id, ...rest }) => rest))

export const sameLayout = (a: Layout, b: Layout) => strip(a) === strip(b)

export const effectiveLayout = (state: Pick<AppState, 'commonLayout'>, sheet: Sheet): Layout =>
  sheet.ownLayout || !state.commonLayout ? sheet.layout : state.commonLayout

/** Шаблон вместе с той раскладкой, по которой он печатается. */
export const resolveSheet = (state: Pick<AppState, 'commonLayout'>, sheet: Sheet): Sheet => ({ ...sheet, layout: effectiveLayout(state, sheet) })

/** Если общей раскладки ещё нет — делаем её из первого шаблона. */
export function ensureCommon(d: AppState) {
  if (!d.commonLayout && d.sheets.length) d.commonLayout = structuredClone(d.sheets[0].layout)
}

/**
 * Перенос старых данных: раньше у каждого шаблона была своя раскладка.
 * Общей становится последняя настроенная; шаблоны с такой же раскладкой привязываются к общей,
 * а шаблоны с отличающейся — сохраняют свою (ничего не теряется).
 */
export function migrateLayouts(s: AppState): AppState {
  if (s.commonLayout || !s.sheets.length) return s
  const base = s.lastLayout ?? s.sheets[0].layout
  const common = structuredClone(base)
  return {
    ...s,
    commonLayout: common,
    lastLayout: undefined,
    sheets: s.sheets.map((sh) => ({ ...sh, ownLayout: !sameLayout(sh.layout, common) })),
  }
}
