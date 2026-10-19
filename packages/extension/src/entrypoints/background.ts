/**
 * Folder Search has no background logic of its own: indexing and search run in the offscreen
 * document, and all state lives in IndexedDB. The service worker only makes the toolbar icon open
 * the side panel.
 */
export default defineBackground(() => {
	chrome.sidePanel
		.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) => console.error('[Background] setPanelBehavior failed:', err))
})
