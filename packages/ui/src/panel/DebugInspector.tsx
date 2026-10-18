import React, { useState, useEffect } from 'react'
import { getDB } from '../../../extension/src/lib/db'
import type { WidgetEvent, WidgetInstance } from '../../../extension/src/lib/db'

const DebugInspector: React.FC = () => {
	const [selectedInstanceId, setSelectedInstanceId] = useState('')
	const [events, setEvents] = useState<WidgetEvent[]>([])
	const [instances, setInstances] = useState<WidgetInstance[]>([])
	const [autoRefresh, setAutoRefresh] = useState(true)

	const loadInstances = async () => {
		try {
			const db = await getDB()
			const allInstances = await db.getAll('widget_instances')
			setInstances(allInstances.sort((a, b) => b.createdAt - a.createdAt))
		} catch (error) {
			console.error('Failed to load instances:', error)
		}
	}

	const loadEvents = async (instanceId: string) => {
		try {
			const db = await getDB()
			// @ts-expect-error by-instanceId index exists in DB schema
			const instanceEvents = await db.getAllFromIndex('widget_events', 'by-instanceId', instanceId)
			setEvents(instanceEvents.sort((a, b) => a.seq - b.seq))
		} catch (error) {
			console.error('Failed to load events:', error)
			setEvents([])
		}
	}

	const selectInstance = async (instanceId: string) => {
		setSelectedInstanceId(instanceId)
		if (instanceId) {
			await loadEvents(instanceId)
		} else {
			setEvents([])
		}
	}

	const replayFromEvent = async (eventIndex: number) => {
		alert(`Replay from event ${eventIndex} not yet implemented`)
	}

	const exportEvents = () => {
		const dataStr = JSON.stringify(events, null, 2)
		const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr)
		const exportFileDefaultName = `widget-events-${selectedInstanceId}.json`
		const linkElement = document.createElement('a')
		linkElement.setAttribute('href', dataUri)
		linkElement.setAttribute('download', exportFileDefaultName)
		linkElement.click()
	}

	const getEventTypeColor = (type: string) => {
		if (type.includes('STARTED')) return 'text-blue-600'
		if (type.includes('COMPLETED')) return 'text-green-600'
		if (type.includes('FAILED')) return 'text-red-600'
		if (type.includes('SCHEDULED') || type.includes('WAIT')) return 'text-yellow-600'
		return 'text-gray-600'
	}

	const formatPayload = (payload: any) => JSON.stringify(payload, null, 2)

	useEffect(() => {
		loadInstances()
		if (!autoRefresh) return
		const interval = window.setInterval(() => {
			if (selectedInstanceId) loadEvents(selectedInstanceId)
			loadInstances()
		}, 2000)
		return () => clearInterval(interval)
	}, [autoRefresh, selectedInstanceId])

	return (
		<div className="debug-inspector p-4 h-full flex flex-col">
			<h2 className="text-lg font-semibold mb-4">Debug Inspector</h2>

			<div className="flex items-center space-x-4 mb-4">
				<label className="flex items-center">
					<input
						type="checkbox"
						checked={autoRefresh}
						onChange={e => setAutoRefresh(e.target.checked)}
						className="mr-2"
					/>
					Auto-refresh
				</label>
				<button
					onClick={() => loadInstances()}
					className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
				>
					Refresh
				</button>
			</div>

			<div className="flex space-x-4 flex-1 min-h-0">
				<div className="w-1/3 border-r pr-4">
					<h3 className="font-medium mb-2">Widget Instances</h3>
					<div className="space-y-2 max-h-96 overflow-y-auto">
						{instances.map((instance: WidgetInstance) => (
							<div
								key={instance.instanceId}
								onClick={() => selectInstance(instance.instanceId)}
								className={`p-3 border rounded cursor-pointer hover:bg-gray-50 ${
									selectedInstanceId === instance.instanceId ? 'bg-blue-50 border-blue-300' : ''
								}`}
							>
								<div className="font-medium text-sm">{instance.widgetId}</div>
								<div className="text-xs text-gray-600">Status: {instance.status}</div>
								<div className="text-xs text-gray-500">
									{new Date(instance.createdAt).toLocaleString()}
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="w-2/3 pl-4">
					<div className="flex justify-between items-center mb-2">
						<h3 className="font-medium">Event Log</h3>
						{events.length > 0 && (
							<button
								onClick={exportEvents}
								className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
							>
								Export
							</button>
						)}
					</div>

					{!selectedInstanceId ? (
						<div className="text-center py-8 text-gray-500">
							Select a widget instance to view its event log
						</div>
					) : events.length === 0 ? (
						<div className="text-center py-8 text-gray-500">
							No events found for this instance
						</div>
					) : (
						<div className="space-y-2 max-h-96 overflow-y-auto">
							{events.map((event: WidgetEvent, index: number) => (
								<div key={`${event.instanceId}-${event.seq}`} className="event-item p-3 border rounded">
									<div className="flex justify-between items-start">
										<div className="flex-1">
											<div className="flex items-center space-x-2">
												<span className={`font-medium text-sm ${getEventTypeColor(event.type)}`}>
													{event.type}
												</span>
												{event.stepId && (
													<span className="text-xs bg-gray-100 px-2 py-1 rounded">
														Step: {event.stepId}
													</span>
												)}
											</div>
											<div className="text-xs text-gray-500 mt-1">
												{new Date(event.ts).toLocaleString()} • Seq: {event.seq}
											</div>
											{Object.keys(event.payload).length > 0 && (
												<pre className="text-xs bg-gray-50 p-2 rounded mt-2 overflow-x-auto">
													{formatPayload(event.payload)}
												</pre>
											)}
										</div>
										<button
											onClick={() => replayFromEvent(index)}
											className="ml-2 px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
											title="Replay from this event"
										>
											↻
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default DebugInspector
