// Generates src/lib/phoneSimulator/devices.ts from scripts/deviceFrameMeta.json (produced by
// extractDeviceFrameMeta.cjs) plus a hand-curated naming/badge table below. Re-run both scripts
// after adding new device.avif assets under src/assets/devices/.
const fs = require('fs')
const path = require('path')

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'deviceFrameMeta.json'), 'utf-8'))

// image px -> CSS px. Chosen so it reproduces the real iPhone 15 (393) and iPhone 16 Pro Max (430)
// CSS widths almost exactly from their detected screen-rect pixel widths — the mockup art isn't
// pixel-metric-accurate for every model, so this is a best-fit constant, not a measured device
// property. See extractDeviceFrameMeta.cjs's doc comment for how the screen rect was found.
const CSS_SCALE = 2.15

const IOS_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
	'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'

// folder (relative to src/assets/devices) -> curated display info. Anything with hasHomeButton
// gets a physical home button drawn below the screen instead of a home indicator pill.
const CURATED = {
	'apple/iphone_17-pro-max': {
		brand: 'Apple',
		name: 'iPhone 17 Pro Max',
		code: '17Pro\\nMax',
		badge: 'Flagship',
		dsf: 3,
	},
	'apple/iphone_17-pro': {
		brand: 'Apple',
		name: 'iPhone 17 Pro',
		code: '17\\nPro',
		badge: 'Top',
		dsf: 3,
	},
	'apple/iphone_17': { brand: 'Apple', name: 'iPhone 17', code: '17', badge: '2025', dsf: 3 },
	'apple/iphone_17e': { brand: 'Apple', name: 'iPhone 17e', code: '17e', badge: '2026', dsf: 3 },
	'apple/iphone_air': {
		brand: 'Apple',
		name: 'iPhone Air',
		code: '17\\nAir',
		badge: '2025',
		dsf: 3,
	},
	'apple/iphone_16-pro-max': {
		brand: 'Apple',
		name: 'iPhone 16 Pro Max',
		code: '16Pro\\nMax',
		badge: 'Flagship',
		dsf: 3,
	},
	'apple/iphone_16-pro': {
		brand: 'Apple',
		name: 'iPhone 16 Pro',
		code: '16\\nPro',
		badge: 'Top',
		dsf: 3,
	},
	'apple/iphone_16-plus': {
		brand: 'Apple',
		name: 'iPhone 16 Plus',
		code: '16+',
		badge: '2025',
		dsf: 3,
	},
	'apple/iphone_16': { brand: 'Apple', name: 'iPhone 16', code: '16', badge: '2025', dsf: 3 },
	'apple/iphone_15': { brand: 'Apple', name: 'iPhone 15', code: '15', badge: null, dsf: 3 },
	'apple/iphone_14_15-pro': {
		brand: 'Apple',
		name: 'iPhone 14 & 15 Pro',
		code: '15\\nPro',
		badge: null,
		dsf: 3,
	},
	'apple/iphone_13_14': { brand: 'Apple', name: 'iPhone 13 & 14', code: '14', badge: null, dsf: 3 },
	'apple/iphone_13-mini': {
		brand: 'Apple',
		name: 'iPhone 13 Mini',
		code: '13\\nMini',
		badge: null,
		dsf: 3,
	},
	'apple/iphone_x': { brand: 'Apple', name: 'iPhone X', code: 'X', badge: null, dsf: 3 },
	'apple/iphone_se-3': {
		brand: 'Apple',
		name: 'iPhone SE (3rd gen)',
		code: 'SE3',
		badge: null,
		dsf: 2,
		hasHomeButton: true,
	},
	'apple/iphone_6': {
		brand: 'Apple',
		name: 'iPhone 6',
		code: '6',
		badge: null,
		dsf: 2,
		hasHomeButton: true,
	},
	'apple/iphone_5': {
		brand: 'Apple',
		name: 'iPhone 5',
		code: '5',
		badge: null,
		dsf: 2,
		hasHomeButton: true,
	},

	'android/google/pixel-9-pro-xl': {
		brand: 'Google',
		name: 'Pixel 9 Pro XL',
		code: 'P9Pro\\nXL',
		badge: 'Flagship',
		dsf: 3,
	},
	'android/google/pixel-9-pro': {
		brand: 'Google',
		name: 'Pixel 9 Pro',
		code: 'P9\\nPro',
		badge: 'Top',
		dsf: 3,
	},
	'android/google/pixel-9': { brand: 'Google', name: 'Pixel 9', code: 'P9', badge: '2025', dsf: 3 },
	'android/google/pixel-8': { brand: 'Google', name: 'Pixel 8', code: 'P8', badge: null, dsf: 3 },

	'android/samsung/galaxy-s26-ultra': {
		brand: 'Samsung',
		name: 'Galaxy S26 Ultra',
		code: 'S26\\nUltra',
		badge: 'Flagship',
		dsf: 3,
	},
	'android/samsung/galaxy-s26-plus': {
		brand: 'Samsung',
		name: 'Galaxy S26+',
		code: 'S26+',
		badge: '2026',
		dsf: 3,
	},
	'android/samsung/galaxy-s26': {
		brand: 'Samsung',
		name: 'Galaxy S26',
		code: 'S26',
		badge: '2026',
		dsf: 3,
	},
	'android/samsung/galaxy-s25-ultra': {
		brand: 'Samsung',
		name: 'Galaxy S25 Ultra',
		code: 'S25\\nUltra',
		badge: 'Top',
		dsf: 3,
	},
	'android/samsung/galaxy-s25-plus': {
		brand: 'Samsung',
		name: 'Galaxy S25+',
		code: 'S25+',
		badge: '2025',
		dsf: 3,
	},
	'android/samsung/galaxy-s25': {
		brand: 'Samsung',
		name: 'Galaxy S25',
		code: 'S25',
		badge: '2025',
		dsf: 3,
	},
	'android/samsung/galaxy-s22': {
		brand: 'Samsung',
		name: 'Galaxy S22',
		code: 'S22',
		badge: null,
		dsf: 3,
	},
	'android/samsung/galaxy-a56': {
		brand: 'Samsung',
		name: 'Galaxy A56',
		code: 'A56',
		badge: null,
		dsf: 3,
	},
	'android/samsung/galaxy-z-fold8-ultra': {
		brand: 'Samsung',
		name: 'Galaxy Z Fold8 Ultra',
		code: 'ZFold8\\nUltra',
		badge: 'Flagship',
		dsf: 3,
	},
	'android/samsung/galaxy-z-fold8': {
		brand: 'Samsung',
		name: 'Galaxy Z Fold8',
		code: 'ZFold\\n8',
		badge: '2026',
		dsf: 3,
	},
	'android/samsung/galaxy-z-fold6': {
		brand: 'Samsung',
		name: 'Galaxy Z Fold6',
		code: 'ZFold\\n6',
		badge: null,
		dsf: 3,
	},
	'android/samsung/galaxy-z-flip8': {
		brand: 'Samsung',
		name: 'Galaxy Z Flip8',
		code: 'ZFlip\\n8',
		badge: '2026',
		dsf: 3,
	},
	'android/samsung/galaxy-z-flip6': {
		brand: 'Samsung',
		name: 'Galaxy Z Flip6',
		code: 'ZFlip\\n6',
		badge: null,
		dsf: 3,
	},

	'android/xiaomi/17-ultra': {
		brand: 'Xiaomi',
		name: 'Xiaomi 17 Ultra',
		code: '17\\nUltra',
		badge: 'Flagship',
		dsf: 3,
	},
	'android/xiaomi/17-pro-max': {
		brand: 'Xiaomi',
		name: 'Xiaomi 17 Pro Max',
		code: '17Pro\\nMax',
		badge: 'Top',
		dsf: 3,
	},
	'android/xiaomi/17-pro': {
		brand: 'Xiaomi',
		name: 'Xiaomi 17 Pro',
		code: '17\\nPro',
		badge: '2026',
		dsf: 3,
	},
	'android/xiaomi/17': { brand: 'Xiaomi', name: 'Xiaomi 17', code: '17', badge: '2026', dsf: 3 },
	'android/xiaomi/redmi-note-15-pro': {
		brand: 'Xiaomi',
		name: 'Redmi Note 15 Pro',
		code: 'Note15\\nPro',
		badge: null,
		dsf: 3,
	},
	'android/xiaomi/poco-x8-pro': {
		brand: 'Xiaomi',
		name: 'POCO X8 Pro',
		code: 'X8\\nPro',
		badge: null,
		dsf: 3,
	},
	'android/xiaomi/poco-x7-pro': {
		brand: 'Xiaomi',
		name: 'POCO X7 Pro',
		code: 'X7\\nPro',
		badge: null,
		dsf: 3,
	},
	'android/xiaomi/poco-x7': { brand: 'Xiaomi', name: 'POCO X7', code: 'X7', badge: null, dsf: 3 },

	'android/oneplus/15': { brand: 'OnePlus', name: 'OnePlus 15', code: '15', badge: '2026', dsf: 3 },
	'android/oneplus/13': { brand: 'OnePlus', name: 'OnePlus 13', code: '13', badge: 'Top', dsf: 3 },
	'android/oneplus/nord-ce5': {
		brand: 'OnePlus',
		name: 'Nord CE5',
		code: 'CE5',
		badge: null,
		dsf: 3,
	},

	'android/motorola/edge-60-fusion': {
		brand: 'Motorola',
		name: 'Edge 60 Fusion',
		code: 'Edge\\n60',
		badge: null,
		dsf: 3,
	},

	'android/infinix/note-60-pro': {
		brand: 'Infinix',
		name: 'Note 60 Pro',
		code: 'Note\\n60',
		badge: null,
		dsf: 3,
	},
	'android/infinix/hot-50-pro': {
		brand: 'Infinix',
		name: 'Hot 50 Pro',
		code: 'Hot\\n50',
		badge: null,
		dsf: 3,
	},

	'android/huawei/mate-xt-ultimate': {
		brand: 'Huawei',
		name: 'Mate XT Ultimate',
		code: 'XT\\nUltra',
		badge: 'Flagship',
		dsf: 3,
	},
	'android/huawei/mate-x6': { brand: 'Huawei', name: 'Mate X6', code: 'X6', badge: null, dsf: 3 },
}

