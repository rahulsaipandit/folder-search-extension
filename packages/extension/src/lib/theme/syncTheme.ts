/**
 * Lightweight theme sync for secondary entrypoints (non-sidepanel pages).
 *
 * Reads the `page-agent-theme` localStorage key set by next-themes and
 * applies the `.dark` class to <html>. Falls back to `prefers-color-scheme`
 * if the stored value is `system`.
 */
export function syncTheme(): void {
	const stored = localStorage.getItem('page-agent-theme')
	const isDark =
		stored === 'dark' ||
		(stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
	document.documentElement.classList.toggle('dark', isDark)
}

/**
 * Calls syncTheme() and listens for system preference changes when in
 * `system` mode. Returns an unsubscribe function.
 */
export function listenThemeChanges(): () => void {
	syncTheme()
	const mq = matchMedia('(prefers-color-scheme: dark)')
	const handler = () => {
		const stored = localStorage.getItem('page-agent-theme')
		if (stored === 'system' || stored === null) {
			syncTheme()
		}
	}
	mq.addEventListener('change', handler)
	return () => mq.removeEventListener('change', handler)
}