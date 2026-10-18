/**
 * Deterministic stand-in for EmbeddingGemma, used ONLY by the Playwright E2E build
 * (`WXT_E2E_FAKE_EMBEDDER=true`, see `packages/e2e`). The real model is hundreds of MB and needs
 * WebGPU or slow WASM, which makes UI-flow tests impractical. Texts that share words get similar
 * vectors (hashed bag-of-words), which is enough to exercise indexing, retrieval and ranking.
 * It is not a quality signal for the real model. Production builds never enable the flag.
 */
import { truncateAndNormalize } from './ranking'

export const FAKE_EMBEDDER_ENABLED =
	(import.meta.env as Record<string, string | undefined>).WXT_E2E_FAKE_EMBEDDER === 'true'

/** Cache that marks the fake model as "downloaded" so the setup flow matches the real one. */
export const FAKE_MODEL_CACHE = 'e2e-fake-model'

/** Prompt scaffolding added by `buildQueryInput` / `buildDocumentInput`; carries no meaning. */
const SCAFFOLD = new Set(['title', 'text', 'task', 'search', 'result', 'query', 'none'])

function fnv1a(s: string): number {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

export function fakeEmbedText(text: string, dim: number): Float32Array {
	const v = new Float32Array(dim)
	for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
		if (!SCAFFOLD.has(w)) v[fnv1a(w) % dim]! += 1
	}
	return truncateAndNormalize(v, dim)
}
