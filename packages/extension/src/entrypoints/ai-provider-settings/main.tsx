/**
 * AI Provider Settings Page
 *
 * Opened as a new browser tab from any text-only feature that needs to configure
 * (or is blocked on) the `textLLMProvider` override for text-only skills. This
 * is the single shared page for that override.
 *
 * See `getTextLLMConfig` (`llm/providers/adapter.ts`) for the resolution order
 * this override participates in.
 */

import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listenThemeChanges } from '@/lib/theme/syncTheme'
import { loadSettings, saveSettings, UnifiedSettings } from '@/shared/settings'
import '../../assets/index.css'

listenThemeChanges()

declare const chrome: any

/**
 * Closes this tab and, when it knows which tab opened it (Chrome sets
 * `openerTabId` on tabs created via `chrome.tabs.create`, which is how every
 * caller — a text-only feature — opens
 * this page), re-activates that tab first. Without this, closing the tab just
 * leaves the browser to pick whatever tab it defaults to next, with no way
 * back to the screen the user came from.
 */
async function returnToOpener() {
  try {
    const tab = await chrome.tabs.getCurrent()
    if (tab?.openerTabId != null) {
      await chrome.tabs.update(tab.openerTabId, { active: true })
    }
  } catch (err) {
    // No opener tab (opened directly, or it was closed meanwhile) — just close.
    console.warn('[AiProviderSettings] could not re-activate opener tab', err)
  } finally {
    window.close()
  }
}

