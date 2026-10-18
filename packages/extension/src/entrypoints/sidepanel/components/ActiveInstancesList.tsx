import { Trash2, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getActiveInstances, stopWidgetInstance, deleteWidgetInstance } from '../../../lib/widgetRuntime'
import type { WidgetInstance } from '../../../lib/widgetRuntime'
import { WidgetStatusDot } from '@/components/misc'

export function ActiveInstancesList() {
	const [instances, setInstances] = useState<WidgetInstance[]>([])

	useEffect(() => {
		async function loadInstances() {
			try {
				const active = await getActiveInstances()
				setInstances(active)
			} catch (e) {
				console.error('[ActiveInstancesList] Failed to load instances:', e)
			}
		}

		loadInstances()

		const interval = setInterval(loadInstances, 2000)
		return () => clearInterval(interval)
	}, [])

	if (instances.length === 0) {
		return (
			<div className="text-xs text-muted-foreground text-center py-8">
				No active widget instances
			</div>
		)
	}

	return (
		<div className="space-y-2">
			{instances.map((instance) => {
				const task = ((instance.input as any)?.task as string) || 'Unknown task'
				const truncatedTask = task.length > 20 ? task.substring(0, 20) + '...' : task

				return (
					<div key={instance.instanceId} className="border rounded-lg p-3">
						<div className="flex items-center justify-between">
							<div>
								<div className="text-sm font-medium" title={task}>
									{truncatedTask}
								</div>
								<WidgetStatusDot status={instance.status} />
								{instance.currentStep && (
									<div className="text-xs text-muted-foreground mt-0.5">
										Step: {instance.currentStep}
									</div>
								)}
							</div>
							<div className="flex gap-1">
								<Button
									size="sm"
									variant="default"
									className="h-7 px-2 text-xs"
									onClick={() => {
										const dashboardUrl = chrome.runtime.getURL('/sidepanel.html?view=dashboard')
										chrome.tabs.create({ url: dashboardUrl })
									}}
								>
									View
								</Button>
								<Button
									size="sm"
									variant="destructive"
									className="h-7 w-7 p-0 ring-1 ring-white"
									onClick={async () => {
										try {
											const result = await stopWidgetInstance(instance.instanceId)
											if (result.success) {
												toast.success('Widget stopped successfully')
											} else {
												toast.error(result.error || 'Failed to stop widget')
											}
										} catch {
											toast.error('Failed to stop widget')
										}
									}}
								>
									<Square className="size-3.5 fill-white" />
								</Button>
								<Button
									size="sm"
									variant="destructive"
									className="h-7 w-7 p-0"
									onClick={async () => {
										try {
											const result = await deleteWidgetInstance(instance.instanceId)
											if (result.success) {
												toast.success('Widget deleted successfully')
											} else {
												toast.error(result.error || 'Failed to delete widget')
											}
										} catch {
											toast.error('Failed to delete widget')
										}
									}}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						</div>
					</div>
				)
			})}
		</div>
	)
}
