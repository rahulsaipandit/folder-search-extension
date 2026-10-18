/**
 * Static rules engine for allowlist and denylist evaluation.
 *
 * Allowlist takes precedence over denylist so users can safely carve
 * out trusted hosts from broad wildcard blocks.
 */
import { Matcher } from './matcher'
import type { Decision, PolicyConfig } from './types'

export class RulesEngine {
  private config: PolicyConfig

  constructor(config: PolicyConfig) {
    this.config = config
  }

  /** Returns true if the host matches any allowlist pattern. */
  isAllowed(host: string): boolean {
    return this.config.allowlist.some((p) => Matcher.matches(host, p))
  }

  /** Returns true if the host matches any denylist pattern. */
  isDenied(host: string): boolean {
    return this.config.denylist.some((p) => Matcher.matches(host, p))
  }

  /**
   * Evaluate a host against the static rules.
   *
   * - `{ decision: 'ALLOW' }` if host is on the allowlist
   * - `{ decision: 'BLOCK', reason: 'Host matches denylist' }` if host is on the denylist (and not on the allowlist)
   * - `null` if no static rule applies
   *
   * Allowlist wins over denylist per design.
   */
  evaluate(host: string): { decision: Decision } | { decision: Decision; reason: string } | null {
    if (this.isAllowed(host)) return { decision: 'ALLOW' }
    if (this.isDenied(host)) return { decision: 'BLOCK', reason: 'Host matches denylist' }
    return null
  }
}