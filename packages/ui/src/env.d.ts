/// <reference types="vite/client" />

declare module '*.module.css' {
	const classes: Record<string, string>
	export default classes
}

// Stub for defuddle-js (used by extension skill implementations transitively included via panel imports)
declare module 'defuddle-js' {
	export class Defuddle {
		static parse(html: string | Document, options?: { url?: string }): {
			contentMarkdown?: string
			content?: string
			title?: string
			author?: string
			datePublished?: string
			[key: string]: unknown
		}
	}
}
