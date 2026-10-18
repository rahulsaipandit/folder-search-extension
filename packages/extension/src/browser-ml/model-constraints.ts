export interface ModelConstraints {
	contextWindow: number
	temp: [number, number]
	maxTokens: [number, number]
	hasThinkMode: boolean
}

const MODEL_DEFAULTS: ModelConstraints = {
	contextWindow: 4096,
	temp: [0.0, 2.0],
	maxTokens: [1, 4096],
	hasThinkMode: false,
}

const MODEL_MAP: Record<string, Partial<ModelConstraints>> = {
	'gemma-2-2b-it-q4f32_1-MLC': { contextWindow: 2048, maxTokens: [1, 1024] },
	'gemma-2-2b-it-q4f16_1-MLC': { contextWindow: 2048, maxTokens: [1, 1024] },
	'Llama-3.2-1B-Instruct-q4f32_1-MLC': { contextWindow: 4096, maxTokens: [1, 2048] },
	'Llama-3.2-3B-Instruct-q4f32_1-MLC': { contextWindow: 4096, maxTokens: [1, 2048] },
	'Llama-3.1-8B-Instruct-q4f32_1-MLC': { contextWindow: 8192, maxTokens: [1, 4096] },
	'Phi-3.5-mini-instruct-q4f16_1-MLC': { contextWindow: 4096, maxTokens: [1, 2048] },
	'Phi-3-mini-4k-instruct-q4f16_1-MLC': { contextWindow: 4096, maxTokens: [1, 2048] },
	'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': { contextWindow: 4096, maxTokens: [1, 2048] },
	'Qwen2.5-1.5B-Instruct-q4f16_1-MLC': { contextWindow: 8192, maxTokens: [1, 2048] },
	'Qwen2.5-3B-Instruct-q4f16_1-MLC': { contextWindow: 8192, maxTokens: [1, 4096] },
	'Qwen3-0.6B-q4f16_1-MLC': { contextWindow: 8192, maxTokens: [1, 4096], hasThinkMode: true },
	'Qwen3-1.7B-q4f16_1-MLC': { contextWindow: 8192, maxTokens: [1, 4096], hasThinkMode: true },
	'Qwen3-4B-q4f16_1-MLC': { contextWindow: 8192, maxTokens: [1, 4096], hasThinkMode: true },
	'SmolLM2-135M-Instruct-q4f16_1-MLC': { contextWindow: 2048, maxTokens: [1, 512] },
	'SmolLM2-360M-Instruct-q4f16_1-MLC': { contextWindow: 2048, maxTokens: [1, 1024] },
	'SmolLM2-1.7B-Instruct-q4f16_1-MLC': { contextWindow: 2048, maxTokens: [1, 1024] },
}

export function getModelConstraints(modelId: string): ModelConstraints {
	const override = MODEL_MAP[modelId] ?? {}
	return { ...MODEL_DEFAULTS, ...override }
}
