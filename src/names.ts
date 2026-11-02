import { getFirstnameGender, getLastnameGender, inclineFirstname, inclineLastname } from 'lvovich'
import type { Gender, SchoolClass, Sheet, Student } from './types'
import { uid } from './util'

const cap = (s: string) =>
  s
    .toLowerCase()
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('-')

/** Определяем пол по имени, а если имя «двойное» (Саша, Женя) — по фамилии. */
export function detectGender(first: string, last: string): { gender: Gender; sure: boolean } {
  const fg = safe(() => getFirstnameGender(first))
  const lg = safe(() => getLastnameGender(last))
  if (fg === 'male') return { gender: 'm', sure: true }
  if (fg === 'female') return { gender: 'f', sure: true }
  if (lg === 'male') return { gender: 'm', sure: true }
  if (lg === 'female') return { gender: 'f', sure: true }
  // мягкий знак на конце женских имён: Любовь
  if (/овь$/i.test(first)) return { gender: 'f', sure: true }
  if (/[ая]$/i.test(first) && fg !== 'androgynous') return { gender: 'f', sure: false }
  return { gender: 'm', sure: false }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

const SURNAME_RE = /(ов|ев|ёв|ин|ын|ова|ева|ёва|ина|ына|ский|цкий|ская|цкая|ая|енко|ук|юк)$/i

const isKnownFirst = (w: string) => {
  const g = safe(() => getFirstnameGender(w))
  return g === 'male' || g === 'female' || g === 'androgynous'
}

/** Разбираем вставленный список: «Фамилия Имя» (или «Имя Фамилия» — поймём сами). */
export function parseStudents(text: string): Student[] {
  const out: Student[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*\d+[.)]?\s*/, '') // «1. Иванов Иван»
      .replace(/[,;\t]+/g, ' ')
      .trim()
    if (!line) continue
    const words = line.split(/\s+/).filter(Boolean)
    let last = words[0] ?? ''
    let first = words[1] ?? ''
    // «Анна Белая», «Мария Иванова» — сначала имя, потом фамилия: меняем местами
    if (words.length >= 2 && isKnownFirst(words[0]) && SURNAME_RE.test(words[1]) && !SURNAME_RE.test(words[0])) {
      ;[first, last] = [words[0], words[1]]
    }
    last = cap(last)
    first = cap(first)
    const g = detectGender(first, last)
    out.push({ id: uid(), last, first, gender: g.gender, genderSure: g.sure })
  }
  return out
}

export function genitive(s: Pick<Student, 'last' | 'first' | 'gender' | 'lastGen' | 'firstGen'>) {
  const gender = s.gender === 'm' ? 'male' : 'female'
  let last = s.last
  // женские фамилии на согласную не склоняются: (у) Мельник, Цой, Лебедь
  if (!(gender === 'female' && /[^аяё]$/i.test(s.last))) {
    last = safe(() => inclineLastname(s.last, 'genitive', gender)) || s.last
  }
  const first = safe(() => inclineFirstname(s.first, 'genitive', gender)) || s.first
  return {
    last: s.lastGen?.trim() || last,
    first: s.firstGen?.trim() || first,
  }
}

export const SAMPLE_STUDENT: Student = {
  id: 'sample',
  last: 'Божко',
  first: 'Александр',
  gender: 'm',
  genderSure: true,
}

export const SAMPLE_CLASS: SchoolClass = {
  id: 'sample',
  grade: '4',
  letter: 'А',
  school: 'МБОУ Рассветовской СОШ',
  students: [SAMPLE_STUDENT],
}

export const PLACEHOLDERS: { key: string; label: string; hint: string }[] = [
  { key: '{ученика}', label: 'ученика / ученицы', hint: 'Само выберет по полу' },
  { key: '{Фамилия}', label: 'Фамилия (кого?)', hint: 'Божко, Ивановой' },
  { key: '{Имя}', label: 'Имя (кого?)', hint: 'Александра, Марии' },
  { key: '{класс}', label: 'Класс', hint: '4' },
  { key: '{буква}', label: 'Буква', hint: 'А' },
  { key: '{школа}', label: 'Школа', hint: 'МБОУ …' },
  { key: '{предмет}', label: 'Предмет', hint: 'из настроек шаблона' },
  { key: '{ученик}', label: 'ученик / ученица', hint: 'кто?' },
  { key: '{фамилия кто}', label: 'Фамилия (кто?)', hint: 'Божко, Иванова' },
  { key: '{имя кто}', label: 'Имя (кто?)', hint: 'Александр, Мария' },
]

export function fillText(tpl: string, student: Student, cls: SchoolClass, sheet?: Pick<Sheet, 'subject'>) {
  const g = genitive(student)
  const f = student.gender === 'f'
  const map: Record<string, string> = {
    'ученика': f ? 'ученицы' : 'ученика',
    'ученик': f ? 'ученица' : 'ученик',
    'Фамилия': g.last,
    'Имя': g.first,
    'фамилия кто': student.last,
    'имя кто': student.first,
    'класс': cls.grade,
    'буква': cls.letter,
    'школа': cls.school,
    'предмет': sheet?.subject ?? '',
  }
  return tpl
    .replace(/\{([^{}]+)\}/g, (m, k: string) => {
      const key = k.trim()
      if (key in map) return map[key]
      const lower = Object.keys(map).find((x) => x.toLowerCase() === key.toLowerCase())
      return lower ? map[lower] : m
    })
    .replace(/\s{2,}/g, ' ')
}
