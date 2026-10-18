export class GazeIndicator {
	shown: boolean = false
	wrapper = document.createElement('div')

	#currentX = 0
	#currentY = 0

	#targetX = 0
	#targetY = 0

	#disposed = false

	constructor() {
		this.wrapper.id = 'page-agent-runtime_gaze-indicator'
		this.wrapper.setAttribute('data-browser-use-ignore', 'true')
		this.wrapper.setAttribute('data-page-agent-ignore', 'true')
		// Fixed container at origin with no size - glow child uses absolute positioning inside it.
		// position:fixed is required so the glow's absolute coordinates are relative to the viewport,
		// not the nearest positioned ancestor on the host page.
		this.wrapper.style.position = 'fixed'
		this.wrapper.style.top = '0'
		this.wrapper.style.left = '0'
		this.wrapper.style.width = '0'
		this.wrapper.style.height = '0'
		this.wrapper.style.overflow = 'visible'
		this.wrapper.style.pointerEvents = 'none'
		this.wrapper.style.display = 'none'

		const glow = document.createElement('div')
		glow.style.position = 'absolute'
		glow.style.width = '20px'
		glow.style.height = '20px'
		glow.style.borderRadius = '50%'
		glow.style.backgroundColor = 'rgba(0, 255, 0, 0.3)'
		glow.style.boxShadow = '0 0 20px rgba(0, 255, 0, 0.5)'
		glow.style.pointerEvents = 'none'
		glow.style.zIndex = '999999'
		glow.style.transform = 'translate(0px, 0px)'
		this.wrapper.appendChild(glow)

		document.body.appendChild(this.wrapper)

		this.#moveToTarget()

		// Arrow-function class fields already capture `this` - no .bind() needed.
		// Passing the unbound reference here matches what dispose() removes.
		window.addEventListener('PageAgent::UpdateGaze', this.#handleUpdateGaze)
		window.addEventListener('PageAgent::HideGazeIndicator', this.#handleHide)
	}

	#handleUpdateGaze = (event: Event) => {
		const { gazeX, gazeY } = (event as CustomEvent).detail
		this.setPosition(gazeX, gazeY)
		if (!this.shown) this.show()
	}

	#handleHide = () => {
		this.hide()
	}

	#moveToTarget() {
		if (this.#disposed) return

		const newX = this.#currentX + (this.#targetX - this.#currentX) * 0.2
		const newY = this.#currentY + (this.#targetY - this.#currentY) * 0.2

		const xDistance = Math.abs(newX - this.#targetX)
		if (xDistance > 0) {
			this.#currentX = xDistance < 2 ? this.#targetX : newX
		}

		const yDistance = Math.abs(newY - this.#targetY)
		if (yDistance > 0) {
			this.#currentY = yDistance < 2 ? this.#targetY : newY
		}

		if (xDistance > 0 || yDistance > 0) {
			;(this.wrapper.firstElementChild as HTMLElement).style.transform =
				`translate(${this.#currentX}px, ${this.#currentY}px)`
		}

		requestAnimationFrame(() => this.#moveToTarget())
	}

	setPosition(gazeX: number, gazeY: number) {
		this.#targetX = gazeX * window.innerWidth
		this.#targetY = gazeY * window.innerHeight
	}

	show() {
		if (this.shown) return
		this.shown = true
		this.wrapper.style.display = 'block'
	}

	hide() {
		if (!this.shown) return
		this.shown = false
		this.wrapper.style.display = 'none'
	}

	dispose() {
		this.#disposed = true
		window.removeEventListener('PageAgent::UpdateGaze', this.#handleUpdateGaze)
		window.removeEventListener('PageAgent::HideGazeIndicator', this.#handleHide)
		this.wrapper.remove()
	}
}