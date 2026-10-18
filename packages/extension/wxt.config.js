import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'wxt'

const __dirname = dirname(fileURLToPath(import.meta.url))

function copyPyodideAssets() {
	return {
		name: 'copy-pyodide-assets',
		apply: 'build',
		buildStart() {
			const src = resolve('node_modules/pyodide')
			const dest = resolve('public/pyodide')
			mkdirSync(dest, { recursive: true })
			const needed = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'packages.json']
			for (const file of needed) {
				try {
					copyFileSync(join(src, file), join(dest, file))
				} catch (_) {}
			}
			// Copy Python wheels for numpy/scipy/scikit-learn if present
			try {
				for (const f of readdirSync(src)) {
					if (f.endsWith('.whl') || f.endsWith('.tar.bz2')) {
						try {
							copyFileSync(join(src, f), join(dest, f))
						} catch (_) {}
					}
				}
			} catch (_) {}
		},
	}
}

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// See https://wxt.dev/api/config.html
export default defineConfig({
	srcDir: 'src',
	alias: {
		'@': resolve(__dirname, 'src'),
	},
	outDir: process.env.NODE_ENV === 'production' ? '.output/prod' : '.output/dev',
	modules: ['@wxt-dev/module-react'],
	webExt: {
		// chromiumProfile: chromeProfile,
		// keepProfileChanges: true,
		// chromiumArgs: ['--hide-crash-restore-bubble'],
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
		plugins: [tailwindcss(), copyPyodideAssets()],
		define: {
			__VERSION__: JSON.stringify(pkg.version),
			// Aliases used by ConfigPanel to display version info in the footer
			__EXT_VERSION__: JSON.stringify(pkg.version),
			__CORE_VERSION__: JSON.stringify(
				(() => {
					try {
						return JSON.parse(
							readFileSync(resolve(__dirname, '../../packages/core/package.json'), 'utf-8')
						).version
					} catch {
						return pkg.version // fallback to extension version if core package.json is unavailable
					}
				})()
			),
			__PRODUCTION__: process.env.NODE_ENV === 'production',
			__DEV__: process.env.NODE_ENV === 'development',
		},
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
		homepage_url: 'https://alibaba.github.io/page-agent/',
		content_security_policy: {
			// wasm-unsafe-eval: required by Chrome MV3 to compile ONNX Runtime WebAssembly.
			extension_pages:
				"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self';",
		},
		permissions: [
			'activeTab',
			'tabs',
			'tabGroups',
			'sidePanel',
			'storage',
			'scripting',
			'offscreen',
			'alarms',
			// 'identity', — commented out for Web Store submission: backs the SEO Rank Tracker's
			// Search Console integration (SearchConsoleProvider.ts), which also needs a real
			// oauth2.client_id (still a placeholder below). Its Agent Library card is commented
			// out too (AgentLibrary.tsx) until both are ready. Re-add together.
			// Phone Simulator's "Open in device-resize mode" fallback only
			// (lib/phoneSimulator/liveTabResize.ts) — used when a site's own frame-ancestors/
			// X-Frame-Options header refuses to render inside the mockup's iframe (e.g. CNN, most
			// banks, Google properties). Chrome shows a "started debugging this browser" bar on
			// that fallback tab while active; same mechanism DevTools' own device toolbar uses.
			// Commented out for Web Store submission (needs a privacy-practices justification);
			// Phone Simulator's card is commented out too (AgentLibrary.tsx) since this fallback
			// is part of that feature. Re-add together.
			// 'debugger',
		],
		// No standing host_permissions: page access comes from activeTab (grants the tab the
		// user just invoked the extension on) plus optional_host_permissions, requested at
		// runtime via chrome.permissions.request() from a user gesture (multi-tab automation
		// asking for a second tab, or a site's one-time "enable auto-connect" prompt) — see
		// entrypoints/background.ts's dynamic content-script registration.
		optional_host_permissions: ['<all_urls>'],
		// oauth2 block commented out along with the 'identity' permission above (Web Store
		// submission needs a privacy-practices justification, and the client_id below is still a
		// placeholder anyway). Was required by chrome.identity.getAuthToken() for the SEO Rank
		// Tracker's Search Console integration
		// (packages/extension/src/seo/providers/SearchConsoleProvider.ts). This client_id must be
		// created in Google Cloud Console as a "Chrome App" OAuth client tied to this extension's
		// ID (the `key` field above pins that ID for dev/self-hosted builds) — see
		// docs/designSE_Ranking.md §2.2 item 1. Re-add alongside 'identity' once that's set up.
		// oauth2: {
		// 	client_id: 'REPLACE_WITH_GOOGLE_CLOUD_OAUTH_CLIENT_ID.apps.googleusercontent.com',
		// 	scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
		// },
		icons: {
			64: 'assets/images/page-agent-64.png',
		},
		action: {
			default_title: '__MSG_extActionTitle__',
		},
		side_panel: {
			default_path: 'sidepanel/index.html',
		},
		externally_connectable: {
			matches: ['http://localhost/*'],
		},
	},
})
