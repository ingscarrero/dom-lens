# DOM Lens — Architecture

## Overview

DOM Lens is a Chrome MV3 DevTools extension. There are four distinct execution contexts at runtime; understanding which code runs where is the key to understanding the whole system.

```mermaid
flowchart TB
    subgraph ext["Extension (chrome-extension://&lt;id&gt;)"]
        panel["DevTools panel<br/>panel/index.html — React + Zustand<br/>the entire UI lives here"]
        sw["Background service worker<br/>background.ts<br/>screenshots · LLM proxy · net.fetch / net.head"]
    end
    subgraph page["Inspected tab"]
        main["MAIN world<br/>injected.content.ts @ document_start<br/>window.__dom_lens__ · sees __webpack_require__, fiber roots"]
        iso["ISOLATED world<br/>content.ts<br/>placeholder for a postMessage bridge"]
    end
    ai[("Local OpenAI-compatible server<br/>LM Studio / Ollama / llama.cpp")]

    panel -- "chrome.runtime.connect (PanelToBg / BgToPanel)" --> sw
    panel -- "chrome.devtools.inspectedWindow.eval" --> main
    sw -- "chrome.tabs.captureVisibleTab" --> page
    sw -- "fetch (host_permissions: all_urls)" --> ai
    main -. "window.postMessage (reserved)" .- iso
```

