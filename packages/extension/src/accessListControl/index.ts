/**
 * Access List Control - Tab Access Policy Engine
 *
 * A production-ready policy engine for deciding whether the extension
 * is allowed to read or process page content. Prevents access to
 * sensitive sites (banking, government, tax, identity) while still
 * allowing explicit user-approved exceptions through an allowlist.
 *
 * Architecture:
 * - Matcher: host normalisation and wildcard pattern matching
 * - RulesEngine: static allowlist/denylist evaluation
 * - PluginRunner: pluggable heuristic plugins
 * - PolicyEngine: coordinates rules + plugins with fail-closed default
 * - PolicyLoader: merges global, regional, and user override configs
 *
 * Usage:
 * ```ts
 * import { PolicyEngine, DEFAULT_DENYLIST, DEFAULT_ALLOWLIST } from '@/accessListControl'
 * import { PasswordFieldPlugin, LoginFormPlugin, KeywordPlugin } from '@/accessListControl'
 * ```
 */
export { Matcher } from './matcher'
export { RulesEngine } from './rules-engine'
export {
  PluginRunner,
  buildSnapshot,
  PasswordFieldPlugin,
  // LoginFormPlugin,
  SensitiveFieldPlugin,
  KeywordPlugin,
} from './plugins'
export { PolicyEngine } from './policy-engine'
export { mergePolicyConfig, DEFAULT_DENYLIST, DEFAULT_ALLOWLIST } from './policy-loader'
export type { PolicyFile } from './policy-loader'
export type {
  Host,
  Pattern,
  Decision,
  PolicyConfig,
  PolicyContext,
  DocumentSnapshot,
  PolicyPlugin,
  PluginResult,
  DecisionRecord,
  UserPolicyOverrides,
} from './types'