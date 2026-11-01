import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/nunito/900.css'
import './styles.css'
import App from './App'
import { registerServiceWorker } from './lib/push'
import { applyLook } from './lib/settings'
import { LANG } from './lib/i18n'

applyLook()
document.documentElement.lang = LANG
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyLook)
registerServiceWorker()

const root = createRoot(document.getElementById('root')!)
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')) {
  // Dev-only look check with fake people (see Preview.tsx)
  import('./Preview').then(({ default: Preview }) => root.render(<Preview />))
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
