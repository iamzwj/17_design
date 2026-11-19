import { useEffect, useState } from 'react'
import { ACCENT_THEMES, applyAccentTheme, readAccentTheme, saveAccentTheme } from './accentThemes.js'
import './accentTheme.css'

export default function AccentTheme({ user }) {
  const [accent, setAccent] = useState(() => readAccentTheme(user))

  useEffect(() => { setAccent(readAccentTheme(user)) }, [user?.id, user?.identity])

  function selectAccent(id) {
    setAccent(id)
    applyAccentTheme(id)
    saveAccentTheme(user, id)
  }

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
        onClick={() => selectAccent(id)}
      />)}
    </div>
  </div>
}
