import { useEffect, useRef } from 'react'

export type OrbState = 'idle' | 'listening' | 'thinking' | 'processing' | 'responding'

const STATE_CONFIG = {
	idle:       { speed: 0.24, pulseScale: 0.04, glowColor: '#1e293b', glowOpacity: 0.18, hue: 220, sat: 35, brightMin: 12, brightMax: 50, labelColor: '#475569' },
	listening:  { speed: 0.88, pulseScale: 0.14, glowColor: '#22c55e', glowOpacity: 0.40, hue: 141, sat: 70, brightMin: 16, brightMax: 68, labelColor: '#4ade80' },
	thinking:   { speed: 0.52, pulseScale: 0.09, glowColor: '#7c3aed', glowOpacity: 0.32, hue: 263, sat: 62, brightMin: 14, brightMax: 62, labelColor: '#a78bfa' },
	processing: { speed: 1.92, pulseScale: 0.18, glowColor: '#f59e0b', glowOpacity: 0.52, hue: 38,  sat: 78, brightMin: 13, brightMax: 68, labelColor: '#fbbf24' },
	responding: { speed: 1.28, pulseScale: 0.12, glowColor: '#86efac', glowOpacity: 0.50, hue: 142, sat: 66, brightMin: 20, brightMax: 65, labelColor: '#bbf7d0' },
} as const

const SIZE_CONFIG = {
	small:  { orbDiameter: 80,  pixelSize: 5.5,  gap: 1.2 },
	medium: { orbDiameter: 120, pixelSize: 8,    gap: 1.8 },
	large:  { orbDiameter: 240, pixelSize: 16.5, gap: 3.5 },
} as const

