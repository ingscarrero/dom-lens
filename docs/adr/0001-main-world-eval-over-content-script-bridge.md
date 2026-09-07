# ADR-0001: Reach page globals via `inspectedWindow.eval` in the MAIN world

- **Status:** Accepted
- **Date:** 2026-05-28 (v0.1.0)

## Context

DOM Lens needs to read things that only exist in the page's own JavaScript
realm: React fiber roots on container elements, `__webpack_require__`,
`__webpack_share_scopes__`, Vite / Native Federation globals, and the
`window.__dom_lens__` API installed by our injected script. A DevTools
panel has two ways to get there:

1. `chrome.devtools.inspectedWindow.eval(code, { useContentScriptContext: false })`
   evaluates directly in the page's MAIN world and returns a
   JSON-serialisable result.
2. An ISOLATED-world content script that relays `window.postMessage`
   calls to and from a MAIN-world script, with the panel talking to the
   content script through `chrome.runtime`.

## Decision

Use `inspectedWindow.eval` for every panel → page call. Register a
MAIN-world content script (`entrypoints/injected.content.ts`,
`world: 'MAIN'`, `run_at: 'document_start'`) that installs
`window.__dom_lens__` so the evaluated code is a one-line call rather than
a shipped blob. Keep `entrypoints/content.ts` as an ISOLATED-world
placeholder with the `dom-lens` channel constant so a bridge can be added
without changing the protocol.

## Alternatives considered

- **postMessage bridge.** Two extra hops (panel → content script → page
  and back), two serialisations, and request/response correlation on a
  broadcast channel. Only advantage: works on pages whose CSP blocks
  `eval` in the inspected window.
- **`chrome.scripting.executeScript` with `world: 'MAIN'` from the
  service worker.** Works for fire-and-forget (we use it to clear the
  overlay on disconnect) but returns through the worker, adding a hop for
  every capture.

## Consequences

- One hop, no correlation ids for page calls; results arrive as plain
  JSON.
- `inspectedWindow.eval` does not await Promises. Asynchronous page work
  is exposed as *start* + *poll* pairs (`startPrimeLazyLoad` /
  `getPrimeLazyLoadStatus`).
- Pages that forbid `eval` cannot be captured today; the ISOLATED bridge
  is the documented escape hatch.
- The injected script must be present before capture, so a page loaded
  before the extension was installed shows "main-world script not present
  — reload".
