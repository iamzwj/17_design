import { useEffect, useState } from 'react'
import { ACCENT_STORAGE_KEY, ACCENT_THEMES, applyAccentTheme, readAccentTheme } from './accentThemes.js'
import './accentTheme.css'

export default function AccentTheme() {
  const [accent, setAccent] = useState(readAccentTheme)

  useEffect(() => {
    applyAccentTheme(accent)
    try { localStorage.setItem(ACCENT_STORAGE_KEY, accent) } catch { /* Keep the accent applied for this session. */ }
  }, [accent])

  return <div className="theme-menu-row accent-theme-row">
    <span className="theme-menu-label">主题色</span>
    <div className="accent-theme-options" role="group" aria-label="主题色">
      {ACCENT_THEMES.map(({ id, label, swatch }) => <button
        key={id}
        type="button"
        aria-label={label}
        aria-pressed={accent === id}
        title={label}
        style={{ '--accent-swatch': swatch }}
        onClick={() => setAccent(id)}
      />)}
    </div>
  </div>
}
