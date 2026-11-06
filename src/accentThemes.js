export const ACCENT_STORAGE_KEY = 'dgen-accent-v1'

export const ACCENT_THEMES = [
  { id: 'blue', label: '蓝色', swatch: '#1685ff' },
  { id: 'green', label: '绿色', swatch: '#54b963' },
  { id: 'yellow', label: '黄色', swatch: '#ffcb17' },
  { id: 'orange', label: '橙色', swatch: '#ff841d' },
  { id: 'pink', label: '粉色', swatch: '#f54b9b' },
]

export function readAccentTheme() {
  const saved = localStorage.getItem(ACCENT_STORAGE_KEY)
  return ACCENT_THEMES.find(({ id }) => id === saved)?.id ?? 'blue'
}
