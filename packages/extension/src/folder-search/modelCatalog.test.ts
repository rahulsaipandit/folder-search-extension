import { describe, expect, it } from 'vitest'

import {
	COMPONENT_BYTES,
	componentDtype,
	displayError,
	fileMatchesComponentDtype,
	isWebGPUError,
	selectionBytes,
} from './modelCatalog'
import type { ModelSelection } from './types'

const sel = (over: Partial<ModelSelection>): ModelSelection => ({ text: true, vision: false, audio: false, dtype: 'q4', ...over })
const MB = 1024 * 1024
const BASE = 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/main/onnx/'

describe('audio is always q8', () => {
	it('keeps the audio encoder at q8 whatever precision text and vision use', () => {
		expect(componentDtype('q4', 'audio')).toBe('q8')
		expect(componentDtype('fp16', 'audio')).toBe('q8')
		expect(componentDtype('q4', 'text')).toBe('q4')
	})

	it('adds the q8 audio size (not the q4 one) to the consent total', () => {
		const withAudio = selectionBytes(sel({ audio: true }))
		const without = selectionBytes(sel({}))
		expect(withAudio - without).toBe(COMPONENT_BYTES.q8.audio)
		expect(COMPONENT_BYTES.q8.audio - COMPONENT_BYTES.q4.audio).toBe(151 * MB)
	})

	it('sizes the CPU fallback from fp16 text and vision but q8 audio', () => {
		expect(selectionBytes(sel({ vision: true, audio: true, dtype: 'fp16' }))).toBe(
			COMPONENT_BYTES.fp16.text + COMPONENT_BYTES.fp16.vision + COMPONENT_BYTES.q8.audio
		)
	})
})

describe('fileMatchesComponentDtype', () => {
	it('expects the q8 audio file even when q4 is selected, and rejects the q4 one', () => {
		expect(fileMatchesComponentDtype(`${BASE}audio_encoder_quantized.onnx`, 'audio', 'q4')).toBe(true)
		expect(fileMatchesComponentDtype(`${BASE}audio_encoder_q4.onnx`, 'audio', 'q4')).toBe(false)
	})

	it('matches the precision selected for text and vision, including external data files', () => {
		expect(fileMatchesComponentDtype(`${BASE}model_q4.onnx_data`, 'text', 'q4')).toBe(true)
		expect(fileMatchesComponentDtype(`${BASE}model_fp16.onnx`, 'text', 'fp16')).toBe(true)
		expect(fileMatchesComponentDtype(`${BASE}model_q4.onnx`, 'text', 'fp16')).toBe(false)
		expect(fileMatchesComponentDtype(`${BASE}vision_encoder_q4.onnx`, 'vision', 'q4')).toBe(true)
		expect(fileMatchesComponentDtype(`${BASE}vision_encoder_q4.onnx`, 'text', 'q4')).toBe(false)
	})
})

describe('WebGPU error marker', () => {
	it('is recognized and stripped for display', () => {
		const msg = 'WEBGPU_UNAVAILABLE: No WebGPU adapter was found.'
		expect(isWebGPUError(msg)).toBe(true)
		expect(displayError(msg)).toBe('No WebGPU adapter was found.')
		expect(isWebGPUError('Network error')).toBe(false)
		expect(displayError('Network error')).toBe('Network error')
	})
})
