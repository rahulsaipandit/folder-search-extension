let _counter = 0

/**
 * Generate a short monotonic ID with a readable prefix.
 * Consistent with the extension's storage/idb.ts nextId().
 */
export function nextId(prefix: string): string {
	_counter = (_counter + 1) % 1_000_000
	return `${prefix}_${Date.now()}_${_counter.toString().padStart(6, '0')}`
}
