# DOM Lens — Module Reference

Every module in `lib/` is documented here. Modules are grouped by subdirectory.

---

## `lib/artifacts/`

### `extractArtifacts.ts`
Extracts fenced ` ```html ` blocks from LLM markdown output. Returns `{ lang, code }[]`. Used by `MarkdownRenderer` to render HTML artifacts in sandboxed iframes.

---

## `lib/bridge/`

### `protocol.ts`
Single source of truth for the port message protocol between the panel and the background service worker. Exports `PanelToBg`, `BgToPanel`, `LmChatPayload`, `ChatMessage`, `ContentPart`. No runtime logic — pure types + the `CHANNEL` constant (`'dom-lens'`).

### `mainWorld.ts`
`postMessage` helper for the MAIN-world ↔ ISOLATED-world bridge (content.ts ↔ injected.content.ts). Wraps messages with the `dom-lens` channel namespace. Reserved for future bridging paths.

---

## `lib/components/`

### `uxVisionPrompts.ts`
UX vision preset definitions and prompt builder for the Components tab.

**Exports:**
- `UX_PRESETS`: 9 preset objects — each has `{ id, label, icon, systemPrompt, userPromptTemplate }`. Presets: `ux-audit`, `aesthetics`, `layout`, `usability`, `a11y`, `engagement`, `wow`, `trends`, `market`. Plus `customPromptId` / `customPromptLabel` constants.
- `UxDomContext`: type for DOM inspection results (`element`, `computed`, `cssRules`, metadata about accessibility).
- `buildUxVisionPayload(opts)`: assembles the `LmChatPayload` for an analysis run. Accepts: screenshot crop (data URL), DOM context, memory entries, preset or custom prompt. Memory section is prepended first so the model has context before reading the current question.
- `describeInputs(opts)`: returns a bullet list of what was sent to the model (for the Inputs panel in each analysis tab).
- `formatDomContext(ctx)`: renders `UxDomContext` as a `## DOM context` Markdown section.

---

## `lib/concurrency/`

### `pool.ts`
Capped async concurrency pool. `createPool(maxConcurrent: number)` returns a `run<T>(fn: () => Promise<T>): Promise<T>` function. Queues tasks and releases slots as they complete. Used with `maxConcurrent=4` for the sourcemap probe pass — matches Chrome's per-origin connection limit and avoids flooding the page's server.

---

## `lib/diagrams/`

### `mermaid.ts`
Thin wrapper around the `mermaid` library. Exports `renderMermaid(id, source): Promise<{ svg }>`. Initialises mermaid once with dark-theme defaults. Callers are responsible for error handling.