function AiProviderSettingsApp() {
  const [settings, setSettings] = useState<UnifiedSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  React.useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  const save = async (patch: Partial<UnifiedSettings>): Promise<boolean> => {
    if (!settings) return false
    setSaving(true)
    setSavedMsg('')
    try {
      const merged = { ...settings, ...patch }
      await saveSettings(merged)
      setSettings(merged)
      setSavedMsg('Saved ✓')
      setTimeout(() => setSavedMsg(''), 2500)
      return true
    } catch (err) {
      console.error('[AiProviderSettings] save failed', err)
      setSavedMsg('Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground text-sm">
      <header className="flex items-center justify-between px-6 py-3 border-b bg-muted/30">
        <h1 className="font-semibold text-base">AI Provider</h1>
        <div className="flex items-center gap-3">
          {savedMsg && (
            <span className={`text-xs ${savedMsg.includes('fail') ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
              {savedMsg}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={returnToOpener}>
            Close
          </Button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-6">
        <AIProviderTab settings={settings} onSave={save} />
      </div>
    </div>
  )
}

const FETCH_TIMEOUT_MS = 5000

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Guesses which model is loaded on a local OpenAI-compatible server, so the user
 * doesn't have to know/type the exact model id themselves.
 *
 * Tries LM Studio's native `/api/v0/models` first (only reachable when the
 * endpoint's path is the standard `/v1`, since that endpoint lives at the server
 * root, not under `/v1`) — it reports a `state` field, so a model actually
 * loaded into memory can be distinguished from ones merely downloaded. Falls
 * back to the standard OpenAI-compatible `<endpoint>/models` (works for Ollama
 * and other local servers), which has no loaded/unloaded distinction, so the
 * first entry is used.
 */
async function detectLoadedModel(endpoint: string): Promise<string | null> {
  let origin: URL | null = null
  try {
    origin = new URL(endpoint)
  } catch {
    // Not a valid absolute URL — fall through to the OpenAI-compatible path below,
    // which will fail with a clearer "Could not reach endpoint" error.
  }

  if (origin && /\/v1\/?$/.test(origin.pathname)) {
    try {
      const data = await fetchJson(`${origin.origin}/api/v0/models`)
      const models: { id: string; state?: string }[] = data?.data ?? []
      const loaded = models.find(m => m.state === 'loaded')
      if (loaded) return loaded.id
    } catch {
      // LM Studio's native endpoint isn't available (different server, or an
      // older LM Studio version) — fall back to the standard endpoint below.
    }
  }

  const data = await fetchJson(`${endpoint}/models`)
  const models: { id: string }[] = data?.data ?? []
  return models[0]?.id ?? null
}

function AIProviderTab({
  settings,
  onSave,
}: {
  settings: UnifiedSettings
  onSave: (patch: Partial<UnifiedSettings>) => Promise<boolean>
}) {
  const [provider, setProvider] = useState<'local' | 'browser'>(settings.textLLMProvider ?? 'local')
  const [endpoint, setEndpoint] = useState(settings.textLLMEndpoint ?? settings.localEndpointUrl ?? 'http://localhost:1234/v1')
  const [model, setModel] = useState(settings.textLLMModel ?? settings.currentLocalModel ?? '')
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState('')

  const handleDetectModel = async () => {
    const base = endpoint.trim().replace(/\/+$/, '')
    if (!base) {
      setDetectError('Enter an endpoint URL first.')
      return
    }
    setDetecting(true)
    setDetectError('')
    try {
      const found = await detectLoadedModel(base)
      if (!found) {
        setDetectError('No models found at that endpoint.')
        return
      }
      setModel(found)
    } catch (err: any) {
      setDetectError(`Could not reach endpoint: ${err?.message ?? String(err)}`)
    } finally {
      setDetecting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    const ok = await onSave({
      textLLMProvider: provider,
      textLLMEndpoint: provider === 'local' ? (endpoint || undefined) : undefined,
      // Persist undefined (not '') when no model is chosen, so the config resolver's
      // fallback to the global currentLocalModel actually kicks in - see adapter.ts.
      textLLMModel: (provider === 'local' || provider === 'browser') ? (model || undefined) : undefined,
    })
    setSaving(false)
    // On success, take the user back to the feature they came from rather than
    // leaving them stranded on this tab.
    // Stay put on failure so they can see the "Save failed" message and retry.
    if (ok) await returnToOpener()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-medium text-base mb-1">AI provider for “Answer from these files”</h2>
        <p className="text-xs text-muted-foreground">
          Asking a question sends excerpts of your files to this model, so only private options are
          offered: a server on your computer, or a model running inside the browser. Searching never
          needs an AI provider.
        </p>
      </div>

      {/* Provider selector */}
      <div className="space-y-3">
        {/* Local LLM */}
        <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${provider === 'local' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
          <input
            type="radio"
            name="textLLM"
            value="local"
            checked={provider === 'local'}
            onChange={() => setProvider('local')}
            className="mt-0.5"
          />
          <div className="flex-1 space-y-2">
            <div>
              <p className="font-medium">Local LLM</p>
              <p className="text-xs text-muted-foreground">
                Ollama, LM Studio, or any OpenAI-compatible local server. Fully private.
              </p>
            </div>
            {provider === 'local' && (
              <div className="space-y-2 pt-1">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Endpoint URL</label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    placeholder="http://localhost:1234/v1"
                    value={endpoint}
                    onChange={e => setEndpoint(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Model name</label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. mistral-7b-instruct"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs shrink-0"
                      onClick={handleDetectModel}
                      disabled={detecting || !endpoint.trim()}
                    >
                      {detecting ? 'Detecting…' : 'Detect'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Detect asks the server which model is currently loaded, so you don't have to
                    type its exact id.
                  </p>
                  {detectError && (
                    <p className="text-xs text-destructive mt-1">{detectError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </label>

        {/* Browser LLM */}
        <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${provider === 'browser' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
          <input
            type="radio"
            name="textLLM"
            value="browser"
            checked={provider === 'browser'}
            onChange={() => setProvider('browser')}
            className="mt-0.5"
          />
          <div className="flex-1 space-y-2">
            <div>
              <p className="font-medium">Browser LLM <span className="text-xs font-normal text-muted-foreground">(offline, private)</span></p>
              <p className="text-xs text-muted-foreground">
                Runs entirely in the browser using WebLLM. No internet required after download.
              </p>
            </div>
            {provider === 'browser' && (
              <div className="pt-1 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Currently loaded model:{' '}
                  <span className="font-medium text-foreground">
                    {settings.currentLocalModel ?? <em>none</em>}
                  </span>
                </p>
                <button
                  className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                  onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('browser-llm-settings.html') })}
                  type="button"
                >
                  ↗ Load or change Browser LLM model
                </button>
              </div>
            )}
          </div>
        </label>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save & Return'}
      </Button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiProviderSettingsApp />
  </React.StrictMode>,
)
