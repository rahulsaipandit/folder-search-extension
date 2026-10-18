/** Parsing of audio/video unit ids (`${fileId}@${startSec}` with an optional soundtrack suffix). */

/** File ids may contain '@', so the unit separator is always the last one. */
export const unitFileOf = (unitId: string): string => unitId.slice(0, unitId.lastIndexOf('@'))

/** Start second encoded in a unit id; the soundtrack suffix is ignored. 0 if unreadable. */
export function unitStartOf(unitId: string): number {
	const n = parseFloat(unitId.slice(unitId.lastIndexOf('@') + 1))
	return Number.isFinite(n) ? n : 0
}
