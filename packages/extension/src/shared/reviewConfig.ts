/**
 * Where the review prompt sends people. Nothing is hardcoded in components: the store id and the
 * Google Form identifiers come from the env file (`WXT_*`, see `.env.example`). Design: docs/designGuidelines.md §5.
 */

/**
 * TEMPORARY: the id supplied for development (its listing slug is `flightpulse`). Delete this fallback
 * and set `WXT_STORE_EXTENSION_ID` once the extension is published.
 */
export const TEMP_STORE_EXTENSION_ID = 'hkknnlcdijjfcloilldhnbibjkakfmpo'

export interface FeedbackFormConfig {
	/** Public form id: the `/d/e/<id>/` segment of the published link (not the editor id). */
	formId: string
	/** Google Forms field names, e.g. `entry.776165306`. */
	entries: { extension: string; name: string; email: string; message: string }
}

type Env = Record<string, string | undefined>

export function storeReviewUrl(extensionId: string): string {
	return `https://chromewebstore.google.com/detail/${encodeURIComponent(extensionId)}/reviews`
}

export function formResponseUrl(formId: string): string {
	return `https://docs.google.com/forms/d/e/${encodeURIComponent(formId)}/formResponse`
}

/** Feature flag. Opt-in: only the exact value `true` enables the prompt, so a missing env file means off. */
export function isReviewPromptEnabled(env: Env): boolean {
	return env.WXT_REVIEW_PROMPT_ENABLED?.trim().toLowerCase() === 'true'
}

export function readStoreExtensionId(env: Env): string {
	return env.WXT_STORE_EXTENSION_ID?.trim() || TEMP_STORE_EXTENSION_ID
}

/** `null` when any form value is missing: the prompt then stays hidden rather than linking to a wrong place. */
export function readFeedbackFormConfig(env: Env): FeedbackFormConfig | null {
	const get = (k: string) => env[k]?.trim() || undefined
	const formId = get('WXT_FEEDBACK_FORM_ID')
	const extension = get('WXT_FEEDBACK_FORM_ENTRY_EXTENSION')
	const name = get('WXT_FEEDBACK_FORM_ENTRY_NAME')
	const email = get('WXT_FEEDBACK_FORM_ENTRY_EMAIL')
	const message = get('WXT_FEEDBACK_FORM_ENTRY_MESSAGE')
	if (!formId || !extension || !name || !email || !message) return null
	return { formId, entries: { extension, name, email, message } }
}

export function reviewPromptEnabled(): boolean {
	return isReviewPromptEnabled(import.meta.env as Env)
}

export function getStoreReviewUrl(): string {
	return storeReviewUrl(readStoreExtensionId(import.meta.env as Env))
}

export function getFeedbackFormConfig(): FeedbackFormConfig | null {
	const cfg = readFeedbackFormConfig(import.meta.env as Env)
	if (!cfg) console.warn('[review] WXT_FEEDBACK_FORM_* is not set in the env file; the review prompt is disabled.')
	return cfg
}