### `extractMermaid.ts`
Extracts ` ```mermaid ` fenced blocks from a markdown string. Returns `string[]`. Used to pull diagrams out of LLM replies for separate rendering.

---

## `lib/federation/`

### `detect.ts`
Module Federation detection heuristics. Runs in the MAIN world (called from `window.__dom_lens__.capture()`).

Detection strategies:
- **Webpack 5**: checks `window.__webpack_share_scopes__`, `__webpack_require__.S`, `__webpack_require__.f?.consumes`
- **Vite plugin-federation**: checks `window.__federation__`, `__federation_method_getRemote`
- **Native Federation**: checks `window.__FEDERATION__`
- **ESM import maps**: parses `<script type="importmap">` for remote URLs

Remote enumeration walks `__webpack_share_scopes__.default` and any `window[containerName].get` / `.init` container globals.

Returns `FederationGraph | null`.

### `graph.ts`
Types for federation topology: `FederationGraph`, `Remote`, `SharedModule`. Pure data — no detection logic.

---

## `lib/llm/`

### `rules.ts`
Shared prompt rules for LLM output consistency. Currently contains Mermaid diagram rules (one statement per line, no `end` keyword, allowed diagram types, etc.) injected into every diagram-generating prompt.

---

## `lib/lm-studio/`

### `client.ts`
Raw OpenAI-compatible HTTP client. Exports:
- `chatStream(payload, signal?)`: async generator that yields `{ delta, done }` objects from an SSE stream. Handles `[DONE]` sentinel and malformed chunks.
- `chatOneshot(payload)`: single-shot (non-streaming) call; returns full text.

Used only by the background SW — never from the panel directly.

### `oneshotProxy.ts`
Panel-side proxy for `lm.oneshot` port messages. `createOneshotProxy({ post, awaitResult })` returns an `async (payload) => { ok, text }` function. The panel calls this; the proxy posts a `lm.oneshot` message with a UUID `requestId` and resolves when `lm.oneshot.result` arrives.

### `streamingProxy.ts`
Panel-side proxy for `lm.stream` port messages. `createStreamingProxy({ post, registerHandlers, unregisterHandlers })` returns a `(payload, handlers) => cancelFn` function. Handlers: `{ onDelta, onDone, onError }`. The proxy posts `lm.stream`, registers callbacks by `requestId`, and cleans up on done/error.

### `LlmContext.tsx`
React Context for `streamingOneshot`. `<LlmProvider value={streamingOneshot}>` wraps `App`. `useLlm()` returns the streaming proxy from anywhere in the tree. Used by `MermaidBlock` and `ArtifactBlock` for their Heal/Refine actions.

---

## `lib/memory/`

### `sessionMemory.ts`
Per-page session memory for chaining AI analysis context.

**Constants:**
- `MAX_ENTRY_BYTES = 6144` — single entry ceiling (text truncated with `…(truncated)` marker)
- `MAX_TOTAL_BYTES = 24576` — total budget per page key (FIFO eviction)

**Key types:**
- `MemoryEntry`: `{ id, label, sourceId?, icon?, componentName?, componentKind?, text, timestamp }`

**Key functions:**
- `pageKey(url)` — `origin + pathname`, strips query and hash
- `addMemoryEntry(prev, entry)` — prepends new entry, truncates text, evicts oldest to fit budget
- `removeMemoryEntry(prev, id)` — filters by id
- `formatMemoryForPrompt(entries)` — emits `## Memory from prior analyses on this page` Markdown section
- `memoryStats(entries)` — `{ count, bytes, budget }` for toolbar display

---

## `lib/modules/`

### `types.ts`
Core module types: `ModuleEntry`, `ModuleKind`, `FrameworkHint`, `BundlerHint`, `SourceFile`, `ParsedSourceMap`, `ModuleTreeNode`.

### `fingerprints.ts`
URL and global-name fingerprint database. Exports `FINGERPRINTS: Fingerprint[]` — each with `pattern` (URL substring or regex) and `{ framework, bundler }` result. ~50 entries covering React, Vue, Angular, Svelte, Next, Nuxt, Remix, SvelteKit, webpack, Vite, Rollup, esbuild, and major CDNs.

### `classify.ts`
Classifies a `PerformanceResourceTiming` entry into a `ModuleEntry`. Applies fingerprints, derives `kind` (js-chunk / js-entry / css / image / font / wasm / other).

### `detect.ts`
MAIN-world module inventory. Reads `window.performance.getEntriesByType('resource')` and emits raw timing entries. Called from `window.__dom_lens__.capture()`.

### `pageInventory.ts`
Orchestrates `detect` + `classify` into a `ModuleEntry[]` list for the panel store.

### `sourcemap.ts`
Parses a raw sourcemap JSON string using `@jridgewell/sourcemap-codec`. Returns `ParsedSourceMap`: `{ sources, sourcesContent, mappings }` where `mappings` is the decoded VLQ array. Wraps errors with URL + step context.

### `sourcemapProbe.ts`
Concurrent probe pass for a list of `ModuleEntry` objects. Uses `lib/concurrency/pool.ts` (max 4). For each module: HEAD-probes for the `.map` URL (checks `SourceMap` / `X-SourceMap` headers), then fetches and parses if found. Updates `ModuleEntry.status` in-place.

### `moduleTree.ts`
Builds the hierarchical tree from a `ModuleEntry[]` list. Groups by origin, then reconstructs folder structure from sourcemap `sources` paths. Returns `ModuleTreeNode[]`.

### `fetchProxy.ts`
`createFetchProxy` and `createHeadProxy` — panel-side helpers that wrap `net.fetch` / `net.head` port messages into `async (url) => result` functions. Thin wrappers over the waiter-map pattern in `App.tsx`.

