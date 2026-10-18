# Extension Behavioral Guidelines

Guidelines for keeping the extension's manifest, permissions, and runtime code patterns from
tripping Chrome Web Store review and Enhanced Safe Browsing's automated trust model. That model
scores an extension on **behavioral signals** — permissions requested, dynamic-code-execution
patterns, and whether the listing matches actual behavior — independent of code quality. A
well-written extension can still sit in the "unproven" bucket longer than necessary if it declares
more standing access than it needs or contains patterns automated reviewers flag on sight (`eval`,
`new Function`, remotely-fetched code).

This doc records two concrete changes made for that reason, and the guideline each implies for
future changes.

## 1. No standing `host_permissions` — use `activeTab` + `optional_host_permissions`

**What changed:** `wxt.config.js` no longer declares `host_permissions: ['<all_urls>']`. It
declares `activeTab` (permissions array) and `optional_host_permissions: ['<all_urls>']` instead.
Verify with the built manifest — there should be no `host_permissions` key and no
`content_scripts` array:

```
packages/extension/.output/prod/chrome-mv3/manifest.json
```

**Why:** `host_permissions: ['<all_urls>']` declared at install time is the single biggest
Web Store review risk for an automation extension, and it's exactly the kind of standing broad
grant the Enhanced Safe Browsing trust model treats as an unproven-extension signal. `activeTab`
only grants the tab the user just invoked the extension on; `optional_host_permissions` lets
broader/other-tab access be requested at runtime, in the open, via a real permission prompt the
user can see and decline — instead of being silently granted at install.

**The WXT gotcha — read this before reaching for `registration: 'runtime'`:**

`defineContentScript({ matches: [...], registration: 'runtime' })` sounds like the fix (inject
programmatically instead of automatically), but it is **not**. Checked directly against the
installed package:

```
node_modules/wxt/dist/types.d.mts:764-776   — registration: 'runtime' doc comment:
  "runtime": the content script's `matches` is added to `host_permissions` and you are
  responsible for using the scripting API to register/execute the content script
  dynamically at runtime.

node_modules/wxt/dist/core/utils/manifest.mjs:197-201 — the actual behavior:
  contentScripts.filter((cs) => cs.options.registration === "runtime").forEach((script) => {
      script.options.matches?.forEach((matchPattern) => {
          addHostPermission(manifest, matchPattern)
      })
  })
```

`registration: 'runtime'` only changes **when** the script is injected (manually via
`chrome.scripting`, instead of automatically by the manifest's `content_scripts` array at page
load). It does **not** avoid declaring the permission — WXT still walks `options.matches` and adds
every pattern to `host_permissions` regardless of registration mode. Passing `matches: ['<all_urls>']`
with `registration: 'runtime'` produces the exact same manifest permission footprint as a normal
manifest-registered content script. This is not a hypothetical — it's read directly out of the
installed `wxt@0.21.4` source, not inferred from docs (the public WXT content-script docs don't
cover this at all).

**The actual fix:** omit `matches` entirely (it's optional when `registration: 'runtime'` —
`validation.mjs` only requires it for manifest-registered scripts) or WXT still calls
`matches?.forEach(...)`, which is a no-op on `undefined`/`[]`. Concretely:

- The content script (`entrypoints/page-agent.content.ts`) is `defineContentScript({ registration:
  'runtime', runAt: 'document_end', main })` — no `matches` key at all.
- `lib/pageAgentBridgeRegistration.ts` owns actual injection: it reads
  `chrome.permissions.getAll()` for whatever origins are currently granted and calls
  `chrome.scripting.registerContentScripts()` (for future navigations) plus
  `chrome.scripting.executeScript()` (to inject into already-open matching tabs immediately),
  scoped only to those granted origins. It resyncs on `chrome.permissions.onAdded`/`onRemoved` and
  on service-worker startup — wired from `entrypoints/background.ts`.
