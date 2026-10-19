import React from 'react'
import ReactDOM from 'react-dom/client'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'

import App from './App'

import '@/assets/index.css'

// Sync dark mode with system preference
const syncDarkMode = () => {
	document.documentElement.classList.toggle(
		'dark',
		matchMedia('(prefers-color-scheme: dark)').matches
	)
}
syncDarkMode()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncDarkMode)

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<ErrorBoundary>
					<App />
				</ErrorBoundary>
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>
)
