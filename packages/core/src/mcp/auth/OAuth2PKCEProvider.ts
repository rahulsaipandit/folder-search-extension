/**
 * OAuth2PKCEProvider - OAuth 2.0 Authorization Code + PKCE flow.
 *
 * Works in:
 *   - Web browsers: uses window.location and sessionStorage for redirect handling.
 *   - React Native / Expo: uses expo-linking for deep link redirect (dynamic import
 *     so this file doesn't break web builds that lack expo-linking).
 *
 * PKCE (RFC 7636) ensures the code_verifier never travels over the wire - only
 * the code_challenge is sent. This makes it safe for public clients (SPAs, mobile).
 *
 * Token storage: tokens are kept in memory only. Callers that need persistence
 * should use MCPStorage to save/load access tokens, then inject them here via
 * `loadTokens()` at startup.
 */

import type { IOAuth2Provider } from './IOAuth2Provider'

export interface OAuth2PKCEConfig {
  authorizationEndpoint: string
  tokenEndpoint: string
  clientId: string
  scopes: string[]
  redirectUri: string
  /** Key used to persist the verifier across the redirect. Default: 'mcp_oauth_verifier' */
  storageKey?: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export class OAuth2PKCEProvider implements IOAuth2Provider {
  private _accessToken: string | null = null
  private _refreshToken: string | null = null
  private _expiresAt: number | null = null
  private readonly _storageKey: string

  private readonly config: OAuth2PKCEConfig

  constructor(config: OAuth2PKCEConfig) {
    this.config = config
    this._storageKey = config.storageKey ?? 'mcp_oauth_verifier'
  }

  get isAuthenticated(): boolean {
    if (!this._accessToken) return false
    if (this._expiresAt && Date.now() > this._expiresAt - 30_000) return false
    return true
  }

  async getAccessToken(): Promise<string> {
    if (this.isAuthenticated) return this._accessToken!

    if (this._refreshToken) {
      try {
        await this._refresh()
        return this._accessToken!
      } catch (err) {
        console.warn('[OAuth2PKCEProvider] refresh failed, re-auth required:', err)
        this._refreshToken = null
      }
    }

    throw new Error(
      'OAuth2PKCEProvider: no valid token. Call authorize() to start the flow.'
    )
  }

  async authorize(): Promise<void> {
    const verifier = this._generateVerifier()
    const challenge = await this._deriveChallenge(verifier)

    // Persist verifier across the redirect boundary
    this._storeVerifier(verifier)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: this._generateVerifier().slice(0, 16),
    })

    const authUrl = `${this.config.authorizationEndpoint}?${params.toString()}`

    // Try Expo deep link (React Native) first, fall back to window.open (web)
    const opened = await this._openAuthUrl(authUrl)
    if (!opened) {
      throw new Error('OAuth2PKCEProvider: could not open authorization URL')
    }
  }

  async handleRedirect(redirectUrl: string): Promise<string> {
    const url = new URL(redirectUrl)
    const code = url.searchParams.get('code')

    if (!code) {
      const error = url.searchParams.get('error') ?? 'unknown_error'
      const desc = url.searchParams.get('error_description') ?? ''
      throw new Error(`OAuth2PKCEProvider: authorization failed - ${error}: ${desc}`)
    }

    const verifier = this._loadVerifier()
    if (!verifier) {
      throw new Error('OAuth2PKCEProvider: code_verifier not found - redirect may be stale')
    }
    this._clearVerifier()

    await this._exchangeCode(code, verifier)
    return this._accessToken!
  }

  async revokeTokens(): Promise<void> {
    this._accessToken = null
    this._refreshToken = null
    this._expiresAt = null
    this._clearVerifier()
  }

  /**
   * Load previously persisted tokens (e.g. from MCPStorage at startup).
   * Call this before the first getAccessToken() to avoid unnecessary re-auth.
   */
  loadTokens(accessToken: string, refreshToken?: string, expiresAt?: number): void {
    this._accessToken = accessToken
    this._refreshToken = refreshToken ?? null
    this._expiresAt = expiresAt ?? null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private - PKCE helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _generateVerifier(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }

  private async _deriveChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }

  private async _exchangeCode(code: string, verifier: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    })

    const res = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`OAuth2PKCEProvider: token exchange failed ${res.status}: ${text}`)
    }

    const data = (await res.json()) as TokenResponse
    this._applyTokenResponse(data)
  }

  private async _refresh(): Promise<void> {
    if (!this._refreshToken) throw new Error('No refresh token')

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this._refreshToken,
      client_id: this.config.clientId,
    })

    const res = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) throw new Error(`OAuth2PKCEProvider: refresh failed ${res.status}`)

    const data = (await res.json()) as TokenResponse
    this._applyTokenResponse(data)
  }

  private _applyTokenResponse(data: TokenResponse): void {
    this._accessToken = data.access_token
    if (data.refresh_token) this._refreshToken = data.refresh_token
    this._expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private - platform-adaptive URL opener
  // ─────────────────────────────────────────────────────────────────────────

  private async _openAuthUrl(url: string): Promise<boolean> {
    // React Native / Expo - dynamic import to prevent web bundle breakage
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Linking = await import('expo-linking' as any).catch(() => null)
      if (Linking) {
        await Linking.openURL(url)
        return true
      }
    } catch { /* not in Expo */ }

    // Web browser
    if (typeof window !== 'undefined' && window.open) {
      window.open(url, '_self')
      return true
    }

    return false
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private - verifier storage (sessionStorage on web, memory on native)
  // ─────────────────────────────────────────────────────────────────────────

  private _storeVerifier(verifier: string): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(this._storageKey, verifier)
    } else {
      // React Native - in-memory (redirect will arrive in the same JS context)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any)[`__oauth_verifier_${this._storageKey}`] = verifier
    }
  }

  private _loadVerifier(): string | null {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(this._storageKey)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any)[`__oauth_verifier_${this._storageKey}`] ?? null
  }

  private _clearVerifier(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(this._storageKey)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any)[`__oauth_verifier_${this._storageKey}`]
    }
  }
}
