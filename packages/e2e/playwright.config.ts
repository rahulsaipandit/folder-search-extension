import { defineConfig } from '@playwright/test'

// Extensions only load in a headed Chromium or the new headless mode (`channel: 'chromium'`),
// which the fixture selects. One worker: each test owns a persistent browser profile.
export default defineConfig({
	testDir: './tests',
	timeout: 60_000,
	workers: 1,
	reporter: [['list']],
	use: { trace: 'retain-on-failure' },
})
