import React from 'react'
import ReactDOM from 'react-dom/client'

import '@/assets/index.css'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'

import { FolderSearch } from '../sidepanel/components/FolderSearch/FolderSearch'

const syncDarkMode = () => {
	document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
}
syncDarkMode()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncDarkMode)

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<FolderSearch wide />
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>
)
