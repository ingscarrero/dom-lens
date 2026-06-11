# DOM Lens

A Chrome MV3 DevTools-panel extension that captures **DOM snapshots**, walks the **React fiber tree**, maps **Module Federation** topology, inspects **JS/CSS module bundles** down to their sourcemapped sources, and feeds everything to a **local OpenAI-compatible AI** (LM Studio, Ollama, llama.cpp, etc.) for on-device analysis.

Everything runs locally. No telemetry, no remote API calls (except to your local AI server).

**Current version: `v0.3.21`**

---

## Features at a glance

| Tab | What it does |
|---|---|
| **Snapshot** | Serialized DOM, full-page screenshot, console errors, network entries |
| **Components** | React fiber tree, live overlay, UX-vision AI analysis, session memory |
| **Federation** | Host ↔ remotes graph, Module Federation / Vite / Native Federation / ESM import maps |
| **Modules** | Module tree → source files, sourcemap probe, AI code analysis, GitHub links, Propose PR |
| **Insights** | Prompt presets, Mermaid diagrams, HTML artifact canvas, Heal/Refine with AI |
| **Analyze** | Chat with local model; streaming SSE; multimodal screenshot support |
| **Settings** | AI endpoint, model, API key, snapshot toggles, GitHub mappings |

---

## Feature details

### Snapshot tab
- Serialized DOM (raw HTML + Markdown via `turndown`)
- Full-page or visible-viewport PNG screenshot (scroll-and-stitch with optional AI-enhanced stitching)
- Captured console errors, network entries, viewport metrics

### Components tab
- Collapsible React fiber tree — works without React DevTools installed
- Detects function / class / memo / forwardRef components; skips host DOM nodes
- Click a node → auto-scrolls the live page to the component; blue overlay highlights its bounds
- **Analyze region with AI**: 9 UX-vision presets (UX Audit, Aesthetics & Branding, Layout & Composition, Usability, Accessibility, Engagement, Wow Factor, Design Trends, Market Research) plus free-text custom prompts
- Sends: cropped screenshot of selected bounds + DOM context (element identity, outerHTML, 25 computed styles, matching CSS rules) + optional session memory
- Results in per-run tabs (badge dots: streaming / done / error); Tree sub-tab stays full-size after switching back
- **Session memory**: save any analysis result to a 24 KB page-scoped memory store; include it in later prompts to chain context (e.g., branding principles from a whole-page analysis grounding layout alternatives for a sub-region)

### Federation tab
- Detects Webpack 5 Module Federation, Vite plugin-federation, Native Federation, and ESM import maps
- Shows host ↔ remotes interactive graph (`@xyflow/react`) with exposed modules and load state
- Sidebar list of remotes with entry URL and loaded/not-loaded badge

### Modules tab
- Classifies every JS/CSS/font/WASM asset loaded by the page (chunk kind, framework, bundler, library)
- Detects ~50 frameworks/libs from `window.*` globals + URL fingerprints
- Hierarchical module tree: origin → folder → file → sourcemapped source files
- Concurrent sourcemap probe (up to 4 parallel HEAD + fetch) with per-module status badge (✓ mapped / ! error / – missing)
- Per-source file viewer with full syntax highlighting (`prism-react-renderer`, CSP-safe — no `eval`)
- Source mode toggle: **📦 Sourcemap** (embedded `sourcesContent`) vs **🐙 GitHub** (fetch from raw.githubusercontent.com)
- AI analysis at module level (Architecture, Dashboard, Risk, Optimize, Diagram, Ideas) and file level (Audit, Improve, Explain) — all streaming, separate tabs, no flicker
- **Propose PR**: after Risk / Optimize / Improve analysis, export a change plan to Cursor, Claude Desktop, Claude.ai, or a GitHub issue
- **GitHub source mappings**: connect module URL patterns to GitHub repos (owner/repo/branch) with `{version}` branch templating and regex version capture

