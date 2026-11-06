import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import GlobalBackground from './GlobalBackground.jsx'
import './styles.css'

document.title = 'D-Gen'
document.documentElement.dataset.accent = localStorage.getItem('dgen-accent-v1') === 'green' ? 'green' : 'blue'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <GlobalBackground />
  </StrictMode>,
)
