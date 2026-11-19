import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import GlobalBackground from './GlobalBackground.jsx'
import { applyAccentTheme, readAccentTheme } from './accentThemes.js'
import './styles.css'

document.title = 'D-Gen'
applyAccentTheme(readAccentTheme())

// Keep the browser's broken-image glyph out of every image surface; individual
// views can still display their own loading and error states around the image.
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.classList.add('image-unavailable')
}, true)
document.addEventListener('load', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.classList.remove('image-unavailable')
}, true)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <GlobalBackground />
  </StrictMode>,
)
