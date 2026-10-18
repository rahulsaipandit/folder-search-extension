import React from 'react'
import ReactDOM from 'react-dom/client'

import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'

import { registerBuiltInActions } from '../../actions/impl'
import App from './App'

// Fork: dark/light theme support

import '@/assets/index.css'

// Fork: populate globalActionRegistry so actions invoked via globalActionExecutionEngine work in the sidepanel
registerBuiltInActions()

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
