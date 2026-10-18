/**
 * Regression test for the actual root cause behind "Start Autofill" doing
 * nothing (see packages/extension/docs/AutofillDebuggingPostmortem.md,
 * section 6): TabsController only binds to the active tab inside
 * onBeforeTask(), which only runs when a full LLM task starts via
 * agent.execute(). callTool() (used by autofill/job-search/login to skip the
 * LLM loop entirely) bypassed that binding completely, so RemotePageController
 * had no target tab for any deterministic tool call made before the first
 * execute().
 *
 * TabsController is mocked here (rather than the full chrome.* messaging
 * surface it talks to) so this test is about the binding *contract*
 * (ensureTabBinding calls init() exactly once, only when unbound), not a
 * full extension-messaging integration test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const initMock = vi.fn(async function (this: any) {
	this.currentTabId = 999
})
const disposeMock = vi.fn()

vi.mock('./TabsController', () => {
	class TabsController {
		currentTabId: number | null = null
		init = initMock
		dispose = disposeMock
		waitUntilTabLoaded = vi.fn(async () => {})
	}
	return { TabsController }
})

vi.mock('./RemotePageController', () => {
	class RemotePageController {
		constructor(public tabsController: unknown) {}
	}
	return { RemotePageController }
})

vi.mock('./system_prompt.md?raw', () => ({ default: 'Default working language: **English**' }))

const { MultiPageAgent } = await import('./MultiPageAgent')

describe('MultiPageAgent.ensureTabBinding()', () => {
	beforeEach(() => {
		initMock.mockClear()
		disposeMock.mockClear()
	})

	it('binds the active tab when nothing has bound it yet (the callTool()-before-execute() case)', async () => {
		const agent = new MultiPageAgent({ baseURL: 'https://example.test', model: 'test-model', apiKey: 'test' })

		await agent.ensureTabBinding()

		expect(initMock).toHaveBeenCalledOnce()
	})

	it('does not re-init a tab binding that already exists', async () => {
		const agent = new MultiPageAgent({ baseURL: 'https://example.test', model: 'test-model', apiKey: 'test' })

		await agent.ensureTabBinding()
		await agent.ensureTabBinding()
		await agent.ensureTabBinding()

		expect(initMock).toHaveBeenCalledOnce()
	})
})
