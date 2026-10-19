/**
 * Bookkeeping for the glass wall's texture-array layers: which tile owns which layer, which layers
 * hold a finished picture, and which can be taken back. Pure (no GL), so the rules are unit-tested;
 * `GlassRenderer` does the actual uploads.
 *
 * A layer is handed to a tile that is near the viewport and taken back, least recently drawn first,
 * once its tile has left. Every hand-out gets a token: a load that finishes after its layer was
 * re-assigned (or the pool was reset) presents a stale token and is discarded.
 */
export interface Lease {
	layer: number
	token: number
}

export class LayerPool {
	private layerOfTile = new Int32Array(0)
	private missing = new Uint8Array(0)
	private readonly tileOfLayer: Int32Array
	private readonly ready: Uint8Array
	private readonly tokens: Uint32Array
	private readonly used: Float64Array

	constructor(readonly size: number) {
		this.tileOfLayer = new Int32Array(size).fill(-1)
		this.ready = new Uint8Array(size)
		this.tokens = new Uint32Array(size)
		this.used = new Float64Array(size)
	}

	/** Forget everything and start for `tileCount` tiles. In-flight loads become stale. */
	reset(tileCount: number): void {
		this.layerOfTile = new Int32Array(tileCount).fill(-1)
		this.missing = new Uint8Array(tileCount)
		this.tileOfLayer.fill(-1)
		this.ready.fill(0)
		for (let l = 0; l < this.size; l++) this.tokens[l]!++
	}

	/** The layer holding tile `tile`'s picture, or -1. May still be loading: see `isReady`. */
	layerOf(tile: number): number {
		return this.layerOfTile[tile] ?? -1
	}

	/** True once the tile's first picture is on the GPU. */
	isReady(tile: number): boolean {
		const layer = this.layerOf(tile)
		return layer >= 0 && this.ready[layer] === 1
	}

	/** True when the tile has no layer and is not known to lack a picture, so it should be loaded. */
	needsLoad(tile: number): boolean {
		return this.layerOf(tile) < 0 && !this.missing[tile]
	}

	/** Record that the tile's layer was drawn at `stamp`; the least recently drawn layers go first. */
	touch(tile: number, stamp: number): void {
		const layer = this.layerOf(tile)
		if (layer >= 0) this.used[layer] = stamp
	}

	/**
	 * Gives `tile` a layer: a free one, else the least recently drawn layer whose tile is not in `near`.
	 * Returns null when every layer belongs to a near tile (the tile waits for the next frame).
	 */
	take(tile: number, near: ReadonlySet<number>): Lease | null {
		let free = -1
		let victim = -1
		for (let l = 0; l < this.size; l++) {
			const owner = this.tileOfLayer[l]!
			if (owner < 0) {
				free = l
				break
			}
			if (!near.has(owner) && (victim < 0 || this.used[l]! < this.used[victim]!)) victim = l
		}
		const layer = free >= 0 ? free : victim
		if (layer < 0) return null
		const owner = this.tileOfLayer[layer]!
		if (owner >= 0) this.layerOfTile[owner] = -1
		this.tokens[layer]!++
		this.tileOfLayer[layer] = tile
		this.layerOfTile[tile] = layer
		this.ready[layer] = 0
		return { layer, token: this.tokens[layer]! }
	}

	/** Is `lease` still the current owner of its layer (not re-assigned, pool not reset)? */
	isCurrent(lease: Lease): boolean {
		return this.tokens[lease.layer] === lease.token
	}

	/** The picture was uploaded. Returns false (and changes nothing) for a stale lease. */
	finish(lease: Lease): boolean {
		if (!this.isCurrent(lease)) return false
		this.ready[lease.layer] = 1
		return true
	}

	/** The load ended without a picture: give the layer back. `noPicture` stops it being retried. */
	abandon(tile: number, lease: Lease, noPicture: boolean): void {
		if (!this.isCurrent(lease)) return
		this.tileOfLayer[lease.layer] = -1
		this.layerOfTile[tile] = -1
		this.ready[lease.layer] = 0
		if (noPicture) this.missing[tile] = 1
	}
}
