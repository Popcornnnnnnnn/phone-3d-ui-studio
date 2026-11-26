import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initializeAppearance } from './appearance'
import './appearance.css'
import './styles.css'

initializeAppearance()

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element was not found')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
