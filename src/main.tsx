import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerExitCleanup } from './infrastructure/storage/localStorage'

// Register cleanup handler to clear privacy-sensitive data on app exit
registerExitCleanup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
