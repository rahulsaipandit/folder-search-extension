// Phone Web Simulator (docs/PhoneWebSimulator.html was the reference marketing page, not the
// actual UI). Renders the target URL in an iframe sized to the device's real CSS px, positioned
// over the real device-photo frame's screen cutout (assets/devices/, see
// scripts/extractDeviceFrameMeta.cjs + scripts/generateDevicesTs.cjs for how devices.ts is
// generated from those images). For sites whose own X-Frame-Options/CSP frame-ancestors header
// refuses the iframe, lib/phoneSimulator/liveTabResize.ts offers a CDP device-metrics-override
// fallback that resizes a real tab instead — that only works on a top-level navigation, which
// frame-ancestors doesn't restrict.

export type DeviceBadge = '2026' | '2025' | 'Flagship' | 'Top' | null

export interface ScreenRect {
	x: number
	y: number
	width: number
	height: number
}

export interface PhoneDevice {
	id: string
	brand: string
	name: string
	shortCode: string // e.g. "17", "17Pro", "SE" — shown in the badge chip in the device list
	width: number // CSS px, portrait — derived from the frame image's screen-rect pixel size
	height: number // CSS px, portrait
	deviceScaleFactor: number
	userAgent: string
	badge: DeviceBadge
	/** True for devices with a physical home button visible in the frame photo (no gesture home-indicator pill needed). */
	hasHomeButton: boolean
	/** Real device photo (assets/devices/**\/device.avif) the iframe is composited into. */
	frameUrl: string
	imageWidth: number
	imageHeight: number
	/** The photo's screen cutout, in image px — where the iframe is positioned/scaled to. */
	screenRect: ScreenRect
}

export type Orientation = 'portrait' | 'landscape'

export type ThemeMode = 'system' | 'light' | 'dark'

export type ScreenMode = 'browser' | 'pwa' | 'fullscreen'

export interface PhoneSimulatorSettings {
	deviceFrame: boolean
	realisticUI: boolean
	synchronizedScrolling: boolean
	touchScrolling: boolean
	theme: ThemeMode
	screenMode: ScreenMode
	customUrl: string // Pro-gated in the UI; stored so the field isn't lossy if toggled later
	customTime: string // Pro-gated in the UI, "HH:MM"
	anonymousAnalytics: boolean
}

export interface PhoneSimulatorState {
	settings: PhoneSimulatorSettings
	favoriteDeviceIds: string[]
	lastDeviceId: string
	lastUrl: string
}

export const DEFAULT_SETTINGS: PhoneSimulatorSettings = {
	deviceFrame: true,
	realisticUI: true,
	synchronizedScrolling: true,
	touchScrolling: true,
	theme: 'system',
	screenMode: 'browser',
	customUrl: '',
	customTime: '',
	anonymousAnalytics: true,
}
