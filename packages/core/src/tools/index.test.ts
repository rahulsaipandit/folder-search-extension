/**
 * Regression tests for the autofill tools bug chain (see
 * packages/extension/docs/AutofillDebuggingPostmortem.md, section 4):
 *
 * - detect_form_fields used to run a standalone `executeJavascript` script that
 *   (a) never actually returned its result once wrapped by executeJavascript's
 *       `eval('(async () => { ' + script + ' })')`, and
 *   (b) computed its own throwaway index unrelated to the `highlightIndex`
 *       fill_form_field/submit_form resolve through.
 *
 * These tests exercise the tools directly against a mocked `pageController`,
 * so they don't need a real DOM (see PageController.test.ts in
 * @page-agent/page-controller for the DOM-level index-alignment test).
 */
import { describe, expect, it, vi } from 'vitest'

import type { PageAgentCore } from '../PageAgentCore'
import type { ToolContext } from './index'
import { tools } from './index'

function fakeAgent(pageController: Record<string, any>) {
	return { pageController } as unknown as PageAgentCore
}

const fakeCtx: ToolContext = { signal: new AbortController().signal }

describe('detect_form_fields', () => {
	it('surfaces the real highlightIndex from getFormFields() in both the human list and FIELDS_DATA', async () => {
		const pageController = {
			updateTree: vi.fn(async () => {}),
			getFormFields: vi.fn(async (includeAllForms: boolean) => {
				expect(includeAllForms).toBe(false)
				return {
					success: true,
					message: JSON.stringify({
						fields: [
							{
								highlightIndex: 7,
								label: 'Email',
								fieldType: 'email',
								required: true,
								name: 'email',
								id: 'email',
								value: '',
								options: [],
							},
						],
					}),
				}
			}),
		}

		const result = await tools
			.get('detect_form_fields')!
			.execute.call(fakeAgent(pageController), { include_all_forms: false }, fakeCtx)

		expect(pageController.updateTree).toHaveBeenCalledOnce()
		expect(result).toContain('[7] Email (email) *')
		expect(result).toContain('FIELDS_DATA:')

		const marker = result.indexOf('FIELDS_DATA:')
		const { fields } = JSON.parse(result.slice(marker + 'FIELDS_DATA:'.length))
		expect(fields[0].highlightIndex).toBe(7)
	})

	it('never fabricates a FIELDS_DATA marker when getFormFields() fails', async () => {
		// Regression guard: the old script swallowed its own return value, so
		// callers (ResumeManager) saw a message with no FIELDS_DATA marker and
		// fell into "Could not parse detected form fields." This pins that the
		// failure path stays honest about failing rather than silently
		// producing malformed success output.
		const pageController = {
			updateTree: vi.fn(async () => {}),
			getFormFields: vi.fn(async () => ({
				success: false,
				message: '❌ Failed to detect form fields: DOM tree not indexed yet.',
			})),
		}

		const result = await tools
			.get('detect_form_fields')!
			.execute.call(fakeAgent(pageController), { include_all_forms: false }, fakeCtx)

		expect(result).not.toContain('FIELDS_DATA:')
		expect(result).toContain('❌ Failed to detect form fields')
	})

	it('reports "no form fields" when the page has none, without treating it as a parse failure', async () => {
		const pageController = {
			updateTree: vi.fn(async () => {}),
			getFormFields: vi.fn(async () => ({
				success: true,
				message: JSON.stringify({ fields: [] }),
			})),
		}

		const result = await tools
			.get('detect_form_fields')!
			.execute.call(fakeAgent(pageController), { include_all_forms: false }, fakeCtx)

		expect(result).toContain('No form fields detected')
	})
})

describe('fill_form_field', () => {
	it('passes highlight_index straight through to pageController.inputText() for text fields', async () => {
		const pageController = {
			inputText: vi.fn(async (index: number, value: string) => ({
				success: true,
				message: `✅ Input text (${value}) into element (${index}).`,
			})),
			selectOption: vi.fn(),
		}

		const result = await tools.get('fill_form_field')!.execute.call(
			fakeAgent(pageController),
			{
				highlight_index: 7,
				value: 'rahul@example.com',
				field_type: 'email',
			},
			fakeCtx
		)

		expect(pageController.inputText).toHaveBeenCalledWith(7, 'rahul@example.com')
		expect(pageController.selectOption).not.toHaveBeenCalled()
		expect(result).toContain('✅')
	})

	it('routes select fields through pageController.selectOption() instead of inputText()', async () => {
		const pageController = {
			inputText: vi.fn(),
			selectOption: vi.fn(async (index: number, text: string) => ({
				success: true,
				message: `✅ Selected option (${text}) in element (${index}).`,
			})),
		}

		await tools.get('fill_form_field')!.execute.call(
			fakeAgent(pageController),
			{
				highlight_index: 9,
				value: 'United States',
				field_type: 'select',
			},
			fakeCtx
		)

		expect(pageController.selectOption).toHaveBeenCalledWith(9, 'United States')
		expect(pageController.inputText).not.toHaveBeenCalled()
	})
})

describe('submit_form', () => {
	it('passes submit_button_index straight through to pageController.clickElement()', async () => {
		const pageController = {
			clickElement: vi.fn(async (index: number) => ({
				success: true,
				message: `✅ Clicked element (${index}).`,
			})),
		}

		const result = await tools
			.get('submit_form')!
			.execute.call(fakeAgent(pageController), { submit_button_index: 18 }, fakeCtx)

		expect(pageController.clickElement).toHaveBeenCalledWith(18)
		expect(result).toContain('✅')
	})
})
