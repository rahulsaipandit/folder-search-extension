import { FolderSearch } from './components/FolderSearch/FolderSearch'
import { ReviewPrompt } from './components/ReviewPrompt'

/**
 * The side panel is Folder Search and nothing else: there is no agent chat, so there is no view
 * router, back button or provider setup here. Settings live on the Manage page (gear in the header).
 * `ReviewPrompt` counts side panel opens only (design: docs/designGuidelines.md §5).
 */
export default function App() {
	return (
		<div className="h-screen overflow-y-auto bg-background text-foreground">
			<FolderSearch />
			<ReviewPrompt />
		</div>
	)
}
