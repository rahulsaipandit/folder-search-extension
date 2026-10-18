/**
 * Main decision pipeline combining static rules and heuristic plugins.
 *
 * Decision model: ALLOW only if ALL checks pass.
 *
 * Evaluation order (fail-closed):
 * 1. Denylist check - BLOCK if host matches any denylist pattern
 * 2. Allowlist check - if the host is explicitly allowlisted, it is a
 *    trusted carve-out and skips plugin heuristics entirely (see below)
 * 3. Plugin heuristics - BLOCK if any plugin detects a risk
 * 4. Pass all checks → ALLOW
 * 5. (Optional) User-gesture gate - only ALLOW if user explicitly triggered the action
 *
 * This is deliberately conservative: the only way to get ALLOW is to
 * pass every gate. Any single failure results in BLOCK.
 */
import { PluginRunner } from './plugins'
import { RulesEngine } from './rules-engine'
import type { Decision, PolicyConfig, PolicyContext, PolicyPlugin } from './types'

export interface PolicyEngineOptions {
	/**
	 * If true, ALLOW is only returned when a user-gesture flag is set
	 * in the PolicyContext. This prevents automated/silent access even
	 * on pages that pass all other checks.
	 *
	 * @default false
	 */
	requireUserGesture?: boolean
}

export class PolicyEngine {
	private rules: RulesEngine
	private plugins: PluginRunner
	private options: PolicyEngineOptions

	constructor(
		config: PolicyConfig,
		plugins: PolicyPlugin[] = [],
		options: PolicyEngineOptions = {}
	) {
		this.rules = new RulesEngine(config)
		this.plugins = new PluginRunner(plugins)
		this.options = options
	}

	/**
	 * Evaluate a URL and optional DOM snapshot, returning a decision.
	 *
	 * ALLOW is returned **only** when:
	 * - The host is NOT in the denylist (or is in the allowlist override)
	 * - No heuristic plugin detects a risk
	 * - (Optional) A user gesture is present in the context
	 *
	 * Any single failure → BLOCK.
	 *
	 * @param ctx - Runtime context with URL, host, and optional DOM snapshot.
	 * @returns An object with decision and optional reason.
	 */
	evaluate(ctx: PolicyContext): { decision: Decision; reason?: string } {
		// ── 1. Denylist check ──────────────────────────────────────────
		// If the host is explicitly denied by the denylist, block immediately.
		// Note: allowlist is checked first by RulesEngine, so explicitly
		// allowed hosts return ALLOW here rather than falling into this branch.
		const ruleResult = this.rules.evaluate(ctx.host)
		if (ruleResult?.decision === 'BLOCK')
			return {
				decision: 'BLOCK',
				reason: (ruleResult as { decision: Decision; reason: string }).reason,
			}

		// ── 2. Explicit allowlist override ─────────────────────────────
		// A host on the allowlist is a deliberate user/operator carve-out
		// (e.g. a domain that legitimately discusses financial terms but is
		// known-trusted, like an archive mirror). Skip plugin heuristics
		// entirely for these hosts - otherwise the allowlist would be useless
		// for exactly the pages it's meant to unblock, since page-content
		// heuristics like KeywordPlugin fire independently of the host.
		if (ruleResult?.decision === 'ALLOW') {
			if (this.options.requireUserGesture && !ctx.userGesture) {
				return { decision: 'BLOCK', reason: 'User gesture required' }
			}
			return { decision: 'ALLOW' }
		}

		// ── 3. Plugin heuristics ──────────────────────────────────────
		// Host is neither denylisted nor allowlisted. Run all plugins - if
		// any detects a risk (password field, sensitive keyword, login
		// form, etc.), block.
		const pluginResult = this.plugins.run(ctx)
		if (pluginResult) return { decision: pluginResult.decision, reason: pluginResult.reason }

		// ── 4. Passed all checks → (Optional) User-gesture gate ──────
		if (this.options.requireUserGesture && !ctx.userGesture) {
			return { decision: 'BLOCK', reason: 'User gesture required' }
		}

		// ── 5. ALLOW ──────────────────────────────────────────────────
		return { decision: 'ALLOW' }
	}
}
