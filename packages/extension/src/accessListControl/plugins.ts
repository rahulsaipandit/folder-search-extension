/**
 * Heuristic plugin system and built-in plugins for runtime page inspection.
 */
import type { DocumentSnapshot, PluginResult, PolicyContext, PolicyPlugin } from './types'

/** Executes plugins in order and returns the first non-null result. */
export class PluginRunner {
	private plugins: PolicyPlugin[]

	constructor(plugins: PolicyPlugin[] = []) {
		this.plugins = plugins
	}

	run(ctx: PolicyContext): PluginResult | null {
		for (const plugin of this.plugins) {
			const result = plugin.evaluate(ctx)
			if (result) return result
		}
		return null
	}
}

// ---------------------------------------------------------------------------
// DOM Snapshot builder (content-script side)
// ---------------------------------------------------------------------------

/**
 * Build a lightweight DocumentSnapshot from the current page DOM.
 *
 * Scans for password fields, login forms, and sensitive input fields
 * (SSN, credit card, routing number, etc.). Also collects a bounded
 * text sample for keyword analysis.
 *
 * Safe-guarded: returns an empty snapshot if `document` is unavailable
 * (e.g., called from a non-browser context).
 *
 * Use this in the Chrome content script before invoking the engine.
 */
export function buildSnapshot(): DocumentSnapshot {
	if (typeof document === 'undefined') {
		return {
			hasPasswordFields: false,
			hasLoginForm: false,
			hasSensitiveFields: false,
			textSample: '',
		}
	}

	return {
		hasPasswordFields: !!document.querySelector('input[type="password"]'),
		hasLoginForm: detectLoginForm(),
		hasSensitiveFields: containsSensitiveFields(),
		textSample: document.body?.innerText?.slice(0, 50000) || '',
	}
}

/**
 * Detect whether the page contains a login/authentication form rather
 * than just any generic `<form>`. This avoids false positives on
 * comment forms, search bars, newsletter signups, etc.
 *
 * Heuristics (any match = login form):
 * 1. A password field exists inside a `<form>`
 * 2. A form's `name` or `id` matches login/auth patterns
 * 3. A form contains a submit button labelled "log in", "sign in", etc.
 */
function detectLoginForm(): boolean {
	// Heuristic 1: form contains a password field
	const formsWithPassword = document.querySelectorAll('form input[type="password"]')
	if (formsWithPassword.length > 0) return true

	const loginPatterns = [
		/login/i,
		/sign[-\s]?in/i,
		/log[-\s]?in/i,
		/auth/i,
		/authenticate/i,
		/sign[-\s]?on/i,
		/credentials/i,
		/mfa/i,
		/2fa/i,
		/otp/i,
		/sso/i,
	]

	// Heuristic 2: form name/id matches login patterns
	const forms = document.querySelectorAll<HTMLFormElement>('form[name], form[id]')
	for (const form of forms) {
		const nameOrId = `${form.name} ${form.id}`
		if (loginPatterns.some((p) => p.test(nameOrId))) return true
	}

	// Heuristic 3: submit button text matches login patterns
	const submitButtons = document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
		'input[type="submit"], button[type="submit"], button:not([type])'
	)
	for (const btn of submitButtons) {
		const label = (btn as HTMLInputElement).value || (btn as HTMLButtonElement).textContent || ''
		if (loginPatterns.some((p) => p.test(label))) return true
	}

	return false
}

/**
 * Check whether the DOM contains input fields whose `name`, `id`,
 * `aria-label`, or wrapping `<label>` text suggests they carry
 * sensitive data.
 */
