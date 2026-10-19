import { ExternalLink, Loader2, Pause, Play, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { fileName } from '@/folder-search/browse'
import { readFolderFile } from '@/folder-search/fileAccess'
import { readWaveform } from '@/folder-search/mediaMeta'
import type { FileRecord, FolderRecord } from '@/folder-search/types'
import { formatDuration } from '@/folder-search/waveform'

import { useFocusTrap } from './focusTrap'
import { AUDIO_TILE_ASPECT, drawWaveform } from './glass/drawWaveform'

interface Props {
	item: FileRecord
	folder: FolderRecord | undefined
	onClose: () => void
	onOpenOriginal: () => void
}

const CANVAS_W = 640

/**
 * Plays one video or audio file with its sound on: play/pause, a seek bar, the time and mute, as in the
 * demo's viewer. Audio shows its waveform with the play position. The wall stops its own previews while
 * this is open (the viewer plays a separate copy of the file).
 */
export function MediaViewer({ item, folder, onClose, onOpenOriginal }: Props) {
	const isVideo = item.kind === 'video'
	const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const dialogRef = useRef<HTMLDivElement>(null)
	useFocusTrap(dialogRef)
	const [url, setUrl] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [playing, setPlaying] = useState(false)
	const [time, setTime] = useState(0)
	const [length, setLength] = useState(item.duration ?? 0)
	const [muted, setMuted] = useState(false)
	const [peaks, setPeaks] = useState<number[] | undefined>(item.waveform)

	useEffect(() => {
		let objectUrl: string | null = null
		let dead = false
		if (!folder) {
			setError('The folder is no longer indexed.')
			return
		}
		readFolderFile(folder, item.relPath)
			.then(file => {
				if (dead) return
				objectUrl = URL.createObjectURL(file)
				setUrl(objectUrl)
				if (!isVideo && !item.waveform?.length) {
					readWaveform(file)
						.then(meta => !dead && setPeaks(meta.waveform))
						.catch(e => console.warn('[folder-search] could not read the waveform of', item.relPath, e))
				}
			})
			.catch(e => !dead && setError(`Could not open the file. If the browser restarted, reconnect the folder. ${e instanceof Error ? e.message : ''}`))
		return () => {
			dead = true
			if (objectUrl) URL.revokeObjectURL(objectUrl)
		}
	}, [folder, item.relPath, item.waveform, isVideo])

	useEffect(() => {
		closeRef.current?.focus()
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
			else if (e.key === ' ' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
				e.preventDefault()
				toggle()
			}
		}
		window.addEventListener('keydown', key)
		return () => window.removeEventListener('keydown', key)
	}, [onClose])

	useEffect(() => {
		if (!isVideo && canvasRef.current) drawWaveform(canvasRef.current, peaks, length > 0 ? time / length : 0)
	}, [isVideo, peaks, time, length])

	const toggle = () => {
		const el = mediaRef.current
		if (!el) return
		if (el.paused) void el.play().catch(e => console.warn('[folder-search] playback was refused', e))
		else el.pause()
	}
	const media = {
		ref: mediaRef as React.RefObject<never>,
		src: url ?? undefined,
		autoPlay: true,
		onPlay: () => setPlaying(true),
		onPause: () => setPlaying(false),
		onEnded: () => setPlaying(false),
		onLoadedMetadata: () => {
			const d = mediaRef.current?.duration
			if (d !== undefined && Number.isFinite(d)) setLength(d)
		},
		onTimeUpdate: () => setTime(mediaRef.current?.currentTime ?? 0),
		onError: () => setError('This browser cannot play this file.'),
	}

	return (
		<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={item.relPath} className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white">
			<div className="flex items-center gap-2 p-2 text-xs">
				<span className="flex-1 truncate" title={item.relPath}>{fileName(item.relPath)}</span>
				<Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:bg-white/10" onClick={onOpenOriginal}>
					<ExternalLink className="size-3" /> Open original
				</Button>
				<Button ref={closeRef} size="icon-sm" variant="ghost" className="size-7 text-white hover:bg-white/10" onClick={onClose} aria-label="Close">
					<X className="size-4" />
				</Button>
			</div>
			<div className="flex min-h-0 flex-1 items-center justify-center p-3">
				{error ? (
					<p className="max-w-sm text-center text-xs text-amber-300 break-words">{error}</p>
				) : !url ? (
					<Loader2 className="size-6 animate-spin" />
				) : isVideo ? (
					<video {...media} playsInline onClick={toggle} className="max-h-full max-w-full rounded-xl" />
				) : (
					<>
						<audio {...media} />
						<canvas
							ref={canvasRef}
							width={CANVAS_W}
							height={Math.round(CANVAS_W / AUDIO_TILE_ASPECT)}
							className="aspect-[4/3] w-full max-w-xl rounded-2xl"
							aria-label="Waveform"
						/>
					</>
				)}
			</div>
			<div className="mx-auto mb-4 flex w-[min(560px,100%-24px)] items-center gap-3 rounded-2xl bg-white/10 p-2 backdrop-blur">
				<Button size="icon-sm" variant="ghost" className="size-8 text-white hover:bg-white/15" onClick={toggle} disabled={!url || !!error} aria-label={playing ? 'Pause' : 'Play'}>
					{playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
				</Button>
				<input
					type="range"
					min={0}
					max={length || 1}
					step={0.01}
					value={Math.min(time, length || 1)}
					disabled={!url || !!error}
					onChange={e => {
						const t = Number(e.target.value)
						if (mediaRef.current) mediaRef.current.currentTime = t
						setTime(t)
					}}
					className="min-w-0 flex-1 accent-white"
					aria-label="Seek"
				/>
				<span className="w-[5.5rem] text-right text-[11px] tabular-nums">
					{formatDuration(time) || '0:00'} / {formatDuration(length) || '0:00'}
				</span>
				<Button
					size="icon-sm"
					variant="ghost"
					className="size-8 text-white hover:bg-white/15"
					disabled={!url || !!error}
					onClick={() => {
						const next = !muted
						if (mediaRef.current) mediaRef.current.muted = next
						setMuted(next)
					}}
					aria-label={muted ? 'Unmute' : 'Mute'}
				>
					{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
				</Button>
			</div>
		</div>
	)
}
