import { type BrowserContext, chromium, test as base } from '@playwright/test'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const EXTENSION_PATH = path.resolve(here, '../../extension/.output/e2e/chrome-mv3-dev')

interface Fixtures {
	context: BrowserContext
	extensionId: string
}

export const test = base.extend<Fixtures>({
	context: async ({}, use) => {
		if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
			throw new Error(`Extension build not found at ${EXTENSION_PATH}. Run: npm run build:ext -w @page-agent/e2e`)
		}
		const userDataDir = mkdtempSync(path.join(tmpdir(), 'folder-search-e2e-'))
		const context = await chromium.launchPersistentContext(userDataDir, {
			channel: 'chromium', // new headless mode: supports extensions
			args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
		})
		await use(context)
		await context.close()
		rmSync(userDataDir, { recursive: true, force: true })
	},
	extensionId: async ({ context }, use) => {
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
		await use(new URL(worker.url()).host)
	},
})

export const expect = test.expect
