/**
 * WebGL2 renderer for the glass image wall (design §4B.3). It paints only: layout, hit-testing and
 * keyboard focus belong to the DOM layer in GlassWall.tsx. Everything is drawn in one instanced call.
 *
 * Thumbnails live in a fixed pool of 256x256 texture-array layers, so GPU memory is bounded by POOL,
 * not by how many images the folder has. A tile gets a layer while it is near the viewport.
 * The loop runs only while something changes (hover easing, scrolling, a texture arriving).
 */
import { LayerPool } from './layerPool'
import { type Tile, tilesInBand } from './layout'
import { FRAGMENT, VERTEX } from './shaders'

/** What can become a tile's first picture: a stored thumbnail, or a canvas the caller drew (a waveform). */
export type TileSource = Blob | ImageBitmap | HTMLCanvasElement

/** Resolves the first picture of tile `index`, or undefined when it has none. */
export type ThumbLoader = (index: number) => Promise<TileSource | undefined>

export interface GlassOptions {
	onContextLost?: () => void
	onContextRestored?: () => void
}

/** Pool of texture layers: 128 x 320 x 320 x 4 B ≈ 52 MB. Big enough that playing video stays sharp. */
export const POOL_LAYERS = 128
const LAYER_SIZE = 320
const MAX_INSTANCES = 512
const FLOATS_PER_INSTANCE = 8
const FOCAL = 1200
/** How far (radians, about 3 degrees) the whole scene turns to follow the pointer. */
const MAX_ORBIT = 0.05
const EASE_MS = 90
const MAX_DPR = 2
/**
 * The canvas is this many CSS px wider than the layout on each side, so the turned scene's outer tiles are
 * not clipped. The caller sizes the canvas to `layoutWidth + 2 * GLASS_PAD` and shifts
 * it left by GLASS_PAD; tile x positions are offset here.
 */
export const GLASS_PAD = 32

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)
	if (!shader) throw new Error('Could not create a shader')
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? ''
		gl.deleteShader(shader)
		throw new Error(`${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'} shader failed to compile: ${log}`)
	}
	return shader
}

interface GlResources {
	program: WebGLProgram
	vao: WebGLVertexArrayObject
	corners: WebGLBuffer
	instances: WebGLBuffer
	texture: WebGLTexture
	uViewport: WebGLUniformLocation | null
	uFocal: WebGLUniformLocation | null
	uOrbit: WebGLUniformLocation | null
}

