import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

console.log('[Switchboard] main.tsx loaded, mounting React...')
const root = document.getElementById('root')
if (root) {
  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
    console.log('[Switchboard] React render called')
  } catch (err) {
    console.error('[Switchboard] React render error:', err)
    root.textContent = String(err)
  }
} else {
  document.body.innerHTML = '<pre style="color:red;padding:40px">#root not found</pre>'
}
