# Changelog

All notable changes to DOM Lens are documented here.

---

## [Unreleased]

### Added
- Vitest unit suite (110 tests) for the pure `lib/` modules — concurrency pool, asset classification, fingerprints, sourcemap decoding, GitHub mapping, federation detection, fiber walking, DOM serialisation, screenshot slicing — with enforced coverage floors (`vitest.config.ts`).
- GitHub Actions CI: `pnpm compile` → `pnpm test:coverage` → `pnpm build` on every PR and push to `main`, with the coverage report uploaded as an artifact.
- Documentation: `docs/REQUIREMENTS.md`, `docs/SYSTEM_DESIGN.md`, `docs/adr/` (six ADRs), `CONTRIBUTING.md`, `SECURITY.md`; Mermaid diagrams, C4 context/container views and sequence diagrams in `docs/architecture.md`.
- MIT `LICENSE`; `license`, `repository` and `packageManager` fields in `package.json`.

### Security
- Components tab: the "Context sent to model" list is rendered as JSX (`lib/ui/inlineCode.tsx`) instead of `dangerouslySetInnerHTML`, so a page-controlled element id / class / component name can no longer inject markup into the DevTools panel.
- Background `net.fetch` / `net.head` proxy: only `http(s)` URLs to public hosts are fetched; loopback, `*.localhost`, link-local and private ranges (IPv4 and IPv6, including IPv4-mapped forms) are refused, except the configured AI endpoint and the inspected page's own host (`lib/net/urlPolicy.ts`). Redirects are no longer followed. The check is syntactic; DNS rebinding is an accepted, documented residual risk (NFR-S.8).
- Settings tab warns when the AI endpoint is plain `http://` on a non-loopback host (the API key would travel unencrypted); the plaintext-at-rest storage of the key is documented in `docs/REQUIREMENTS.md`.
- `mermaid` bumped to 11.17.2 (transitive `dompurify` 3.4.15) — clears the dompurify advisories flagged by `pnpm audit`.
- Dropped the redundant `activeTab` permission (`<all_urls>` host permission already covers it); `scripting` / `tabs` are annotated with why they are needed.
- CI: third-party GitHub Actions pinned to full commit SHAs.
- Resolved the remaining open Dependabot alerts, all in dev tooling or the `examples/mf-demo` app (the shipped bundle is unchanged; manifest and output file list are byte-identical). Root: `postcss` ^8.5.28, `vite` 8.3.0, `browserslist` 4.28.9, `brace-expansion` 1.1.18 and friends within their declared ranges, plus `pnpm-workspace.yaml` overrides for `adm-zip`, `shell-quote`, `tmp`, `uuid` (under `node-notifier`) and `esbuild` 0.28 whose dependents pin vulnerable versions. Demo: `webpack-dev-server` ^5.2.6, `websocket-driver` 0.7.5, `fast-uri` 3.1.7 and overrides for `shell-quote`, `qs` and `uuid` (under `sockjs`). `pnpm audit` is clean in both workspaces. `SECURITY.md` documents the override policy and a (currently empty) list of unresolved advisories.

### Fixed
- `lib/modules/sourcemap.ts`: base64-encoded inline `sourceMappingURL` data URIs were never decoded (the `;base64` flag check excluded the comma it was testing for) and fell back to a JSON parse error.

### Changed
- Removed the unused `bippy` dependency; `lib/react/walkFiber.ts` has been a dependency-free, read-only walker since v0.2.0 (README and module reference corrected to match).
- Dependency build scripts are opt-in via `pnpm-workspace.yaml` (`esbuild` allowed, `spawn-sync` ignored) so a clean `pnpm install` exits 0 on pnpm 10+.
- `docs/architecture.md`: corrected the console-capture trade-off — `window` `error` / `unhandledrejection` listeners are installed; the gap is cross-origin iframes and workers.

---

## [0.3.21] — 2026-06-11