function containsSensitiveFields(): boolean {
	// Field-name/label patterns, tightened to the specific terms sites use for
	// sensitive inputs. Bare words like "credit" or "routing" previously
	// matched unrelated fields (e.g. "credits" on a course-signup form, or
	// "routing" in a shipping/logistics context), so those were narrowed to
	// their compound forms ("credit card", "routing number").
	const sensitivePatterns = [
		/\bssn\b/i,
		/social.?security/i,
		/credit.?card/i,
		/card.?number/i,
		/cvv/i,
		/cvc/i,
		/routing.?number/i,
		/account.?number/i,
		/bank.?account/i,
		/tax.?id/i,
		/\bein\b/i,
		/passport/i,
		/driver.?licen[cs]e/i,
	]

	const inputs = document.querySelectorAll<HTMLInputElement>(
		'input[name], input[id], input[aria-label]'
	)

	return Array.from(inputs).some((input) => {
		const nameOrId = `${input.name} ${input.id} ${input.getAttribute('aria-label') || ''}`
		if (sensitivePatterns.some((pattern) => pattern.test(nameOrId))) return true

		// Check the associated <label> element
		if (input.id) {
			const label = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)
			if (label && sensitivePatterns.some((pattern) => pattern.test(label.textContent || ''))) {
				return true
			}
		}

		return false
	})
}

// ---------------------------------------------------------------------------
// Built-in plugins
// ---------------------------------------------------------------------------

/** Blocks pages where a password input (`<input type="password">`) is detected. */
export class PasswordFieldPlugin implements PolicyPlugin {
	name = 'password-field'

	evaluate(ctx: PolicyContext): PluginResult | null {
		if (ctx.dom?.hasPasswordFields) {
			return { decision: 'BLOCK', reason: 'Password field detected' }
		}
		return null
	}
}

/**
 * Blocks pages where a login/authentication form is detected.
 *
 * This is intentionally more targeted than "any `<form>`" - it uses
 * heuristics to distinguish login forms from comment forms, search
 * bars, and newsletter signups.
 */
// export class LoginFormPlugin implements PolicyPlugin {
//   name = 'login-form'
//
//   evaluate(ctx: PolicyContext): PluginResult | null {
//     if (ctx.dom?.hasLoginForm) {
//       return { decision: 'BLOCK', reason: 'Login form detected' }
//     }
//     return null
//   }
// }

/**
 * Blocks pages where sensitive input fields (SSN, credit card, routing
 * number, etc.) are detected via DOM scanning.
 *
 * This provides defence in depth beyond the KeywordPlugin - it catches
 * cases where the field labels are visible in the DOM but not in the
 * rendered text sample.
 */
export class SensitiveFieldPlugin implements PolicyPlugin {
	name = 'sensitive-field'

	evaluate(ctx: PolicyContext): PluginResult | null {
		if (ctx.dom?.hasSensitiveFields) {
			return { decision: 'BLOCK', reason: 'Sensitive input field detected' }
		}
		return null
	}
}

// Word-boundary regexes rather than raw substrings: `'otp'.includes` style
// matching false-positived on ordinary words like "hotpot" or "adoption".
const SENSITIVE_TERM_PATTERNS: readonly [string, RegExp][] = [
	['ssn', /\bssn\b/],
	['social security', /social security/],
	['routing number', /routing number/],
	['credit card', /credit card/],
	['bank account', /bank account/],
	['tax return', /tax return/],
	['otp', /\botp\b/],
	['2fa', /\b2fa\b/],
]

/**
 * Scans page text for sensitive keywords like SSN, bank account, etc.
 *
 * A single incidental mention (e.g. a news/finance article that discusses
 * "credit card" debt or a "tax return" in passing) is common on legitimate,
 * non-sensitive pages and isn't itself evidence of a data-collection form.
 * Requiring two or more distinct terms raises the bar to something closer
 * to an actual sensitive-data context (e.g. a form mentioning both "SSN"
 * and "routing number"), while still catching real sensitive pages, which
 * typically reference several related terms together.
 */
export class KeywordPlugin implements PolicyPlugin {
	name = 'keyword-scan'
	private static readonly MIN_DISTINCT_TERMS = 2

	evaluate(ctx: PolicyContext): PluginResult | null {
		const text = (ctx.dom?.textSample || '').toLowerCase()
		const matched = SENSITIVE_TERM_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
			([term]) => term
		)

		if (matched.length >= KeywordPlugin.MIN_DISTINCT_TERMS) {
			return { decision: 'BLOCK', reason: `Sensitive keywords: ${matched.join(', ')}` }
		}
		return null
	}
}
