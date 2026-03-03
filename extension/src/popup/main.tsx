/**
 * Simply Sats Chrome Extension — Popup Entry Point
 *
 * Bootstraps the React app inside the extension popup (400x600).
 * Imports shared components from the main app and wraps them
 * with PlatformProvider for the Chrome extension adapter.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Shared fonts and styles
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'

// Extension-specific styles (includes the shared index.css + popup overrides)
import './popup.css'

import { PopupApp } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
)
