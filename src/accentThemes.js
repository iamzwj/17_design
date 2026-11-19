export const ACCENT_STORAGE_KEY = 'dgen-accent-v1'

export const ACCENT_THEMES = [
  { id: 'blue', label: '蓝色', swatch: '#1685ff' },
  { id: 'green', label: '绿色', swatch: '#54b963' },
  { id: 'yellow', label: '黄色', swatch: '#ffcb17' },
  { id: 'orange', label: '橙色', swatch: '#ff841d' },
  { id: 'pink', label: '粉色', swatch: '#f54b9b' },
]

export function defaultAccentTheme(identity) {
  return identity === 'yanxuanjia' ? 'green' : identity === 'pulin' ? 'orange' : 'blue'
}

export function accentStorageKey(user) {
  return user?.id ? `${ACCENT_STORAGE_KEY}:${encodeURIComponent(user.id)}` : `${ACCENT_STORAGE_KEY}:guest`
}

export function readAccentTheme(user) {
  let saved
  try { saved = localStorage.getItem(accentStorageKey(user)) } catch { /* Use the identity default when storage is unavailable. */ }
  return ACCENT_THEMES.find(({ id }) => id === saved)?.id ?? defaultAccentTheme(user?.identity)
}

export function saveAccentTheme(user, id) {
  if (!ACCENT_THEMES.some((theme) => theme.id === id)) return
  try { localStorage.setItem(accentStorageKey(user), id) } catch { /* Keep the choice for the current session. */ }
}

export function applyAccentTheme(id) {
  const theme = ACCENT_THEMES.find((entry) => entry.id === id) ?? ACCENT_THEMES[0]
  const root = document.documentElement
  root.dataset.accent = theme.id
  root.style.setProperty('--user-message-fill', theme.swatch)
}