### `githubMapping.ts`
GitHub source mapping data model and URL resolution.

**Types:**
- `GithubMapping`: `{ id, label, urlPattern, owner, repo, branch, basePath?, versionCapture? }`

**Key functions:**
- `findMappingForModule(moduleUrl, mappings)` — first-match-wins substring search
- `normalizeSourcePathForGithub(sourcePath)` — strips webpack/vite/rollup scheme prefixes. Two-pass: triple-slash first (`webpack:///`), then namespaced variant (`webpack://<namespace>/`), for all four schemes.
- `resolveGithubFileUrl(mapping, sourcePath, moduleUrl?)` — builds `raw.githubusercontent.com` URL; substitutes `{version}` from `versionCapture` regex if configured.

### `analyzeFile.ts`
Prompt builders for file-level AI analyses: **Audit** (security + correctness), **Improve** (refactoring + modernisation), **Explain** (plain-English walkthrough). Returns `LmChatPayload`.

### `analyzeModule.ts`
Prompt builders for module-level AI analyses: **Architecture** (component breakdown), **Dashboard** (health metrics), **Risk** (vulnerabilities), **Optimize** (bundle/perf), **Diagram** (Mermaid architecture), **Ideas** (opportunities). Returns `LmChatPayload`.

### `proposePr.ts`
Change-plan prompt + multi-target export for the Propose PR feature.

**`EXPORT_TARGETS`**: array of export targets, each with `{ id, label, build(plan, opts) → { kind, url | run } }`:
- **Cursor**: `cursor://anysphere.cursor-deeplink/prompt?text=…`
- **Claude Desktop**: `claude://claude.ai/new?q=…`
- **Claude.ai**: `https://claude.ai/new?q=…`
- **GitHub issue**: `https://github.com/new/issue` with prefilled body

All truncated to 8 KB per deeplink (Chrome URL dispatch chokes at ~30 KB; Claude.ai truncates at ~14 KB).

### `reformat.ts`
MAIN-world image usage scanner. Finds `<img>` and CSS `background-image` URLs, returns structured list with element context. Used by the image-usage viewer in the Modules tab.

### `skeleton.ts`
JS/CSS skeleton extractor — no LLM required. For JS: extracts top-level function/class/const names via lightweight regex. For CSS: extracts selector names and custom property declarations. Returns a compact structural summary for the CodeMapView.

### `summarizeSymbol.ts`
Per-symbol LLM summarize: takes a function/class body, returns a one-paragraph description via `lm.oneshot`. Used in the CodeMapView for on-demand symbol docs.

### `viewers.ts`
Registry mapping `ModuleKind` → viewer component. Allows the ModulesTab to render different asset kinds with appropriate viewers without a big switch statement.

---

## `lib/react/`

### `walkFiber.ts`
Fiber traversal using `bippy`. Walks `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` fiber roots. Skips host DOM nodes (tags start with lowercase). Returns raw fiber objects. Runs in the MAIN world.

### `fiberToTree.ts`
Converts raw fiber objects to `ComponentNode[]` — the serialisable shape used by the panel store and react-arborist tree.

`ComponentNode`: `{ id, name, kind, key?, bounds?, tag?, hint?, children }`

`kind` detection:
- `memo` — fiber type has `$$typeof === Symbol(react.memo)`
- `forwardRef` — fiber type has `$$typeof === Symbol(react.forward_ref)`
- `class` — fiber type prototype has `isReactComponent`
- `function` — all other named functions

---

## `lib/snapshot/`

### `types.ts`
`Snapshot` type: `{ id, url, title, capturedAt, dom, screenshot, react?, federation?, network, console, modules?, webVitals? }`.

`HarEntry`: extended `PerformanceResourceTiming` with `sourceMapUrl?`, `sourceMapStatus?` fields added by the probe pass.

### `capture.ts`
Snapshot capture orchestrator (runs in the panel, calls into MAIN world + background). Drives the capture flow:
1. `inspectedWindow.eval` → `window.__dom_lens__.capture()`
2. Tile capture loop (if full-page enabled)
3. Assemble and store `Snapshot`

