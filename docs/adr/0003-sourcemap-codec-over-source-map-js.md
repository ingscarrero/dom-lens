# ADR-0003: Decode sourcemaps with `@jridgewell/sourcemap-codec`

- **Status:** Accepted
- **Date:** 2026-05-24 (v0.3.12)

## Context

The Modules tab attributes bundle bytes to original sources and grafts
the sourcemap's `sources` / `sourcesContent` under each module. The first
implementation used `source-map-js` (`SourceMapConsumer`). Inside the
extension panel it threw a CSP violation: the library builds its index
lists with `new Function(...)`, which the MV3 extension-page policy
(`script-src 'self'`) forbids. Chrome's own Sources panel can use such
code because DevTools' frontend runs with a relaxed CSP; extension pages
do not.

## Decision

Replace `source-map-js` with `@jridgewell/sourcemap-codec` and read the
sourcemap JSON directly (`lib/modules/sourcemap.ts`). We only need
`decode(mappings)` → segments; byte attribution is the gap between
successive generated columns, the same approximation
`source-map-explorer` and `webpack-bundle-analyzer` use.

## Alternatives considered

- **Relax the CSP** with `unsafe-eval` in the manifest. Rejected by
  Chrome for MV3 extension pages, and undesirable anyway.
- **`source-map` (Mozilla) with the WASM build.** Needs `wasm-unsafe-eval`
  and a fetch of the `.wasm` asset; heavier than a 2 KB VLQ decoder for
  a feature that never needs `originalPositionFor`.
- **Decode VLQ by hand.** Equivalent to vendoring the codec; no benefit.

## Consequences

- Pure JS, ~2 KB, no eval; the same codec Vite, Rollup and Svelte ship.
- We do not get position lookups (`originalPositionFor`). If a future
  feature needs them (click a minified column → original line), add a
  binary search over the decoded segments rather than reintroducing
  `source-map-js`.
- A typed `SourcemapFetchError { step, mapUrl }` was introduced at the
  same time so a 404 HTML page is reported as "not valid JSON, first 80
  chars: <!doctype html>…" instead of a bare `Unexpected token <`.
