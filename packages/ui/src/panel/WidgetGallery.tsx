import React, { useState, useEffect } from 'react'
import { getRegisteredWidget, createWidgetInstance, getActiveInstances } from '../../../extension/src/lib/widgetRuntime'
import type { WidgetInstance } from '../../../extension/src/lib/db'

declare const chrome: any

const WidgetGallery: React.FC = () => {
	const [searchQuery, setSearchQuery] = useState('')
	const [availableWidgets, setAvailableWidgets] = useState<Array<{ id: string; name: string; description: string }>>([])
	const [activeInstances, setActiveInstances] = useState<WidgetInstance[]>([])

	const loadWidgets = async () => {
		try {
			const result = await chrome.runtime.sendMessage({ type: 'GET_WIDGETS' })
			setAvailableWidgets(result.widgets || [])
		} catch (error) {
			console.error('Failed to load widgets:', error)
			setAvailableWidgets([
				{
					id: 'org.page-agent.resume-parser',
					name: 'Resume Parser',
					description: 'Extracts structured data from resume documents'
				}
			])
		}
	}

	const loadActiveInstances = async () => {
		try {
			const instances = await getActiveInstances()
			setActiveInstances(instances)
		} catch (error) {
			console.error('Failed to load active instances:', error)
		}
	}

	const launchWidget = async (widgetId: string) => {
		try {
			const widget = getRegisteredWidget(widgetId)
			if (!widget) {
				alert('Widget not found')
				return
			}
			const input = {}
			const instance = await createWidgetInstance(widget, input)
			alert(`Widget "${widget.name}" launched with ID: ${instance.instanceId}`)
			await loadActiveInstances()
		} catch (error) {
			console.error('Failed to launch widget:', error)
			alert('Failed to launch widget: ' + error)
		}
	}

	useEffect(() => {
		loadWidgets()
		loadActiveInstances()
	}, [])

	const filteredWidgets = availableWidgets.filter(widget =>
		!searchQuery ||
		widget.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
		widget.description.toLowerCase().includes(searchQuery.toLowerCase())
	)

	return (
		<div className="widget-gallery p-4">
			<h2 className="text-lg font-semibold mb-4">Widget Gallery</h2>

			<input
				value={searchQuery}
				onChange={e => setSearchQuery(e.target.value)}
				placeholder="Search widgets..."
				className="w-full p-2 border rounded mb-4"
			/>

			{activeInstances.length > 0 && (
				<div className="mb-6">
					<h3 className="text-md font-medium mb-2">Active Widgets</h3>
					<div className="space-y-2">
						{activeInstances.map(instance => (
							<div key={instance.instanceId} className="p-3 bg-blue-50 rounded border">
								<div className="flex justify-between items-center">
									<div>
										<div className="font-medium">{instance.widgetId}</div>
										<div className="text-sm text-gray-600">Status: {instance.status}</div>
									</div>
									<div className="text-xs text-gray-500">
										{new Date(instance.createdAt).toLocaleString()}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="widget-list space-y-3">
				{filteredWidgets.map(widget => (
					<div key={widget.id} className="widget-card p-4 border rounded hover:bg-gray-50">
						<div className="flex justify-between items-start">
							<div className="flex-1">
								<h3 className="font-medium">{widget.name}</h3>
								<p className="text-sm text-gray-600 mt-1">{widget.description}</p>
							</div>
							<button
								onClick={() => launchWidget(widget.id)}
								className="ml-4 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
							>
								Launch
							</button>
						</div>
					</div>
				))}
			</div>

			{filteredWidgets.length === 0 && searchQuery && (
				<div className="text-center py-8 text-gray-500">
					No widgets found matching "{searchQuery}"
				</div>
			)}
		</div>
	)
}

export default WidgetGallery
