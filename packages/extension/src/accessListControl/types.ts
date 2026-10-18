/**
 * Core types for the Tab Access Policy Engine.
 *
 * These types define the contract for static rules, runtime context,
 * plugin heuristics, and decision outcomes.
 */
export type Host = string

/** A wildcard or exact-match pattern (e.g. `"*.bank.com"`, `"example.com"`). */
export type Pattern = string

/** The binary access decision. */
export type Decision = 'ALLOW' | 'BLOCK'

/** Static policy configuration consumed by RulesEngine. */
export interface PolicyConfig {
  denylist: Pattern[]
  allowlist: Pattern[]
  strictMode?: boolean
}

/** Runtime context evaluated by the PolicyEngine. */
export interface PolicyContext {
  url: string
  host: string
  dom?: DocumentSnapshot
  /** Set to true when the action was triggered by an explicit user gesture (click, keyboard, etc.). */
  userGesture?: boolean
}

/** Lightweight DOM snapshot built for heuristic plugins. */
export interface DocumentSnapshot {
  hasPasswordFields: boolean
  hasLoginForm: boolean
  hasSensitiveFields: boolean
  textSample: string
}

/** A heuristic plugin that inspects PolicyContext and optionally returns a decision. */
export interface PolicyPlugin {
  name: string
  evaluate(ctx: PolicyContext): PluginResult | null
}

/** Result returned by a PolicyPlugin when it has an opinion. */
export interface PluginResult {
  decision: Decision
  reason?: string
}

/** Structured record of why a decision was made. */
export interface DecisionRecord {
  url: string
  host: string
  decision: Decision
  source: 'allowlist' | 'denylist' | 'plugin' | 'default'
  ruleOrPlugin?: string
  reason?: string
  timestamp: string
}

/** User-customisable overrides persisted in extension settings. */
export interface UserPolicyOverrides {
  allowlist?: string[]
  denylist?: string[]
  region?: string
}