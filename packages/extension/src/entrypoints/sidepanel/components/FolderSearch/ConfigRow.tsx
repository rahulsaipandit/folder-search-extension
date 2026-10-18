import { FolderSearch2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { getFiles, listFolders } from '@/folder-search/db'
import { folderAccess } from '@/folder-search/fileAccess'
import { formatBytes, selectionBytes } from '@/folder-search/modelCatalog'
import { loadFolderSearchSettings } from '@/folder-search/settings'

interface Status {
	tone: 'none' | 'ready' | 'warn'
	label: string
	detail: string
}

function ago(ts: number | null): string {
	if (!ts) return 'never scanned'
	const min = Math.round((Date.now() - ts) / 60_000)
	if (min < 1) return 'last scan just now'
	if (min < 60) return `last scan ${min} min ago`
	if (min < 60 * 48) return `last scan ${Math.round(min / 60)} h ago`
	return `last scan ${Math.round(min / 1440)} days ago`
}

/**
 * Status summary and link-out only (design §4A.6). Deliberately read-only and not part of the
 * settings Save flow: model download, folder picking and removal happen on the Manage page.
 */
export function FolderSearchConfigRow() {
	const [status, setStatus] = useState<Status | null>(null)

	useEffect(() => {
		let dead = false
		;(async () => {
			try {
				const [settings, folders] = await Promise.all([loadFolderSearchSettings(), listFolders()])
				const models = settings.modelConsent ? `Models ${formatBytes(selectionBytes(settings.selection))} (${settings.selection.dtype})` : 'Models not downloaded'
				if (!folders.length) return !dead && setStatus({ tone: 'none', label: 'Not set up', detail: models })
				const f = folders[0]!
				const access = await folderAccess(f).catch(() => 'denied' as const)
				const indexed = (await getFiles(f.folderId)).filter(x => x.indexState === 'indexed').length
				if (dead) return
				setStatus(
					access === 'granted'
						? { tone: 'ready', label: `Ready · ${indexed.toLocaleString()} files`, detail: `${models} · ${ago(f.lastIndexedAt)}` }
						: { tone: 'warn', label: 'Reconnect', detail: `${models} · folder access needs to be re-granted` }
				)
			} catch (e) {
				console.warn('[folder-search] status unavailable', e)
				if (!dead) setStatus({ tone: 'warn', label: 'Status unavailable', detail: e instanceof Error ? e.message : String(e) })
			}
		})()
		return () => {
			dead = true
		}
	}, [])

	const dot = status?.tone === 'ready' ? 'bg-green-500' : status?.tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground'
	return (
		<div className="pt-3 border-t border-border/50 space-y-1.5">
			<div className="flex items-center gap-1.5 text-xs font-medium">
				<FolderSearch2 className="size-3.5" aria-hidden /> Folder Search
				{status && (
					<span className="ml-auto flex items-center gap-1 font-normal text-muted-foreground">
						<span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
						{status.label}
					</span>
				)}
			</div>
			{status && <p className="text-[11px] text-muted-foreground break-words">{status.detail}</p>}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full text-xs h-7"
				onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('folder-search-settings.html') })}
			>
				Manage
			</Button>
		</div>
	)
}
