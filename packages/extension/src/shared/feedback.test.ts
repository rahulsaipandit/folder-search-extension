import { describe, expect, it, vi } from 'vitest'

import { buildFormBody, extensionLabel, submitFeedback, tooFast, validateFeedback } from './feedback'
import { isReviewPromptEnabled, readFeedbackFormConfig, readStoreExtensionId, storeReviewUrl, TEMP_STORE_EXTENSION_ID } from './reviewConfig'

const cfg = {
	formId: 'FORM_ID',
	entries: { extension: 'entry.1', name: 'entry.2', email: 'entry.3', message: 'entry.4' },
}
const good = { extension: 'Folder Search', name: 'Ada', email: '', message: 'Great' }

describe('validateFeedback', () => {
	it('accepts an empty email but rejects a malformed one', () => {
		expect(validateFeedback(good)).toEqual([])
		expect(validateFeedback({ ...good, email: 'ada@example.com' })).toEqual([])
		expect(validateFeedback({ ...good, email: 'ada@' })).toEqual(['email'])
	})
	it('requires name and message, ignoring whitespace-only input', () => {
		expect(validateFeedback({ ...good, name: '  ', message: '\n' })).toEqual(['name', 'message'])
	})
})

describe('submitFeedback', () => {
	it('posts url-encoded entries to the formResponse url with no-cors', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({})
		await submitFeedback(cfg, { ...good, message: ' a & b ' }, fetchImpl)
		const [url, init] = fetchImpl.mock.calls[0]!
		expect(url).toBe('https://docs.google.com/forms/d/e/FORM_ID/formResponse')
		expect(init.method).toBe('POST')
		expect(init.mode).toBe('no-cors')
		expect((init.body as URLSearchParams).toString()).toBe(
			buildFormBody(cfg, { ...good, message: 'a & b' }).toString()
		)
		expect((init.body as URLSearchParams).get('entry.4')).toBe('a & b')
		expect((init.body as URLSearchParams).get('entry.1')).toBe('Folder Search')
	})
	it('surfaces a network failure to the caller', async () => {
		await expect(submitFeedback(cfg, good, vi.fn().mockRejectedValue(new TypeError('offline')))).rejects.toThrow('offline')
	})
})

describe('spam and labels', () => {
	it('flags an instant submit', () => {
		expect(tooFast(300)).toBe(true)
		expect(tooFast(20_000)).toBe(false)
	})
	it('reads ext from the query string with a fallback', () => {
		expect(extensionLabel('?ext=Folder%20Search', 'x')).toBe('Folder Search')
		expect(extensionLabel('', 'Fallback')).toBe('Fallback')
	})
})

describe('review config', () => {
	it('is off unless the flag is exactly "true"', () => {
		expect(isReviewPromptEnabled({})).toBe(false)
		expect(isReviewPromptEnabled({ WXT_REVIEW_PROMPT_ENABLED: 'false' })).toBe(false)
		expect(isReviewPromptEnabled({ WXT_REVIEW_PROMPT_ENABLED: '1' })).toBe(false)
		expect(isReviewPromptEnabled({ WXT_REVIEW_PROMPT_ENABLED: ' True ' })).toBe(true)
	})
	it('uses the temporary store id until the env sets one, and builds the reviews url from the id', () => {
		expect(readStoreExtensionId({})).toBe(TEMP_STORE_EXTENSION_ID)
		expect(readStoreExtensionId({ WXT_STORE_EXTENSION_ID: ' abc ' })).toBe('abc')
		expect(storeReviewUrl('abc')).toBe('https://chromewebstore.google.com/detail/abc/reviews')
	})
	it('returns null when any form value is missing, so the prompt stays hidden', () => {
		const env = {
			WXT_FEEDBACK_FORM_ID: 'F',
			WXT_FEEDBACK_FORM_ENTRY_EXTENSION: 'entry.1',
			WXT_FEEDBACK_FORM_ENTRY_NAME: 'entry.2',
			WXT_FEEDBACK_FORM_ENTRY_EMAIL: 'entry.3',
			WXT_FEEDBACK_FORM_ENTRY_MESSAGE: 'entry.4',
		}
		expect(readFeedbackFormConfig(env)).toEqual({
			formId: 'F',
			entries: { extension: 'entry.1', name: 'entry.2', email: 'entry.3', message: 'entry.4' },
		})
		expect(readFeedbackFormConfig({ ...env, WXT_FEEDBACK_FORM_ENTRY_EMAIL: '' })).toBeNull()
	})
})
