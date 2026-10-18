import { browser } from 'wxt/browser'

import { DEFAULT_DEVICE_ID } from './devices'
import { DEFAULT_SETTINGS, type PhoneSimulatorSettings, type PhoneSimulatorState } from './types'

declare const chrome: typeof browser

const STORAGE_KEY = 'phoneSimulatorState'

export async function loadPhoneSimState(): Promise<PhoneSimulatorState> {
	const stored = await chrome.storage.local.get(STORAGE_KEY)
	const state = stored[STORAGE_KEY] as PhoneSimulatorState | undefined
	if (!state) {
		return {
			settings: DEFAULT_SETTINGS,
			favoriteDeviceIds: [],
			lastDeviceId: DEFAULT_DEVICE_ID,
			lastUrl: '',
		}
	}
	// Merge over defaults so a settings shape change (new toggle added later) doesn't crash on an
	// older stored object missing the new field.
	return {
		settings: { ...DEFAULT_SETTINGS, ...state.settings },
		favoriteDeviceIds: state.favoriteDeviceIds ?? [],
		lastDeviceId: state.lastDeviceId ?? DEFAULT_DEVICE_ID,
		lastUrl: state.lastUrl ?? '',
	}
}

export async function savePhoneSimState(state: PhoneSimulatorState): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: state })
}

export async function updatePhoneSimSettings(
	settings: PhoneSimulatorSettings
): Promise<PhoneSimulatorState> {
	const current = await loadPhoneSimState()
	const next = { ...current, settings }
	await savePhoneSimState(next)
	return next
}

export async function toggleFavoriteDevice(deviceId: string): Promise<PhoneSimulatorState> {
	const current = await loadPhoneSimState()
	const isFavorite = current.favoriteDeviceIds.includes(deviceId)
	const favoriteDeviceIds = isFavorite
		? current.favoriteDeviceIds.filter((id) => id !== deviceId)
		: [...current.favoriteDeviceIds, deviceId]
	const next = { ...current, favoriteDeviceIds }
	await savePhoneSimState(next)
	return next
}

export async function setLastDevice(deviceId: string): Promise<PhoneSimulatorState> {
	const current = await loadPhoneSimState()
	const next = { ...current, lastDeviceId: deviceId }
	await savePhoneSimState(next)
	return next
}

export async function setLastUrl(url: string): Promise<PhoneSimulatorState> {
	const current = await loadPhoneSimState()
	const next = { ...current, lastUrl: url }
	await savePhoneSimState(next)
	return next
}
