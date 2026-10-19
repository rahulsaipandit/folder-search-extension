import { describe, expect, it } from 'vitest'

import {
	DEFAULT_ALLOWLIST,
	DEFAULT_DENYLIST,
	KeywordPlugin,
	Matcher,
	PasswordFieldPlugin,
	PolicyEngine,
	SensitiveFieldPlugin,
	mergePolicyConfig,
} from './index'
import type { DocumentSnapshot, PolicyContext } from './index'
import type { PolicyFile } from './policy-loader'

const dom = (over: Partial<DocumentSnapshot> = {}): DocumentSnapshot => ({
	hasPasswordFields: false,
	hasLoginForm: false,
	hasSensitiveFields: false,
	textSample: '',
	...over,
})
const ctx = (host: string, over: Partial<PolicyContext> = {}): PolicyContext => ({
	url: `https://${host}/`,
	host,
	...over,
})
const plugins = () => [new PasswordFieldPlugin(), new SensitiveFieldPlugin(), new KeywordPlugin()]
const engine = (config = { denylist: ['*.bank.test'], allowlist: ['ok.bank.test'] }, opts = {}) =>
	new PolicyEngine(config, plugins(), opts)

describe('Matcher', () => {
	it('ignores case and a leading www., and treats *.x as the apex plus every subdomain', () => {
		expect(Matcher.matches('WWW.Chase.com', '*.chase.com')).toBe(true)
		expect(Matcher.matches('chase.com', '*.chase.com')).toBe(true)
		expect(Matcher.matches('secure.chase.com', '*.chase.com')).toBe(true)
	})

	it('does not match look-alike domains or substrings', () => {
		expect(Matcher.matches('notchase.com', '*.chase.com')).toBe(false)
		expect(Matcher.matches('chase.com.evil.io', '*.chase.com')).toBe(false)
		expect(Matcher.matches('a.example.com', 'example.com')).toBe(false)
	})
})

describe('PolicyEngine', () => {
	it('blocks denylisted hosts regardless of page content', () => {
		const r = engine().evaluate(ctx('login.bank.test', { dom: dom() }))
		expect(r).toEqual({ decision: 'BLOCK', reason: 'Host matches denylist' })
	})

	it('lets an allowlisted host override a broader denylist wildcard', () => {
		expect(engine().evaluate(ctx('ok.bank.test')).decision).toBe('ALLOW')
	})

	it('skips page heuristics for allowlisted hosts (the deliberate carve-out)', () => {
		const sensitive = dom({ hasPasswordFields: true, hasSensitiveFields: true, textSample: 'credit card ssn' })
		expect(engine().evaluate(ctx('ok.bank.test', { dom: sensitive })).decision).toBe('ALLOW')
	})

	it('blocks unknown hosts when a plugin finds a password field or a sensitive field', () => {
		expect(engine().evaluate(ctx('shop.test', { dom: dom({ hasPasswordFields: true }) })).decision).toBe('BLOCK')
		expect(engine().evaluate(ctx('shop.test', { dom: dom({ hasSensitiveFields: true }) })).decision).toBe('BLOCK')
	})

	it('needs two distinct sensitive terms before the keyword scan blocks', () => {
		const one = dom({ textSample: 'We mention a tax return once.' })
		const two = dom({ textSample: 'Enter your credit card and bank account here.' })
		expect(engine().evaluate(ctx('blog.test', { dom: one })).decision).toBe('ALLOW')
		expect(engine().evaluate(ctx('blog.test', { dom: two })).decision).toBe('BLOCK')
	})

	it('uses word boundaries, so ordinary words are not mistaken for terms', () => {
		const benign = dom({ textSample: 'hotpot adoption ssnake 2fast' })
		expect(engine().evaluate(ctx('food.test', { dom: benign })).decision).toBe('ALLOW')
	})

	it('allows a clean unknown page, but only with a user gesture when one is required', () => {
		const gated = engine(undefined, { requireUserGesture: true })
		expect(engine().evaluate(ctx('clean.test', { dom: dom() })).decision).toBe('ALLOW')
		expect(gated.evaluate(ctx('clean.test', { dom: dom() }))).toEqual({
			decision: 'BLOCK',
			reason: 'User gesture required',
		})
		expect(gated.evaluate(ctx('clean.test', { dom: dom(), userGesture: true })).decision).toBe('ALLOW')
	})

	it('applies the gesture gate to allowlisted hosts too', () => {
		const gated = engine(undefined, { requireUserGesture: true })
		expect(gated.evaluate(ctx('ok.bank.test')).decision).toBe('BLOCK')
	})
})

describe('default lists', () => {
	const real = () => new PolicyEngine({ denylist: DEFAULT_DENYLIST, allowlist: DEFAULT_ALLOWLIST }, plugins())

	it('block a major bank and its subdomains', () => {
		expect(real().evaluate(ctx('secure.chase.com')).decision).toBe('BLOCK')
	})

	it('let archive mirrors through even when the cached text mentions finance terms', () => {
		const text = dom({ textSample: 'credit card bank account tax return' })
		expect(real().evaluate(ctx('web.archive.ph', { dom: text })).decision).toBe('ALLOW')
	})
})

describe('mergePolicyConfig', () => {
	const file = (patterns: string[]): PolicyFile => ({ version: 1, region: 'x', description: '', updatedAt: '', patterns })

	it('concatenates global, regional and user lists for both allow and deny', () => {
		const cfg = mergePolicyConfig(file(['a.com']), file(['b.com']), file(['c.com']), file(['d.com']), {
			denylist: ['e.com'],
			allowlist: ['f.com'],
		})
		expect(cfg.denylist).toEqual(['a.com', 'c.com', 'e.com'])
		expect(cfg.allowlist).toEqual(['b.com', 'd.com', 'f.com'])
	})

	it('works with no region and no overrides', () => {
		expect(mergePolicyConfig(file(['a.com']), file([]), null, null)).toEqual({ denylist: ['a.com'], allowlist: [] })
	})
})
