/// <reference types="chrome"/>
import { PageAgentCore } from '@page-agent/core'
import { LLMClient } from '@page-agent/llms'

import type { WidgetDefinition } from './widgetRuntime'

export type BridgeActivityStatus = 'pending' | 'success' | 'error'

export interface BridgeActivityEvent {
	instanceId: string
	widgetId: string
	timestamp: number
	type: 'llm_call' | 'dom_extract' | 'tool_execution' | 'capability_check'
	metadata: Record<string, unknown>
	status: BridgeActivityStatus
	duration?: number
}

type ActivityListener = (event: BridgeActivityEvent) => void

/**
 * Page Agent Bridge - Isolated adapter for widget capabilities
 * All capability filtering and auditing happens at this boundary
 * No changes required to core packages
 */
export class PageAgentBridge {
	private core: PageAgentCore
	private widget: WidgetDefinition
	private instanceId: string
	private listeners = new Set<ActivityListener>()

	constructor(widget: WidgetDefinition, instanceId: string) {
		this.widget = widget
		this.instanceId = instanceId

		// Create isolated core instance per widget
		// TODO: PageController instance needs to be properly created and injected here
		const dummyPageController = {} as any

		this.core = new PageAgentCore({
			pageController: dummyPageController,
			provider: 'openai',
			baseURL: 'https://api.openai.com/v1',
			apiKey: 'dummy',
			model: 'gpt-4o',
			maxRetries: 3,
			temperature: 0.1,
		})
	}

	addActivityListener(listener: ActivityListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emitActivity(event: Omit<BridgeActivityEvent, 'instanceId' | 'widgetId'>): void {
		const fullEvent: BridgeActivityEvent = {
			...event,
			instanceId: this.instanceId,
			widgetId: this.widget.id,
		}

		this.listeners.forEach((listener) => {
			try {
				listener(fullEvent)
			} catch {
				// Ignore listener errors
			}
		})
	}

	private async trackActivity<T>(
		type: BridgeActivityEvent['type'],
		metadata: Record<string, unknown>,
		operation: () => Promise<T>
	): Promise<T> {
		const start = Date.now()
		this.emitActivity({
			timestamp: start,
			type,
			metadata,
			status: 'pending',
		})

		try {
			const result = await operation()
			const duration = Date.now() - start
			this.emitActivity({
				timestamp: start,
				type,
				metadata,
				status: 'success',
				duration,
			})
			return result
		} catch (error) {
			const duration = Date.now() - start
			this.emitActivity({
				timestamp: start,
				type,
				metadata: {
					...metadata,
					error: String(error),
				},
				status: 'error',
				duration,
			})
			throw error
		}
	}

	/**
	 * Extract simplified DOM from tab
	 * Requires capability: tab.read
	 */
	async extractDOM(tabId: number): Promise<string> {
		return this.trackActivity('dom_extract', { tabId }, async () => {
			this.assertCapability('tab.read')
			await this.auditLog('tab.extract', { tabId })

			// TODO: Inject content script and connect to remote PageController
			return ''
		})
	}

	/**
	 * Call LLM completion
	 * Requires capability: llm.completion
	 */
	async callLLM(prompt: string): Promise<string> {
		return this.trackActivity('llm_call', { promptHash: this.hashString(prompt) }, async () => {
			this.assertCapability('llm.completion')
			await this.auditLog('llm.call', { promptHash: this.hashString(prompt) })

			const { getWidgetLLMBridge } = await import('./widgetLLMBridge')
			return getWidgetLLMBridge().complete(prompt)
		})
	}

	/**
	 * Execute tool on target tab
	 * Requires capability: tab.interact
	 */
	async executeTool(
		tabId: number,
		toolName: string,
		parameters: Record<string, unknown>
	): Promise<unknown> {
		return this.trackActivity('tool_execution', { tabId, toolName, parameters }, async () => {
			this.assertCapability('tab.interact')
			await this.auditLog('tool.execute', { tabId, toolName })

			const tool = this.core.tools.get(toolName)
			if (!tool) throw new Error(`Tool ${toolName} not found`)
			return tool.execute.bind(this.core)(parameters, { signal: new AbortController().signal })
		})
	}

	/**
	 * Query open tabs
	 * Requires capability: tabs.list or tabs.read
	 */
	async queryTabs(filter: Record<string, unknown>): Promise<chrome.tabs.Tab[]> {
		return this.trackActivity(
			'capability_check',
			{ operation: 'tabs.query', filter: Object.keys(filter) },
			async () => {
				if (filter.url) {
					this.assertCapability('tabs.read')
				} else {
					this.assertCapability('tabs.list')
				}

				await this.auditLog('tabs.query', { filter: Object.keys(filter) })

				return chrome.tabs.query(filter)
			}
		)
	}

	private assertCapability(capability: string): void {
		if (!this.widget.capabilities.includes(capability)) {
			throw new Error(`Capability denied: ${capability} not declared for widget ${this.widget.id}`)
		}
	}

	private async auditLog(operation: string, metadata: Record<string, unknown>): Promise<void> {
		// TODO: Implement persistent audit logging
		console.debug(`[Widget Audit] ${this.widget.id}: ${operation}`, metadata)
	}

	private filterToolsByCapabilities(capabilities: string[]): string[] {
		const allowedTools: string[] = []

		if (capabilities.includes('tab.interact')) {
			allowedTools.push('click', 'input', 'scroll', 'select', 'wait')
		}

		if (capabilities.includes('tab.read')) {
			allowedTools.push('extract')
		}

		return allowedTools
	}

	private hashString(str: string): string {
		let hash = 0
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}
		return hash.toString(16)
	}
}
