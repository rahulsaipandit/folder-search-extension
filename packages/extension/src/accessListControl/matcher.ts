/**
 * Host normalisation and wildcard pattern matching.
 *
 * Hostnames are lowercased and normalised by stripping a leading `www.`
 * prefix before comparison. Patterns may be exact hosts or wildcard
 * entries such as `*.domain.com`.
 *
 * Security note:
 * Wildcard patterns (`*.example.com`) also match the root apex domain
 * (`example.com`). This is critical because `www.example.com` normalises
 * to `example.com`, but `"example.com".endsWith(".example.com")` is false.
 * Without the explicit apex check, every www. variant of every denylisted
 * domain would silently bypass the denylist.
 */
import type { Host, Pattern } from './types'

export const Matcher = {
  /**
   * Normalise a hostname: lowercase it and strip leading `www.`.
   */
  normalize(host: string): Host {
    return host.toLowerCase().replace(/^www\./, '')
  },

  /**
   * Test whether a host matches a pattern.
   *
   * - `*.example.com` matches any subdomain (e.g. `a.example.com`)
   *   AND the root apex domain (`example.com`) - this ensures
   *   `www.example.com` normalises to `example.com` and still matches.
   * - `example.com` matches only the exact normalised host.
   */
  matches(host: string, pattern: Pattern): boolean {
    const normalisedHost = this.normalize(host)
    const normalisedPattern = pattern.toLowerCase()

    if (normalisedPattern.startsWith('*.')) {
      // Check both suffix match (subdomain.example.com) and apex match (example.com).
      // Without the apex check, www.example normalises to example.com but
      // "example.com".endsWith(".example.com") returns false.
      const suffix = normalisedPattern.slice(1) // ".example.com"
      const apex = normalisedPattern.slice(2) // "example.com"
      return normalisedHost.endsWith(suffix) || normalisedHost === apex
    }

    return normalisedHost === normalisedPattern
  },
}