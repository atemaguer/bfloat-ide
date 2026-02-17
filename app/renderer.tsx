import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import appIcon from '@/resources/build/icon.png'
import { WindowContextProvider, menuItems } from '@/app/components/window'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './app'

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MemoryRouter>
        <WindowContextProvider titlebar={{ icon: appIcon, menuItems }}>
          <App />
        </WindowContextProvider>
      </MemoryRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
