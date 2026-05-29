# DOM Lens

A Chrome MV3 DevTools-panel extension that captures **DOM snapshots**, walks the **React fiber tree**, maps **Module Federation** topology, and feeds it all to a **local OpenAI-compatible AI** (LM Studio, Ollama, llama.cpp server, etc.) for on-device analysis.

Everything runs locally. No telemetry, no remote services.

## Features

- **Snapshot**: serialized DOM (raw HTML + markdown), full-page or visible-viewport PNG, captured console errors, network entries, viewport metrics.
- **Components**: collapsible React fiber tree — works without React DevTools installed. Detects function/class/memo/forwardRef components, skips host DOM nodes.
- **Federation**: detects Webpack 5 Module Federation, Vite plugin-federation, Native Federation, and ESM import maps. Shows host ↔ remotes graph with exposed modules and load state.
- **Modules**: classifies every JS/CSS/font/wasm asset loaded by the page (chunk kind, framework, bundler, library). Detects ~50 frameworks/libs from `window.*` globals + URL fingerprints. Click any module to lazy-fetch its `.map` and see a per-source byte breakdown.
- **Diagrams**: auto-extracts ` ```mermaid ` fenced blocks from LLM replies and renders them as live SVG. Includes a scratchpad for iterating on a diagram.
- **Analyze**: chat with a local LM Studio / Ollama model, automatically packaging the snapshot as context (markdown + optional screenshot for multimodal models). Streaming SSE. Includes architecture prompt presets (component map, federation map, bundle breakdown, data flow, risk review) that ask the model to reply with Mermaid diagrams.
- **Settings**: configurable endpoint, model name, optional API key, snapshot composition toggles, system prompt.

## Tech stack

- [WXT](https://wxt.dev) — Vite-based MV3 build system
- React 18 + TypeScript + Tailwind CSS
- [`turndown`](https://github.com/mixmark-io/turndown) — HTML → markdown
- [`react-arborist`](https://github.com/brimdata/react-arborist) — virtualized component tree
- [`@xyflow/react`](https://reactflow.dev) — federation graph
- [`source-map-js`](https://github.com/7rulnik/source-map-js) — VLQ parsing for per-source byte attribution
- [`mermaid`](https://mermaid.js.org/) — auto-rendered architecture diagrams
- [`react-markdown`](https://github.com/remarkjs/react-markdown) + [`remark-gfm`](https://github.com/remarkjs/remark-gfm) — markdown rendering in chat + DOM preview
- [`zustand`](https://github.com/pmndrs/zustand) — panel state

## Build & install

```bash
pnpm install
pnpm build
```

Then in Chrome:

1. Visit `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `.output/chrome-mv3/`

For active development with auto-reload:

```bash
pnpm dev
```

WXT launches Chrome with the extension already loaded.

## Using it

1. Open DevTools (Cmd+Opt+I on macOS) on any page.
2. Click the **DOM Lens** tab in the DevTools toolbar.
3. Press **Capture snapshot**.
4. Browse the **Snapshot**, **Components**, **Federation**, **Modules**, and **Diagrams** tabs for the captured data.
5. Open **Settings** to configure the local AI endpoint (LM Studio defaults to `http://localhost:1234/v1`).
6. Use the **Analyze** tab to chat with the model about the snapshot.

If you see "DOM Lens main-world script not present on this page", reload the page — the MAIN-world content script needs to be present at page load to install its instrumentation hooks.

## Local AI setup

### LM Studio

1. Start LM Studio and load a model (a vision model like LLaVA or Qwen2-VL if you want screenshot support).
2. Open the **Developer** tab → enable **CORS** → start the server.
3. Verify: `curl http://localhost:1234/v1/models`.
4. Set DOM Lens base URL to `http://localhost:1234/v1` and click **Test connection**.

### Ollama

1. Make sure Ollama is running: `ollama serve` (default port 11434).
2. Set DOM Lens base URL to `http://localhost:11434/v1`. Model: any local model name, e.g. `llama3.1`.

The extension routes all model HTTP calls through the background service worker, which has `<all_urls>` host permission and bypasses browser CORS preflight regardless of the server's CORS configuration.

## Verification quick-start

1. **React test** — `https://react.dev` → Capture → **Components** tab shows the React tree.
2. **Module Federation test** — clone `module-federation/module-federation-examples`, run `basic-host-remote`, open DOM Lens on the host. Federation tab shows host + `app1` remote.
3. **Non-React test** — `https://example.com` → Capture still works; Components and Federation tabs show empty-state messages.
4. **Analyze test** — Send a snapshot from the Analyze tab and confirm tokens stream into the panel.

## Architecture

```
[Panel React]  ◄── chrome.runtime.connect (long-lived port) ──►  [Background SW]
    │                                                                │
    │  chrome.devtools.inspectedWindow.eval (MAIN world)              │
    │  chrome.devtools.network.onRequestFinished                      │  fetch → LM Studio
    ▼                                                                 │  chrome.tabs.captureVisibleTab
[Inspected page MAIN]  ◄── window.postMessage ──►  [Content ISOLATED] ┘
   (injected.content.ts)                              (content.ts)
```

- **`entrypoints/injected.content.ts`** — MAIN-world content script (runAt: `document_start`). Installs a React DevTools hook shim, patches `console.*`, exposes `window.__dom_lens__.capture()`.
- **`entrypoints/content.ts`** — ISOLATED-world placeholder; reserved for future bridge work.
- **`entrypoints/background.ts`** — Service worker. Owns screenshots (`chrome.tabs.captureVisibleTab`) and proxies streaming LM Studio chat completions.
- **`entrypoints/devtools.html`** — Registers the DevTools panel.
- **`entrypoints/panel/`** — React panel UI.
- **`lib/`** — Shared modules: snapshot capture, React fiber walk, federation detection, LM Studio client, settings storage, message protocol.

## v1 scope cuts

- Full-page (scrolled) screenshots — visible viewport only
- Per-fiber props/state inspection
- Render-timing / re-render diffs
- Snapshot save/load to disk
- Multi-tab tracking
- `chrome.debugger`-based console capture (uses console-patching instead — misses uncaught rejections that don't reach console)
- Source-map symbolication
- Shadow-DOM piercing in the markdown serializer
- Exporting Federation graph as image
