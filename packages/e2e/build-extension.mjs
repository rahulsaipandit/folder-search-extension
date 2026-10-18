// Builds the extension with the fake embedder enabled into packages/extension/.output/e2e.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension')
const r = spawnSync('npx', ['wxt', 'build', '--mode', 'development'], {
	cwd: ext,
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, WXT_E2E_FAKE_EMBEDDER: 'true' },
})
process.exit(r.status ?? 1)
