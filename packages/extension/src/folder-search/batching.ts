/**
 * Token-budgeted batching for the embedder. On WebGPU, a batch above ~2,700 tokens makes some
 * ONNX Runtime kernels exceed a GPU dispatch limit and the run fails (model card, design §3.2).
 * Padding makes a batch cost `count × longest`, so the budget is checked against that, not the sum.
 */

/** Hard limit is ~2,700; keep a margin for special tokens the tokenizer adds. */
export const MAX_BATCH_TOKENS = 2600

/**
 * Groups item indices into batches, longest first, so that every batch's padded size
 * (`items × longest item`) stays within `maxTokens`. An item that alone exceeds the budget gets a
 * batch of its own; callers must truncate sequences below the budget beforehand.
 */
export function planBatches(lengths: number[], maxTokens = MAX_BATCH_TOKENS): number[][] {
	const order = lengths.map((_, i) => i).sort((a, b) => lengths[b]! - lengths[a]!)
	const batches: number[][] = []
	let current: number[] = []
	let longest = 0
	for (const i of order) {
		const len = Math.max(1, lengths[i]!)
		if (current.length === 0) {
			longest = len
			current = [i]
		} else if ((current.length + 1) * longest <= maxTokens) {
			current.push(i)
		} else {
			batches.push(current)
			longest = len
			current = [i]
		}
	}
	if (current.length) batches.push(current)
	return batches
}
