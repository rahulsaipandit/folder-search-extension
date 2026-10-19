/**
 * Feedback form submission (design docs/designGuidelines.md §5). Posts to a Google Form with
 * `no-cors`, so no host permission is needed and the response is opaque: delivery cannot be confirmed.
 */
import { type FeedbackFormConfig, formResponseUrl } from './reviewConfig'

export interface FeedbackFields {
	extension: string
	name: string
	email: string
	message: string
}

export type FeedbackField = 'name' | 'email' | 'message'

/** Same shape check the form applies server-side; a bad address makes Google drop the response silently. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Fields that fail validation. Email is optional but must be well formed when present. */
export function validateFeedback(f: FeedbackFields): FeedbackField[] {
	const bad: FeedbackField[] = []
	if (!f.name.trim()) bad.push('name')
	if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) bad.push('email')
	if (!f.message.trim()) bad.push('message')
	return bad
}

export function buildFormBody(cfg: FeedbackFormConfig, f: FeedbackFields): URLSearchParams {
	const body = new URLSearchParams()
	body.set(cfg.entries.extension, f.extension.trim())
	body.set(cfg.entries.name, f.name.trim())
	body.set(cfg.entries.email, f.email.trim())
	body.set(cfg.entries.message, f.message.trim())
	return body
}

/** Rejects only when the request itself fails (offline, blocked); an opaque response counts as sent. */
export async function submitFeedback(
	cfg: FeedbackFormConfig,
	f: FeedbackFields,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await fetchImpl(formResponseUrl(cfg.formId), { method: 'POST', mode: 'no-cors', body: buildFormBody(cfg, f) })
}

/** Anything faster than this after the page opened is a bot, not someone typing a message. */
export const MIN_FILL_MS = 2000

/** An implausibly fast submit. A filled honeypot is checked separately by the page. */
export function tooFast(elapsedMs: number): boolean {
	return elapsedMs < MIN_FILL_MS
}

/** The `ext` query value, falling back to the extension's own name so the form field is never empty. */
export function extensionLabel(search: string, fallback: string): string {
	return new URLSearchParams(search).get('ext')?.trim() || fallback
}
