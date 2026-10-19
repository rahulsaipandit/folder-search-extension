import {
	Camera,
	FolderPlus,
	ImageUp,
	Loader2,
	Mic,
	Music,
	Plus,
	Search,
	Square,
	X,
} from 'lucide-react'
import { forwardRef, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

import {
	MAX_RECORD_SEC,
	type MediaQuery,
	audioQuery,
	imageQuery,
	isMediaBlocked,
	mediaErrorText,
	openMediaPermissionTab,
} from './mediaQuery'

interface Props {
	query: string
	onQuery: (q: string) => void
	onSubmit: () => void
	mediaQuery: MediaQuery | null
	onMedia: (q: MediaQuery) => void
	onClear: () => void
	onAddFolder: () => void
	/** Image / audio queries need the matching encoder to have been indexed with. */
	canImage: boolean
	canAudio: boolean
	onError: (message: string) => void
	busy: boolean
}

const iconBtn =
	'grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-2 ring-ring outline-none'

function CameraDialog({
	onShot,
	onClose,
	onError,
}: {
	onShot: (b: Blob) => void
	onClose: () => void
	onError: (m: string) => void
}) {
	const video = useRef<HTMLVideoElement>(null)
	useEffect(() => {
		let stream: MediaStream | null = null
		let dead = false
		navigator.mediaDevices
			.getUserMedia({ video: { facingMode: 'environment' } })
			.then((s) => {
				if (dead) return s.getTracks().forEach((t) => t.stop())
				stream = s
				if (video.current) video.current.srcObject = s
			})
			.catch((e) => {
				if (isMediaBlocked(e)) openMediaPermissionTab('camera')
				onError(mediaErrorText(e, 'camera'))
				onClose()
			})
		return () => {
			dead = true
			stream?.getTracks().forEach((t) => t.stop())
		}
	}, [onClose, onError])

	const capture = () => {
		const v = video.current
		if (!v || !v.videoWidth) return
		const c = document.createElement('canvas')
		c.width = v.videoWidth
		c.height = v.videoHeight
		c.getContext('2d')?.drawImage(v, 0, 0)
		c.toBlob((b) => b && onShot(b), 'image/jpeg', 0.9)
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Take a photo"
			className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-3"
		>
			<video
				ref={video}
				autoPlay
				playsInline
				muted
				className="max-h-[70vh] max-w-full rounded-xl"
			/>
			<div className="flex gap-2">
				<Button onClick={capture}>
					<Camera className="size-4" /> Search with this photo
				</Button>
				<Button variant="secondary" onClick={onClose}>
					Cancel
				</Button>
			</div>
		</div>
	)
}

/**
 * The search box: `+` adds a folder, the mic searches by what you say or play, the camera searches by a
 * photo (take one, or choose an image). Typing, pasting an image, or dropping one also works.
 */
export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
	{
		query,
		onQuery,
		onSubmit,
		mediaQuery,
		onMedia,
		onClear,
		onAddFolder,
		canImage,
		canAudio,
		onError,
		busy,
	},
	inputRef
) {
	const [menu, setMenu] = useState(false)
	const [camera, setCamera] = useState(false)
	const [recording, setRecording] = useState<number | null>(null) // elapsed seconds
	const recorder = useRef<MediaRecorder | null>(null)
	const fileInput = useRef<HTMLInputElement>(null)

	const searchImage = async (blob: Blob, label: string) => {
		try {
			onMedia(await imageQuery(blob, label))
		} catch (e) {
			onError(`Could not read that image: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	const stopRecording = () => {
		if (recorder.current?.state === 'recording') recorder.current.stop()
	}
	useEffect(
		() => () => {
			if (recorder.current?.state === 'recording') recorder.current.stop()
		},
		[]
	)

	const toggleRecording = async () => {
		if (recording !== null) return stopRecording()
		let stream: MediaStream
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		} catch (e) {
			if (isMediaBlocked(e)) openMediaPermissionTab('microphone')
			return onError(mediaErrorText(e, 'microphone'))
		}
		const rec = new MediaRecorder(stream)
		const chunks: Blob[] = []
		recorder.current = rec
		rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
		const tick = setInterval(() => setRecording((s) => (s === null ? s : s + 1)), 1000)
		const limit = setTimeout(stopRecording, MAX_RECORD_SEC * 1000)
		rec.onstop = () => {
			clearInterval(tick)
			clearTimeout(limit)
			stream.getTracks().forEach((t) => t.stop())
			setRecording(null)
			const blob = new Blob(chunks, { type: rec.mimeType })
			if (blob.size < 1000) return onError('Nothing was recorded.')
			void audioQuery(blob, 'Voice recording')
				.then(onMedia)
				.catch((e) => onError(String(e)))
		}
		rec.start()
		setRecording(0)
	}

	const onFile = (f: File | undefined) => {
		if (!f) return
		if (f.type.startsWith('image/')) void searchImage(f, f.name)
		else if (f.type.startsWith('audio/'))
			void audioQuery(f, f.name)
				.then(onMedia)
				.catch((e) => onError(String(e)))
		else onError('Choose an image or an audio file.')
	}

	const hasQuery = Boolean(query || mediaQuery)
	return (
		<div
			className="relative"
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault()
				onFile(e.dataTransfer.files[0])
			}}
		>
			<div className="flex h-10 items-center gap-1 rounded-full border border-foreground/40 bg-neutral-200/70 dark:bg-muted px-1.5 shadow-sm focus-within:ring-2 ring-ring">
				<button
					className={iconBtn}
					title="Add a folder or search with a file"
					aria-label="Add a folder or search with a file"
					aria-haspopup="menu"
					aria-expanded={menu}
					onClick={() => setMenu((m) => !m)}
				>
					<Plus className="size-4" />
				</button>
				{mediaQuery ? (
					<span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
						{mediaQuery.preview ? (
							<img
								src={mediaQuery.preview}
								alt=""
								className="size-6 shrink-0 rounded object-cover"
							/>
						) : (
							<Music className="size-4 shrink-0 text-muted-foreground" />
						)}
						<span className="truncate">{mediaQuery.label}</span>
					</span>
				) : recording !== null ? (
					<span className="flex flex-1 items-center gap-1.5 text-xs text-destructive" role="status">
						<span className="size-2 animate-pulse rounded-full bg-destructive" /> Listening…{' '}
						{recording}s
					</span>
				) : (
					<form
						role="search"
						className="flex h-full min-w-0 flex-1"
						onSubmit={(e) => {
							e.preventDefault()
							onSubmit()
						}}
					>
						<input
							ref={inputRef}
							value={query}
							onChange={(e) => onQuery(e.target.value)}
							onPaste={(e) => {
								const img = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
								if (img) {
									e.preventDefault()
									void searchImage(img, 'Pasted image')
								}
							}}
							placeholder="Search anything…  ( / )"
							aria-label="Search your files"
							className="h-full min-w-0 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
						/>
					</form>
				)}
				{hasQuery && (
					<button className={iconBtn} onClick={onClear} aria-label="Clear search" title="Clear">
						<X className="size-4" />
					</button>
				)}
				<button
					className={`${iconBtn} ${recording !== null ? 'bg-destructive/10 text-destructive' : ''}`}
					onClick={() => void toggleRecording()}
					disabled={!canAudio && recording === null}
					title={
						canAudio
							? recording !== null
								? 'Stop and search'
								: 'Search by voice or sound'
							: 'Turn on audio indexing in Manage to search by sound'
					}
					aria-label={recording !== null ? 'Stop recording' : 'Search by voice or sound'}
				>
					{recording !== null ? (
						<Square className="size-3.5 fill-current" />
					) : (
						<Mic className="size-4" />
					)}
				</button>
				<button
					className={iconBtn}
					onClick={() => setCamera(true)}
					disabled={!canImage}
					title={
						canImage ? 'Take a webcam photo' : 'Turn on image indexing in Manage to search by photo'
					}
					aria-label="Take a webcam photo"
				>
					<Camera className="size-4" />
				</button>
				<span className={`${iconBtn} pointer-events-none`} aria-hidden>
					{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
				</span>
			</div>
			{menu && (
				<div
					role="menu"
					className="absolute left-0 top-11 z-20 w-56 rounded-lg border bg-popover p-1 text-xs shadow-lg"
				>
					<button
						role="menuitem"
						className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
						onClick={() => {
							setMenu(false)
							onAddFolder()
						}}
					>
						<FolderPlus className="size-3.5" /> Add a folder
					</button>
					<button
						role="menuitem"
						className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
						onClick={() => {
							setMenu(false)
							fileInput.current?.click()
						}}
					>
						<ImageUp className="size-3.5" /> Search with an image or sound…
					</button>
				</div>
			)}
			<input
				ref={fileInput}
				type="file"
				accept="image/*,audio/*"
				hidden
				onChange={(e) => {
					onFile(e.target.files?.[0])
					e.target.value = ''
				}}
			/>
			{camera && (
				<CameraDialog
					onClose={() => setCamera(false)}
					onError={onError}
					onShot={(b) => {
						setCamera(false)
						void searchImage(b, 'Camera photo')
					}}
				/>
			)}
		</div>
	)
})