### Added
- **Per-page session memory** — accumulate analysis insights across AI runs on the same page.
  - `lib/memory/sessionMemory.ts`: in-memory store keyed by `pageKey(url) = origin + pathname`; per-entry cap 6 KB, total budget 24 KB with FIFO eviction.
  - `store.ts`: `memoryByPage` state + `addMemoryEntry` / `removeMemoryEntry` / `clearMemory` actions.
  - Memory toolbar in the ComponentsTab action panel: 📚 indicator, byte count, Include toggle, view/clear buttons, budget progress bar, expandable per-entry list with × remove.
  - Each analysis tab shows "💾 Save to memory" button (becomes "📚 In memory" pill once saved).
  - `buildUxVisionPayload` accepts `memoryEntries`; memory section prepended to user message so the model reads design principles before interpreting the current context.
  - `describeInputs` includes "📚 Memory: N entries (X KB) included" in the Context panel.

---

## [0.3.20] — 2026-06-09

### Fixed
- Renamed inner "Components" sub-tab to **"Tree"** — the outer tab is already "Components"; double-label was redundant.
- Tree body is now kept **mounted with `display:none`** when an analysis tab is active, preserving react-arborist's ResizeObserver measurement. Previously the tree shrank to a fraction of the pane on return.

### Added
- **MAIN-world `inspectAtBounds`**: `elementFromPoint` + ancestor walk-up (≥60% area coverage), capturing:
  - Element identity (`tagName`, `id`, `classes`, `role`)
  - 25 computed style properties (display, position, font, spacing, borders, shadow, transform, opacity, etc.)
  - Matching CSS rules (up to 30 rules, scanning at most 8 000 rules across all accessible stylesheets; cross-origin sheets handled with try/catch)
- UX vision analysis now includes the full DOM context in every prompt
- Analysis tabs show an "Inputs sent to model" expandable panel with the cropped image preview and context bullet list

---

## [0.3.19] — 2026-06-07

### Added
- **ComponentsTab UX vision** — full redesign of the Components tab:
  - 9 analysis presets: UX Audit, Aesthetics & Branding, Layout & Composition, Usability, Accessibility, Engagement, Wow Factor, Design Trends, Market Research
  - Custom prompt input
  - Results in tabs (Tree sub-tab + one tab per analysis run); badge dots for streaming/done/error state; duplicate-preset tabs reused, not duplicated
  - `lib/components/uxVisionPrompts.ts`: preset definitions + `buildUxVisionPayload`
- **`lib/snapshot/cropRegion.ts`**: crops a document-coord bounds rectangle from the snapshot screenshot using DPR mapping
- **MAIN-world `scrollToBounds`**: scrolls the viewport to center the selected component's bounds, enabling one-click scroll-to on tree selection

---

## [0.3.18] — 2026-06-05

### Added
- `lib/lm-studio/LlmContext.tsx`: React Context exposing `streamingOneshot`; wrapped by `<LlmProvider>` in `App.tsx`. `useLlm()` hook gives any descendant access without prop drilling.
- **MermaidBlock: Heal-with-AI** — when Mermaid fails to parse a diagram, a "Heal with AI" button sends the current source + error to the model, which returns a corrected diagram
- **ArtifactBlock: Refine-with-AI** — always-visible "Refine" button on HTML artifacts; sends current HTML + instructions to the model; streams the replacement into the iframe
- `lib/ui/healPrompts.ts`: system + user prompts for heal and refine actions

---

## [0.3.17] — 2026-06-03

### Added
- `lib/ui/Tabs.tsx`: generic horizontal tab strip + body slot. `TabItem` type: `{ id, label, badge?, closable?, icon? }`. Badge dots: sky (streaming), emerald (done), red (error).
- **FileDetail**: tabbed layout — Source tab + one tab per analysis kind (Audit / Improve / Explain); tabs are deduped by id, not stacked
- **ModuleAnalysis**: tabbed layout — Summary tab (stats + file lists) + one tab per module-level analysis kind
- **Propose PR**: after any module or file analysis, generate a Markdown change plan and export it to:
  - Cursor (`cursor://anysphere.cursor-deeplink/prompt?text=…`)
  - Claude Desktop (`claude://claude.ai/new?q=…`)
  - Claude.ai web (`https://claude.ai/new?q=…`)
  - GitHub issue (prefills body via URL) — all limited to 8 KB per deeplink
  - `lib/modules/proposePr.ts`: prompt + `EXPORT_TARGETS` array

