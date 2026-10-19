import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import '@/assets/index.css'
import { Button } from '@/components/ui/button'
import { loadSettings, saveSettings } from '@/shared/settings'

import { listenThemeChanges } from '@/lib/theme/syncTheme'

listenThemeChanges()

const MODEL_GROUPS = [
	{
		label: 'Google',
		options: [
			{ value: 'gemma-3-1b-it-q4f16_1-MLC',   label: 'Gemma 3 1B · ~0.8 GB · 32K context' },
			{ value: 'gemma-3-4b-it-q4f16_1-MLC',   label: 'Gemma 3 4B · ~3 GB · 32K context' },
			{ value: 'gemma-2-2b-it-q4f16_1-MLC',   label: 'Gemma 2 2B · ~1.4 GB · 8K context' },
		],
	},
	{
		label: 'Meta',
		options: [
			{ value: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B · ~1 GB · 128K context' },
			{ value: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B · ~2.2 GB · 128K context' },
		],
	},
	{
		label: 'Qwen',
		options: [
			{ value: 'Qwen3-0.6B-q4f16_1-MLC',            label: 'Qwen 3 0.6B · ~0.6 GB · 32K context · Reasoning' },
			{ value: 'Qwen3-1.7B-q4f16_1-MLC',            label: 'Qwen 3 1.7B · ~1.4 GB · 32K context · Reasoning' },
			{ value: 'Qwen3-4B-q4f16_1-MLC',              label: 'Qwen 3 4B · ~3.2 GB · 32K context · Reasoning' },
			{ value: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',   label: 'Qwen 2.5 3B · ~2.3 GB · 32K context' },
			{ value: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B · ~1.2 GB · 32K context' },
		],
	},
	{
		label: 'Microsoft',
		options: [
			{ value: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 Mini · ~2.4 GB · 128K context' },
			{ value: 'Phi-4-mini-instruct-q4f16_1-MLC',   label: 'Phi 4 Mini · ~3.8 GB · 128K context' },
		],
	},
	{
		label: 'HuggingFace',
		options: [
			{ value: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',    label: 'SmolLM2 1.7B · ~1.3 GB · 8K context' },
			{ value: 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC', label: 'TinyLlama 1.1B · ~0.8 GB · 4K context' },
		],
	},
	{
		label: 'DeepSeek',
		options: [
			{ value: 'DeepSeek-R1-Distill-Qwen-1.5B-q4f16_1-MLC', label: 'DeepSeek R1 Qwen 1.5B · ~1.3 GB · 32K context · Reasoning' },
			{ value: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',   label: 'DeepSeek R1 Qwen 7B · ~4 GB · 32K context · Reasoning' },
		],
	},
	{
		label: 'Vision - can analyse images you attach',
		options: [
			{ value: 'Llama-3.2-11B-Vision-Instruct-q4f16_1-MLC', label: 'Llama 3.2 11B Vision · ~8 GB · 128K context · Sees images' },
			{ value: 'Qwen2.5-VL-3B-Instruct-q4f16_1-MLC',        label: 'Qwen 2.5 VL 3B · ~2.3 GB · 32K context · Sees images' },
			{ value: 'Qwen2.5-VL-7B-Instruct-q4f16_1-MLC',        label: 'Qwen 2.5 VL 7B · ~5 GB · 32K context · Sees images' },
		],
	},
] as const

const CONTEXT_WINDOWS = [
	{ value: 2048,   label: '2K tokens' },
	{ value: 4096,   label: '4K tokens' },
	{ value: 8192,   label: '8K tokens' },
	{ value: 16384,  label: '16K tokens' },
	{ value: 32768,  label: '32K tokens' },
	{ value: 131072, label: '128K tokens' },
]

function BrowserLLMSettingsPage() {
	const [modelId, setModelId]             = useState('gemma-2-2b-it-q4f16_1-MLC')
	const [contextWindow, setContextWindow] = useState(8192)
	const [currentModel, setCurrentModel]   = useState<string | null>(null)
	const [showLoader, setShowLoader]       = useState(false)
	const [loading, setLoading]             = useState(false)
	const [progress, setProgress]           = useState(0)
	const [progressText, setProgressText]   = useState('')
	const [success, setSuccess]             = useState('')
	const [error, setError]                 = useState('')

	useEffect(() => {
		loadSettings().then(s => {
			if (s.currentLocalModel) setCurrentModel(s.currentLocalModel)
			if (s.currentLocalModelContextWindow) setContextWindow(s.currentLocalModelContextWindow)
		})
	}, [])

	const handleLoad = async () => {
		console.log('[BrowserLLMSettings] handleLoad() start', { modelId, contextWindow })
		setLoading(true)
		setProgress(0)
		setProgressText('Importing WebLLM library…')
		setError('')
		setSuccess('')

		try {
			// No /* @vite-ignore */ here: that comment tells Vite to leave the bare
			// specifier unresolved, which then fails at runtime in the browser
			// ("Failed to resolve module specifier '@mlc-ai/web-llm'"). Let Vite
			// statically bundle this import instead (see BrowserLLMClient.ts).
			const { CreateMLCEngine } = await import('@mlc-ai/web-llm')
			console.log('[BrowserLLMSettings] @mlc-ai/web-llm imported OK, starting download/compile', modelId)
			setProgressText(`Downloading ${modelId}…`)

			await CreateMLCEngine(modelId, {
				initProgressCallback: (p: any) => {
					const pct = Math.round((p.progress ?? 0) * 100)
					console.log('[BrowserLLMSettings] download progress', { pct, text: p.text })
					setProgress(pct)
					setProgressText(p.text || `Loading… ${pct}%`)
				},
    chatOpts: { context_window_size: contextWindow }
			} as any)
			console.log('[BrowserLLMSettings] CreateMLCEngine resolved - model downloaded and loaded', modelId)

			await saveSettings({
				currentLocalModel: modelId,
				currentLocalModelContextWindow: contextWindow,
				textLLMProvider: 'browser',
				textLLMModel: modelId,
			})
			const verify = await loadSettings()
			console.log('[BrowserLLMSettings] saveSettings() done, read-back settings', {
				currentLocalModel: verify.currentLocalModel,
				currentLocalModelContextWindow: verify.currentLocalModelContextWindow,
				textLLMProvider: verify.textLLMProvider,
			})

			setCurrentModel(modelId)
			setProgress(100)
			setSuccess(`${modelId} downloaded and cached. Provider set to Browser LLM - close this tab to return to Folder Search.`)
		} catch (err: any) {
			console.log('[BrowserLLMSettings] handleLoad() failed', err)
			setError(err?.message || String(err))
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="min-h-screen w-full bg-background text-foreground">
			<div className="w-full p-6 space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between border-b pb-4">
					<h1 className="text-lg font-semibold">Local LLM in Browser</h1>
					<Button
						variant="outline"
						size="sm"
						className={`text-xs ${success ? 'al-attention-btn' : ''}`}
						onClick={() => window.close()}
					>
						Close
					</Button>
				</div>

				{/* Intro */}
				<div className="space-y-3 text-sm text-foreground leading-relaxed">
					<p>
						Run AI models entirely inside your browser - no API key required, no data sent to any server.
						Models are downloaded once and cached locally on your device.
					</p>
					<p className="text-xs text-muted-foreground">
						🔒 100% Private - all processing happens on your computer. Your files and questions never leave this device.
					</p>
					<div className="p-3 rounded-md border border-blue-500/20 bg-blue-500/5 text-xs text-foreground">
						Click <strong>Load Browser LLM</strong> below to download a model. Once downloaded it is selected
						automatically as the provider for <strong>Answer from these files</strong>. No API key needed.
					</div>
				</div>

				{/* Model setup steps */}
				<div className="space-y-3">
					<div className="p-3 rounded-md border bg-muted/30 space-y-1">
						<p className="text-xs font-semibold">Language model</p>
						<p className="text-xs text-muted-foreground">Powers “Answer from these files” without sending anything off your device.</p>
						<p className="text-[11px] text-muted-foreground">
							Generates responses to your questions using WebLLM with WebGPU acceleration where available.
						</p>
						<p className="text-[11px] font-mono mt-1">
							Default: <strong>Gemma 2 2B</strong> · ~1.4 GB · 8K context ·{' '}
							<a href="https://webllm.mlc.ai/" target="_blank" rel="noopener noreferrer" className="underline">WebLLM</a>
						</p>
					</div>
				</div>

				{/* Currently loaded */}
				<div className="space-y-1">
					<label className="text-xs font-medium text-muted-foreground">Currently loaded</label>
					<div className="px-3 py-2 rounded-md border border-input bg-muted/20 text-sm text-muted-foreground font-mono">
						{currentModel ?? 'None loaded'}
					</div>
				</div>

				{/* Load button or expanded loader */}
				{!showLoader ? (
					<div className="space-y-1.5">
						<Button className="w-full" onClick={() => setShowLoader(true)}>
							Load Browser LLM
						</Button>
						<p className="text-[11px] text-muted-foreground text-center">
							Opens model selection below. First download may take a few minutes.
						</p>
					</div>
				) : (
					<div className="space-y-4 border-t pt-4">
						<h2 className="text-sm font-semibold">Download &amp; Load Model</h2>

						<div className="space-y-3">
							<div className="space-y-1.5">
								<label className="text-xs font-medium text-muted-foreground">Model</label>
								<select
									value={modelId}
									onChange={e => setModelId(e.target.value)}
									disabled={loading}
									className="w-full h-9 text-sm rounded-md border border-input bg-background px-2 cursor-pointer"
								>
									{MODEL_GROUPS.map(group => (
										<optgroup key={group.label} label={group.label}>
											{group.options.map(opt => (
												<option key={opt.value} value={opt.value}>{opt.label}</option>
											))}
										</optgroup>
									))}
								</select>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-medium text-muted-foreground">Context Window</label>
								<select
									value={contextWindow}
									onChange={e => setContextWindow(Number(e.target.value))}
									disabled={loading}
									className="w-full h-9 text-sm rounded-md border border-input bg-background px-2 cursor-pointer"
								>
									{CONTEXT_WINDOWS.map(cw => (
										<option key={cw.value} value={cw.value}>{cw.label}</option>
									))}
								</select>
							</div>
						</div>

						{loading && (
							<div className="space-y-2">
								<p className="text-xs text-muted-foreground">{progressText}</p>
								<div className="w-full bg-muted rounded-full h-2">
									<div
										className="bg-primary h-2 rounded-full transition-all duration-300"
										style={{ width: `${progress}%` }}
									/>
								</div>
								<p className="text-xs text-muted-foreground text-right">{progress}%</p>
							</div>
						)}

						{error && (
							<div className="p-3 rounded-md border border-destructive/30 bg-destructive/5 text-xs text-destructive">
								{error}
							</div>
						)}
						{success && (
							<div className="p-3 rounded-md border border-green-500/30 bg-green-500/5 text-xs text-green-700 dark:text-green-400">
								{success}
							</div>
						)}

						<Button
							onClick={handleLoad}
							disabled={loading}
							className={`w-full ${success ? 'bg-green-600 hover:bg-green-600 text-white' : ''}`}
						>
							{loading ? (progressText || 'Loading…') : success ? 'Model Ready ✓' : 'Download & Load Model'}
						</Button>

						<p className="text-[11px] text-muted-foreground text-center">
							Requires a GPU with WebGPU support. Models are cached by the browser after the first download.
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<BrowserLLMSettingsPage />
	</React.StrictMode>
)
