# Mapping large minified modules

This doc explains how DOM Lens handles JS/CSS modules that don't have a
sourcemap — typically the production bundles of every real-world app. The
naive answer ("ask the LLM to reformat it") doesn't scale: a 1 MB minified
file takes minutes to stream and the output isn't readable anyway.

## What we do instead

A two-tier approach borrowed from the recent research on repository-level
LLM code understanding and from how production bundle analyzers work:

1. **Instant skeleton extraction (no LLM).** Regex/heuristic pass over the
   source surfaces every top-level structural symbol: webpack module IDs,
   imports, `require()` callsites, exports, top-level function/class
   declarations for JS; selectors, `@media` / `@keyframes` rules for CSS.
   Runs in <1 s on a 1 MB file, gives the user a navigable outline.

2. **Per-symbol LLM summarisation (streaming).** For any symbol of
   interest, the user clicks "Summarize symbol". We send only that range
   (clamped to 16 KB) to the local LLM and stream the explanation back
   into the row. The model gets a tight, focused context instead of an
   unreadable wall of code.

3. **Whole-file beautify (opt-in, streaming).** For users who do want the
   full reformat (smaller modules, "I want a download to grep through"),
   there's a separate `⤓ Beautify whole file` button. It streams the
   output so the user sees character progress, then offers a `.txt`
   download. We discourage it for large bundles in the tooltip — it's
   genuinely slow and the result is rarely worth the wait.

The crucial idea: **navigation beats reading**. Once the skeleton is on
screen, the user can scan to "which webpack module loaded `react-dom`",
"which exports does this chunk surface", etc., without any LLM call at
all. The LLM is then a precision tool — invoked per-symbol, on demand.

## Why this is the right shape

Several converging sources point to the same design:

- **Webpack Bundle Analyzer** uses [acorn][acorn] to walk the bundle AST
  and attribute byte counts to modules. They don't try to demangle or
  reformat — they treemap. Visualisation > reformat.
  ([webpack/webpack-bundle-analyzer][wba])

- **Recent research** on repository-level LLM understanding consistently
  shows that hierarchical, AST-segmented summarisation outperforms naive
  full-file prompting. The ICCSA 2025 paper *"Repository-Level Code
  Understanding by LLMs via Hierarchical Summarization"* reports up to
  82% relative improvement in top-1 retrieval precision when modules are
  pre-segmented by AST and summarised piece-wise. ([ICCSA 2025
  paper][iccsa]) The Code-Craft paper (arXiv 2504.08975) makes the same
  case for hierarchical graph-based summarisation. ([Code-Craft][craft])

- **Practitioner posts** (Code Completion Over Large Codebases) note that
  chunking on AST boundaries — class, function, file — gives both
  context-window discipline and semantic alignment, exactly what we get
  from our skeleton extractor. ([demajh.com][demajh])

Our skeleton extractor isn't a real AST — shipping acorn into a DevTools
panel would inflate the bundle. We use targeted regex passes with brace
balancing (skipping strings/regex/comments) which empirically covers
~80% of real-world top-level structure. The remaining ~20% (highly
unusual minifier output, transpiled tagged templates, etc.) is the
tradeoff for keeping our content-script payload small.

## Walkthrough — federation demo

Use `examples/mf-demo` (Webpack 5 host + remote at ports 3001/3002) to
see all three tiers in action without leaving your laptop.

```bash
cd examples/mf-demo
pnpm install   # first time only
pnpm dev       # serves host on :3001, remote on :3002
```

Then in Chrome:

1. Load `chrome://extensions` → Developer mode → Load unpacked →
   `chrome-extension/.output/chrome-mv3`.
2. Visit `http://localhost:3001` and open DevTools → DOM Lens panel.
3. **Capture snapshot**.
4. **Modules tab**.

What you should see, per chunk kind:

- `main.js` (the host bootstrap) has a sourcemap → expands directly to
  the **per-source byte breakdown**. No LLM needed.
- `remoteEntry.js` (the federation entry) usually doesn't have a
  sourcemap in dev mode → the **no-sourcemap banner** appears with
  `🗺 Map module`. Clicking it surfaces the webpack container's
  exposed-module table. Each exposed module is a clickable row.
- Click `✨ Summarize symbol` on any webpack module → streaming
  explanation lands in 2–10 seconds (depends on model). For the
  federation demo specifically, the model usually identifies the
  `@host/Widget` and `@host/Counter` exposures correctly.
