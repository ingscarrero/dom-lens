# Runbook: Troubleshooting

---

## Extension not appearing in DevTools

**Symptom:** No "DOM Lens" tab in the DevTools toolbar.

**Checks:**
1. Go to `chrome://extensions` → confirm DOM Lens is listed and **enabled**.
2. Look for an error badge on the extension card. Click **Errors** to see what failed.
3. Check the background service worker: click **service worker** → Console tab. If the SW crashed on startup, it will show here.
4. The DevTools tab only appears in DevTools windows opened *after* the extension loaded. Close and reopen DevTools.

**Fix:** If there are build errors, run `pnpm compile` locally to find them, fix, and reload the extension.

---

## "DOM Lens main-world script not present on this page"

**Symptom:** Error banner appears at the top of the panel after clicking **Capture snapshot**.

**Cause:** `injected.content.ts` (the MAIN-world script) runs at `document_start`. If the page was already loaded before the extension was installed, or if the extension was just reloaded, the script wasn't there at page load time.

**Fix:** Reload the inspected page (Cmd+R / F5) — not just the extension. Then try capture again.

**Also check:**
- The extension must be enabled before the page loads.
- Some pages have an aggressive CSP that blocks content script injection. In that case DOM Lens cannot capture the fiber tree or module inventory on those pages.

---

## Capture produces an empty Components tree

**Symptom:** Capture succeeds but the Components tab shows "No React roots detected".

**Causes and fixes:**

| Cause | Fix |
|---|---|
| Page doesn't use React | Expected — Components tab shows empty-state message |
| React loaded *after* the extension injected | Reload the page; the hook shim must be installed before React calls `ReactDOM.render()` |
| Server-side rendering only (React hydrated but no roots re-render) | The fiber hook may catch SSR apps inconsistently; try forcing a re-render (interact with the page first) |
| `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` already installed by another extension | The hook shim may conflict; disable other React-DevTools-compatible extensions and retry |

---

## Federation tab shows no remotes

**Symptom:** Federation tab shows "No Module Federation detected".

**Causes:**
- The page doesn't use Module Federation, Vite plugin-federation, or Native Federation.
- Remotes haven't loaded yet when capture was triggered. Interact with the page (navigate, click lazy-load triggers) then re-capture.
- Vite plugin-federation uses a different global name — check `window.__federation__` in the browser console.

---

## Modules tab — sourcemap badge shows "! error"

**Symptom:** All or some module badges show `! error` instead of `✓ mapped`.

**Common errors and fixes:**

### 404 on `.map` fetch

The `.map` file doesn't exist at the expected URL. This is normal for:
- Third-party CDN bundles (they rarely ship sourcemaps)
- Production builds with sourcemaps stripped

Check the exact error: hover the badge or click the module to see the error message in the FileDetail panel.

### CORS error on `.map` fetch

The server returned a 200 but with no CORS headers, and Chrome blocked the response.

> **Note:** DOM Lens fetches sourcemaps via the background service worker, which has `<all_urls>` host permission and is not subject to CORS. If you're seeing a CORS error, something unusual is happening. Check the SW console for details.

### Parse error

The `.map` file exists but is malformed or uses an unsupported sourcemap version. DOM Lens uses `@jridgewell/sourcemap-codec` which handles standard V3 sourcemaps. Version 1/2 maps are not supported.

Check the error message — if it says "unexpected token" the map file content may be HTML (a CDN error page), not JSON.

### Size limit

Very large sourcemaps (>20 MB) may be rejected. The `net.fetch` message has a configurable `maxBytes` limit.

---

## Modules tab — source file shows placeholder instead of source

**Symptom:** FileDetail pane shows "Source not available" or similar.

**Cause:** `sourcesContent` is null in the sourcemap. This happens with `nosources-source-map` (the production security-conscious setting).

**Fix:** Configure a [GitHub mapping](github-mappings.md) for this module. The source mode toggle (📦 / 🐙) will auto-switch to GitHub mode, fetching the source from `raw.githubusercontent.com`.

---

## Modules tab — GitHub source gives 404

