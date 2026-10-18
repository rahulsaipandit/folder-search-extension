/**
 * IOAuth2Provider - contract for OAuth 2.0 + PKCE token providers.
 *
 * Used by transports to inject Authorization headers at call time,
 * enabling silent token refresh without restarting the connection.
 *
 * Implementations:
 *   - OAuth2PKCEProvider: PKCE flow for web + React Native
 *
 * Platforms: Web + React Native (no Node.js-specific APIs).
 */

export interface IOAuth2Provider {
  /**
   * Return a valid access token.
   * Implementations should handle token refresh transparently.
   * Rejects if authentication is required and no valid token is available.
   */
  getAccessToken(): Promise<string>

  /**
   * Initiate the OAuth authorization flow (open browser / deep link).
   * Should be called when getAccessToken() throws to prompt the user.
   */
  authorize(): Promise<void>

  /**
   * Handle the redirect callback after the user grants access.
   * Pass the full redirect URL (including code and state params).
   * Returns the access token on success.
   */
  handleRedirect(redirectUrl: string): Promise<string>

  /**
   * Clear stored tokens (logout).
   */
  revokeTokens(): Promise<void>

  /**
   * True if we currently have a valid (or refreshable) access token.
   */
  readonly isAuthenticated: boolean
}