### Fixed
- Mermaid flicker during streaming in FileDetail and ModuleAnalysis — threaded `streaming` prop through to `MarkdownRenderer` / `MermaidBlock`

---

## [0.3.16] — 2026-06-01

### Added
- **Source mode toggle** (📦 Sourcemap | 🐙 GitHub) in FileDetail toolbar
- Auto-default to GitHub mode when `sourcesContent` is null (production `nosources-source-map` case)
- `NOSOURCES=1` environment flag in `examples/mf-demo` to simulate nosources sourcemaps

---

## [0.3.15] — 2026-05-30

### Fixed
- Webpack source path normalisation for the `webpack://<namespace>/` scheme emitted by Webpack 5's default `output.uniqueName`. Previous regex only handled `webpack:///` (triple-slash, no namespace), causing GitHub URLs to contain `webpack:/mf-host/…` (single slash → 404).
- Fixed with two-pass regex in `normalizeSourcePathForGithub`: triple-slash first, then namespaced variant, for all four schemes (`webpack-internal`, `webpack`, `vite`, `rollup`).
- Version-aware branch resolution: `{version}` placeholder in `branch` + `versionCapture` regex to extract version from CDN module URLs

---

## [0.3.14] — 2026-05-28

### Added
- `lib/modules/githubMapping.ts`: `GithubMapping` type, first-match-wins URL pattern lookup, `resolveGithubFileUrl`, `normalizeSourcePathForGithub`
- Settings UI: GitHub Mappings section (add / edit / remove rules)
- FileDetail: GitHub badge "View on GitHub" → opens `raw.githubusercontent.com` URL
- ModuleAnalysis: GitHub repo card with owner/repo/branch
- Demo repos: `ingscarrero/dom-lens-mf-host` and `ingscarrero/dom-lens-mf-remote` pushed to GitHub (public) as sourcemap demo targets

---

## [0.3.13] — 2026-05-26

### Added
- `lib/ui/CodeViewer.tsx`: syntax-highlighted source viewer using `prism-react-renderer` (CSP-safe, no `eval`/`new Function`); line numbers + copy button
- Module-level AI analysis (6 actions): Architecture Overview, Dashboard, Risk Audit, Optimize, Diagram, Ideas — `lib/modules/analyzeModule.ts`
- `ModuleAnalysis` right-pane component for tree-selected modules
- FileDetail uses `CodeViewer` for source display; analysis actions added (Audit / Improve / Explain) — `lib/modules/analyzeFile.ts`
- All module and file analyses stream via `lm.stream` port message

---

## [0.3.12] — 2026-05-24

### Changed
- Swapped `source-map-js` (used `new Function(…)` — blocked by extension page CSP) for `@jridgewell/sourcemap-codec` (pure JS VLQ decoder, no eval)

---

## [0.3.11] — 2026-05-22

### Fixed
- Background SW `net.fetch` distinguishes 4xx/5xx/size errors with clear messages
- Sourcemap fetch errors wrapped with URL + step context
- Inline error panel + Retry button in the module tree pane

---

## [0.3.10] — 2026-05-20

### Fixed
- Module tree derived synchronously; per-module fetch state wired through

---

## [0.3.9] — 2026-05-18

### Added
- `parseSourceMap` now captures `sourcesContent`
- Module tree hierarchy: origin → folder → file → expanded source files
- `ModulesTree` component + `FileDetail` viewer (raw source, no syntax highlight yet)
- File analysis prompts (Audit / Improve / Explain stubs)
- View toggle (list vs tree) in ModulesTab

