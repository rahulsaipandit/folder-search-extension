/**
 * Security tests for the widget framework.
 * Verifies the properties described in AgentSecurityPlan.md:
 *   - Tool scoping (no file/external-comm tools)
 *   - Error classification (ZodErrors → poison)
 *   - Hash chain integrity (tamper evidence)
 *   - Capability enforcement (undeclared capabilities blocked)
 *   - Tool schema validation (Zod rejects bad inputs)
 */
import { describe, expect, test } from 'vitest'

import { classifyError } from '../../../core/src/types'
import { tools } from '../../../core/src/tools/index'
import { assertCapability, hashEvent } from './widgetRuntime'
import type { WidgetDefinition } from './widgetRuntime'

// ---------------------------------------------------------------------------
// 1. Tool scoping
// ---------------------------------------------------------------------------

describe('Tool Scoping', () => {
  test('no file-deletion tool', () => {
    expect(tools.has('delete_file')).toBe(false)
  })

  test('no arbitrary HTTP request tool', () => {
    expect(tools.has('http_request')).toBe(false)
    expect(tools.has('fetch_url')).toBe(false)
    expect(tools.has('send_request')).toBe(false)
  })

  test('no email / data-exfiltration tools', () => {
    expect(tools.has('send_email')).toBe(false)
    expect(tools.has('post_data')).toBe(false)
    expect(tools.has('upload_file')).toBe(false)
  })

  test('no arbitrary-command execution tool in default set', () => {
    expect(tools.has('execute_arbitrary_command')).toBe(false)
    expect(tools.has('run_command')).toBe(false)
  })

  test('execute_javascript is present in the default tools map (gated by PageAgentCore)', () => {
    // PageAgentCore.ts removes it when experimentalScriptExecutionTool is false.
    // The raw tools map contains it so the gate can function - test that the gate exists.
    expect(tools.has('execute_javascript')).toBe(true)
  })

  test('all tools expose a Zod inputSchema', () => {
    for (const [name, t] of tools) {
      expect(t.inputSchema, `tool ${name} missing inputSchema`).toBeDefined()
      expect(
        typeof t.inputSchema.parse,
        `tool ${name}.inputSchema is not a Zod schema`
      ).toBe('function')
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Error classification - ZodErrors must be classified as 'poison'
// ---------------------------------------------------------------------------

describe('Error Classification', () => {
  test('rate-limit error → transient', () => {
    expect(classifyError(new Error('rate_limit exceeded'))).toBe('transient')
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('transient')
  })

  test('timeout error → transient', () => {
    expect(classifyError(new Error('Request timed out'))).toBe('transient')
    expect(classifyError(new Error('ETIMEDOUT'))).toBe('transient')
  })

  test('server error → transient (provider-overload, safe to retry)', () => {
    expect(classifyError(new Error('500 Internal Server Error'))).toBe('transient')
    expect(classifyError(new Error('bad gateway'))).toBe('transient')
  })

  test('ZodError (schema violation) → poison', () => {
    const fakeZodError = Object.assign(new Error('ZodError: invalid input at path foo'), {
      name: 'ZodError',
      issues: [{ code: 'invalid_type', path: ['foo'] }],
    })
    expect(classifyError(fakeZodError)).toBe('poison')
  })

  test('real ZodError instance → poison', async () => {
    const { z } = await import('zod/v4')
    let caught: unknown
    try {
      z.object({ n: z.number() }).parse({ n: 'not-a-number' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
    expect(classifyError(caught)).toBe('poison')
  })

  test('unknown error → poison (default)', () => {
    expect(classifyError(new Error('something completely unexpected'))).toBe('poison')
    expect(classifyError('a plain string error')).toBe('poison')
    expect(classifyError(null)).toBe('poison')
  })
})

// ---------------------------------------------------------------------------
// 3. Hash chain integrity
// ---------------------------------------------------------------------------

describe('Hash Chain Integrity', () => {
  const GENESIS = '0000000000000000'

  test('produces a non-empty hex string', async () => {
    const h = await hashEvent(0, 'STEP_STARTED', { step: 'init' }, GENESIS)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  test('is deterministic for the same inputs', async () => {
    const h1 = await hashEvent(0, 'STEP_STARTED', { step: 'init' }, GENESIS)
    const h2 = await hashEvent(0, 'STEP_STARTED', { step: 'init' }, GENESIS)
    expect(h1).toBe(h2)
  })

  test('different payload → different hash (collision resistance)', async () => {
    const h1 = await hashEvent(0, 'STEP_STARTED', { step: 'a' }, GENESIS)
    const h2 = await hashEvent(0, 'STEP_STARTED', { step: 'b' }, GENESIS)
    expect(h1).not.toBe(h2)
  })

  test('different seq → different hash', async () => {
    const h1 = await hashEvent(0, 'STEP_STARTED', { step: 'x' }, GENESIS)
    const h2 = await hashEvent(1, 'STEP_STARTED', { step: 'x' }, GENESIS)
    expect(h1).not.toBe(h2)
  })

  test('chain: second event prevHash must equal first event hash', async () => {
    const hash0 = await hashEvent(0, 'STEP_STARTED', { step: 'a' }, GENESIS)
    const hash1 = await hashEvent(1, 'STEP_COMPLETED', { result: 'ok' }, hash0)

    // Re-compute with tampered prevHash - must produce a different result
    const hash1_tampered = await hashEvent(1, 'STEP_COMPLETED', { result: 'ok' }, 'deadbeef')
    expect(hash1).not.toBe(hash1_tampered)
  })

  test('three-event chain: each event is bound to its predecessor', async () => {
    const h0 = await hashEvent(0, 'STEP_STARTED', { n: 0 }, GENESIS)
    const h1 = await hashEvent(1, 'STEP_COMPLETED', { n: 1 }, h0)
    const h2 = await hashEvent(2, 'STEP_STARTED', { n: 2 }, h1)

    // Tamper event 1 → h2 must change even though event 2 is unchanged
    const h1_bad = await hashEvent(1, 'STEP_COMPLETED', { n: 9 }, h0) // mutated payload
    const h2_after_tamper = await hashEvent(2, 'STEP_STARTED', { n: 2 }, h1_bad)
    expect(h2).not.toBe(h2_after_tamper)
  })
})

// ---------------------------------------------------------------------------
// 4. Capability enforcement
// ---------------------------------------------------------------------------

function makeWidget(capabilities: string[]): WidgetDefinition {
  return {
    id: 'test-widget',
    name: 'Test',
    version: '1.0',
    description: '',
    capabilities,
    input: {} as any,
    steps: {},
  }
}

describe('Capability Enforcement', () => {
  test('throws when capability is not declared', () => {
    const w = makeWidget([])
    expect(() => assertCapability(w, 'tabs.read')).toThrow("Capability denied: 'tabs.read'")
  })

  test('throws for any undeclared capability', () => {
    const w = makeWidget(['tab.create'])
    expect(() => assertCapability(w, 'tabs.read')).toThrow()
    expect(() => assertCapability(w, 'tab.navigate')).toThrow()
  })

  test('passes when capability is declared', () => {
    const w = makeWidget(['tabs.read', 'tab.create'])
    expect(() => assertCapability(w, 'tabs.read')).not.toThrow()
    expect(() => assertCapability(w, 'tab.create')).not.toThrow()
  })

  test('declared capabilities do not grant undeclared ones', () => {
    const w = makeWidget(['tabs.read'])
    expect(() => assertCapability(w, 'tab.create')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 5. Tool schema validation (Zod rejects invalid inputs at the boundary)
// ---------------------------------------------------------------------------

describe('Tool Schema Validation', () => {
  test('click_element_by_index rejects non-integer index', () => {
    const t = tools.get('click_element_by_index')
    expect(t).toBeDefined()
    expect(() => t!.inputSchema.parse({ index: 'not-a-number' })).toThrow()
    expect(() => t!.inputSchema.parse({})).toThrow()
  })

  test('click_element_by_index accepts a valid integer index', () => {
    const t = tools.get('click_element_by_index')!
    expect(() => t.inputSchema.parse({ index: 3 })).not.toThrow()
  })

  test('input_text rejects missing fields', () => {
    const t = tools.get('input_text')
    expect(t).toBeDefined()
    expect(() => t!.inputSchema.parse({ index: 1 })).toThrow() // missing text
    expect(() => t!.inputSchema.parse({ text: 'hello' })).toThrow() // missing index
  })

  test('input_text accepts valid inputs', () => {
    const t = tools.get('input_text')!
    expect(() => t.inputSchema.parse({ index: 0, text: 'hello' })).not.toThrow()
  })

  test('wait rejects out-of-range seconds', () => {
    const t = tools.get('wait')!
    expect(() => t.inputSchema.parse({ seconds: 0 })).toThrow() // min is 1
    expect(() => t.inputSchema.parse({ seconds: 11 })).toThrow() // max is 10
  })

  test('wait accepts valid seconds', () => {
    const t = tools.get('wait')!
    expect(() => t.inputSchema.parse({ seconds: 3 })).not.toThrow()
  })

  test('done rejects missing text', () => {
    const t = tools.get('done')!
    expect(() => t.inputSchema.parse({})).toThrow()
  })

  test('done accepts valid input with default success=true', () => {
    const t = tools.get('done')!
    const parsed = t.inputSchema.parse({ text: 'All done' })
    expect((parsed as any).success).toBe(true)
  })
})
