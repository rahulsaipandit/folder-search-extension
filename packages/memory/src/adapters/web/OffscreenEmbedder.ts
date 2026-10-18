/**
 * Embedder abstractions for web/extension environments.
 *
 * `IEmbedder` - interface for any embedding backend.
 * `OffscreenEmbedder` - delegates to a Chrome offscreen document via an injected
 *   bridge function; keeps Chrome-specific messaging out of the library.
 *
 * The extension wires the bridge:
 *   const embedder = new OffscreenEmbedder((type, payload) =>
 *     sendToOffscreen(type, payload))
 */

export interface EmbedOptions {
	mode?: 'passage' | 'query'
}

export interface IEmbedder {
	isReady: boolean
	initialize(): Promise<void>
	embed(texts: string[], opts?: EmbedOptions): Promise<number[][]>
	embedSingle(text: string, opts?: EmbedOptions): Promise<number[]>
}

/** Injected bridge: sends a typed message and returns the result. */
export type OffscreenBridgeFn = (type: string, payload: unknown) => Promise<unknown>

/**
 * Embedder that routes embedding calls through a Chrome offscreen document.
 * Required when running in a service worker (no DOM, no WebGL).
 */
export class OffscreenEmbedder implements IEmbedder {
	isReady = false
	private bridge: OffscreenBridgeFn

	constructor(bridge: OffscreenBridgeFn) {
		this.bridge = bridge
	}

	async initialize(): Promise<void> {
		try {
			await this.bridge('offscreen:embed:init', {})
			this.isReady = true
		} catch {
			this.isReady = false
		}
	}

	async embed(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
		const result = await this.bridge('offscreen:embed:batch', { texts, mode: opts?.mode ?? 'passage' })
		return result as number[][]
	}

	async embedSingle(text: string, opts?: EmbedOptions): Promise<number[]> {
		const result = await this.bridge('offscreen:embed:single', { text, mode: opts?.mode ?? 'query' })
		return result as number[]
	}
}

/** Null embedder - always returns empty vectors. Useful as a safe fallback. */
export class NullEmbedder implements IEmbedder {
	isReady = false
	async initialize(): Promise<void> { /* no-op */ }
	async embed(texts: string[]): Promise<number[][]> { return texts.map(() => []) }
	async embedSingle(): Promise<number[]> { return [] }
}
