// One-off tool: finds each device.avif's screen area. These mockups render the screen as a flat
// near-black rectangle (not a transparent cutout — confirmed by inspection). A pure flood-fill
// undershoots the true edges because AVIF compression + anti-aliasing puts a few off-threshold
// pixels right at the rounded-corner boundary, breaking 4-connectivity before reaching the real
// edge. Row/column projection profiles are robust to that: a screen row/column is one where most
// of its pixels (not all) are near-black, so a few noisy pixels don't block the whole scan.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', 'src', 'assets', 'devices')
const COLOR_TOLERANCE = 40
const ALPHA_THRESHOLD = 150
const ROW_FILL_THRESHOLD = 0.5

async function findScreenRect(file) {
	const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
	const { width, height, channels } = info
	// Most mockups render the "off" screen as flat black, but at least one (iPhone 6) renders it
	// near-white instead — sample the actual center color rather than assuming black, so both
	// (and any other flat fill color) are detected the same way.
	const cx = Math.floor(width / 2)
	const cy = Math.floor(height / 2)
	const ci = (cy * width + cx) * channels
	const [cr, cg, cb] = [data[ci], data[ci + 1], data[ci + 2]]
	const isScreenPixel = (x, y) => {
		const i = (y * width + x) * channels
		if (data[i + 3] <= ALPHA_THRESHOLD) return false
		return (
			Math.abs(data[i] - cr) < COLOR_TOLERANCE &&
			Math.abs(data[i + 1] - cg) < COLOR_TOLERANCE &&
			Math.abs(data[i + 2] - cb) < COLOR_TOLERANCE
		)
	}

	const rowCounts = new Int32Array(height)
	for (let y = 0; y < height; y++) {
		let c = 0
		for (let x = 0; x < width; x++) if (isScreenPixel(x, y)) c++
		rowCounts[y] = c
	}
	const maxRowCount = Math.max(...rowCounts)
	if (maxRowCount < width * 0.3) return { error: 'no wide enough black band found' }

	let minY = -1,
		maxY = -1
	for (let y = 0; y < height; y++) {
		if (rowCounts[y] > maxRowCount * ROW_FILL_THRESHOLD) {
			if (minY === -1) minY = y
			maxY = y
		}
	}

	const colCounts = new Int32Array(width)
	for (let x = 0; x < width; x++) {
		let c = 0
		for (let y = minY; y <= maxY; y++) if (isScreenPixel(x, y)) c++
		colCounts[x] = c
	}
	const bandHeight = maxY - minY + 1
	let minX = -1,
		maxX = -1
	for (let x = 0; x < width; x++) {
		if (colCounts[x] > bandHeight * ROW_FILL_THRESHOLD) {
			if (minX === -1) minX = x
			maxX = x
		}
	}
	if (minX === -1 || minY === -1) return { error: 'projection scan failed' }

	return {
		imageWidth: width,
		imageHeight: height,
		screen: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
	}
}

async function main() {
	const targets = process.argv.slice(2)
	const files = []
	if (targets.length) {
		for (const t of targets) files.push(path.join(ROOT, t, 'device.avif'))
	} else {
		const walk = (dir) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) walk(full)
				else if (entry.name === 'device.avif') files.push(full)
			}
		}
		walk(ROOT)
	}

	const results = {}
	for (const file of files) {
		const rel = path.relative(ROOT, path.dirname(file)).replace(/\\/g, '/')
		try {
			const rect = await findScreenRect(file)
			results[rel] = rect
			if (rect.screen) {
				const cssRatio = (rect.screen.height / rect.screen.width).toFixed(4)
				console.log(
					`${rel}: image=${rect.imageWidth}x${rect.imageHeight} screen=${rect.screen.width}x${rect.screen.height} @(${rect.screen.x},${rect.screen.y}) ratio=${cssRatio}`
				)
			} else {
				console.log(`${rel}: ${rect.error}`)
			}
		} catch (e) {
			console.log(`${rel}: ERROR ${e.message}`)
		}
	}
	fs.writeFileSync(path.join(__dirname, 'deviceFrameMeta.json'), JSON.stringify(results, null, 2))
}

main()
