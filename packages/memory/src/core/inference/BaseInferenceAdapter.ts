/**
 * Platform-agnostic base for InferenceAdapter.
 *
 * Provides T0 methods (keyword-based, no LLM) that work in any environment.
 * Platform-specific subclasses (browser extension, desktop) extend this and
 * override `infer()` + `initialize()` with their LLM wiring.
 */

import type { InferenceRequest, InferenceResult, WikiKnowledgeBaseConfig } from '../../types'
import type { IInferenceAdapter } from './IInferenceAdapter'

export abstract class BaseInferenceAdapter implements IInferenceAdapter {
	protected isReady = false
	protected _clientType = 'none'

	abstract initialize(): Promise<void>
	abstract infer(request: InferenceRequest): Promise<InferenceResult>

	getStatus(): { isReady: boolean; clientType: string } {
		return { isReady: this.isReady, clientType: this._clientType }
	}

	// ── T0: Named entity extraction (no LLM) ─────────────────────────────────

	async extractEntities(text: string): Promise<{ entities: string[]; topics: string[]; isProcedural: boolean }> {
		const STOPWORDS = new Set([
			'The', 'A', 'An', 'This', 'That', 'These', 'Those',
			'I', 'We', 'They', 'He', 'She', 'It', 'Is', 'Are',
			'Was', 'Were', 'And', 'But', 'Or', 'In', 'On', 'At',
			'To', 'By', 'Of', 'With', 'From', 'For', 'Be', 'As',
		])
		const words = text.split(/[\s,;:()[\]"']+/)
		const seen = new Set<string>()
		const entities: string[] = []

		for (let i = 0; i < words.length; i++) {
			const w = words[i].replace(/[^a-zA-Z0-9]/g, '')
			if (w.length < 2) continue
			const prevEndsWithPunct = i > 0 && /[.!?]$/.test(words[i - 1])
			const isSentenceStart = i === 0 || prevEndsWithPunct
			if (
				/^[A-Z]/.test(w) &&
				!STOPWORDS.has(w) &&
				(!isSentenceStart || /^[A-Z]{2,}/.test(w)) &&
				!seen.has(w)
			) {
				seen.add(w)
				entities.push(w)
			}
		}

		const topics = [...new Set(
			text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
				.filter(t => t.length > 4 && !/^(this|that|with|from|they|their|there|these|those|have|been|will|would|could|should|about|which)$/.test(t))
		)].slice(0, 5)

		const lower = text.toLowerCase()
		const isProcedural = ['first', 'then', 'step', 'check', 'run', 'deploy', 'configure', 'before', 'after']
			.some(w => lower.includes(w))

		return { entities, topics, isProcedural }
	}

	// ── T0: Outcome classification (no LLM) ──────────────────────────────────

	async classifyOutcome(text: string): Promise<{ outcome: string; failureMode?: string; confidence: number }> {
		const lower = text.toLowerCase()
		const failureIndicators = ['fail', 'error', 'timeout', 'crash', 'bug', 'issue', 'broken', 'incorrect']
		const successIndicators = ['success', 'complete', 'done', 'passed', 'verified', 'working']
		const failureScore = failureIndicators.filter(w => lower.includes(w)).length
		const successScore = successIndicators.filter(w => lower.includes(w)).length

		if (failureScore > successScore) {
			return {
				outcome: 'failure',
				failureMode: failureIndicators.find(w => lower.includes(w)) ?? 'unknown',
				confidence: Math.min(1, failureScore * 0.3),
			}
		}
		if (successScore > failureScore) {
			return { outcome: 'success', confidence: Math.min(1, successScore * 0.3) }
		}
		return { outcome: 'pending', confidence: 0.3 }
	}

	// ── T0/T1: Wiki page extraction (no-LLM fallback) ────────────────────────

	async extractWikiPage(text: string, _config: WikiKnowledgeBaseConfig): Promise<{ title: string; body: string; wikilinks: string[] }> {
		const lines = text.split('\n').map(l => l.trim()).filter(l => l)
		const title = lines[0] || 'Untitled Page'
		const body = lines.slice(1).join('\n')
		return { title, body, wikilinks: this._extractWikiLinks(body) }
	}

	protected _extractWikiLinks(text: string): string[] {
		const linkRegex = /\[\[([^\]]+)\]\]/g
		const links: string[] = []
		let match
		while ((match = linkRegex.exec(text)) !== null) {
			links.push(match[1])
		}
		return links
	}
}
