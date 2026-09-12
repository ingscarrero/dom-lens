# DOM Lens — Requirements

This document states what DOM Lens must do (functional requirements, per
panel tab) and how well it must do it (non-functional requirements). Each
requirement is traced to the code that implements it so a reviewer can
verify the claim rather than take it on faith. Numbers quoted for budgets
are the constants in the source, not aspirations.

Conventions: **FR-x.y** functional, **NFR-x.y** non-functional.
Status: ✅ implemented · ⚠️ partial · ❌ not yet.

---

## 1. Functional requirements

### 1.1 Snapshot tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-1.1 | Capture the inspected page's DOM as raw HTML and as semantic Markdown, stripping `script`/`style`/`svg`/`iframe`, annotating `data-testid` / `aria-label` elements so the model can reference them | `lib/snapshot/serializeDom.ts`, called from `lib/snapshot/capture.ts` inside `window.__dom_lens__.capture()` (`entrypoints/injected.content.ts`) | ✅ |
| FR-1.2 | Capture a full-page screenshot by scroll-and-stitch, priming lazy-loaded content first and hiding `position: fixed/sticky` elements so they are not re-stamped on every tile | `lib/snapshot/fullPage.ts`, `beginFullPageCapture` / `startPrimeLazyLoad` in `injected.content.ts`, `entrypoints/panel/captureFlow.ts` | ✅ |
| FR-1.3 | Fall back to a visible-viewport capture when full-page capture fails (tile cap, scroll-locked page) and tell the user why | `captureFlow.ts` → `captureViewportOnly`, `store.setCaptureError` | ✅ |
| FR-1.4 | Optionally correct stitch seams with the model (AI-enhanced stitch) | `lib/snapshot/enhanceStitch.ts`, `entrypoints/panel/enhanceFlow.ts` | ✅ |
| FR-1.5 | Record console output emitted while the page runs (before DevTools opened) and network entries seen by DevTools | console patching + `createConsoleBuffer` (cap 200) in `injected.content.ts`; `entrypoints/panel/hooks/useNetwork.ts` | ✅ (`error` / `unhandledrejection` listeners included; cross-origin iframes and workers are not seen — see ADR-0002) |
| FR-1.6 | Show viewport metrics, tech-stack fingerprints and the raw snapshot JSON | `lib/modules/detect.ts`, `lib/modules/fingerprints.ts`, `lib/ui/JsonViewer.tsx`, `tabs/SnapshotTab.tsx` | ✅ |

### 1.2 Components tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-2.1 | Walk every React fiber root on the page **without** requiring React DevTools, and without installing or patching `__REACT_DEVTOOLS_GLOBAL_HOOK__` | `lib/react/walkFiber.ts` (DOM scan for `__reactContainer$*` / legacy `_reactRootContainer`) | ✅ |
| FR-2.2 | Present function / class / memo / forwardRef / provider / suspense nodes; skip host DOM nodes but keep their component children | `walkFiber.ts` (`FIBER_TAG`, `buildNode`) → `ComponentNode` (`lib/react/fiberToTree.ts`) | ✅ |
| FR-2.3 | Attach document-space bounds, host tag and a short hint (aria-label → title → alt → text → href) to each node | `readBounds`, `readMetadata` in `walkFiber.ts` | ✅ |
| FR-2.4 | Selecting a node scrolls the live page to it and paints an overlay | `scrollToBounds`, `highlight`, `clearHighlight` in `injected.content.ts`; `tabs/ComponentsTab.tsx` | ✅ |
| FR-2.5 | Analyze the selected region with 9 UX-vision presets or a custom prompt, sending the cropped screenshot plus DOM context (element identity, 25 computed styles, ≤ 30 matching CSS rules) | `lib/components/uxVisionPrompts.ts`, `lib/snapshot/cropRegion.ts`, `inspectAtBounds` in `injected.content.ts` | ✅ |
| FR-2.6 | Save analysis results to per-page session memory and fold them into later prompts | `lib/memory/sessionMemory.ts`, `store.ts` (`memoryByPage`) | ✅ |
| FR-2.7 | Keep the tree mounted while an analysis tab is active so react-arborist keeps its measurements | `ComponentsTab.tsx` (`display:none`, see ADR-0005) | ✅ |

### 1.3 Federation tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-3.1 | Detect Webpack 5 Module Federation, Vite plugin-federation, Native Federation and ESM import maps from page globals and `<script>` tags | `lib/federation/detect.ts` | ✅ |
| FR-3.2 | Enumerate remote containers (name, entry URL, exposed modules, loaded state) and shared scopes; never throw on cross-origin iframe globals | `readWebpackContainers` in `detect.ts` (frame-name skip + try/catch) | ✅ |
| FR-3.3 | Render the host ↔ remotes topology as an interactive graph and a sidebar list | `tabs/FederationTab.tsx` (`@xyflow/react`), `lib/federation/graph.ts` types | ✅ |

