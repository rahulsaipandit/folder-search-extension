import { LLM, type LLMConfig } from '@page-agent/llms'
import { z } from 'zod'

declare const chrome: any

/**
 * Enhanced encryption utilities for secure storage of sensitive data
 */
class SecureStorage {
  private key: CryptoKey | null = null

  async initialize(): Promise<void> {
    if (this.key) return

    // Use PBKDF2 to derive a key from a constant salt (for deterministic key generation)
    // In production, this should use a proper key management system
    const salt = new TextEncoder().encode('widget-framework-salt')
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('page-agent-widget-framework-key'),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    this.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  async encrypt(data: string): Promise<string> {
    await this.initialize()
    if (!this.key) throw new Error('Encryption key not initialized')

    const encoded = new TextEncoder().encode(data)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoded
    )

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    return btoa(String.fromCharCode(...combined))
  }

  async decrypt(encryptedData: string): Promise<string> {
    await this.initialize()
    if (!this.key) throw new Error('Encryption key not initialized')

    const combined = new Uint8Array(
      atob(encryptedData).split('').map(c => c.charCodeAt(0))
    )

    const iv = combined.slice(0, 12)
    const encrypted = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encrypted
    )

    return new TextDecoder().decode(decrypted)
  }
}

// Global secure storage instance
const secureStorage = new SecureStorage()

/**
 * Bridge for widgets to access the extension's existing LLM integration
 */
export class WidgetLLMBridge {
  private llm: LLM | null = null
  private config: LLMConfig | null = null

  async initialize(): Promise<void> {
    // Get LLM config from secure extension storage
    try {
      const result = await chrome.storage.local.get('llmConfig')
      if (result.llmConfig) {
        // Decrypt if encrypted
        this.config = JSON.parse(await secureStorage.decrypt(result.llmConfig))
      }
    } catch {
      // Fallback to direct storage for backward compatibility
      const result = await chrome.storage.local.get('llmConfig')
      this.config = result.llmConfig
    }

    if (!this.config) {
      throw new Error('No LLM configuration found')
    }

    this.llm = new LLM(this.config)
  }

  async complete(prompt: string): Promise<string> {
    if (!this.llm) {
      await this.initialize()
    }

    if (!this.llm) {
      throw new Error('Failed to initialize LLM')
    }

    try {
      // Use the LLM's invoke method with a simple text prompt
      const messages = [{ role: 'user' as const, content: prompt }]
      const result = await this.llm.invoke(messages, {}, AbortSignal.timeout(30000))
      return (result as any).content
    } catch (error) {
      console.error('[WidgetLLMBridge] Completion failed:', error)
      throw new Error(`LLM completion failed: ${error}`)
    }
  }

  async extract<T>(content: string, schema: z.ZodType<T>): Promise<T> {
    if (!this.llm) {
      await this.initialize()
    }

    if (!this.llm) {
      throw new Error('Failed to initialize LLM')
    }

    try {
      const prompt = `
Please extract structured data from the following content according to the specified schema.

Content:
${content}

Schema requirements: ${schema.description || 'Extract structured information'}

Return the extracted data as a valid JSON object matching the schema.
`.trim()

      const messages = [{ role: 'user' as const, content: prompt }]
      const result = await this.llm.invoke(messages, {}, AbortSignal.timeout(30000))

      // Parse and validate the JSON response
      // Try to parse the entire response first, then fall back to extracting JSON
      let parsed
      try {
        parsed = JSON.parse((result as any).content.trim())
      } catch {
        const jsonMatch = (result as any).content.match(/\{[\s\S]*?\}/)
        if (!jsonMatch) {
          throw new Error('No JSON object found in LLM response')
        }
        parsed = JSON.parse(jsonMatch[0])
      }
      return schema.parse(parsed)
    } catch (error) {
      console.error('[WidgetLLMBridge] Extraction failed:', error)
      throw new Error(`LLM extraction failed: ${error}`)
    }
  }
}

// Global singleton instance
let llmBridge: WidgetLLMBridge | null = null

export function getWidgetLLMBridge(): WidgetLLMBridge {
  if (!llmBridge) {
    llmBridge = new WidgetLLMBridge()
  }
  return llmBridge
}

// Export secure storage for use in other parts of the widget system
export { secureStorage }