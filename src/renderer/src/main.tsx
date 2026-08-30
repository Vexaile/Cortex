import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useStore } from './store/useStore'
import './styles/index.css'

// Expose the store for automated screenshots and end-to-end drivers. Read-only
// convenience for tooling; the app itself never reads this.
;(window as unknown as { __cortexStore: typeof useStore }).__cortexStore = useStore

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