### 1.4 Modules tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-4.1 | Inventory every resource the page loaded — including assets loaded before DevTools opened — and classify by chunk kind, framework, bundler and library | `lib/modules/pageInventory.ts`, `lib/modules/classify.ts` | ✅ |
| FR-4.2 | Probe sourcemap availability for every JS/CSS module (header → HEAD sibling → lazy fetch) with a live status badge and progress | `lib/modules/sourcemapProbe.ts`, `lib/concurrency/pool.ts`, `net.head` in `background.ts` | ✅ |
| FR-4.3 | Parse sourcemaps without `eval` (MV3 CSP), attribute bytes per source, expose `sourcesContent`, and surface actionable errors (step + URL + body peek) | `lib/modules/sourcemap.ts` (`SourcemapFetchError`) | ✅ |
| FR-4.4 | Show a Sources-panel-style tree: origin → folder → module → authored sources | `lib/modules/moduleTree.ts`, `tabs/modules/ModulesTree.tsx` | ✅ |
| FR-4.5 | View any source file with syntax highlighting; toggle between embedded sourcemap content and the file fetched from GitHub | `lib/ui/CodeViewer.tsx`, `tabs/modules/FileDetail.tsx`, `lib/modules/githubMapping.ts` | ✅ |
| FR-4.6 | Map module URL patterns to GitHub repos with `{version}` branch templating and path normalisation for webpack/vite/rollup prefixes | `githubMapping.ts`, `tabs/SettingsTab.tsx` | ✅ |
| FR-4.7 | For modules without sourcemaps, extract a structural skeleton without an LLM and summarise individual symbols on demand | `lib/modules/skeleton.ts`, `lib/modules/summarizeSymbol.ts` (see `docs/CODE_MAPPING.md`) | ✅ |
| FR-4.8 | Run streaming module-level (Architecture, Dashboard, Risk, Optimize, Diagram, Ideas) and file-level (Audit, Improve, Explain) analyses in separate tabs | `lib/modules/analyzeModule.ts`, `lib/modules/analyzeFile.ts`, `lib/ui/Tabs.tsx` | ✅ |
| FR-4.9 | Export a change plan to Cursor, Claude Desktop, Claude.ai or a GitHub issue via deep link | `lib/modules/proposePr.ts` (`EXPORT_TARGETS`) | ✅ |

### 1.5 Insights tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-5.1 | Offer curated prompt presets (component map, federation map, bundle breakdown, data flow, risk review) plus user-defined prompts | `tabs/prompts.ts`, `settings.customPrompts` | ✅ |
| FR-5.2 | Render Mermaid blocks in model output as SVG and offer Heal-with-AI on parse errors | `lib/diagrams/*.ts`, `lib/ui/MermaidBlock.tsx`, `lib/ui/healPrompts.ts` | ✅ |
| FR-5.3 | Render HTML artifacts in a sandboxed iframe (`sandbox="allow-scripts"`, null origin) and offer Refine-with-AI | `lib/artifacts/extractArtifacts.ts`, `lib/ui/ArtifactBlock.tsx` | ✅ |

### 1.6 Analyze tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-6.1 | Chat with the local model using the snapshot (markdown, React summary, federation summary, console) as context | `lib/lm-studio/client.ts` (`buildSnapshotPrompt`), `tabs/AnalyzeTab.tsx` | ✅ |
| FR-6.2 | Stream tokens via SSE through the service worker; support cancel | `lm.chat.start` / `lm.chat.cancel` in `background.ts`, `chatStream` in `client.ts` | ✅ |
| FR-6.3 | Optionally attach the screenshot (whole or sliced into ≤ 16 tiles) as multimodal `image_url` parts | `lib/snapshot/slicer.ts`, `settings.sendSlicedTiles` | ✅ |

### 1.7 Settings tab

| ID | Requirement | Implementation | Status |
|---|---|---|---|
| FR-7.1 | Configure endpoint, model, optional API key, system prompt and a connection test that lists models | `lib/storage/settings.ts`, `lm.test` in `background.ts`, `tabs/SettingsTab.tsx` | ✅ |
| FR-7.2 | Toggle snapshot composition (markdown, screenshot, React tree, federation, network, console) and size knobs | `Settings` type, `DEFAULT_SETTINGS` | ✅ |
| FR-7.3 | Manage GitHub source mappings (add / edit / remove, parse `owner/repo` or a GitHub URL) | `parseRepoSpec` in `githubMapping.ts`, `SettingsTab.tsx` | ✅ |
| FR-7.4 | Persist settings in `chrome.storage.local` and react to external changes | `loadSettings`, `saveSettings`, `onSettingsChanged` | ✅ |