export class GlassRenderer {
	private readonly gl: WebGL2RenderingContext
	private res!: GlResources
	private readonly instanceData = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE)

	private tiles: Tile[] = []
	private hover = new Float32Array(0)
	private hoverTarget = new Float32Array(0)
	/** Scene rotation (pitch about x, yaw about y) and where it is easing to. */
	private pitch = 0
	private yaw = 0
	private pitchTarget = 0
	private yawTarget = 0
	private focus = new Float32Array(0)
	private readonly active = new Set<number>()
	private hovered = -1

	private readonly pool = new LayerPool(POOL_LAYERS)
	private stamp = 0
	private scratch: HTMLCanvasElement | null = null
	private scratchCtx: CanvasRenderingContext2D | null = null

	private scroll = 0
	private vw = 1
	private vh = 1
	private raf = 0
	private lastT = 0
	private dead = false
	private lost = false
	/** Tiles drawn by the last frame (for tests and the performance notes in the design doc). */
	drawn = 0

	private readonly onLost = (e: Event) => {
		e.preventDefault()
		this.lost = true
		cancelAnimationFrame(this.raf)
		this.raf = 0
		this.opts.onContextLost?.()
	}
	private readonly onRestored = () => {
		this.initGL()
		this.pool.reset(this.tiles.length)
		this.lost = false
		this.opts.onContextRestored?.()
		this.wake()
	}

	/** Returns null (after logging why) when WebGL2 or the shaders are unavailable: use the CSS wall. */
	static create(canvas: HTMLCanvasElement, loader: ThumbLoader, opts: GlassOptions = {}): GlassRenderer | null {
		try {
			return new GlassRenderer(canvas, loader, opts)
		} catch (e) {
			console.warn('[folder-search] glass wall unavailable, using the CSS wall:', e)
			return null
		}
	}

	private constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly loader: ThumbLoader,
		private readonly opts: GlassOptions
	) {
		// Low power: stay on the integrated GPU when there is one, away from the model's WebGPU work.
		const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' })
		if (!gl) throw new Error('WebGL2 is not available')
		this.gl = gl
		this.initGL()
		canvas.addEventListener('webglcontextlost', this.onLost)
		canvas.addEventListener('webglcontextrestored', this.onRestored)
	}

	private initGL(): void {
		const gl = this.gl
		const program = gl.createProgram()
		if (!program) throw new Error('Could not create a GL program')
		const vs = compile(gl, gl.VERTEX_SHADER, VERTEX)
		const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
		gl.attachShader(program, vs)
		gl.attachShader(program, fs)
		gl.linkProgram(program)
		gl.deleteShader(vs)
		gl.deleteShader(fs)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(`Program failed to link: ${gl.getProgramInfoLog(program) ?? ''}`)
		}

		const vao = gl.createVertexArray()
		const corners = gl.createBuffer()
		const instances = gl.createBuffer()
		const texture = gl.createTexture()
		if (!vao || !corners || !instances || !texture) throw new Error('Could not allocate GL resources')

		gl.bindVertexArray(vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, corners)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

		gl.bindBuffer(gl.ARRAY_BUFFER, instances)
		gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW)
		const stride = FLOATS_PER_INSTANCE * 4
		const attribs: [number, number, number][] = [
			[1, 4, 0],
			[2, 4, 16],
		]
		for (const [loc, size, offset] of attribs) {
			gl.enableVertexAttribArray(loc)
			gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
			gl.vertexAttribDivisor(loc, 1)
		}

		gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
		gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, LAYER_SIZE, LAYER_SIZE, POOL_LAYERS)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

		gl.useProgram(program)
		gl.uniform1i(gl.getUniformLocation(program, 'uThumbs'), 0)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
		gl.disable(gl.DEPTH_TEST)
		gl.clearColor(0, 0, 0, 0)

		this.res = {
			program,
			vao,
			corners,
			instances,
			texture,
			uViewport: gl.getUniformLocation(program, 'uViewport'),
			uFocal: gl.getUniformLocation(program, 'uFocal'),
			uOrbit: gl.getUniformLocation(program, 'uOrbit'),
		}
	}

	// ── Inputs ──────────────────────────────────────────────────────────────────────────────────

	setTiles(tiles: Tile[]): void {
		this.tiles = tiles
		const n = tiles.length
		this.hover = new Float32Array(n)
		this.hoverTarget = new Float32Array(n)
		this.focus = new Float32Array(n)
		this.active.clear()
		this.hovered = -1
		this.pool.reset(n)
		this.wake()
	}

	/**
	 * New rectangles for the same tiles (the panel was resized): hover, focus and every loaded picture are
	 * kept. A different number of tiles is a different set, so that falls back to `setTiles`.
	 */
	setLayout(tiles: Tile[]): void {
		if (tiles.length !== this.tiles.length) return this.setTiles(tiles)
		this.tiles = tiles
		this.wake()
	}

	/** CSS size of the canvas and the device pixel ratio (capped: fill rate is the main cost). */
	setViewport(cssW: number, cssH: number, dpr: number): void {
		const ratio = Math.min(Math.max(dpr, 1), MAX_DPR)
		this.vw = Math.max(1, cssW)
		this.vh = Math.max(1, cssH)
		this.canvas.width = Math.max(1, Math.round(this.vw * ratio))
		this.canvas.height = Math.max(1, Math.round(this.vh * ratio))
		if (!this.lost) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
		this.wake()
	}

	/** How far, in px, the visible slice starts below the top of the layout. */
	setScroll(y: number): void {
		if (y === this.scroll) return
		this.scroll = y
		this.wake()
	}

	/** The tile under the pointer (brightens), or null when the pointer left all tiles. */
	setHover(index: number | null): void {
		const next = index ?? -1
		if (this.hovered !== next && this.hovered >= 0) {
			this.hoverTarget[this.hovered] = 0
			this.active.add(this.hovered)
		}
		this.hovered = next
		if (next >= 0 && next < this.tiles.length) {
			this.hoverTarget[next] = 1
			this.active.add(next)
		}
		this.wake()
	}

	/**
	 * Pointer position over the canvas, each axis in -1..1, or null when it left. The whole scene turns a
	 * few degrees toward it (the demo's "orbit"), which is what makes the glass catch light as you move.
	 */
	setPointer(nx: number | null, ny = 0): void {
		this.pitchTarget = nx === null ? 0 : ny * MAX_ORBIT
		this.yawTarget = nx === null ? 0 : -nx * MAX_ORBIT
		this.wake()
	}

	setFocus(index: number | null): void {
		this.focus.fill(0)
		if (index !== null && index >= 0 && index < this.focus.length) this.focus[index] = 1
		this.wake()
	}

	// ── Texture pool ────────────────────────────────────────────────────────────────────────────

	private ensureTextures(): void {
		const gl = this.gl
		const band = tilesInBand(this.tiles, this.scroll - this.vh * 0.75, this.scroll + this.vh * 1.75)
		const near = new Set(band)
		const centre = this.scroll + this.vh / 2
		const wanted = band
			.filter(i => this.pool.needsLoad(i))
			.sort((a, b) => Math.abs(this.tileMid(a) - centre) - Math.abs(this.tileMid(b) - centre))
		for (const i of wanted) {
			const lease = this.pool.take(i, near)
			if (!lease) break
			void this.loader(i)
				.then(async source => {
					if (!source) return null
					return createImageBitmap(source, { resizeWidth: LAYER_SIZE, resizeHeight: LAYER_SIZE, resizeQuality: 'medium' })
				})
				.then(bitmap => {
					if (this.dead || this.lost || !this.pool.isCurrent(lease)) return bitmap?.close()
					if (!bitmap) {
						// No stored thumbnail: it shows as a neutral glass tile and is not retried.
						console.warn(`[folder-search] glass wall: tile ${i} has no stored thumbnail, drawing a placeholder`)
						this.pool.abandon(i, lease, true)
						return
					}
					gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.res.texture)
					gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, lease.layer, LAYER_SIZE, LAYER_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
					bitmap.close()
					this.pool.finish(lease)
					this.wake()
				})
				.catch(e => {
					if (!this.pool.isCurrent(lease)) return
					console.warn('[folder-search] could not load a picture for the glass wall', e)
					this.pool.abandon(i, lease, true)
				})
		}
	}

	/** True once tile `index` has its first picture on the GPU. */
	hasTexture(index: number): boolean {
		return this.pool.isReady(index)
	}

	/**
	 * Replaces what tile `index` shows with `source` (a playing video's current frame, an animated
	 * waveform). The picture is stretched to the layer; tile and source share an aspect ratio, so that
	 * is undone on screen. Returns false when the tile is not on the GPU yet (try again next frame).
	 */
	uploadToTile(index: number, source: CanvasImageSource): boolean {
		if (this.dead || this.lost || !this.hasTexture(index)) return false
		const layer = this.pool.layerOf(index)
		if (!this.scratch) {
			this.scratch = document.createElement('canvas')
			this.scratch.width = this.scratch.height = LAYER_SIZE
			this.scratchCtx = this.scratch.getContext('2d')
		}
		const ctx = this.scratchCtx
		if (!ctx) return false
		try {
			ctx.drawImage(source, 0, 0, LAYER_SIZE, LAYER_SIZE)
		} catch {
			return false // a video that has no decoded frame yet
		}
		const gl = this.gl
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.res.texture)
		gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, LAYER_SIZE, LAYER_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch)
		this.wake()
		return true
	}

	private tileMid(i: number): number {
		const t = this.tiles[i]!
		return t.y + t.h / 2
	}

	// ── Frame loop ──────────────────────────────────────────────────────────────────────────────

	private wake(): void {
		if (this.raf || this.dead || this.lost) return
		this.raf = requestAnimationFrame(this.tick)
	}

	private readonly tick = (now: number): void => {
		this.raf = 0
		if (this.dead || this.lost) return
		const dt = this.lastT ? Math.min(64, now - this.lastT) : 16
		this.lastT = now
		const k = 1 - Math.exp(-dt / EASE_MS)
		let animating = false
		for (const i of this.active) {
			this.hover[i]! += (this.hoverTarget[i]! - this.hover[i]!) * k
			if (Math.abs(this.hoverTarget[i]! - this.hover[i]!) < 0.003) {
				this.hover[i] = this.hoverTarget[i]!
				if (this.hoverTarget[i] === 0 && i !== this.hovered) this.active.delete(i)
			} else {
				animating = true
			}
		}
		this.pitch += (this.pitchTarget - this.pitch) * k
		this.yaw += (this.yawTarget - this.yaw) * k
		if (Math.abs(this.pitchTarget - this.pitch) < 0.0002 && Math.abs(this.yawTarget - this.yaw) < 0.0002) {
			this.pitch = this.pitchTarget
			this.yaw = this.yawTarget
		} else {
			animating = true
		}
		this.ensureTextures()
		this.draw()
		if (animating) this.wake()
		else this.lastT = 0
	}

	private draw(): void {
		const gl = this.gl
		const { res, instanceData: data } = this
		this.stamp++
		const band = tilesInBand(this.tiles, this.scroll - 40, this.scroll + this.vh + 40)
		let n = 0
		const put = (i: number) => {
			if (n >= MAX_INSTANCES) return
			const t = this.tiles[i]!
			this.pool.touch(i, this.stamp)
			const o = n * FLOATS_PER_INSTANCE
			data[o] = GLASS_PAD + t.x + t.w / 2
			data[o + 1] = t.y + t.h / 2 - this.scroll
			data[o + 2] = t.w
			data[o + 3] = t.h
			data[o + 4] = this.pool.isReady(i) ? this.pool.layerOf(i) : -1
			data[o + 5] = this.hover[i]!
			data[o + 6] = this.focus[i]!
			data[o + 7] = 1
			n++
		}
		for (const i of band) if (i !== this.hovered) put(i)
		// The hovered tile is drawn last so a neighbour never covers it.
		if (this.hovered >= 0 && band.includes(this.hovered)) put(this.hovered)

		gl.clear(gl.COLOR_BUFFER_BIT)
		this.drawn = n
		if (!n) return
		gl.useProgram(res.program)
		gl.bindVertexArray(res.vao)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, res.texture)
		gl.uniform2f(res.uViewport, this.vw, this.vh)
		gl.uniform1f(res.uFocal, FOCAL)
		const cp = Math.cos(this.pitch)
		const sp = Math.sin(this.pitch)
		const cy = Math.cos(this.yaw)
		const sy = Math.sin(this.yaw)
		// Ry(yaw) * Rx(pitch), column-major
		gl.uniformMatrix3fv(res.uOrbit, false, [cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp])
		gl.bindBuffer(gl.ARRAY_BUFFER, res.instances)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * FLOATS_PER_INSTANCE)
		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
	}

	dispose(): void {
		this.dead = true
		cancelAnimationFrame(this.raf)
		this.canvas.removeEventListener('webglcontextlost', this.onLost)
		this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
		if (this.lost) return
		// The context itself is left alone: React may re-attach to this same canvas (StrictMode), and a
		// canvas whose context was force-lost never yields a working one again.
		const { gl, res } = this
		gl.deleteTexture(res.texture)
		gl.deleteBuffer(res.corners)
		gl.deleteBuffer(res.instances)
		gl.deleteVertexArray(res.vao)
		gl.deleteProgram(res.program)
	}
}
