import type { DownloadSnapshot } from './modelCatalog'
import type { IndexProgress } from './types'

/** `chrome.runtime` message type the offscreen document broadcasts to open Folder Search pages. */
export const FOLDER_EVENT = 'folder:event'

export type FolderEvent =
	| { event: 'index-progress'; progress: IndexProgress }
	| { event: 'model-progress'; snapshot: DownloadSnapshot }