- Try `⤓ Beautify whole file` on the small `remoteEntry.js` (~30 KB) —
  takes a few seconds, downloads as `.txt`. Compare with the same on
  `main.js` (~200 KB) to see why "beautify everything" is the wrong
  default UX.

## Detecting sourcemap availability

Before we even reach the "no sourcemap, fall back to skeleton" branch we
want to know how many modules in the snapshot *do* have a sourcemap.
Three layered signals, cheapest to most expensive:

1. **`SourceMap` response header** (free, no probe). TypeScript's
   `--sourceMap`, Webpack's `devtool: 'source-map'`, Vite's
   `build.sourcemap: true`, Rollup's `sourcemap: true`, and Babel's
   `sourceMaps: true` all *can* emit this header — though by default
   most servers don't forward it. When present, we get the absolute
   sourcemap URL with zero extra work. `useNetwork.ts` plucks it out
   of the HAR `response.headers` array as each request finishes.

2. **`<url>.map` HEAD probe** (one round-trip per module). For
   modules without the header, we fire a HEAD against the
   conventional `.map` sibling. The background SW falls back to
   `Range: 0-0` GET when the server rejects HEAD (some CDNs do).
   Any 2xx → `found`, any 4xx → `missing`, network error →
   `error`. We strip query strings before probing so cache-busted
   URLs don't get false negatives.

3. **Full fetch + parse** (lazy, on user action). When the user
   actually expands a module row, `fetchAndParseSourceMap` does
   the real download + VLQ walk. By that point we already know
   whether it'll succeed.

### Concurrency

The probe pass naturally parallelises — each module is independent.
`lib/concurrency/pool.ts` exposes `runPool(items, fn, { concurrency })`
that runs at most N jobs at a time, with a **hard cap at 4**:

```ts
export const MAX_CONCURRENCY = 4;
export const DEFAULT_CONCURRENCY = 4;
```

The cap is deliberate:

- Browsers cap concurrent connections per origin at 6 (Chrome,
  Firefox). Issuing more in-flight HEAD requests than that just
  queues them at the socket layer — no speedup, more memory churn.
- Local LLM servers (LM Studio default, Ollama via
  `OLLAMA_NUM_PARALLEL`) typically expose ~4 parallel inference
  slots. Pushing more concurrent LLM calls than that just queues at
  the model server.
- 4 is the empirical sweet spot: a 200-module probe finishes in
  ~3-5s on a typical site, fast enough to be useful as an
  on-mount pass without being aggressive enough to flag bot
  detection.

The pool surface returns ordered results regardless of completion
order, and isolates per-job failures (one 500 doesn't take down the
batch). Progress is reported continuously so the Modules tab's
summary card can show `probing 12/45…` while the pool churns.

### The summary card

The top-of-tab card collapses the probe records into four counters:

- `✓ declared` — header was present.
- `✓ found` — HEAD probe returned 2xx.
- `✗ missing` — HEAD probe returned 4xx.
- `— N/A` — module kind doesn't have sourcemaps (images, fonts,
  wasm, …).

Plus a parenthetical "X of Y JS/CSS available" so the user can
estimate at a glance how much of the bundle is debuggable. Per-row
badges show the same status in the rightmost column.

When the probe says `missing` for a module, expanding the row no
longer triggers a wasted fetch+parse attempt — the detail view
jumps straight to the `🗺 Map module` UX.

## When to extend

If a real bundle reliably defeats the regex extractor (no symbols
surfaced from a known-loaded webpack chunk), the right next step is
**not** to write more regex — it's to ship a real parser. Options in
order of weight:

- [`tree-sitter-javascript`][tsjs] compiled to WASM (~150 KB) — gives
  proper AST, robust to minifier quirks.
- [`acorn`][acorn] direct dependency (~200 KB) — matches what
  webpack-bundle-analyzer uses.
- A WebContainer with `npm install` + the user's choice of pretty
  printer — heaviest but lets us actually reformat 1 MB files locally
  in a sandbox.

[acorn]: https://github.com/acornjs/acorn
[wba]: https://github.com/webpack/webpack-bundle-analyzer
[iccsa]: https://link.springer.com/chapter/10.1007/978-3-031-97576-9_6
[craft]: https://arxiv.org/pdf/2504.08975
[demajh]: https://demajh.com/blog/ai_large_codebases.html
[tsjs]: https://github.com/tree-sitter/tree-sitter-javascript
