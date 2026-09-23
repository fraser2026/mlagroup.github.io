import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../app/src/styles/tokens.css'
import { ThemeProvider } from '@ra/theme/ThemeProvider'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