See the [GitHub Mappings runbook](github-mappings.md#troubleshooting) for the full diagnostic checklist.

**Quick checks:**
1. Is the `basePath` correct?
2. Does the branch/tag exist in the repo?
3. Is the repo public?

---

## AI analysis — no response / stream never completes

**Check the SW console** (`chrome://extensions` → DOM Lens → service worker → Console):

- `TypeError: Failed to fetch` → the AI server isn't running or the endpoint URL is wrong.
- `403 Forbidden` → API key required or incorrect.
- `404 Not Found` → the `/chat/completions` path is wrong (check base URL includes `/v1`).
- `500 Internal Server Error` → model loading error or context overflow on the server side.

**Test the endpoint:**
```bash
curl http://localhost:1234/v1/models
# Should return JSON with a list of models
```

**Test a chat completion:**
```bash
curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}],"stream":false}'
```

---

## AI analysis — tokens appear then abruptly stop

**Causes:**
- Context length exceeded on the model side. The DOM markdown + screenshot can be large. Try: Settings → disable **Include screenshot** or reduce **Max markdown chars**.
- Server timeout. LM Studio has a per-request timeout; increase it in Developer → Advanced settings.
- The model got confused and emitted an early `[DONE]` SSE sentinel. Check the SW console for a premature `lm.stream.done`.

---

## Mermaid diagram shows error banner

**Symptom:** After a diagram-generating AI analysis, the diagram area shows a red error like "Syntax error in graph".

**Fix options:**
1. Click **Heal with AI** — sends the broken diagram + error to the model, which returns a corrected version.
2. Check the raw Markdown tab for the analysis — sometimes the model wraps the diagram in extra text; the extraction may have captured the wrong block.
3. Run the analysis again — non-deterministic models occasionally emit malformed Mermaid; a second run usually fixes it.

**Prevention:** The prompt presets include strict Mermaid rules (one statement per line, no `end` keyword except where required, allowed diagram types). If a particular diagram type consistently fails, it may need a more targeted rule — file an issue.

---

## HTML artifact iframe is blank

**Symptom:** The Insights tab shows an artifact pane but the iframe is empty.

**Causes:**
- The model emitted a ` ```html ` block but it was empty or contained only `<!DOCTYPE html>` with no body content.
- The sandbox (`sandbox="allow-scripts"` only) blocked something the HTML requires (e.g., external resource fetch, `localStorage`). This is intentional — the iframe has null origin and no extension API access.

**Fix:** Click **Refine with AI** and ask the model to produce self-contained HTML (no external scripts, no storage access). Or ask it to embed all styles and scripts inline.

---

## Session memory not appearing in prompts

**Symptom:** You saved an analysis to memory but the Include toggle is on and the next analysis doesn't seem to reference the memory.

**Checks:**
1. The memory toolbar shows entries — if the count is 0, the save didn't register.
2. The current page key must match: memory is scoped to `origin + pathname`. If you navigated to a different path, the previous page's memory is hidden (but not deleted).
3. The "Context sent to model" panel in the analysis tab should list `📚 Memory: N entries (X KB) included`. If it says 0, the `includeMemory` toggle was off when the analysis was started.
4. Per-entry budget: if your entries are large and you're at the 24 KB total, older entries may have been evicted. Check the memory toolbar's progress bar.

---

## Performance: capture takes very long

**Symptom:** "Capturing…" appears for more than 10 seconds.

**Causes:**
- Full-page capture with many tiles (tall page). Each tile requires a scroll + screenshot + port round-trip.
- Scroll priming (lazy-loaded content discovery) adds extra scroll passes.
- Very large pages with many React components slow the fiber walk.

**Mitigation:**
- Settings → disable **Full-page capture** to use visible viewport only (much faster).
- Disable **Include network** if there are thousands of network entries.

---

## Extension update / reload breaks open DevTools

When you reload the extension (`chrome://extensions` → ↺), the background SW restarts and all port connections drop. The panel loses its port connection.

**Fix:** Close and reopen DevTools on the inspected page. The panel reconnects automatically on mount.