Only the service worker talks to the network; only the MAIN-world script touches page globals; the panel orchestrates both. See the [C4 views](#c4-views) below for the system boundary and the [sequence diagrams](#sequence-diagrams) for the two main flows.
---

## Entrypoints

### `entrypoints/injected.content.ts` — MAIN world

Declared as a content script with `world: 'MAIN'` and `run_at: 'document_start'`. This means it runs before any page JS and has full access to the page's global scope.

Key responsibilities:
- **React DevTools hook shim**: installs `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` so React registers its fiber root before the panel tries to walk it.
- **Console patching**: wraps `console.error`, `console.warn`, `console.log` to buffer entries for capture.
- **`window.__dom_lens__` API surface**: the Panel calls into this via `inspectedWindow.eval`.
  - `capture()` — serializes DOM to Markdown, walks fiber tree, detects Module Federation, drains console buffer, reads viewport metrics.
  - `highlight(x, y, w, h, label, color)` — draws an overlay `<div>` on the page.
  - `clearHighlight()` — removes the overlay.
  - `scrollToBounds(x, y, w, h)` — smooth-scrolls the viewport to center the given rectangle.
  - `inspectAtBounds(x, y, w, h)` — `elementFromPoint` + ancestor walk-up (≥60% area coverage), returns element identity + 25 computed styles + matching CSS rules.

### `entrypoints/content.ts` — ISOLATED world

Minimal placeholder. Receives `window.postMessage` with `channel: 'dom-lens'` for future bridging if the `inspectedWindow.eval` path is unavailable (e.g., pages that block all eval via CSP).

### `entrypoints/background.ts` — Service worker

Long-lived port router. All panel↔page coordination goes through here.

Message types handled:

| PanelToBg type | What the SW does |
|---|---|
| `panel.hello` | Registers `tabId` → `port` mapping |
| `capture.tile` | `chrome.tabs.captureVisibleTab` → returns PNG data URL |
| `lm.chat.start` | Opens streaming SSE to AI server; forwards `lm.chat.delta` / `lm.chat.done` / `lm.chat.error` |
| `lm.chat.cancel` | Aborts in-flight stream via `AbortController` |
| `lm.test` | `GET /models` health check → `lm.test.result` |
| `net.fetch` | `fetch(url)` → returns text body (used to download sourcemaps) |
| `net.head` | `fetch(url, {method:'HEAD'})` → returns status + headers (sourcemap probe) |
| `lm.oneshot` | One-shot (non-streaming) LLM call → `lm.oneshot.result` |
| `lm.stream` | Streaming LLM call → `lm.stream.delta` / `lm.stream.done` / `lm.stream.error` |
| `lm.stream.cancel` | Aborts streaming request |

### `entrypoints/devtools/` — DevTools page

`index.html` + `main.ts` call `chrome.devtools.panels.create('DOM Lens', …)` to register the panel. This is the only page that can call `chrome.devtools.*` APIs.

### `entrypoints/panel/` — Panel React app

React 18 SPA. `App.tsx` owns the top-level port connection and routes all `BgToPanel` messages to the correct waiting `Promise` resolvers (waiter maps keyed by `requestId`). This gives the rest of the panel a simple async API:

```ts
// fetches a sourcemap and resolves to { ok, text }
const result = await fetchText(url);

// fires a streaming LLM call, calling onDelta for each token
const cancel = streamingOneshot(payload, { onDelta, onDone, onError });
```

---

## C4 views

### Level 1 — System context

```mermaid
C4Context
    title DOM Lens — system context
    Person(dev, "Frontend engineer", "Opens DevTools on a page they are debugging or reviewing")
    System(lens, "DOM Lens", "Chrome MV3 DevTools-panel extension: snapshots, React tree, federation map, module/sourcemap explorer, AI analysis")
    System_Ext(page, "Inspected web page", "Any origin; may use React, webpack/Vite/Module Federation")
    System_Ext(ai, "Local OpenAI-compatible LLM server", "LM Studio, Ollama, llama.cpp — runs on the developer's machine")
    System_Ext(gh, "raw.githubusercontent.com", "Optional, unauthenticated: canonical sources when a GitHub mapping is configured")
    System_Ext(tools, "Cursor / Claude / GitHub issue", "Optional deep-link targets for Propose PR change plans")

    Rel(dev, lens, "Captures, browses, asks questions", "DevTools panel")
    Rel(lens, page, "Reads DOM, fiber roots, globals, resources; probes .map siblings", "inspectedWindow.eval, fetch")
    Rel(lens, ai, "Sends snapshot context, streams completions", "HTTP + SSE")
    Rel(lens, gh, "Fetches original source files", "HTTPS GET")
    Rel(lens, tools, "Opens a prefilled deep link", "cursor:// claude:// https://")
```

### Level 2 — Containers (runtime execution contexts)

```mermaid
C4Container
    title DOM Lens — containers
    Person(dev, "Frontend engineer")
    System_Boundary(ext, "DOM Lens extension") {
        Container(devtools, "DevTools page", "devtools/main.ts", "Registers the panel via chrome.devtools.panels.create")
        Container(panel, "Panel SPA", "React 18 + Zustand + Tailwind", "All UI and orchestration: capture flow, module tree, analyses, settings")
        Container(sw, "Background service worker", "background.ts", "Long-lived port router: screenshots, LLM proxy (SSE), net.fetch / net.head")
        Container(main, "MAIN-world script", "injected.content.ts", "window.__dom_lens__: capture, highlight, scroll, inspectAtBounds")
        Container(iso, "ISOLATED-world script", "content.ts", "Reserved postMessage bridge (placeholder)")
        ContainerDb(storage, "chrome.storage.local", "Settings", "Endpoint, model, API key, toggles, GitHub mappings")
    }
    System_Ext(page, "Inspected page")
    System_Ext(ai, "Local LLM server")
    System_Ext(gh, "raw.githubusercontent.com")

    Rel(dev, panel, "Uses")
    Rel(devtools, panel, "Creates panel")
    Rel(panel, sw, "PanelToBg / BgToPanel messages", "chrome.runtime.connect port")
    Rel(panel, main, "Calls __dom_lens__.*", "inspectedWindow.eval")
    Rel(panel, storage, "loadSettings / saveSettings")
    Rel(sw, page, "captureVisibleTab; HEAD/GET .map", "chrome.tabs, fetch")
    Rel(sw, ai, "POST /chat/completions (stream), GET /models", "fetch")
    Rel(sw, gh, "GET raw file", "fetch")
    Rel(main, page, "Reads DOM, fiber roots, __webpack_* globals")
```

---

## Sequence diagrams

### Capture: panel → background → MAIN world

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as Panel (captureFlow.ts)
    participant M as MAIN world (__dom_lens__)
    participant B as Background SW
    participant C as Chrome (tabs API)

    U->>P: click Capture snapshot
    P->>M: eval scrollMetrics()
    M-->>P: { scrollWidth, scrollHeight, dpr, … }
    P->>M: eval capture({ maxMarkdownChars })
    M->>M: serializeDom · walkAllFiberRoots · detectFederation · drain console · inventory resources
    M-->>P: PartialSnapshot (JSON)
    alt full-page screenshot enabled
        P->>M: eval startPrimeLazyLoad()
        loop poll ≤ 45 s
            P->>M: eval getPrimeLazyLoadStatus()
            M-->>P: running | done { finalHeight }
        end
        P->>M: eval beginFullPageCapture()
        M-->>P: { hiddenCount }
        loop each tile (≤ fullPageMaxTiles, ≥ 600 ms apart)
            P->>M: eval scrollTo(x, y) + getScrollPosition()
            P->>B: port: capture.tile { requestId, tabId }
            B->>C: captureVisibleTab(windowId, png) (retry ×4, backoff)
            C-->>B: data URL
            B-->>P: port: capture.tile.result { requestId, dataUrl }
        end
        P->>M: eval endFullPageCapture()
        P->>P: stitch tiles on canvas
    else viewport only
        P->>B: port: capture.tile
        B-->>P: capture.tile.result
    end
    P->>P: classifyEntries(network, pageResources) → Snapshot
    P->>P: store.setSnapshot(snapshot)
    P-->>U: tabs populate
```

Every port request carries a UUID `requestId`; `App.tsx` keeps a `Map<requestId, resolver>` per message family so concurrent requests never cross wires.

### Sourcemap probe and GitHub mapping

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant P as Panel (ModulesTab)
    participant B as Background SW
    participant S as Site origin
    participant G as raw.githubusercontent.com

    P->>P: classifyEntries → LoadedModule[]
    par up to 4 concurrent (runPool)
        P->>B: port: net.head { url + ".map" }
        B->>S: HEAD /main.js.map (fallback GET Range: bytes=0-0)
        S-->>B: 200 | 404
        B-->>P: net.head.result { status }
    end
    P->>P: badge: ✓ found / – missing / ! error
    U->>P: expand module
    P->>B: port: net.fetch { mapUrl, maxBytes: 32 MB }
    B->>S: GET /main.js.map (credentials: omit)
    S-->>B: JSON
    B-->>P: net.fetch.result { text }
    P->>P: parseSourceMap → sizes, tree, sourcesContent
    U->>P: select source file
    alt sourcesContent present
        P-->>U: CodeViewer shows embedded source
    else stripped (nosources-source-map) or 🐙 GitHub mode
        P->>P: findMappingForModule(moduleUrl, settings.githubMappings)
        P->>P: resolveGithubFileUrl(sourcePath, mapping, moduleUrl) → rawUrl
        P->>B: port: net.fetch { rawUrl }
        B->>G: GET /owner/repo/branch/path (unauthenticated)
        G-->>B: file
        B-->>P: net.fetch.result
        P-->>U: CodeViewer + View on GitHub link
    end
```

---

## Message protocol

Defined in `lib/bridge/protocol.ts`. All messages are plain discriminated union objects — no serialization library.

```ts
type PanelToBg =
  | { type: 'panel.hello'; tabId: number }
  | { type: 'capture.tile'; requestId: string; tabId: number }
  | { type: 'lm.chat.start'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.chat.cancel'; requestId: string }
  | { type: 'lm.test'; baseUrl: string; apiKey?: string }
  | { type: 'net.fetch'; requestId: string; url: string; maxBytes?: number }
  | { type: 'net.head'; requestId: string; url: string }
  | { type: 'lm.oneshot'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.stream'; requestId: string; payload: LmChatPayload }
  | { type: 'lm.stream.cancel'; requestId: string };

type BgToPanel =
  | { type: 'capture.tile.result'; requestId: string; ok: true; dataUrl: string }
  | { type: 'capture.tile.result'; requestId: string; ok: false; message: string }
  | { type: 'lm.chat.delta'; requestId: string; text: string }
  | { type: 'lm.chat.done'; requestId: string }
  | { type: 'lm.chat.error'; requestId: string; message: string }
  | { type: 'lm.test.result'; ok: boolean; models?: string[]; message?: string }
  | { type: 'net.fetch.result'; ... }
  | { type: 'net.head.result'; ... }
  | { type: 'lm.oneshot.result'; ... }
  | { type: 'lm.stream.delta'; requestId: string; text: string }
  | { type: 'lm.stream.done'; requestId: string; fullText: string }
  | { type: 'lm.stream.error'; requestId: string; message: string };
```

Every request carries a `requestId` (UUID). `App.tsx` maintains four `Map<string, resolver>` refs to match responses to callers without any global state.

---

## Capture flow

```mermaid
flowchart TD
    click["User clicks Capture snapshot"] --> flow["captureFlow.ts — runCapture()"]
    flow --> metrics["inspectedWindow.eval → __dom_lens__.scrollMetrics()"]
    metrics --> cap["inspectedWindow.eval → __dom_lens__.capture()<br/>DOM markdown · fiber tree · federation graph<br/>console buffer · tech stack · resource inventory"]
    cap --> full{"fullPageScreenshot?"}
    full -- yes --> prime["startPrimeLazyLoad() — scroll to bottom, wait, re-measure"]
    prime --> hide["beginFullPageCapture() — hide fixed/sticky elements"]
    hide --> tiles["for each tile (≤ fullPageMaxTiles):<br/>scrollTo → post capture.tile → await PNG"]
    tiles --> stitch["stitch tiles on a canvas"]
    stitch --> restore["endFullPageCapture() — restore elements, scroll back"]
    full -- no --> vp["single capture.tile of the visible viewport"]
    restore --> classify["classifyEntries(network, pageResources)"]
    vp --> classify
    classify --> store["Zustand: setSnapshot(snapshot)"]
    tiles -. "tile cap or scroll-locked page" .-> fallback["fall back to viewport-only + captureError"]
    fallback --> classify
```
The scroll-and-stitch path hides fixed/sticky elements before capturing tiles (they'd appear in every tile), re-shows them after, and smooth-scrolls with a re-measure pass to handle lazy-loaded content changing the page height.

---

## LLM proxy design

The panel cannot `fetch` a local AI server directly because:
1. The panel's origin is `chrome-extension://<id>` — the AI server's CORS policy almost certainly doesn't allow this origin.
2. Even if CORS headers are permissive, Chrome sends a preflight `OPTIONS` request which most local AI servers don't handle.

**Solution**: all AI calls go through the background service worker, which has `host_permissions: ['<all_urls>']`. The SW's `fetch` is not subject to the same CORS restrictions as the panel's `fetch`.

Two LLM call patterns:

| Pattern | Port messages | Use case |
|---|---|---|
| **Chat** (`lm.chat.start`) | `lm.chat.delta` × N + `lm.chat.done` | AnalyzeTab main chat |
| **Streaming oneshot** (`lm.stream`) | `lm.stream.delta` × N + `lm.stream.done` | Module/file/UX analyses |
| **Oneshot** (`lm.oneshot`) | `lm.oneshot.result` | Single-pass (non-streaming) tasks |

The streaming paths use an `AbortController` per `requestId` so any in-flight request can be cancelled cleanly.

---

## LlmContext

`lib/lm-studio/LlmContext.tsx` exposes `streamingOneshot` via a React Context so any component in the tree can trigger a streaming LLM call without prop drilling. The `<LlmProvider>` wraps `App`; `useLlm()` is the consumer hook.

Used by:
- `MermaidBlock` (Heal-with-AI)
- `ArtifactBlock` (Refine-with-AI)
- Any future leaf component that needs ad-hoc LLM access

---

## Sourcemap pipeline

```mermaid
flowchart TD
    open["Modules tab opens"] --> inv["pageInventory.ts<br/>performance.getEntriesByType('resource') ∪ devtools network"]
    inv --> cls["classify.ts — chunk kind, framework, bundler, library"]
    cls --> probe["sourcemapProbe.ts — runPool(max 4)"]
    probe --> declared{"SourceMap header<br/>already seen?"}
    declared -- yes --> found["status: declared"]
    declared -- no --> head["net.head(url + '.map')<br/>(SW falls back to GET Range: 0-0)"]
    head -- 2xx --> found2["status: found"]
    head -- 4xx/5xx --> missing["status: missing"]
    head -- network error --> err["status: error"]
    found --> tree["moduleTree.ts — origin → folder → module"]
    found2 --> tree
    missing --> tree
    err --> tree
    tree --> expand["user expands a module"]
    expand --> fetch["net.fetch(map URL, cap 32 MB)"]
    fetch --> parse["sourcemap.ts — decode VLQ with @jridgewell/sourcemap-codec<br/>bytes per source · sourcesContent"]
    parse --> graft["graft 'Authored sources' subtree"]
    graft --> select["user selects a source file"]
    select --> has{"sourcesContent<br/>present?"}
    has -- yes --> view["CodeViewer (prism-react-renderer)"]
    has -- "no (nosources-source-map)" --> gh{"GitHub mapping<br/>matches URL?"}
    gh -- yes --> raw["net.fetch raw.githubusercontent.com"]
    gh -- no --> notice["fallback notice + Map module skeleton"]
    raw --> view
```
**CSP constraint**: `source-map-js` uses `new Function(...)` for VLQ decoding — blocked by the extension page CSP. Replaced with `@jridgewell/sourcemap-codec` (pure JS, no eval).

---

## Session memory

`lib/memory/sessionMemory.ts` — in-memory only (no `chrome.storage`), keyed by `pageKey(url) = origin + pathname`.

Budget model:
- Per-entry cap: 6 KB (text truncated with `…(truncated to fit memory budget)` marker)
- Total budget: 24 KB per page key (oldest entries dropped FIFO when adding a new one would exceed budget)

Prompt injection: `formatMemoryForPrompt(entries)` emits a `## Memory from prior analyses` section, prepended to the user message so the model reads prior context before the current question.

---

## Content Security Policy

The extension panel page has a strict MV3 CSP. Key constraints:
- No `eval`, `new Function`, or `unsafe-eval` — rules out many JS source-map libraries
- No inline `<script>` in HTML — all code is bundled by WXT/Vite
- `sandbox="allow-scripts"` on artifact iframes — no `allow-same-origin`, so iframes run at null origin and cannot call any `chrome.*` API

---

## State management

Zustand store (`entrypoints/panel/store.ts`). Single flat store; no slices.

Major state buckets:

| Key | Type | Purpose |
|---|---|---|
| `tab` | `Tab` | Active top-level tab |
| `snapshot` | `Snapshot \| null` | Last captured page snapshot |
| `settings` | `Settings` | AI endpoint, model, toggles |
| `memoryByPage` | `Record<string, MemoryEntry[]>` | Per-page session memory |
| `chatMessages` | `ChatMessage[]` | AnalyzeTab transcript |
| `modules` | `ModuleEntry[]` | Classified page assets |

Settings are persisted to `chrome.storage.local` via `lib/storage/settings.ts`; all other state is ephemeral (lost on DevTools close).

---

## Design decisions

Each decision below is also recorded as a dated ADR in [`docs/adr/`](adr/README.md) with context, alternatives and consequences.

### Why `inspectedWindow.eval` instead of a content script bridge?

`inspectedWindow.eval` with `{ useContentScriptContext: false }` runs directly in the page's MAIN world — exactly where `__REACT_DEVTOOLS_GLOBAL_HOOK__`, `__webpack_require__`, and `window.__dom_lens__` live. A content script runs in the ISOLATED world and would need a `window.postMessage` bridge to reach MAIN-world globals, adding latency and complexity.

### Why not `chrome.debugger`?

`chrome.debugger` attaches the DevTools protocol and shows a yellow "Chrome is being debugged" bar in the inspected tab — visible and alarming to end users. DOM Lens avoids it by patching `console.*` and listening for `window` `error` / `unhandledrejection` events in the injected script instead. The trade-off: output from cross-origin iframes and web workers is not seen.

### Why replace `source-map-js` with `@jridgewell/sourcemap-codec`?

`source-map-js` uses `new Function(…)` to construct the VLQ decoder — blocked by the MV3 extension page CSP. `@jridgewell/sourcemap-codec` is a pure-JS alternative with no eval.

### Why no PAT storage for GitHub mappings?

Storing a GitHub Personal Access Token in `chrome.storage` creates an attack surface (any content script in a compromised extension could read it). All GitHub fetches are unauthenticated reads of public raw.githubusercontent.com URLs. Propose-PR plans are inert Markdown handed off to external tools (Cursor/Claude/GitHub) — the token never touches the extension.

### Why keep the tree mounted with `display:none`?

`react-arborist` uses a `ResizeObserver` to measure the tree container. Unmounting it on tab switch destroys the observer; when the tree remounts it measures zero and stays miniaturised. Hiding with CSS preserves the observer without re-rendering.