---

## 2. Non-functional requirements

### 2.1 Performance budgets

These are the caps enforced in code. They exist because the panel runs
inside DevTools next to the page being debugged, and because local LLM
servers have small context windows and few inference slots.

| ID | Budget | Value | Where |
|---|---|---|---|
| NFR-P.1 | Concurrent network probes / fetches from the panel | hard cap **4** (`MAX_CONCURRENCY`), default 4 | `lib/concurrency/pool.ts` |
| NFR-P.2 | Single `net.fetch` response size | **32 MB** default cap (`maxBytes`) | `entrypoints/background.ts` |
| NFR-P.3 | Serialized DOM markdown sent to the model | `maxMarkdownChars`, default **20 000** chars (`serializeDom` default 50 000); truncated with a marker | `lib/storage/settings.ts`, `lib/snapshot/serializeDom.ts` |
| NFR-P.4 | React fiber walk | **5 000** nodes (`MAX_NODES`), result flagged `truncated` | `lib/react/walkFiber.ts` |
| NFR-P.5 | Console buffer retained before capture | **200** entries | `lib/snapshot/capture.ts` |
| NFR-P.6 | Full-page screenshot | ≤ **20** tiles (`fullPageMaxTiles`), ≥ **600 ms** between tiles (Chrome caps `captureVisibleTab` at ~2/s), 4 retries with exponential backoff; lazy-load priming times out after **45 s** | `captureFlow.ts`, `background.ts`, `fullPage.ts` |
| NFR-P.7 | Screenshot slicing for multimodal prompts | ≤ **16** tiles, ~2048 px per tile | `lib/snapshot/slicer.ts` |
| NFR-P.8 | DOM context for UX analyses | ≤ **30** matching CSS rules, scanning ≤ **8 000** rules | `inspectAtBounds` in `injected.content.ts` |
| NFR-P.9 | Session memory | **6 KB** per entry, **24 KB** per page, FIFO eviction | `lib/memory/sessionMemory.ts` |
| NFR-P.10 | Source sent to the model | file analyses **24 KB**; module analyses ~**28 KB** curated concatenation; symbol summaries **16 KB**; Propose-PR deep links **8 KB** | `analyzeFile.ts`, `analyzeModule.ts`, `summarizeSymbol.ts`, `proposePr.ts` |
| NFR-P.11 | Skeleton extraction for a 1 MB minified bundle | < 1 s, no LLM call | `lib/modules/skeleton.ts`, `docs/CODE_MAPPING.md` |

### 2.2 Security and CSP posture

| ID | Requirement | Implementation |
|---|---|---|
| NFR-S.1 | Comply with the MV3 extension-page CSP: no `eval`, `new Function` or inline scripts | All code bundled by WXT; `@jridgewell/sourcemap-codec` replaces `source-map-js` (ADR-0003); `prism-react-renderer` for highlighting |
| NFR-S.2 | Model-generated HTML must never gain extension privileges | `ArtifactBlock.tsx` iframe uses `sandbox="allow-scripts"` only (no `allow-same-origin`) → null origin, no `chrome.*` |
| NFR-S.3 | Never store third-party credentials for GitHub | No PAT field; only unauthenticated `raw.githubusercontent.com` reads (ADR-0004) |
| NFR-S.4 | Requests to the inspected site must not carry the user's cookies | `net.head` / `net.fetch` use `credentials: 'omit'` |
| NFR-S.5 | Minimal permission set | `storage`, `scripting`, `activeTab`, `tabs`; `host_permissions: <all_urls>` is required for the CORS-free LLM proxy and `.map` probing (ADR-0001) |
| NFR-S.6 | The MAIN-world script must not break or be broken by React DevTools | No hook shim or patching (`installDevtoolsHookShim` is a no-op); root discovery is read-only |
| NFR-S.7 | Page globals are untrusted | Every cross-window read in `detect.ts` / `walkFiber.ts` is wrapped in try/catch; iframe-named globals are skipped |

See also [SECURITY.md](../SECURITY.md) for the disclosure policy.

### 2.3 Privacy and data flow

DOM Lens is a local-first tool. Nothing leaves the machine unless the user
configures or clicks something that sends it. The complete list of outbound
traffic:

