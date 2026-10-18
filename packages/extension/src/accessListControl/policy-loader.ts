/**
 * Policy loading and merge semantics.
 *
 * Assembles the final `PolicyConfig` by merging bundled global, regional,
 * and user override lists. Merge order ensures allowlist entries take
 * precedence over denylist entries at evaluation time (handled by RulesEngine).
 *
 * Merge order:
 * 1. Global denylist
 * 2. Region denylist
 * 3. Global allowlist
 * 4. Region allowlist
 * 5. User allow overrides
 * 6. User deny overrides (if supported)
 */
import type { Pattern, PolicyConfig, UserPolicyOverrides } from './types'

/** JSON schema for individual policy files. */
export interface PolicyFile {
	version: number
	region: string
	description: string
	updatedAt: string
	patterns: Pattern[]
}

/**
 * Assemble a `PolicyConfig` by merging global, regional, and user override lists.
 *
 * @param globalDenylist - Global denylist patterns file.
 * @param globalAllowlist - Global allowlist patterns file.
 * @param regionDenylist - Region-specific denylist (nullable).
 * @param regionAllowlist - Region-specific allowlist (nullable).
 * @param userOverrides  - Optional user-supplied overrides.
 * @returns The merged PolicyConfig.
 */
export function mergePolicyConfig(
	globalDenylist: PolicyFile,
	globalAllowlist: PolicyFile,
	regionDenylist: PolicyFile | null,
	regionAllowlist: PolicyFile | null,
	userOverrides: UserPolicyOverrides = {}
): PolicyConfig {
	const denylist: Pattern[] = [
		...globalDenylist.patterns,
		...(regionDenylist ? regionDenylist.patterns : []),
		...(userOverrides.denylist || []),
	]

	const allowlist: Pattern[] = [
		...globalAllowlist.patterns,
		...(regionAllowlist ? regionAllowlist.patterns : []),
		...(userOverrides.allowlist || []),
	]

	return { denylist, allowlist }
}

/**
 * Default denylist covering sensitive categories across finance, government,
 * healthcare, identity, payroll, crypto, and SSO/Auth providers.
 *
 * Categories:
 * - Banking & Finance: major banks, brokerages, payment providers
 * - Government / Identity: SSA, IRS, DMV, login.gov, ID.me, USCIS, VA
 * - Healthcare: insurance portals, medical record systems
 * - Auth / SSO: Google Accounts, Microsoft login, Okta, Auth0
 * - Payroll / HR: Workday, ADP, Gusto
 * - Crypto / Wallets: Coinbase, Binance, MetaMask, Ledger
 *
 * These are illustrative starter data, not a complete production denylist.
 */
export const DEFAULT_DENYLIST: Pattern[] = [
	// ── Banking & Finance: major banks ──
	'*.bank',
	'*.bankofamerica.com',
	'*.chase.com',
	'*.wellsfargo.com',
	'*.citi.com',
	'*.citibank.com',
	'*.usbank.com',
	'*.pnc.com',
	'*.capitalone.com',
	'*.americanexpress.com',
	'*.discover.com',

	// ── Banking & Finance: brokerages ──
	'*.robinhood.com',
	'*.etrade.com',
	'*.fidelity.com',
	'*.vanguard.com',
	'*.schwab.com',

	// ── Banking & Finance: payment providers ──
	'*.paypal.com',
	'*.venmo.com',
	'*.cash.app',
	'*.squareup.com',
	'*.stripe.com',

	// ── Government / Identity ──
	'*.irs.gov',
	'*.ssa.gov',
	'*.uscis.gov',
	'*.treasury.gov',
	'*.usa.gov',
	'*.va.gov',
	'*.healthcare.gov',
	'*.medicare.gov',
	'*.gov', // catches *.gov.uk, *.gov.in, *.gov.au etc.
	'*.dmv.org',
	'*.dmv.ca.gov',
	'*.login.gov',
	'*.id.me',

	// ── Healthcare: insurance portals ──
	'*.aetna.com',
	'*.cigna.com',
	'*.bcbs.com',
	'*.unitedhealthgroup.com',
	'*.uhc.com',

	// ── Healthcare: medical record systems ──
	'*.mychart.com',
	'*.kaiserpermanente.org',
	'*.epic.com',

	// ── Auth / SSO ──
	'login.live.com',
	'login.microsoftonline.com',
	'signin.aws.amazon.com',
	'appleid.apple.com',
	'login.yahoo.com',
	'accounts.paypal.com',
	'accounts.google.com',
	'*.okta.com',
	'*.auth0.com',

	// ── Payroll / HR ──
	'*.workday.com',
	'*.myworkday.com',
	'*.adp.com',
	'*.gusto.com',

	// ── Crypto / Wallets ──
	'*.coinbase.com',
	'*.binance.com',
	'*.binance.us',
	'*.metamask.io',
	'*.ledger.com',
	'*.ledgerwallet.com',

	// ── Tax preparation ──
	'*.hrblock.com',
	'*.turbotax.com',
	'*.intuit.com',
	'*.taxact.com',

	// ── Chrome internal ──
	'chrome://settings/*',
]

/**
 * Default allowlist for overriding broad wildcard blocks with specific trusted hosts.
 *
 * Note: matching a pattern here bypasses plugin heuristics entirely (see
 * PolicyEngine.evaluate), not just the denylist. Only add hosts here whose
 * pages are trusted even when their rendered text incidentally contains
 * sensitive-sounding terms.
 */
export const DEFAULT_ALLOWLIST: Pattern[] = [
	'stripe.com',
	'docs.stripe.com',

	// ── Archive mirrors ──
	// archive.ph/archive.today snapshots of paywalled finance/news articles
	// routinely contain cached text like "credit card" or "bank account",
	// which trips KeywordPlugin even though the domain itself is not a
	// sensitive site.
	'*.archive.ph',
	'*.archive.today',
]
