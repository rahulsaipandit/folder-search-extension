import React, { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import '@/assets/index.css'
import { CornerUpLeft } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { HatGlasses } from 'lucide-react'

import { listenThemeChanges } from '@/lib/theme/syncTheme'

listenThemeChanges()

function App() {
	const [allowlist, setAllowlist] = useState<string[]>([])
	const [denylist, setDenylist] = useState<string[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		chrome.storage.local.get('accessControlOverrides').then((result: { accessControlOverrides?: { allowlist?: string[], denylist?: string[] } }) => {
			const overrides = result.accessControlOverrides || {}
			setAllowlist(overrides.allowlist || [])
			setDenylist(overrides.denylist || [])
			setLoading(false)
		})
	}, [])

	const handleSave = useCallback(async () => {
		setSaving(true)
		try {
			await chrome.storage.local.set({
				accessControlOverrides: { allowlist, denylist }
			})
			toast.success('Content access policy updated')
			toast.info('For already open tabs, refresh the page (F5) to apply the new policy.')
		} catch (error) {
			toast.error('Failed to save policy')
		} finally {
			setSaving(false)
		}
	}, [allowlist, denylist])

	const addToList = (list: string[], setter: (list: string[]) => void, value: string) => {
		if (value.trim() && !list.includes(value.trim())) {
			setter([...list, value.trim()])
		}
	}

	const removeFromList = (list: string[], setter: (list: string[]) => void, value: string) => {
		setter(list.filter(item => item !== value))
	}

	if (loading) {
		return (
			<div className="flex flex-col gap-4 p-4">
				<div className="text-center py-8">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto"></div>
					<p className="text-sm text-muted-foreground mt-2">Loading policy...</p>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4 p-4 relative max-w-2xl mx-auto">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold">Content Access Policy</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => window.close()}
					className="absolute top-2 right-3 cursor-pointer"
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</div>

			<p className="text-xs text-muted-foreground">
				Customize which websites the extension can access. Use exact domains (e.g., example.com) or wildcards (e.g., *.example.com).
			</p>

			{/* Allowlist */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<label className="text-sm font-medium">Allowed Sites</label>
					<Tooltip>
						<TooltipTrigger asChild>
							<button type="button" className="text-muted-foreground hover:text-foreground">
								<HatGlasses className="size-3" />
							</button>
						</TooltipTrigger>
						<TooltipContent>
							Sites explicitly allowed even if they match blocked patterns.
						</TooltipContent>
					</Tooltip>
				</div>
				<Input
					placeholder="example.com"
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							addToList(allowlist, setAllowlist, e.currentTarget.value)
							e.currentTarget.value = ''
						}
					}}
					className="text-xs h-8"
				/>
				<div className="flex flex-wrap gap-2">
					{allowlist.map((site) => (
						<span key={site} className="inline-flex items-center gap-1 text-xs bg-green-100 dark:bg-green-900 px-2 py-1 rounded">
							{site}
							<button
								onClick={() => removeFromList(allowlist, setAllowlist, site)}
								className="text-red-600 hover:text-red-800"
							>
								×
							</button>
						</span>
					))}
				</div>
			</div>

			{/* Denylist */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<label className="text-sm font-medium">Blocked Sites</label>
					<Tooltip>
						<TooltipTrigger asChild>
							<button type="button" className="text-muted-foreground hover:text-foreground">
								<HatGlasses className="size-3" />
							</button>
						</TooltipTrigger>
						<TooltipContent>
							Sites blocked from extension access. Takes precedence over allowlist.
						</TooltipContent>
					</Tooltip>
				</div>
				<Input
					placeholder="*.badsite.com"
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							addToList(denylist, setDenylist, e.currentTarget.value)
							e.currentTarget.value = ''
						}
					}}
					className="text-xs h-8"
				/>
				<div className="flex flex-wrap gap-2">
					{denylist.map((site) => (
						<span key={site} className="inline-flex items-center gap-1 text-xs bg-red-100 dark:bg-red-900 px-2 py-1 rounded">
							{site}
							<button
								onClick={() => removeFromList(denylist, setDenylist, site)}
								className="text-red-600 hover:text-red-800"
							>
								×
							</button>
						</span>
					))}
				</div>
			</div>

			<div className="flex gap-2 mt-4">
				<Button
					onClick={handleSave}
					disabled={saving}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					{saving ? 'Saving...' : 'Save Policy'}
				</Button>
			</div>
		</div>
	)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
)
