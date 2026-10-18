/**
 * content script for RemotePageController
 */
import { PageController } from '@page-agent/page-controller'

export function initPageController() {
	let pageController: PageController | null = null
	let intervalID: number | null = null

	const myTabIdPromise = chrome.runtime
		.sendMessage({ type: 'PAGE_CONTROL', action: 'get_my_tab_id' })
		.then((response) => {
			return (response as { tabId: number | null }).tabId
		})
		.catch((error) => {
			console.error('[RemotePageController.ContentScript]: Failed to get my tab id', error)
			return null
		})

	async function getPC(): Promise<PageController> { //RP_DONE: 
		if (!pageController) {
			pageController = new PageController({ enableMask: false, viewportExpansion: 400 })
		} //RP_DONE: 
		return pageController
	}

	intervalID = window.setInterval(async () => {
		const agentHeartbeat = (await chrome.storage.local.get('agentHeartbeat')).agentHeartbeat
		const now = Date.now()
		const agentInTouch = typeof agentHeartbeat === 'number' && now - agentHeartbeat < 2_000

		const isAgentRunning = (await chrome.storage.local.get('isAgentRunning')).isAgentRunning
		const currentTabId = (await chrome.storage.local.get('currentTabId')).currentTabId

		const shouldShowMask = isAgentRunning && agentInTouch && currentTabId === (await myTabIdPromise)

		if (shouldShowMask) {
			const pc = await getPC() //RP_DONE: 
			pc.initMask()
			await pc.showMask()
		} else {
			// await getPC().hideMask()
			if (pageController) {
				pageController.hideMask()
				pageController.cleanUpHighlights()
			}
		}

		if (!isAgentRunning && agentInTouch) {
			if (pageController) {
				pageController.dispose()
				pageController = null
			}
		}
	}, 500)

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type === 'GAZE_UPDATE') { //RP_DONE: 
			// Fire-and-forget: no sendResponse needed, so we don't return true.
			// Keeping the listener synchronous preserves Chrome's sendResponse contract for PAGE_CONTROL.
			getPC().then((pc) => {
				pc.initGazeIndicator()
				window.dispatchEvent(new CustomEvent('PageAgent::UpdateGaze', { detail: { gazeX: message.gazeX, gazeY: message.gazeY } }))
			})
			return
		}
		if (message.type === 'GAZE_INDICATOR_HIDE') {
			window.dispatchEvent(new CustomEvent('PageAgent::HideGazeIndicator'))
			return
		}

		if (message.type !== 'PAGE_CONTROL') {
			// sendResponse({
			// 	success: false,
			// 	error: `[RemotePageController.ContentScript]: Invalid message type: ${message.type}`,
			// })
			return
		}

		const { action, payload } = message
		const methodName = getMethodName(action)
		//RP_DONE: 
		getPC()
			.then((pc: any) => {
				switch (action) {
					case 'get_last_update_time':
					case 'get_browser_state':
					case 'update_tree':
					case 'clean_up_highlights':
					case 'click_element':
					case 'input_text':
					case 'select_option':
					case 'scroll':
					case 'scroll_horizontally':
					case 'execute_javascript':
					case 'get_form_fields':
						pc[methodName](...(payload || []))
							.then((result: any) => sendResponse(result))
							.catch((error: any) =>
								sendResponse({
									success: false,
									error: error instanceof Error ? error.message : String(error),
								})
							)
						break

					default:
						sendResponse({
							success: false,
							error: `Unknown PAGE_CONTROL action: ${action}`,
						})
				}
			})
			.catch((error: any) =>
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
			)

		// Must return true synchronously to keep the sendResponse channel open
		// while the above async chain completes.
		return true
	})
}

function getMethodName(action: string): string {
	switch (action) {
		case 'get_last_update_time':
			return 'getLastUpdateTime' as const
		case 'get_browser_state':
			return 'getBrowserState' as const
		case 'update_tree':
			return 'updateTree' as const
		case 'clean_up_highlights':
			return 'cleanUpHighlights' as const

		// DOM actions

		case 'click_element':
			return 'clickElement' as const
		case 'input_text':
			return 'inputText' as const
		case 'select_option':
			return 'selectOption' as const
		case 'scroll':
			return 'scroll' as const
		case 'scroll_horizontally':
			return 'scrollHorizontally' as const
		case 'execute_javascript':
			return 'executeJavascript' as const
		case 'get_form_fields':
			return 'getFormFields' as const

		default:
			return action
	}
}
