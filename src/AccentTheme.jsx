import { useEffect, useState } from 'react'
import './accentTheme.css'

export default function AccentTheme() {
  const [accent, setAccent] = useState(() => localStorage.getItem('dgen-accent-v1') === 'green' ? 'green' : 'blue')
  useEffect(() => {
    document.documentElement.dataset.accent = accent
    localStorage.setItem('dgen-accent-v1', accent)
  }, [accent])
  return <div className="theme-menu-row"><span className="theme-menu-label">主题色</span><div className="theme-mode-options" role="group" aria-label="主题色">
    <button type="button" className={accent === 'blue' ? 'active' : ''} aria-pressed={accent === 'blue'} onClick={() => setAccent('blue')}>蓝色</button>
    <button type="button" className={accent === 'green' ? 'active' : ''} aria-pressed={accent === 'green'} onClick={() => setAccent('green')}>绿色</button>
  </div></div>
}
