import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		name: 'ext',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		silent: 'passed-only',
	},
	resolve: {
		alias: [
			{ find: '@', replacement: path.resolve(__dirname, 'src') },
			// Exact match so subpath imports fall through to real node_modules resolution.
			{ find: /^@page-agent\/llms$/, replacement: path.resolve(__dirname, '../llms/src/index.ts') },
		],
	},
})
