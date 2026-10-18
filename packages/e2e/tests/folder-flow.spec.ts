import type { Page } from '@playwright/test'

import { expect, test } from './fixtures'

const FILES: Record<string, string> = {
	'finance/acme-invoice.txt': 'Invoice 4471 from Acme Corporation for the third quarter consulting services. Amount due 12,400.',
	'travel/lisbon-notes.md': '# Lisbon trip\nWe visited the tram museum, ate pastel de nata and walked along the river at sunset.',
	'recipes/lentil-soup.txt': 'Lentil soup: onions, carrots, red lentils, cumin and lemon. Simmer for thirty minutes.',
}

/**
 * Replaces the OS folder picker (not drivable from Playwright) with an OPFS directory seeded with
 * FILES. OPFS handles are real FileSystemDirectoryHandles, so the app's storage, permission and
 * walker code run unchanged; the offscreen document reads the same handle from IndexedDB.
 */
async function stubFolderPicker(page: Page, files: Record<string, string>): Promise<void> {
	await page.evaluate(async seed => {
		const root = await navigator.storage.getDirectory()
		const dir = await root.getDirectoryHandle(`e2e-${Date.now()}`, { create: true })
		for (const [rel, text] of Object.entries(seed)) {
			let d = dir
			const parts = rel.split('/')
			for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true })
			const w = await (await d.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
			await w.write(text)
			await w.close()
		}
		;(window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => dir
	}, files)
}

test('setup, index a folder, and search it', async ({ context, extensionId }) => {
	const page = await context.newPage()
	await page.goto(`chrome-extension://${extensionId}/folder-search.html`)

	await page.getByRole('button', { name: 'Get started' }).click()
	await expect(page.getByText('Step 1 of 3')).toBeVisible()
	await page.getByRole('button', { name: /Download/ }).click()

	await stubFolderPicker(page, FILES)
	await page.getByRole('button', { name: /Choose folder/ }).click()

	await expect(page.getByText(/Step 3 of 3/)).toBeVisible()
	await page.getByRole('button', { name: 'Start indexing' }).click()

	const search = page.getByLabel('Search your files')
	await expect(search).toBeVisible({ timeout: 30_000 })

	await search.fill('acme invoice')
	await expect(page.getByText('acme-invoice.txt').first()).toBeVisible({ timeout: 15_000 })
	await expect(page.getByText('lentil-soup.txt')).toHaveCount(0)

	await search.fill('lentil soup cumin')
	await expect(page.getByText('lentil-soup.txt').first()).toBeVisible({ timeout: 15_000 })
})
