/**
 * Waveform and duration of an audio file, read in the side panel. Used to fill in files indexed before the
 * index stored these. Nothing here touches the model, so it is safe for UI code (it deliberately does not
 * import `extractors/media.ts`, which pulls in the model runtime).
 */
import { type FileRecord } from './types'
import { waveformPeaksOfChannels } from './waveform'

export type MediaMeta = Pick<FileRecord, 'duration' | 'width' | 'height' | 'waveform'>

/** `meta` without its undefined fields, so saving it can never blank out a value that is already stored. */
export function definedOnly(meta: MediaMeta): MediaMeta {
	return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as MediaMeta
}

/** Peaks for an audio card, from a decode at 12 kHz (cheap, and plenty for 96 bars). */
export async function readWaveform(file: Blob): Promise<MediaMeta> {
	const ctx = new OfflineAudioContext(1, 1, 12_000)
	const buf = await ctx.decodeAudioData(await file.arrayBuffer())
	return {
		duration: buf.duration,
		waveform: waveformPeaksOfChannels(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))),
	}
}
