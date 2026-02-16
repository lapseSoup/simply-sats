import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './index.css'
import App from './App.tsx'
import { registerExitCleanup } from './infrastructure/storage/localStorage'
import { logger } from './services/logger'

const appLogger = logger.child({ module: 'App' })

// Global handler for unhandled promise rejections — surfaces silent async failures
window.addEventListener('unhandledrejection', (event) => {
  appLogger.error('Unhandled promise rejection', {
    reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
    stack: event.reason instanceof Error ? event.reason.stack : undefined
  })
})

// Register cleanup handler to clear privacy-sensitive data on app exit
registerExitCleanup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
