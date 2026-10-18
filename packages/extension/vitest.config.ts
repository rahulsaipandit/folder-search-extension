import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'src/**/*.test.js'],
	},
	resolve: {
		alias: [
			{ find: '@', replacement: path.resolve(__dirname, 'src') },
			// Exact-match regex (not a plain string) so subpath imports like
			// '@page-agent/core/storage' fall through to real node_modules resolution
			// instead of being prefix-rewritten onto these bare-specifier targets.
			{
				find: /^@page-agent\/core$/,
				replacement: path.resolve(__dirname, '../core/src/PageAgentCore.ts'),
			},
			{ find: /^@page-agent\/llms$/, replacement: path.resolve(__dirname, '../llms/src/index.ts') },
			{
				find: /^@page-agent\/page-controller$/,
				replacement: path.resolve(__dirname, '../page-controller/src/PageController.ts'),
			},
		],
	},
})
