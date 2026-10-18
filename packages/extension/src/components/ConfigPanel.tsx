import {
	ChevronDown,
	Copy,
	CornerUpLeft,
	ExternalLink,
	Eye,
	EyeOff,
	HatGlasses,
	Home,
	Loader2,
	Monitor,
	Moon,
	Scale,
	Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useState } from 'react'
import { siGithub } from 'simple-icons'
import { toast } from 'sonner'

import { DEMO_API_KEY, DEMO_BASE_URL, DEMO_MODEL, isTestingEndpoint } from '@/agent/constants'
import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SUPPORTED_UI_LANGUAGES, UI_LANGUAGE_NATIVE_NAMES, useI18n } from '@/i18n'
import { createLLMConfigFromProvider, getBaseURLForProvider } from '@/llm/providers/adapter'
import { type UnifiedSettings, loadSettings, resetSettings, saveSettings } from '@/shared/settings'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
	standalone?: boolean
}

export function ConfigPanel({ config, onSave, onClose, standalone = false }: ConfigPanelProps) {
	// Load unified settings
	const [settings, setSettings] = useState<UnifiedSettings | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		loadSettings()
			.then(setSettings)
			.finally(() => setLoading(false))
	}, [])

	// Provider-specific state (derived from settings)
	const [apiProvider, setApiProvider] = useState<
		'openai' | 'anthropic' | 'local' | 'browser' | 'demo'
	>('demo')
	const [openaiApiKey, setOpenaiApiKey] = useState('')
	const [openaiModel, setOpenaiModel] = useState('gpt-4o')
	const [anthropicApiKey, setAnthropicApiKey] = useState('')
	const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-6')
	const [localEndpointUrl, setLocalEndpointUrl] = useState('')
	const [currentLocalModel, setCurrentLocalModel] = useState<string | null>(null)
	const [disableNamedToolChoice, setDisableNamedToolChoice] = useState(true)
	const [demoBaseURL, setDemoBaseURL] = useState('')

	// Other settings
	const [voiceLanguage, setVoiceLanguage] = useState<LanguagePreference>('en-US')
	const [wakeWords, setWakeWords] = useState('')
	const [silenceTimeout, setSilenceTimeout] = useState(5000)
	const [enableAdvancedClustering, setEnableAdvancedClustering] = useState(false)
	const [analyticsEnabled, setAnalyticsEnabled] = useState(true)
	const [devMode, setDevMode] = useState(false)

	// Config-prop-derived state (synced via prevConfig pattern)
	const [maxSteps, setMaxSteps] = useState<number | undefined>(config?.maxSteps)
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [experimentalLlmsTxt, setExperimentalLlmsTxt] = useState(
		config?.experimentalLlmsTxt ?? false
	)
	const [experimentalIncludeAllTabs, setExperimentalIncludeAllTabs] = useState(
		config?.experimentalIncludeAllTabs ?? false
	)
	const [enableWebsiteIntegration, setEnableWebsiteIntegration] = useState(false)

	// Keep config-derived state in sync when config prop changes
	const [prevConfig, setPrevConfig] = useState(config)
	if (prevConfig !== config) {
		setPrevConfig(config)
		setMaxSteps(config?.maxSteps)
		setSystemInstruction(config?.systemInstruction ?? '')
		setExperimentalLlmsTxt(config?.experimentalLlmsTxt ?? false)
		setExperimentalIncludeAllTabs(config?.experimentalIncludeAllTabs ?? false)
	}

	const { theme, setTheme } = useTheme()
	const { language: uiLanguage, explicitLanguage, setLanguage: setUiLanguage, t } = useI18n()

	// UI state
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [userAuthToken, setUserAuthToken] = useState<string>('')
	const [copied, setCopied] = useState(false)
	const [showToken, setShowToken] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)

	// Sync state with loaded settings
	useEffect(() => {
		if (!settings) return

		setApiProvider(settings.apiProvider)
		setOpenaiApiKey(settings.openaiApiKey || '')
		setOpenaiModel(settings.openaiModel || 'gpt-4o')
		setAnthropicApiKey(settings.anthropicApiKey || '')
		setAnthropicModel(settings.anthropicModel || 'claude-sonnet-4-6')
		setLocalEndpointUrl(settings.localEndpointUrl || '')
		setCurrentLocalModel(settings.currentLocalModel || null)
		// Only enable disableNamedToolChoice for local/browser providers.
		// Demo, OpenAI and Anthropic require the original named tool_choice object.
		setDisableNamedToolChoice(
			settings.apiProvider === 'local' || settings.apiProvider === 'browser'
				? (settings.disableNamedToolChoice ?? true)
				: false
		)
		setDemoBaseURL(settings.demoBaseURL || DEMO_BASE_URL)
		setVoiceLanguage(settings.language)
		setWakeWords(settings.wakeWords || '')
		setSilenceTimeout(settings.silenceTimeout || 5000)
		setEnableAdvancedClustering(settings.enableAdvancedClustering ?? false)
		setAnalyticsEnabled(settings.analyticsEnabled ?? true)
		setDevMode(settings.devMode ?? false)
		setEnableWebsiteIntegration(settings.enableWebsiteIntegration ?? false)
		// Settings values override config-prop defaults if present
		if (settings.experimentalLlmsTxt !== undefined)
			setExperimentalLlmsTxt(settings.experimentalLlmsTxt)
		if (settings.maxSteps !== undefined) setMaxSteps(settings.maxSteps)
		if (settings.systemInstruction !== undefined) setSystemInstruction(settings.systemInstruction)
	}, [settings])

	// Force devMode to false in production
	useEffect(() => {
		if (import.meta.env.WXT_ENVIRONMENT === 'PROD') {
			setDevMode(false)
		}
	}, [])

	// Poll for user auth token
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null

		const fetchToken = async () => {
			const result = await chrome.storage.local.get('PageAgentExtUserAuthToken')
			const token = result.PageAgentExtUserAuthToken
			if (typeof token === 'string' && token) {
				setUserAuthToken(token)
				if (interval) {
					clearInterval(interval)
					interval = null
				}
			}
		}

		fetchToken()
		interval = setInterval(fetchToken, 1000)

		return () => {
			if (interval) clearInterval(interval)
		}
	}, [])

	const handleCopyToken = async () => {
		if (userAuthToken) {
			await navigator.clipboard.writeText(userAuthToken)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	const handleSave = useCallback(async () => {
		setSaving(true)
		try {
			// Only persist demoBaseURL when the user actually typed something other than the
			// live default - otherwise we'd freeze today's DEMO_BASE_URL into storage and
			// shadow future updates to that constant (see settings.ts field doc comment).
			const demoBaseURLCustomized = !!demoBaseURL && demoBaseURL !== DEMO_BASE_URL
			// Create unified settings object
			const unifiedSettings: UnifiedSettings = {
				apiProvider,
				openaiApiKey,
				openaiModel,
				anthropicApiKey,
				anthropicModel,
				localEndpointUrl,
				currentLocalModel,
				disableNamedToolChoice,
				demoBaseURL: demoBaseURLCustomized ? demoBaseURL : undefined,
				demoBaseURLCustomized,
				voiceLanguage,
				wakeWords,
				silenceTimeout,
				language: voiceLanguage,
				maxSteps,
				systemInstruction: systemInstruction || undefined,
				experimentalLlmsTxt,
				enableWebsiteIntegration,
				enableAdvancedClustering,
				analyticsEnabled,
				devMode,
			}

			// Save to unified storage
			await saveSettings(unifiedSettings)

			// Create LLMConfig for the agent
			const llmConfig = createLLMConfigFromProvider({
				apiProvider,
				openaiApiKey,
				openaiModel,
				anthropicApiKey,
				anthropicModel,
				localEndpointUrl,
				currentLocalModel,
				currentLocalModelContextWindow: settings?.currentLocalModelContextWindow,
				disableNamedToolChoice,
				demoBaseURL,
			})

			console.log('[Ext] Saving Local LLM config:', {
				disableNamedToolChoice: llmConfig.disableNamedToolChoice,
				baseURL: llmConfig.baseURL,
				model: llmConfig.model,
			})

			// Convert to ExtConfig format expected by the agent
			const extConfig: ExtConfig = {
				provider: apiProvider === 'demo' ? 'openai' : llmConfig.provider,
				baseURL: llmConfig.baseURL,
				apiKey: apiProvider === 'demo' ? DEMO_API_KEY : llmConfig.apiKey,
				model: apiProvider === 'demo' ? DEMO_MODEL : llmConfig.model,
				maxRetries: llmConfig.maxRetries,
				disableNamedToolChoice: llmConfig.disableNamedToolChoice,
				language: voiceLanguage,
				maxSteps,
				systemInstruction: systemInstruction || undefined,
				experimentalLlmsTxt,
				enableWebsiteIntegration,
				experimentalIncludeAllTabs,
			}

			await onSave(extConfig)
		} finally {
			setSaving(false)
		}
	}, [
		apiProvider,
		openaiApiKey,
		openaiModel,
		anthropicApiKey,
		anthropicModel,
		localEndpointUrl,
		currentLocalModel,
		disableNamedToolChoice,
		demoBaseURL,
		voiceLanguage,
		wakeWords,
		silenceTimeout,
		enableAdvancedClustering,
		analyticsEnabled,
		devMode,
		maxSteps,
		systemInstruction,
		experimentalLlmsTxt,
		enableWebsiteIntegration,
		experimentalIncludeAllTabs,
		settings,
		onSave,
	])

	const handleReset = useCallback(async () => {
		await resetSettings()
		const defaultSettings = await loadSettings()
		setSettings(defaultSettings)
		toast.success('Settings reset to defaults')
	}, [])

	if (loading) {
		return (
			<div className="flex flex-col gap-4 p-4">
				<div className="text-center py-8">
					<Loader2 className="size-6 animate-spin mx-auto mb-2" />
					<p className="text-sm text-muted-foreground">Loading settings...</p>
				</div>
			</div>
		)
	}

	const currentBaseURL = apiProvider === 'demo' ? demoBaseURL : getBaseURLForProvider(apiProvider)

	return (
		<div className="flex flex-col gap-4 p-4 relative">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold">Settings</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onClose}
					className="absolute top-2 right-3 cursor-pointer"
					aria-label="Back"
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</div>

			{/* Hub link */}
			<a
				href="/hub.html"
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center justify-between p-3 rounded-md border bg-muted/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
			>
				Manage Page Agent Hub
				<ExternalLink className="size-3" />
			</a>

			{/* API Provider Selection */}
			<div className="flex flex-col gap-1.5">
				<label className="text-xs text-muted-foreground">LLM Provider</label>
				<select
					value={apiProvider}
					onChange={(e) => {
						const val = e.target.value as typeof apiProvider
						setApiProvider(val)
						if (val === 'browser' && !standalone) {
							chrome.tabs.create({ url: chrome.runtime.getURL('browser-llm-settings.html') })
						}
					}}
					className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
				>
					<option value="demo">Demo</option>
					<option value="openai">OpenAI</option>
					<option value="anthropic">Anthropic</option>
					<option value="local">Local LLM</option>
					<option value="browser">Browser LLM</option>
				</select>
			</div>

			{/* Provider-specific settings */}
			{apiProvider === 'openai' && (
				<>
					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2">
							<label className="text-xs text-muted-foreground">OpenAI API Key</label>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Your OpenAI API key for accessing GPT models. Keep this secure.
								</TooltipContent>
							</Tooltip>
						</div>
						<div className="flex gap-2 items-center">
							<Input
								type={showApiKey ? 'text' : 'password'}
								placeholder="sk-..."
								value={openaiApiKey}
								onChange={(e) => setOpenaiApiKey(e.target.value)}
								className="text-xs h-8"
							/>
							<Button
								variant="outline"
								size="icon"
								className="h-8 w-8 shrink-0 cursor-pointer"
								onClick={() => setShowApiKey(!showApiKey)}
								aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
							>
								{showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">OpenAI Model</label>
						<select
							value={openaiModel}
							onChange={(e) => setOpenaiModel(e.target.value)}
							className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
						>
							<option value="gpt-4o">GPT-4o</option>
							<option value="gpt-4o-mini">GPT-4o Mini</option>
							<option value="gpt-4-turbo">GPT-4 Turbo</option>
							<option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
						</select>
					</div>
				</>
			)}

			{apiProvider === 'anthropic' && (
				<>
					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2">
							<label className="text-xs text-muted-foreground">Anthropic API Key</label>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Your Anthropic API key for accessing Claude models. Keep this secure.
								</TooltipContent>
							</Tooltip>
						</div>
						<Input
							type="password"
							placeholder="sk-ant-..."
							value={anthropicApiKey}
							onChange={(e) => setAnthropicApiKey(e.target.value)}
							className="text-xs h-8"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">Anthropic Model</label>
						<select
							value={anthropicModel}
							onChange={(e) => setAnthropicModel(e.target.value)}
							className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
						>
							<option value="claude-opus-4-7">Claude Opus 4.7</option>
							<option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
							<option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
						</select>
					</div>
				</>
			)}

			{apiProvider === 'local' && (
				<>
					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2">
							<label className="text-xs text-muted-foreground">Local Endpoint URL</label>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									URL of your local LLM server (e.g., LM Studio, Ollama).
								</TooltipContent>
							</Tooltip>
						</div>
						<Input
							placeholder="http://localhost:1234/v1"
							value={localEndpointUrl}
							onChange={(e) => setLocalEndpointUrl(e.target.value)}
							className="text-xs h-8"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">Model Name</label>
						<Input
							placeholder="qwen/qwen3.5-27b"
							value={currentLocalModel || ''}
							onChange={(e) => setCurrentLocalModel(e.target.value || null)}
							className="text-xs h-8"
						/>
					</div>

					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={disableNamedToolChoice}
							onChange={(e) => setDisableNamedToolChoice(e.target.checked)}
							className="size-3 accent-primary"
						/>
						<label className="text-xs text-muted-foreground">
							Disable named tool_choice for LM Studio/Ollama use
						</label>
					</div>
				</>
			)}

			{apiProvider === 'browser' && (
				<div className="p-2.5 rounded-md border border-blue-500/30 bg-blue-500/5 text-xs text-foreground leading-relaxed space-y-2">
					<p>
						<strong>Browser LLM:</strong> Runs models locally using WebGPU - no API key needed.
					</p>
					{currentLocalModel ? (
						<p>
							Current model: <code className="font-mono">{currentLocalModel}</code>
						</p>
					) : (
						<p className="text-muted-foreground">
							No model loaded. Open the settings page to download one first.
						</p>
					)}
					{!standalone && (
						<Button
							size="sm"
							variant="outline"
							className="w-full text-xs h-7"
							onClick={() =>
								chrome.tabs.create({ url: chrome.runtime.getURL('browser-llm-settings.html') })
							}
						>
							Open Settings Page
						</Button>
					)}
				</div>
			)}

			{apiProvider === 'demo' && (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<label className="text-xs text-muted-foreground">Demo Base URL</label>
						<Tooltip>
							<TooltipTrigger asChild>
								<button type="button" className="text-muted-foreground hover:text-foreground">
									<HatGlasses className="size-3" />
								</button>
							</TooltipTrigger>
							<TooltipContent>
								The base URL for the demo service. You can override this if needed.
							</TooltipContent>
						</Tooltip>
					</div>
					<Input
						placeholder={DEMO_BASE_URL}
						value={demoBaseURL}
						onChange={(e) => setDemoBaseURL(e.target.value)}
						className="text-xs h-8"
					/>
				</div>
			)}

			{/* Testing endpoint notice */}
			{isTestingEndpoint(currentBaseURL) && (
				<div className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-xs text-foreground leading-relaxed">
					<Scale className="size-3 inline-block mr-1 -mt-0.5 text-amber-600" />
					You are using the free testing API. By using this service you agree to the{' '}
					<a
						href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="underline hover:text-foreground"
					>
						Terms of Use & Privacy Policy
					</a>
					. No sensitive data. No guaranteed availability.
				</div>
			)}

			{/* Appearance */}
			<div className="border-t pt-4">
				<h3 className="text-sm font-medium mb-3">Appearance</h3>
				<div className="flex items-center gap-2">
					{(['light', 'system', 'dark'] as const).map((themeOption) => {
						const isActive = theme === themeOption
						const icons: Record<string, React.ReactNode> = {
							light: <Sun className="size-4" />,
							system: <Monitor className="size-4" />,
							dark: <Moon className="size-4" />,
						}
						const labels: Record<string, string> = {
							light: 'Light',
							system: 'System',
							dark: 'Dark',
						}
						return (
							<button
								key={themeOption}
								type="button"
								onClick={() => setTheme(themeOption)}
								className={`flex-1 flex flex-col items-center gap-1 py-2 px-3 rounded-lg border text-xs transition-colors cursor-pointer ${
									isActive
										? 'border-primary bg-primary/10 text-foreground'
										: 'border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50'
								}`}
							>
								{icons[themeOption]}
								<span>{labels[themeOption]}</span>
							</button>
						)
					})}
				</div>
			</div>

			{/* Interface Language */}
			<div className="border-t pt-4">
				<h3 className="text-sm font-medium mb-3">{t('settings.interfaceLanguage')}</h3>
				<select
					value={explicitLanguage ?? ''}
					onChange={(e) => setUiLanguage((e.target.value || undefined) as typeof explicitLanguage)}
					className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer w-full"
				>
					<option value="">
						{t('settings.interfaceLanguageAuto', {
							language: UI_LANGUAGE_NATIVE_NAMES[uiLanguage],
						})}
					</option>
					{SUPPORTED_UI_LANGUAGES.map((lang) => (
						<option key={lang} value={lang}>
							{UI_LANGUAGE_NATIVE_NAMES[lang]}
						</option>
					))}
				</select>
			</div>

			{/* Advanced Config */}
			<button
				type="button"
				onClick={() => setAdvancedOpen(!advancedOpen)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mt-1 font-bold"
			>
				Advanced
				<ChevronDown
					className="size-3 transition-transform"
					style={{ transform: advancedOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
				/>
			</button>

			{advancedOpen && (
				<>
					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">Max Steps</label>
						<Input
							type="number"
							placeholder="40"
							min={1}
							max={200}
							value={maxSteps ?? ''}
							onChange={(e) => setMaxSteps(e.target.value ? Number(e.target.value) : undefined)}
							className="text-xs h-8 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">System Instruction</label>
						<textarea
							placeholder="Additional instructions for the agent..."
							value={systemInstruction}
							onChange={(e) => setSystemInstruction(e.target.value)}
							rows={3}
							className="text-xs rounded-md border border-input bg-background px-3 py-2 resize-y min-h-[60px]"
						/>
					</div>

					{/* User Auth Token Section */}
					<div
						className={`flex flex-col gap-1.5 p-3 bg-muted/50 rounded-md border ${!enableWebsiteIntegration ? 'opacity-50 pointer-events-none' : ''}`}
					>
						<div className="flex items-center gap-2">
							<label
								htmlFor="user-auth-token"
								className="text-xs font-medium text-muted-foreground"
							>
								User Auth Token
							</label>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									This token allows trusted websites to programmatically control the extension
									through JavaScript APIs.
								</TooltipContent>
							</Tooltip>
						</div>
						<p className="text-[10px] text-muted-foreground mb-1">
							Give a website the ability to call this extension.
						</p>
						<div className="flex gap-2 items-center">
							<Input
								id="user-auth-token"
								readOnly
								value={
									userAuthToken
										? showToken
											? userAuthToken
											: `${userAuthToken.slice(0, 4)}${'•'.repeat(userAuthToken.length - 8)}${userAuthToken.slice(-4)}`
										: 'Loading...'
								}
								className="text-xs h-8 font-mono bg-background"
							/>
							<Button
								variant="outline"
								size="icon"
								className="h-8 w-8 shrink-0 cursor-pointer"
								onClick={() => setShowToken(!showToken)}
								disabled={!userAuthToken}
								aria-label={showToken ? 'Hide token' : 'Show token'}
								aria-pressed={showToken}
							>
								{showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
							</Button>
							<Button
								variant="outline"
								size="icon"
								className="h-8 w-8 shrink-0 cursor-pointer"
								onClick={handleCopyToken}
								disabled={!userAuthToken}
								aria-label="Copy token"
							>
								{copied ? <span className="">✓</span> : <Copy className="size-3" />}
							</Button>
							<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
								{copied ? 'Token copied' : ''}
							</span>
						</div>
					</div>

					<div className="flex items-center justify-between cursor-pointer">
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Enable website integration</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									When enabled, websites can use the AgentX extension through the User Auth Token
									API.
								</TooltipContent>
							</Tooltip>
						</div>
						<Switch
							checked={enableWebsiteIntegration}
							onCheckedChange={setEnableWebsiteIntegration}
						/>
					</div>

					<div className="flex items-center justify-between cursor-pointer">
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Experimental llms.txt support</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Enables experimental support for llms.txt files.</TooltipContent>
							</Tooltip>
						</div>
						<Switch checked={experimentalLlmsTxt} onCheckedChange={setExperimentalLlmsTxt} />
					</div>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">Experimental include all tabs</span>
						<Switch
							checked={experimentalIncludeAllTabs}
							onCheckedChange={setExperimentalIncludeAllTabs}
						/>
					</label>

					<div className="flex items-center justify-between cursor-pointer">
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">
								Advanced clustering (UMAP + HDBSCAN)
							</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Use WASM-based UMAP + HDBSCAN for semantic clustering. Requires downloading ML
									models (~50 MB) on first use.
								</TooltipContent>
							</Tooltip>
						</div>
						<Switch
							checked={enableAdvancedClustering}
							onCheckedChange={setEnableAdvancedClustering}
						/>
					</div>

					<div className="flex items-center justify-between cursor-pointer">
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Usage analytics</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button type="button" className="text-muted-foreground hover:text-foreground">
										<HatGlasses className="size-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Sends anonymous click events (e.g. which home-screen actions and Agent Library
									skill cards you use) to help us see what's actually used. Never includes page
									content, task instructions, browsing history, or anything you type — see{' '}
									<a
										href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md"
										target="_blank"
										rel="noopener noreferrer"
										className="underline"
									>
										Privacy Policy
									</a>
									.
								</TooltipContent>
							</Tooltip>
						</div>
						<Switch checked={analyticsEnabled} onCheckedChange={setAnalyticsEnabled} />
					</div>

					{import.meta.env.WXT_ENVIRONMENT === 'DEV' && (
						<div className="flex items-center justify-between cursor-pointer border-t pt-3">
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground">Dev Mode</span>
								<Tooltip>
									<TooltipTrigger asChild>
										<button type="button" className="text-muted-foreground hover:text-foreground">
											<HatGlasses className="size-3" />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										Enables additional diagnostic logging in development builds.
									</TooltipContent>
								</Tooltip>
							</div>
							<Switch checked={devMode} onCheckedChange={setDevMode} />
						</div>
					)}
				</>
			)}

			{/* Content Access Policy */}
			<div className="flex items-center justify-between cursor-pointer">
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Edit Content Access Policy</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<button type="button" className="text-muted-foreground hover:text-foreground">
								<HatGlasses className="size-3" />
							</button>
						</TooltipTrigger>
						<TooltipContent>Manage allowed and blocked websites for the extension.</TooltipContent>
					</Tooltip>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="text-xs h-7"
					onClick={() =>
						chrome.tabs.create({ url: chrome.runtime.getURL('content-access-settings.html') })
					}
				>
					Edit
				</Button>
			</div>

			{/* Voice Settings */}
			<div className="border-t pt-4">
				<h3 className="text-sm font-medium mb-3">Voice Settings</h3>

				<div className="flex flex-col gap-1.5">
					<label className="text-xs text-muted-foreground">Language</label>
					<select
						value={voiceLanguage ?? ''}
						onChange={(e) => setVoiceLanguage((e.target.value || undefined) as LanguagePreference)}
						className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
					>
						<option value="">System</option>
						<option value="en-US">English</option>
						<option value="zh-CN">中文</option>
					</select>
				</div>

				<div className="flex flex-col gap-1.5 mt-2">
					<label className="text-xs text-muted-foreground pt-1">Wake Words</label>
					<Input
						placeholder="hey ai, listen up"
						value={wakeWords}
						onChange={(e) => setWakeWords(e.target.value)}
						className="text-xs h-8"
					/>
				</div>

				<div className="flex flex-col gap-1.5 mt-2">
					<label className="text-xs text-muted-foreground pt-1">Silence Timeout (ms)</label>
					<Input
						type="number"
						min={1000}
						max={30000}
						step={1000}
						value={silenceTimeout}
						onChange={(e) => setSilenceTimeout(Number(e.target.value))}
						className="text-xs h-8"
					/>
				</div>
			</div>

			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onClose} className="flex-1 h-8 text-xs cursor-pointer">
					Cancel
				</Button>
				<Button
					variant="outline"
					onClick={handleReset}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					Reset
				</Button>
				<Button
					onClick={handleSave}
					disabled={saving}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					{saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
				</Button>
			</div>

			{/* Vault Settings */}
			<div className="pt-3 border-t border-border/50">
				<button
					type="button"
					onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('vault-settings.html') })}
					className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="size-3.5"
					>
						<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
						<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
					</svg>
					Vault Settings
				</button>
			</div>

			{/* Footer */}
			<div className="mt-4 mb-4 pt-4 border-t border-border/50 flex gap-2 justify-between text-[10px] text-muted-foreground">
				<div className="flex flex-col justify-between">
					<span>
						Version <span className="font-mono">v{__VERSION__}</span>
					</span>
					{/* 
					<a
						href="https://github.com/alibaba/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<svg role="img" viewBox="0 0 24 24" className="size-3 fill-current">
							<path d={siGithub.path} />
						</svg>
						<span>Source Code</span>
					</a>

					<a
						href="https://alibaba.github.io/page-agent/"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<Home className="size-3" />
						<span>Home Page</span>
					</a> */}

					<a
						href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<HatGlasses className="size-3" />
						<span>Privacy</span>
					</a>
				</div>
			</div>

			{/* Attribution */}
			<div className="text-[10px] text-muted-foreground bg-background fixed bottom-0 w-full">
				{/* <div className="flex justify-start">
					<span className="leading-loose text-[10px]">
						Powered by{' '}
						<a
							href="https://www.guideaxon.com/"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground"
						>
							GuideAxon
						</a>{' '}AI{' '}
						• Built with ♥️ by{' '}
						<a
							href="https://github.com/gaomeng1900"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground"
						>
							@Simon
						</a>
					</span>
				</div> */}
				<div className="flex justify-start">
					<a
						href={chrome.runtime.getURL('entrypoints/licenses.html')}
						target="_blank"
						rel="noopener noreferrer"
						className="leading-loose underline hover:text-foreground"
					>
						Open Source Notices
					</a>
					<span className="leading-loose ml-4">Copyright © 2026 GuideAxon</span>
				</div>
			</div>
		</div>
	)
}