function toId(folder) {
	return folder
		.replace(/^apple\//, '')
		.replace(/^android\/[a-z]+\//, '')
		.replace(/[_]/g, '-')
}

const entries = []
for (const [folder, info] of Object.entries(CURATED)) {
	const m = meta[folder]
	if (!m || !m.screen) {
		console.warn(`Skipping ${folder} — no screen metadata`)
		continue
	}
	const width = Math.round(m.screen.width / CSS_SCALE)
	const height = Math.round(width * (m.screen.height / m.screen.width))
	const id = toId(folder)
	const isApple = folder.startsWith('apple/')
	entries.push({
		id,
		brand: info.brand,
		name: info.name,
		shortCode: info.code,
		width,
		height,
		deviceScaleFactor: info.dsf,
		userAgent: isApple ? 'IOS_UA' : 'ANDROID_UA',
		badge: info.badge ? `'${info.badge}'` : 'null',
		hasHomeButton: !!info.hasHomeButton,
		framePath: folder,
		imageWidth: m.imageWidth,
		imageHeight: m.imageHeight,
		screen: m.screen,
	})
}

const lines = []
lines.push(`import type { PhoneDevice } from './types'`)
lines.push('')
lines.push(
	`// Auto-generated by scripts/generateDevicesTs.cjs from scripts/deviceFrameMeta.json — do not`
)
lines.push(`// hand-edit the generated fields (width/height/framePath); re-run the script instead.`)
lines.push(`const IOS_UA =`)
lines.push(`\t'${IOS_UA}'`)
lines.push(`const ANDROID_UA =`)
lines.push(`\t'${ANDROID_UA}'`)
lines.push('')
lines.push(
	`// Bulk-imports each device.avif this catalog actually references, as a URL keyed by its folder`
)
lines.push(
	`// path (e.g. "apple/iphone_15") — matches each entry's \`framePath\` below. Deliberately scoped to`
)
lines.push(
	`// exactly those folders (brace-expanded, not a blanket **/device.avif) — assets/devices/ also has`
)
lines.push(
	`// ipad/laptop/TV/gamepad frames for other, not-yet-built pickers; an unscoped glob would bundle`
)
lines.push(`// all of those into the shipped extension for nothing.`)
const framePathList = entries.map((e) => e.framePath).join(',')
lines.push(
	`const FRAME_IMAGES = import.meta.glob('../../assets/devices/{${framePathList}}/device.avif', { eager: true, query: '?url', import: 'default' }) as Record<string, string>`
)
lines.push(`function frameUrl(folder: string): string {`)
lines.push(
	`\tconst key = Object.keys(FRAME_IMAGES).find((k) => k.includes(\`/devices/\${folder}/\`))`
)
lines.push(`\tif (!key) throw new Error(\`No device frame image found for '\${folder}'\`)`)
lines.push(`\treturn FRAME_IMAGES[key]`)
lines.push(`}`)
lines.push('')
lines.push(`export const PHONE_DEVICES: PhoneDevice[] = [`)
for (const e of entries) {
	lines.push(`\t{`)
	lines.push(`\t\tid: '${e.id}',`)
	lines.push(`\t\tbrand: '${e.brand}',`)
	lines.push(`\t\tname: '${e.name.replace(/'/g, "\\'")}',`)
	lines.push(`\t\tshortCode: '${e.shortCode.replace(/\n/g, '\\n')}',`)
	lines.push(`\t\twidth: ${e.width},`)
	lines.push(`\t\theight: ${e.height},`)
	lines.push(`\t\tdeviceScaleFactor: ${e.deviceScaleFactor},`)
	lines.push(`\t\tuserAgent: ${e.userAgent},`)
	lines.push(`\t\tbadge: ${e.badge},`)
	lines.push(`\t\thasHomeButton: ${e.hasHomeButton},`)
	lines.push(`\t\tframeUrl: frameUrl('${e.framePath}'),`)
	lines.push(`\t\timageWidth: ${e.imageWidth},`)
	lines.push(`\t\timageHeight: ${e.imageHeight},`)
	lines.push(
		`\t\tscreenRect: { x: ${e.screen.x}, y: ${e.screen.y}, width: ${e.screen.width}, height: ${e.screen.height} },`
	)
	lines.push(`\t},`)
}
lines.push(`]`)
lines.push('')
lines.push(`export function getDeviceById(id: string): PhoneDevice | undefined {`)
lines.push(`\treturn PHONE_DEVICES.find((d) => d.id === id)`)
lines.push(`}`)
lines.push('')
lines.push(`export const DEFAULT_DEVICE_ID = 'iphone-15'`)
lines.push('')
lines.push(
	`export const DEVICE_CATEGORY_TABS = ['All', '2026', '2025', 'Flagship', 'Top'] as const`
)
lines.push(`export type DeviceCategoryTab = (typeof DEVICE_CATEGORY_TABS)[number]`)
lines.push('')
lines.push(`export function filterDevices(`)
lines.push(`\tdevices: PhoneDevice[],`)
lines.push(`\tcategory: DeviceCategoryTab,`)
lines.push(`\tquery: string`)
lines.push(`): PhoneDevice[] {`)
lines.push(`\tconst q = query.trim().toLowerCase()`)
lines.push(`\treturn devices.filter((d) => {`)
lines.push(`\t\tif (category !== 'All' && d.badge !== category) return false`)
lines.push(
	`\t\tif (q && !d.name.toLowerCase().includes(q) && !d.brand.toLowerCase().includes(q)) return false`
)
lines.push(`\t\treturn true`)
lines.push(`\t})`)
lines.push(`}`)

fs.writeFileSync(
	path.join(__dirname, '..', 'src', 'lib', 'phoneSimulator', 'devices.ts'),
	lines.join('\n') + '\n'
)
console.log(`Wrote ${entries.length} devices.`)
