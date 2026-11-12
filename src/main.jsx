import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import GlobalBackground from './GlobalBackground.jsx'
import { applyAccentTheme, readAccentTheme } from './accentThemes.js'
import './styles.css'

document.title = 'D-Gen'
applyAccentTheme(readAccentTheme())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <GlobalBackground />
  </StrictMode>,
)