---

## [0.3.8] — 2026-05-16

### Added
- `lib/concurrency/pool.ts`: capped async pool (max 4 concurrent tasks)
- Capture `SourceMap` response headers in `HarEntry`
- `net.head` port message + HEAD-probe proxy in background SW
- Concurrent sourcemap probe pass on Modules tab open (4 parallel HEAD requests)
- Modules tab: per-module status badges (✓ mapped / ! error / – missing) + summary card

---

## [0.3.7] — 2026-05-14

### Added
- Streaming `lm.stream` / `lm.stream.delta` / `lm.stream.done` / `lm.stream.error` port messages + `createStreamingProxy`
- JS/CSS skeleton extractor (`lib/modules/skeleton.ts`): no-LLM structure summary
- `CodeMapView` with skeleton + per-symbol summarise action
- Image usage: scroll-to + highlight overlay on the inspected page

---

## [0.3.6] — 2026-05-12

### Added
- `lm.oneshot` port message + `createOneshotProxy` (single-shot, fire-and-forget LLM call via SW)
- MAIN-world image usage scanner (`lib/modules/reformat.ts`)
- Viewer registry + restructured ModulesTab by asset kind (JS / CSS / image / font / wasm)

---

## [0.3.5] — 2026-05-10

### Added
- `lib/artifacts/extractArtifacts.ts`: extract `html` fenced blocks from LLM replies
- `lib/ui/ArtifactBlock.tsx`: sandboxed iframe renderer (`sandbox="allow-scripts"` only)
- Artifacts wired into `MarkdownRenderer` and the Insights gallery
- Visual Dashboard preset + HTML artifact rules in prompt presets

---

## [0.3.4] — 2026-05-08

### Fixed
- Added "one statement per line" rule to Mermaid prompt presets
- Scroll priming + smooth-scroll override + re-measure for accurate full-page capture
- Dropped `mindmap` from Mermaid presets (parse error rate too high)

---

## [0.3.3] — 2026-05-06

### Added
- Keep preset gallery visible in Insights + custom prompt input
- AI-enhanced stitching workflow: send tile overlaps to model for seam correction

---

## [0.3.2] — 2026-05-04

### Fixed
- Strict Mermaid syntax rules in all prompt presets
- Hide fixed/sticky elements during multi-tile capture to prevent ghost headers

---

## [0.3.1] — 2026-05-02

### Changed
- Rework Diagrams tab into **Insights dashboard** with preset gallery and persistent result panes
- Defer Mermaid render until streaming completes (eliminates mid-stream flicker)

---

## [0.3.0] — 2026-04-30

### Added
- **Modules tab**: asset classification, ~50 framework fingerprints, sourcemap pipeline
- **Insights tab** (formerly Diagrams): Mermaid diagram gallery + architecture prompt presets
- `lib/diagrams/`: Mermaid extraction + rendering
- Background SW: sourcemap fetch proxy (`net.fetch` port message)
- Page-side module inventory via `PerformanceResourceTiming`

---

## [0.2.x] — Component + markdown iteration

- Markdown renderer + JSON viewer
- `react-markdown` + remark-gfm wired into AnalyzeTab + SnapshotTab
- Component tree hints (tag + content), significant-only filter, subtree focus
- Full-page scroll-and-stitch capture with tile orchestration
- Live page overlay cleanup on DevTools close

---

## [0.1.0] — Initial release

- WXT scaffold + manifest
- Snapshot capture (DOM, screenshot, fiber walk, MF detection)
- Components tab (react-arborist fiber tree)
- Federation tab (@xyflow/react graph)
- Analyze tab (streaming SSE chat with local AI)
- Settings tab (endpoint, model, API key, toggles)
- Background SW: screenshot + LM Studio streaming proxy
- MAIN-world content script: React DevTools hook shim, console patching, `window.__dom_lens__.capture()`