| Destination | When | What is sent | Control |
|---|---|---|---|
| Configured AI endpoint (`settings.baseUrl`, default `http://localhost:1234/v1`) | Any AI action (Analyze chat, per-tab analyses, Heal/Refine, enhanced stitch) | Page markdown, screenshots / crops (as data URLs), console entries, React and federation summaries, source file contents, session memory, the user's prompt; `Authorization: Bearer <apiKey>` if set | Endpoint and composition toggles in Settings; nothing is sent until the user triggers an action |
| The inspected page's own origins | Modules tab opens (probe) and module expansion (fetch) | `HEAD`/`GET` for `<asset>.map` and `GET` for the asset body, `credentials: 'omit'` | Automatic on Modules tab; only touches URLs the page already loaded. The service-worker proxy refuses non-`http(s)` URLs and loopback / link-local / private-range hosts (`lib/net/urlPolicy.ts`), except the configured AI endpoint and the inspected page's own host |
| `raw.githubusercontent.com` | User toggles 🐙 GitHub source mode and a mapping matches | Unauthenticated `GET` of a public file path derived from the sourcemap | Off by default; mappings are user-defined |
| Cursor / Claude Desktop / Claude.ai / GitHub | User clicks a Propose PR export target | The change plan (≤ 8 KB) embedded in a deep-link URL | Explicit click per export |

Data at rest: only `Settings` (including the optional API key, stored in
plain text in `chrome.storage.local`, readable by this extension alone) and
custom prompts / GitHub mappings. Snapshots, analyses and session memory are
in-memory and discarded when DevTools closes. There is no telemetry, no
crash reporting, no update ping.

API key handling: the key is **not encrypted** at rest — `chrome.storage.local`
is isolated per extension but stored in the clear on disk, so anyone with
access to the browser profile can read it. Prefer keys scoped to a local or
low-privilege endpoint. In transit the key is sent only as
`Authorization: Bearer` to `settings.baseUrl`; when that URL is plain `http://`
on a non-loopback host, the Settings tab shows a warning
(`insecureTransportWarning` in `lib/storage/settings.ts`) because the key and
every snapshot would cross the network unencrypted.

### 2.4 Reliability and error behaviour

| ID | Requirement | Implementation |
|---|---|---|
| NFR-R.1 | A failure in one capture sub-step must not abort the snapshot | `detectFederation` returns a graph with a `detect_error` signal instead of throwing; tech-stack and resource inventory are try/caught in `runCapture` |
| NFR-R.2 | One failed probe/fetch must not fail the batch | `runPool` isolates errors per job (`{ ok: false, error }`) and supports abort |
| NFR-R.3 | HTTP errors are surfaced, not parsed | Service worker checks `res.ok` before returning bodies; `SourcemapFetchError` carries `step`, `mapUrl` and an 80-char body peek |
| NFR-R.4 | In-flight LLM streams are cancellable and cleaned up | `AbortController` per `requestId`; all aborted on port disconnect |
| NFR-R.5 | Closing DevTools leaves no overlay on the page | `port.onDisconnect` runs `clearHighlight` in the MAIN world via `chrome.scripting` |
| NFR-R.6 | Stale MAIN-world script is detected | `ping()` / `version` check surfaces the "main-world script not present" message with a reload hint |

### 2.5 Accessibility of the panel

The panel is a developer tool rendered inside Chrome DevTools, so it
inherits DevTools' zoom and high-contrast behaviour. Current state and gaps:

| ID | Requirement | Status |
|---|---|---|
| NFR-A.1 | Tab strips expose `role="tab"` / `aria-selected` | ✅ `lib/ui/Tabs.tsx` |
| NFR-A.2 | All actions are native `<button>` / `<input>` elements and therefore keyboard-reachable | ✅ (no click handlers on plain `div`s for primary actions) |
| NFR-A.3 | Colour is never the only status carrier | ⚠️ badge dots (streaming/done/error) also change label text, but the sourcemap status badge relies on glyph + colour |
| NFR-A.4 | Arrow-key navigation within tab strips and the component tree | ⚠️ react-arborist provides tree keyboard navigation; the top-level tab strip does not implement roving tabindex |
| NFR-A.5 | Streaming output announced to assistive tech (`aria-live`) | ❌ not implemented |

Contributions closing the ⚠️/❌ rows are welcome — see
[CONTRIBUTING.md](../CONTRIBUTING.md).

### 2.6 Compatibility

- Chrome 115+ (MV3 `world: 'MAIN'` content scripts, `chrome.scripting`).
- Any OpenAI-compatible `/v1/chat/completions` server with SSE streaming;
  vision models required for image parts.
- React 16.8+ pages for the Components tab (legacy `_reactRootContainer`
  and modern `__reactContainer$` roots).
