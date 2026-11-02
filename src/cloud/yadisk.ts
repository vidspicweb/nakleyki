import { YANDEX_CLIENT_ID } from './config'

// Работа с Яндекс Диском прямо из браузера. Программа видит только свою папку
// «Приложения/<название приложения>» на Диске пользователя.

const API = 'https://cloud-api.yandex.net/v1/disk'
const TOKEN_KEY = 'nakl-yadisk-token'

export class AuthError extends Error {}
/** Токен есть, но прав не хватает (например, нет доступа ко всему Диску). */
export class ScopeError extends Error {}

export interface Token {
  value: string
  expiresAt: number
}

const redirectUri = () => location.origin + location.pathname

export function loginUrl(force = false) {
  const p = new URLSearchParams({ response_type: 'token', client_id: YANDEX_CLIENT_ID, redirect_uri: redirectUri(), force_confirm: force ? 'yes' : 'no' })
  return 'https://oauth.yandex.ru/authorize?' + p.toString()
}

/**
 * Кто работает на этом компьютере:
 *  owner  — владелец библиотеки, вошёл своим Яндексом;
 *  member — сотрудник, открыл ссылку от владельца (ничего не вводит).
 */
export type Role = 'owner' | 'member'
const ROLE_KEY = 'nakl-role'
export const loadRole = (): Role => (localStorage.getItem(ROLE_KEY) === 'member' ? 'member' : 'owner')
const saveRole = (r: Role) => localStorage.setItem(ROLE_KEY, r)

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

/** Ссылка для сотрудника: в ней ключ доступа к папке библиотеки на Диске владельца. */
export function shareLink(t: Token) {
  return location.origin + location.pathname + '#access=' + b64url(JSON.stringify({ t: t.value, e: t.expiresAt }))
}

/** После входа Яндекс возвращает нас на сайт с #access_token=… в адресе. Сотрудник приходит с #access=… */
export function takeTokenFromUrl(): { token?: Token; error?: string; role?: Role } {
  if (location.hash.startsWith('#access=')) {
    const raw = location.hash.slice('#access='.length)
    history.replaceState(null, '', location.pathname + location.search)
    try {
      const d = JSON.parse(unb64url(raw)) as { t: string; e: number }
      if (!d.t || d.e < Date.now()) return { error: 'Эта ссылка уже не действует — попросите у владельца новую' }
      const token = { value: d.t, expiresAt: d.e }
      saveToken(token)
      saveRole('member')
      return { token, role: 'member' }
    } catch {
      return { error: 'Ссылка повреждена — скопируйте её целиком' }
    }
  }
  if (!location.hash.includes('access_token=') && !location.hash.includes('error=')) return {}
  const h = new URLSearchParams(location.hash.slice(1))
  history.replaceState(null, '', location.pathname + location.search)
  const err = h.get('error')
  if (err) return { error: err === 'access_denied' ? 'Вы отменили вход' : 'Яндекс не дал войти: ' + err }
  const value = h.get('access_token')!
  const token = { value, expiresAt: Date.now() + Number(h.get('expires_in') ?? 31536000) * 1000 }
  saveToken(token)
  saveRole('owner')
  return { token, role: 'owner' }
}

export function loadToken(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null
    if (t && t.expiresAt > Date.now() + 60_000) return t
  } catch {
    /* нет токена */
  }
  return null
}
export const saveToken = (t: Token) => localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
export const clearToken = () => (localStorage.removeItem(TOKEN_KEY), localStorage.removeItem(ROLE_KEY))

export class YaDisk {
  private token: string
  constructor(token: string) {
    this.token = token
  }

  private async req(method: string, url: string, init: RequestInit = {}) {
    let res: Response
    try {
      res = await fetch(API + url, { ...init, method, headers: { Authorization: 'OAuth ' + this.token, Accept: 'application/json', ...(init.headers ?? {}) } })
    } catch {
      throw new Error('Нет связи с Яндекс Диском. Проверьте интернет.')
    }
    if (res.status === 401) throw new AuthError('Нужно войти в Яндекс Диск заново')
    if (res.status === 403) throw new ScopeError('У программы нет доступа к этой папке Диска')
    return res
  }

  private async json<T>(method: string, url: string): Promise<T> {
    const res = await this.req(method, url)
    if (!res.ok) throw new Error(await errText(res))
    return res.json()
  }

  async info() {
    return this.json<{ user?: { display_name?: string; login?: string }; total_space: number; used_space: number }>('GET', '/?fields=user,total_space,used_space')
  }

  async mkdir(path: string) {
    const res = await this.req('PUT', '/resources?path=' + enc(path))
    if (!res.ok && res.status !== 409) throw new Error(await errText(res))
  }

  /** Сведения о файле или null, если его нет. */
  async meta(path: string): Promise<{ md5?: string; modified?: string } | null> {
    const res = await this.req('GET', `/resources?path=${enc(path)}&fields=md5,modified`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(await errText(res))
    return res.json()
  }

  /** Имена файлов в папке (пустой список, если папки нет). */
  async list(dir: string): Promise<string[]> {
    const names: string[] = []
    for (let offset = 0; ; offset += 1000) {
      const res = await this.req('GET', `/resources?path=${enc(dir)}&limit=1000&offset=${offset}&fields=_embedded.items.name,_embedded.total`)
      if (res.status === 404) return names
      if (!res.ok) throw new Error(await errText(res))
      const data = await res.json()
      const items: { name: string }[] = data._embedded?.items ?? []
      names.push(...items.map((i) => i.name))
      if (items.length < 1000) return names
    }
  }

  async download(path: string): Promise<Blob | null> {
    const res = await this.req('GET', '/resources/download?path=' + enc(path))
    if (res.status === 404) return null
    if (!res.ok) throw new Error(await errText(res))
    const { href } = await res.json()
    const file = await fetch(href)
    if (!file.ok) throw new Error('Не удалось скачать файл с Диска')
    return file.blob()
  }

  async upload(path: string, body: Blob | ArrayBuffer) {
    const res = await this.req('GET', `/resources/upload?path=${enc(path)}&overwrite=true`)
    if (!res.ok) throw new Error(await errText(res))
    const { href } = await res.json()
    let put: Response
    try {
      put = await fetch(href, { method: 'PUT', body })
    } catch {
      throw new Error('Не удалось отправить файл на Диск')
    }
    if (!put.ok) throw new Error('Диск не принял файл (' + put.status + ')')
  }

  async remove(path: string) {
    const res = await this.req('DELETE', `/resources?path=${enc(path)}&permanently=true`)
    if (!res.ok && res.status !== 404 && res.status !== 202) throw new Error(await errText(res))
  }
}

const enc = (p: string) => encodeURIComponent(p)

async function errText(res: Response) {
  try {
    const d = await res.json()
    if (res.status === 507) return 'На Яндекс Диске закончилось место'
    return d.message || d.description || 'Ошибка Яндекс Диска (' + res.status + ')'
  } catch {
    return 'Ошибка Яндекс Диска (' + res.status + ')'
  }
}
