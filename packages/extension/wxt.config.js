import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'wxt'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Copies the ONNX Runtime loader + wasm into `public/ort/` so transformers.js can load them from
 * the extension origin (CDN and blob: loads are blocked by the extension-pages CSP). Runs for both
 * `wxt` (dev) and `wxt build`. See browser-ml/gemma-embeddings.ts.
 */
function copyOrtAssets() {
	return {
		name: 'copy-ort-assets',
		buildStart() {
			const src = resolve(__dirname, '../../node_modules/onnxruntime-web/dist')
			const dest = resolve(__dirname, 'public/ort')
			mkdirSync(dest, { recursive: true })
			for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
				try {
					copyFileSync(join(src, file), join(dest, file))
				} catch (e) {
					// Missing runtime files would otherwise surface later as an opaque "no available backend".
					this.error(`copy-ort-assets: cannot copy ${file} from ${src}: ${e.message}`)
				}
			}
		},
	}
}

// The fake embedder returns meaningless vectors; it must never reach a production build.
if (process.env.NODE_ENV === 'production' && process.env.WXT_E2E_FAKE_EMBEDDER) {
	throw new Error('WXT_E2E_FAKE_EMBEDDER must not be set for a production build')
}

// See https://wxt.dev/api/config.html
export default defineConfig({
	srcDir: 'src',
	alias: {
		'@': resolve(__dirname, 'src'),
	},
	// The E2E build swaps in a fake embedder (folder-search/fakeEmbedder.ts); keep it out of the real outputs.
	outDir: process.env.WXT_E2E_FAKE_EMBEDDER
		? '.output/e2e'
		: process.env.NODE_ENV === 'production'
			? '.output/prod'
			: '.output/dev',
	modules: ['@wxt-dev/module-react'],
	webExt: {
		disabled: true,
	},
	vite: () => ({
		// Rolldown (used by Vite 8 / WXT 0.20) does not inherit WXT's top-level
		// `alias` option, so we must declare resolve.alias here directly.
		resolve: {
			alias: {
				'@': resolve(__dirname, 'src'),
			},
		},
		plugins: [tailwindcss(), copyOrtAssets()],
		optimizeDeps: {
			force: true,
		},
		// Emit workers as IIFE files at the extension origin so worker-src 'self' covers them.
		// blob: workers are blocked by Chrome MV3 in ALL CSP directives.
		worker: {
			format: 'iife',
		},
		build: {
			minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
			// console.error/warn are kept even in production per AGENTS.md ("do not hide errors or
			// risks") — only the noisy log/debug/info calls are stripped.
			terserOptions:
				process.env.NODE_ENV === 'production'
					? { compress: { pure_funcs: ['console.log', 'console.debug', 'console.info'] } }
					: undefined,
			sourcemap: process.env.NODE_ENV === 'development',
			chunkSizeWarningLimit: 2000,
			cssCodeSplit: true,
			reportCompressedSize: process.env.NODE_ENV === 'production',
			rollupOptions: {
				onwarn: function (message, handler) {
					if (message.code === 'EVAL') return
					handler(message)
				},
			},
		},
	}),
	zip: {
		artifactTemplate: 'page-agent-ext-{{version}}-{{browser}}.zip',
	},
	manifest: {
		// The `key` field pins a stable extension ID for local/dev and self-hosted CRX builds.
		// The Chrome Web Store rejects uploads containing `key`, so it's omitted in production.
		...(process.env.NODE_ENV === 'production'
			? {}
			: {
					key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqbzT0iTYeYlnCvDJIGDnGU8oarJgZILDzSfLi/ufuSxXEPDKuMyD892GhvrMCZNVHS11Sh6NYUOc/PcUOhtaR2urHtcNkrpSJNV10zUamY7fxBdVEkOucfyLu8INVy+teis62MoRWYPaUPkfZUjrLGW8MsZ9aFzARfu9GGDEp2EAYsWDN6w6vyz9LJ82pm542EWnVT4MjmDPgvYFCWGBtaU/dfHD+GAX6URJFapsCvryVURKJ+76c/GO9/I3EX1IBfbY6dec78bLCMvVxiTmiv36KyGPwX1OpakW8IiCpXWdbAxjm+plbYlp5t5zTyyoE3sOSFeXsBH0Kg27o8GcvQIDAQAB',
				}),
		default_locale: 'en',
		name: '__MSG_extName__',
		description: '__MSG_extDescription__',
		content_security_policy: {
			// wasm-unsafe-eval: required by Chrome MV3 to compile ONNX Runtime WebAssembly.
			extension_pages:
				"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self';",
		},
		// Folder Search reads the folder the user picks (File System Access, no permission needed),
		// keeps its index in IndexedDB, and runs the model in an offscreen document. It reads no web
		// pages, so there are no tab, scripting or host permissions, and no content scripts.
		permissions: ['sidePanel', 'storage', 'offscreen'],
		icons: {
			64: 'assets/images/page-agent-64.png',
		},
		action: {
			default_title: '__MSG_extActionTitle__',
		},
		side_panel: {
			default_path: 'sidepanel/index.html',
		},
	},
})
