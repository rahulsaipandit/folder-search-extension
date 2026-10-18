import { useEffect, useRef, useState } from 'react'
import { File, FileImage, FileText, Plus } from 'lucide-react'

interface AttachButtonProps {
	disabled?: boolean
}

export function AttachButton({ disabled }: AttachButtonProps) {
	const [open, setOpen] = useState(false)
	const wrapperRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		function handleClickOutside(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [open])

	return (
		<div ref={wrapperRef} className="relative flex-shrink-0">
			<div className={`attach-btn-wrapper${open ? ' is-open' : ''}`}>
				<div className="attach-btn-blur" />
				<div className="attach-btn-ring" />
				<button
					className="attach-btn"
					aria-label="Attach files"
					title="Attach image, PDF, or text file"
					onClick={() => setOpen((v) => !v)}
					disabled={disabled}
				>
					<Plus className="size-3" />
				</button>
			</div>

			{open && (
				<div className="absolute bottom-full mb-2 left-0 bg-popover border rounded-lg shadow-md py-1 w-40 z-50">
					<button
						className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-popover-foreground hover:bg-muted transition-colors"
						onClick={() => setOpen(false)}
					>
						<FileImage className="size-3.5 text-blue-500 flex-shrink-0" />
						Image
					</button>
					<button
						className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-popover-foreground hover:bg-muted transition-colors"
						onClick={() => setOpen(false)}
					>
						<FileText className="size-3.5 text-red-500 flex-shrink-0" />
						PDF File
					</button>
					<button
						className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-popover-foreground hover:bg-muted transition-colors"
						onClick={() => setOpen(false)}
					>
						<File className="size-3.5 text-green-600 flex-shrink-0" />
						Text File
					</button>
				</div>
			)}
		</div>
	)
}