function hslToHex(h: number, s: number, l: number): string {
	s /= 100; l /= 100
	const k = (n: number) => (n + h / 30) % 12
	const a = s * Math.min(l, 1 - l)
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
	return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

export function PixelOrb({ state = 'idle', size = 'small' }: { state?: OrbState; size?: 'small' | 'medium' | 'large' }) {
	const containerRef = useRef<HTMLDivElement>(null)
	const stateRef = useRef(state)
	const glowHaloRef = useRef<HTMLElement | null>(null)
	const orbContainerRef = useRef<HTMLElement | null>(null)
	const labelRef = useRef<HTMLElement | null>(null)

	// Sync ref so the animation loop always reads the latest state without remounting
	stateRef.current = state

	// Apply glow + scale + label transitions when state changes
	useEffect(() => {
		const cfg = STATE_CONFIG[state]
		if (glowHaloRef.current) {
			glowHaloRef.current.style.backgroundColor = cfg.glowColor
			glowHaloRef.current.style.opacity = String(cfg.glowOpacity)
		}
		if (orbContainerRef.current) {
			orbContainerRef.current.style.transform = `scale(${1 + cfg.pulseScale})`
		}
		if (labelRef.current) {
			labelRef.current.textContent = state
			labelRef.current.style.color = cfg.labelColor
		}
	}, [state])

	// Build pixel grid and run RAF loop - remounts only on size change
	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const sc = SIZE_CONFIG[size]
		const COLS = 11, ROWS = 11
		const maxPulseScale = Math.max(...Object.values(STATE_CONFIG).map(s => s.pulseScale))
		const wrapperDiameter = Math.ceil(sc.orbDiameter * (1 + maxPulseScale) + sc.orbDiameter * 0.35)

		const wrapper = document.createElement('div')
		wrapper.style.cssText = `position:relative;width:${wrapperDiameter}px;height:${wrapperDiameter}px;display:flex;align-items:center;justify-content:center;margin:0 auto;`

		const glowHalo = document.createElement('div')
		glowHalo.style.cssText = `position:absolute;width:85%;height:85%;border-radius:50%;filter:blur(${sc.orbDiameter * 0.15}px);transition:background-color 0.3s ease,opacity 0.3s ease;`
		glowHaloRef.current = glowHalo

		const orbContainer = document.createElement('div')
		orbContainer.style.cssText = `width:${sc.orbDiameter}px;height:${sc.orbDiameter}px;border-radius:50%;overflow:hidden;position:relative;transition:transform 0.3s ease;`
		orbContainerRef.current = orbContainer

		const pixelGrid = document.createElement('div')
		pixelGrid.style.cssText = `position:absolute;width:100%;height:100%;`

		const orbRadius = sc.orbDiameter / 2
		const totalW = COLS * sc.pixelSize + (COLS - 1) * sc.gap
		const totalH = ROWS * sc.pixelSize + (ROWS - 1) * sc.gap
		const startX = (sc.orbDiameter - totalW) / 2
		const startY = (sc.orbDiameter - totalH) / 2

		const pixels: { el: HTMLDivElement; row: number; col: number }[] = []
		for (let r = 0; r < ROWS; r++) {
			for (let c = 0; c < COLS; c++) {
				const px = startX + c * (sc.pixelSize + sc.gap) + sc.pixelSize / 2
				const py = startY + r * (sc.pixelSize + sc.gap) + sc.pixelSize / 2
				if (Math.sqrt((px - orbRadius) ** 2 + (py - orbRadius) ** 2) >= orbRadius - 4) continue
				const el = document.createElement('div')
				el.style.cssText = `position:absolute;left:${startX + c * (sc.pixelSize + sc.gap)}px;top:${startY + r * (sc.pixelSize + sc.gap)}px;width:${sc.pixelSize}px;height:${sc.pixelSize}px;border-radius:${sc.pixelSize * 0.28}px;`
				pixelGrid.appendChild(el)
				pixels.push({ el, row: r, col: c })
			}
		}

		const initCfg = STATE_CONFIG[stateRef.current]
		glowHalo.style.backgroundColor = initCfg.glowColor
		glowHalo.style.opacity = String(initCfg.glowOpacity)
		orbContainer.style.transform = `scale(${1 + initCfg.pulseScale})`

		orbContainer.appendChild(pixelGrid)
		wrapper.appendChild(glowHalo)
		wrapper.appendChild(orbContainer)
		container.appendChild(wrapper)

		let label: HTMLElement | null = null
		if (size !== 'small') {
			label = document.createElement('div')
			const fontSize = Math.max(10, sc.orbDiameter * 0.09)
			label.style.cssText = `margin-top:6px;font-size:${fontSize}px;font-family:monospace;text-transform:uppercase;letter-spacing:0.12em;text-align:center;transition:color 0.3s ease;`
			label.textContent = stateRef.current
			label.style.color = STATE_CONFIG[stateRef.current].labelColor
			labelRef.current = label
			container.appendChild(label)
		}

		let animT = 0, waveOffset = 0, lastTime = Date.now(), rafId: number
		const cx = (COLS - 1) / 2

		const animate = () => {
			const now = Date.now()
			const dt = (now - lastTime) / 1000
			lastTime = now
			const cfg = STATE_CONFIG[stateRef.current]
			animT += dt * cfg.speed
			waveOffset += dt * 0.64
			pixels.forEach(({ el, row, col }) => {
				const dx = col - cx, dy = row - cx
				const dist = Math.sqrt(dx * dx + dy * dy) / (COLS / 2)
				const wave = Math.sin(animT * cfg.speed * 2.5 - dist * 3.5 + waveOffset * 0.3) * 0.5 + 0.5
				const radial = 1 - Math.max(0, Math.min(1, dist * 1.1))
				const brightness = cfg.brightMin + (cfg.brightMax - cfg.brightMin) * (wave * 0.7 + radial * 0.3)
				el.style.backgroundColor = hslToHex(cfg.hue, cfg.sat, brightness)
			})
			rafId = requestAnimationFrame(animate)
		}
		rafId = requestAnimationFrame(animate)

		return () => {
			cancelAnimationFrame(rafId)
			glowHaloRef.current = null
			orbContainerRef.current = null
			labelRef.current = null
			container.removeChild(wrapper)
			if (label) container.removeChild(label)
		}
	}, [size])

	return <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} />
}
