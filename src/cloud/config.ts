/**
 * ClientID приложения, зарегистрированного на https://oauth.yandex.ru/client/new
 * Права: «Доступ к папке приложения на Диске» и «Доступ к информации о Диске».
 * Redirect URI: адрес сайта, например https://vidspicweb.github.io/nakleyki/
 * Это публичный идентификатор, его можно хранить в коде.
 */
export const YANDEX_CLIENT_ID: string = import.meta.env.VITE_YANDEX_CLIENT_ID || '3f833e26d6ff41dd91fc1d0608de0ff8'