- Filename matters: WXT classifies entrypoints as `content-script` type purely by filename pattern
  (`content.ts`, `*.content.ts`, `content/index.ts`, …), independent of whether the module calls
  `defineContentScript`. The content-script type gets a build-time evaluation environment with
  `window`/`document` shims; a same-logic file named as a plain `unlisted-script` does not, and
  will crash the build the moment any transitively-imported module touches `window`/`document`
  or `location` at module scope (real crash encountered while building this: a `page-controller`
  DOM module blew up during WXT's analysis pass once the file was renamed off the `content.ts`
  pattern). **Guideline: if a script needs the DOM-aware analysis environment, keep it named as a
  content-script-pattern file and use `registration: 'runtime'` with no `matches` — don't rename it
  to dodge the pattern.**

**Guideline for anything that needs multi-tab / other-origin access going forward:**
`chrome.permissions.request()` only succeeds when called **synchronously inside a user gesture**
(a click handler, before any other `await`). See `lib/hostPermissions.ts`
(`ensureBroadHostAccess`, `requestHostAccessFor`) and its call site in `agent/useAgent.ts`'s
`execute()` — the request happens as the literal first statement, before `createSession()` or
anything else that awaits. Don't move a permission request deeper into an async chain; by the time
you're a few `await`s past the click, the gesture may no longer count and the browser silently
denies the request.

**Guideline for UI that depends on grant state:** don't conflate "no permission granted yet" with
"blocked by policy." `useAgent.ts`'s `checkAccess()` used to treat `chrome.tabs.sendMessage`
failing (content script absent) as `isSiteBlocked: true`, which — once standing host access went
away — meant nearly every site showed as "Restricted" by default. Fixed by checking
`hasHostAccessFor(url)` first: no grant → `siteAccessGranted: false` (a distinct, non-alarming
state, surfaced as an "Enable on this site" pill in the header, calling `requestSiteAccess()`
directly from its `onClick`); grant present → run the real `CHECK_ACCESS` policy check as before.

## 2. No dynamic code execution (`new Function`, `eval`)

**What changed:** `AdvancedTools.executeJavaScript()` (`lib/advancedTools.ts`) — the widget
"Advanced JS execution" tool that ran `new Function(...)` on strings (potentially LLM-generated) —
was deleted, along with its wiring through `lib/widgetRuntime.ts`'s `tools.executeJavaScript`.

**Why:** `new Function()`/`eval()` on dynamically-produced strings is one of the patterns automated
Web Store review scanners flag regardless of where the string originates or how it's sandboxed —
even though this extension's CSP never used `unsafe-eval` (`script-src 'self' 'wasm-unsafe-eval'`),
the construct itself is the signal. Rather than build the sanctioned workaround (a manifest
`sandbox.pages` entry with its own relaxed CSP, running the eval there in a document with zero
extension-API/DOM access, bridged via `postMessage`), the capability was removed outright.

**Guideline:** don't reintroduce `new Function()`/`eval()` for a "run this dynamic code" feature
without going through the sandboxed-page pattern above. A plain `new Function()` call anywhere in
extension-page or content-script code is a review flag even when it's technically safe.

## Also flagged, not yet acted on

From the same review pass — worth revisiting before a Web Store submission:

- **Single Purpose policy risk**: many unrelated entrypoints (calendar, financial monitor, dinner
  planner, dev tools, …) bundled under one listing is a common rejection trigger. Align the listing
  description with actual scope, or split/remove features that don't match the stated purpose.
- **`tabGroups` permission**: declared in `wxt.config.js` but no confirmed `chrome.tabGroups` call
  found — verify usage or drop it (unused permissions are their own signal).
- **Privacy Practices / Data Disclosure tab**: `docs/terms-and-privacy.md` already discloses GA4
  usage analytics and the BYOK/LLM data flow in prose — make sure the Web Store Developer
  Dashboard's own Data Disclosure tab and a hosted (non-GitHub) privacy policy URL are filled in to
  match, since undisclosed analytics is a suspension trigger independent of what the repo docs say.
- **Enhanced Safe Browsing's "not trusted" warning specifically**: expect it on initial launch
  regardless of the above — it's primarily driven by install base/age and developer identity
  verification, which no code change affects. The permission/eval cleanups above reduce how long it
  takes to clear, not whether it appears at first.
