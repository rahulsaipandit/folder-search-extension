import { expect, test } from './fixtures'

// Known benign warning: next-themes (ThemeProvider) injects a <script> and React 19 warns about it on
// every page that uses ThemeProvider. Keep this list exact; any other console error must fail the test.
const KNOWN_BENIGN = [/Encountered a script tag while rendering React component/]

test('folder-search tab renders the Welcome screen without console errors', async ({ context, extensionId }) => {
	const page = await context.newPage()
	const errors: string[] = []
	page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
	page.on('console', m => m.type() === 'error' && errors.push(`console: ${m.text()}`))

	await page.goto(`chrome-extension://${extensionId}/folder-search.html`)

	await expect(page.getByRole('heading', { name: 'Folder Search' })).toBeVisible()
	await expect(page.getByText('Find files by describing them')).toBeVisible()
	await expect(page.getByRole('button', { name: /Set up/ })).toBeVisible()
	expect(errors.filter(e => !KNOWN_BENIGN.some(re => re.test(e)))).toEqual([])
})

test('offscreen document answers folder-search messages', async ({ context, extensionId }) => {
	const page = await context.newPage()
	await page.goto(`chrome-extension://${extensionId}/folder-search.html`)

	const reply = await page.evaluate(async () => {
		try {
			await chrome.offscreen.createDocument({
				url: 'offscreen.html',
				reasons: ['WORKERS' as chrome.offscreen.Reason],
				justification: 'e2e: exercise the folder-search engine',
			})
		} catch (e) {
			// Already created by the app itself.
			if (!String((e as Error).message).includes('single offscreen document')) throw e
		}
		return chrome.runtime.sendMessage({ type: 'offscreen:folder:index:status', requestId: 'e2e' })
	})

	expect(reply).toMatchObject({ ok: true, result: { running: false } })
})
