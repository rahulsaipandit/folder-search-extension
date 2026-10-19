declare module 'defuddle-js' {
	// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- mirrors the real defuddle-js class shape (static-only API)
	export class Defuddle {
		static parse(
			html: string | Document,
			options?: { url?: string }
		): {
			contentMarkdown?: string
			content?: string
			title?: string
			author?: string
			datePublished?: string
			[key: string]: unknown
		}
	}
}
