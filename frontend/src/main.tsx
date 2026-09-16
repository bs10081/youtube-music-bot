import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './styles/listening.css'

if (new URLSearchParams(window.location.search).get('ui') !== 'legacy') {
  document.documentElement.classList.add('dark', 'listening-theme');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