### Insights tab
- Curated prompt presets: component map, federation map, bundle breakdown, data flow, risk review
- Architecture diagrams rendered as live Mermaid SVG
- HTML artifact canvas (sandboxed iframe, `sandbox="allow-scripts"` only, null origin — no extension API access)
- **Heal-with-AI** on Mermaid parse errors; **Refine-with-AI** always available on HTML artifacts

### Analyze tab
- Chat with the local model using the captured snapshot as context
- Streaming SSE via background service worker (bypasses CORS regardless of AI server configuration)
- Optional screenshot as multimodal `image_url` content part (vision models: LLaVA, Qwen2-VL, llava-v1.6, etc.)

### Settings tab
- AI endpoint URL, model name, optional API key, system prompt override
- Snapshot composition toggles (markdown / screenshot / network / console)
- GitHub source mappings management (add / edit / remove entries)

---

## Tech stack

| Concern | Library |
|---|---|
| Build | [WXT](https://wxt.dev) (Vite-based MV3) |
| UI | React 18 + TypeScript + Tailwind CSS |
| State | [zustand](https://github.com/pmndrs/zustand) v5 |
| Component tree | [react-arborist](https://github.com/brimdata/react-arborist) |
| Federation graph | [@xyflow/react](https://reactflow.dev) |
| React fiber walk | [bippy](https://github.com/aidenybai/bippy) |
| HTML → Markdown | [turndown](https://github.com/mixmark-io/turndown) |
| Syntax highlight | [prism-react-renderer](https://github.com/FormidableLabs/prism-react-renderer) — CSP-safe, no `eval` |
| Source maps | [@jridgewell/sourcemap-codec](https://github.com/nicolo-ribaudo/source-map-codec) — CSP-safe VLQ decode |
| Diagrams | [mermaid](https://mermaid.js.org/) |
| Markdown | [react-markdown](https://github.com/remarkjs/react-markdown) + remark-gfm |

---

## Quick start

### Prerequisites
- Node.js 18+ and [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- Chrome 115+
- A running local AI server — see [AI setup runbook](docs/runbooks/ai-setup.md)

### Install and build

```bash
git clone https://github.com/ingscarrero/dom-lens.git
cd dom-lens
pnpm install
pnpm build
```

### Load the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `dom-lens/.output/chrome-mv3/`

### Development (hot reload)

```bash
pnpm dev
```

WXT launches a Chrome profile with the extension pre-loaded and auto-reloaded on save.

---

## Using the extension

1. Open DevTools (`Cmd+Opt+I` on macOS / `F12` on Windows/Linux) on any page.
2. Click the **DOM Lens** tab in the DevTools toolbar.
3. Click **Capture snapshot**.
4. Browse the tabs to inspect captured data.
5. Open **Settings** → configure your local AI endpoint (LM Studio defaults to `http://localhost:1234/v1`).
6. Use **Analyze** or per-tab AI actions to interrogate the snapshot with the model.

> **Tip:** if you see *"DOM Lens main-world script not present on this page"*, reload the page. The MAIN-world content script runs at `document_start` and must be injected before capture.

---

## Documentation index

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | Message flows, entrypoint map, design decisions |
| [Module reference](docs/modules-reference.md) | Every `lib/` module explained |
| [Dev setup runbook](docs/runbooks/dev-setup.md) | Full local development environment |
| [AI setup runbook](docs/runbooks/ai-setup.md) | LM Studio / Ollama / llama.cpp server setup |
| [MF demo runbook](docs/runbooks/mf-demo.md) | Running the Module Federation example app |
| [GitHub mappings runbook](docs/runbooks/github-mappings.md) | Connecting modules to GitHub source repos |
| [Troubleshooting runbook](docs/runbooks/troubleshooting.md) | Common errors and fixes |
| [Changelog](CHANGELOG.md) | Version history |

---

## License

Private repository — all rights reserved.