### `serializeDom.ts`
Wraps `turndown` for DOM → Markdown. Applies size limits (configurable `maxMarkdownChars`). Strips `<script>` and `<style>` content. Returns `{ html, markdown, charCount }`.

### `fullPage.ts`
Full-page scroll-and-stitch orchestrator. Primes lazy-loaded content (scroll to bottom, wait, re-measure), hides fixed/sticky elements, captures tiles, re-shows elements.

### `slicer.ts`
Canvas-based tile stitcher. Takes an array of `{ dataUrl, scrollY }` pairs and composites them into a single PNG data URL.

### `enhanceStitch.ts`
AI-enhanced stitch seam correction. Sends overlapping tile regions to the LLM for blending; assembles the corrected seam tiles.

### `cropRegion.ts`
Crops a document-coordinate bounding box from the full snapshot screenshot using DPR (device pixel ratio) mapping. Returns a cropped `dataURL` or `null` if the bounds fall outside the screenshot extent. Used by the Components tab to send only the selected component's region to the UX vision model.

---

## `lib/storage/`

### `settings.ts`
`chrome.storage.local` wrapper for extension settings.

`Settings` type:
```ts
{
  baseUrl: string;           // AI server endpoint (default: 'http://localhost:1234/v1')
  model: string;             // model name
  apiKey?: string;           // optional API key
  systemPrompt?: string;     // system prompt override
  includeScreenshot: boolean;
  includeMarkdown: boolean;
  includeNetwork: boolean;
  includeConsole: boolean;
  maxMarkdownChars: number;
  githubMappings: GithubMapping[];
}
```

`loadSettings()` → `Promise<Settings>`. `saveSettings(partial)` merges and writes. `onSettingsChanged(cb)` subscribes to `chrome.storage.onChanged`; returns unsubscribe function.

---

## `lib/ui/`

### `Tabs.tsx`
Generic horizontal tab strip + content slot.

```ts
type TabItem = {
  id: string;
  label: string;
  badge?: 'streaming' | 'done' | 'error';
  closable?: boolean;
  icon?: string;
};
```

Badge dot colors: `streaming` → sky (pulsing), `done` → emerald, `error` → red.

Props: `tabs`, `activeId`, `onSelect`, `onClose?`, `children` (content for active tab).

### `CodeViewer.tsx`
Syntax-highlighted source file viewer. Uses `prism-react-renderer` — no eval, CSP-safe. Features: line numbers, copy-to-clipboard button, language detection from file extension (JS/JSX/TS/TSX/CSS/JSON/HTML). Dark theme matching the panel.

### `MermaidBlock.tsx`
Renders a Mermaid diagram from a source string. Props:
- `source` — Mermaid diagram text
- `streaming` — if true, defers render until source stops changing (prevents mid-stream flicker)
- `onHealed?` — callback receiving a corrected source after Heal-with-AI

On parse error: shows error message + "Heal with AI" button (requires `useLlm()` context). Heal sends the broken source + error to the model and replaces with the fixed diagram.

### `ArtifactBlock.tsx`
Renders HTML in a sandboxed iframe (`sandbox="allow-scripts"` only, null origin). Props:
- `html` — initial HTML content
- `streaming` — defers render until streaming stops

Always shows a "Refine with AI" button. Refine sends current HTML + instructions to the model; replaces iframe content with the streamed result.

### `MarkdownRenderer.tsx`
`react-markdown` with custom renderers for:
- ` ```mermaid ` blocks → `MermaidBlock`
- ` ```html ` blocks → `ArtifactBlock`
- Code blocks → `CodeViewer` (for non-diagram/artifact code)
- Tables → styled with Tailwind

### `MarkdownEditor.tsx`
`<textarea>` + live preview panel for editing Markdown (used in Insights scratchpad).

### `JsonViewer.tsx`
`@uiw/react-json-view` wrapper with consistent dark theme. Used in the Snapshot tab raw JSON view.

### `healPrompts.ts`
System + user prompt templates for Heal-with-AI (Mermaid) and Refine-with-AI (HTML artifact) actions. Kept here so they can be tuned independently of the component code.
