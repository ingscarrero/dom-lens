import { defineBackground } from 'wxt/utils/define-background';
import type { PanelToBg, BgToPanel } from '@/lib/bridge/protocol';
import { chatStream, listModels } from '@/lib/lm-studio/client';
import { loadSettings } from '@/lib/storage/settings';
import { hostOf, isAllowedProxyUrl } from '@/lib/net/urlPolicy';

/**
 * Chrome's chrome.tabs.captureVisibleTab is rate-limited to ~2 calls/sec per
 * window. Long pages stitching many tiles regularly trip this. Retry with
 * exponential backoff when the call rejects, up to a few attempts.
 */
/** Human-readable byte formatting used only for error messages. The
 * panel has its own formatter; we keep this one minimal so the SW
 * stays small. */
function formatBytesForError(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Hosts the `net.fetch` / `net.head` proxy may reach even when they are
 * loopback / private: the user's configured AI endpoint and the
 * inspected page's own host (so local dev servers keep working — the
 * page can already fetch its own origin, so this grants nothing new).
 */
async function trustedProxyHosts(inspectedTabId: number | null): Promise<string[]> {
  const hosts: string[] = [];
  try {
    const h = hostOf((await loadSettings()).baseUrl);
    if (h) hosts.push(h);
  } catch {
    /* storage unavailable — fall through with no exemption */
  }
  if (inspectedTabId != null) {
    try {
      const h = hostOf((await chrome.tabs.get(inspectedTabId)).url);
      if (h) hosts.push(h);
    } catch {
      /* tab gone */
    }
  }
  return hosts;
}

/**
 * The proxy never follows redirects: with `redirect: 'follow'` the
 * browser would contact every hop before we could inspect it, so a
 * public asset URL could bounce the request into a private host.
 * Hop-by-hop validation is not possible from a service worker: with
 * `redirect: 'manual'` the browser returns an opaque redirect (status 0,
 * no `Location`), so there is nothing to validate and re-issue. A
 * redirecting asset / `.map` URL therefore fails in the Modules tab
 * with the message below — a deliberate trade-off (NFR-S.8). Returns
 * the rejection message, or null.
 */
function redirectRefusal(res: Response, url: string): string | null {
  return res.type === 'opaqueredirect'
    ? `Blocked by URL policy: ${url} redirected — the proxy does not follow redirects`
    : null;
}

async function captureVisibleTabWithRetry(
  windowId: number,
  attempts = 4,
): Promise<string> {
  let delay = 600;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export default defineBackground({
  type: 'module',
  main() {
    const activeStreams = new Map<string, AbortController>();

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'panel') return;

      let inspectedTabId: number | null = null;

      const send = (msg: BgToPanel) => {
        try {
          port.postMessage(msg);
        } catch {
          /* port closed */
        }
      };

      port.onMessage.addListener(async (msg: PanelToBg) => {
        try {
          if (msg.type === 'panel.hello') {
            inspectedTabId = msg.tabId;
            return;
          }
          if (msg.type === 'capture.tile') {
            try {
              const tab = await chrome.tabs.get(msg.tabId);
              const dataUrl = await captureVisibleTabWithRetry(tab.windowId);
              send({ type: 'capture.tile.result', requestId: msg.requestId, ok: true, dataUrl });
            } catch (e: any) {
              send({
                type: 'capture.tile.result',
                requestId: msg.requestId,
                ok: false,
                message: e?.message ?? String(e),
              });
            }
            return;
          }
          if (msg.type === 'lm.chat.start') {
            const controller = new AbortController();
            activeStreams.set(msg.requestId, controller);
            try {
              for await (const chunk of chatStream(msg.payload, controller.signal)) {
                if (chunk.delta)
                  send({ type: 'lm.chat.delta', requestId: msg.requestId, text: chunk.delta });
                if (chunk.done) {
                  send({ type: 'lm.chat.done', requestId: msg.requestId });
                  break;
                }
              }
            } catch (e: any) {
              if (e?.name !== 'AbortError') {
                send({
                  type: 'lm.chat.error',
                  requestId: msg.requestId,
                  message: e?.message ?? String(e),
                });
              }
            } finally {
              activeStreams.delete(msg.requestId);
            }
            return;
          }
          if (msg.type === 'lm.chat.cancel') {
            activeStreams.get(msg.requestId)?.abort();
            activeStreams.delete(msg.requestId);
            return;
          }
          if (msg.type === 'lm.stream') {
            // Like lm.oneshot but the SW forwards every delta to the panel
            // for live progress. The panel routes deltas on requestId so
            // multiple symbol-level summaries can run concurrently without
            // crossing wires (we don't currently parallelize, but the API
            // shape allows it).
            const controller = new AbortController();
            activeStreams.set(msg.requestId, controller);
            let acc = '';
            try {
              for await (const chunk of chatStream(msg.payload, controller.signal)) {
                if (chunk.delta) {
                  acc += chunk.delta;
                  send({ type: 'lm.stream.delta', requestId: msg.requestId, text: chunk.delta });
                }
                if (chunk.done) break;
              }
              send({ type: 'lm.stream.done', requestId: msg.requestId, fullText: acc });
            } catch (e: any) {
              if (e?.name === 'AbortError') {
                send({
                  type: 'lm.stream.error',
                  requestId: msg.requestId,
                  message: 'cancelled',
                });
              } else {
                send({
                  type: 'lm.stream.error',
                  requestId: msg.requestId,
                  message: e?.message ?? String(e),
                });
              }
            } finally {
              activeStreams.delete(msg.requestId);
            }
            return;
          }
          if (msg.type === 'lm.stream.cancel') {
            activeStreams.get(msg.requestId)?.abort();
            activeStreams.delete(msg.requestId);
            return;
          }
          if (msg.type === 'lm.oneshot') {
            // Same as lm.chat.start but the panel doesn't want streaming —
            // accumulate the deltas server-side and reply with the full
            // text in a single message. Used by the AI-enhanced stitch flow
            // where the user shouldn't see partial JSON dribble into the
            // chat transcript.
            const controller = new AbortController();
            activeStreams.set(msg.requestId, controller);
            let acc = '';
            try {
              for await (const chunk of chatStream(msg.payload, controller.signal)) {
                if (chunk.delta) acc += chunk.delta;
                if (chunk.done) break;
              }
              send({ type: 'lm.oneshot.result', requestId: msg.requestId, ok: true, text: acc });
            } catch (e: any) {
              if (e?.name === 'AbortError') {
                send({
                  type: 'lm.oneshot.result',
                  requestId: msg.requestId,
                  ok: false,
                  message: 'cancelled',
                });
              } else {
                send({
                  type: 'lm.oneshot.result',
                  requestId: msg.requestId,
                  ok: false,
                  message: e?.message ?? String(e),
                });
              }
            } finally {
              activeStreams.delete(msg.requestId);
            }
            return;
          }
          if (msg.type === 'lm.test') {
            const result = await listModels(msg.baseUrl, msg.apiKey);
            if (result.ok) send({ type: 'lm.test.result', ok: true, models: result.models });
            else send({ type: 'lm.test.result', ok: false, message: result.message });
            return;
          }
          if (msg.type === 'net.head') {
            // Lightweight existence probe — used to detect .map siblings
            // without downloading them. Some servers reject HEAD; fall
            // back to a GET with a Range: 0-0 request, which most CDNs
            // honour and reply to with 206 Partial Content.
            const trusted = await trustedProxyHosts(inspectedTabId);
            const policy = isAllowedProxyUrl(msg.url, trusted);
            if (!policy.ok) {
              send({
                type: 'net.head.result',
                requestId: msg.requestId,
                ok: false,
                message: `Blocked by URL policy: ${policy.reason}`,
              });
              return;
            }
            try {
              let res: Response;
              try {
                res = await fetch(msg.url, {
                  method: 'HEAD',
                  credentials: 'omit',
                  redirect: 'manual',
                });
              } catch {
                res = await fetch(msg.url, {
                  method: 'GET',
                  credentials: 'omit',
                  redirect: 'manual',
                  headers: { Range: 'bytes=0-0' },
                });
              }
              const refusal = redirectRefusal(res, msg.url);
              if (refusal) {
                send({ type: 'net.head.result', requestId: msg.requestId, ok: false, message: refusal });
                return;
              }
              const len = Number(res.headers.get('content-length') ?? '0') || undefined;
              send({
                type: 'net.head.result',
                requestId: msg.requestId,
                ok: true,
                status: res.status,
                contentType: res.headers.get('content-type') ?? undefined,
                contentLength: len,
              });
            } catch (e: any) {
              send({
                type: 'net.head.result',
                requestId: msg.requestId,
                ok: false,
                message: e?.message ?? String(e),
              });
            }
            return;
          }
          if (msg.type === 'net.fetch') {
            // 32 MB cap — sourcemaps for monorepo bundles routinely hit
            // 10-20 MB. 32 is the empirical ceiling before
            // memory pressure inside the SW becomes noticeable.
            const max = msg.maxBytes ?? 32 * 1024 * 1024;
            const trusted = await trustedProxyHosts(inspectedTabId);
            const policy = isAllowedProxyUrl(msg.url, trusted);
            if (!policy.ok) {
              send({
                type: 'net.fetch.result',
                requestId: msg.requestId,
                ok: false,
                message: `Blocked by URL policy: ${policy.reason}`,
              });
              return;
            }
            try {
              const res = await fetch(msg.url, { credentials: 'omit', redirect: 'manual' });
              const refusal = redirectRefusal(res, msg.url);
              if (refusal) {
                send({ type: 'net.fetch.result', requestId: msg.requestId, ok: false, message: refusal });
                return;
              }
              const contentType = res.headers.get('content-type') ?? undefined;
              // `fetch` resolves successfully on 4xx/5xx — it only rejects
              // on network/CORS/abort errors. So we have to check `ok`
              // explicitly. Returning the 404 HTML body to the caller as
              // a "successful" fetch was the source of confusing
              // "Unexpected token <" parse errors in the panel.
              if (!res.ok) {
                send({
                  type: 'net.fetch.result',
                  requestId: msg.requestId,
                  ok: false,
                  message: `HTTP ${res.status} ${res.statusText || ''} — ${msg.url}`.trim(),
                });
                return;
              }
              const buf = await res.arrayBuffer();
              if (buf.byteLength > max) {
                send({
                  type: 'net.fetch.result',
                  requestId: msg.requestId,
                  ok: false,
                  message: `Response too large: ${formatBytesForError(buf.byteLength)} (cap is ${formatBytesForError(max)}). The asset may be a heavy sourcemap — consider raising the cap.`,
                });
                return;
              }
              const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
              send({
                type: 'net.fetch.result',
                requestId: msg.requestId,
                ok: true,
                text,
                status: res.status,
                contentType,
              });
            } catch (e: any) {
              // Network errors land here ("Failed to fetch" on CORS or
              // DNS, abort, etc.). Pass the message through verbatim so
              // the panel can surface it.
              send({
                type: 'net.fetch.result',
                requestId: msg.requestId,
                ok: false,
                message: `Network error fetching ${msg.url}: ${e?.message ?? String(e)}`,
              });
            }
            return;
          }
        } catch {
          /* silently ignore unexpected handler errors */
        }
      });

      port.onDisconnect.addListener(() => {
        for (const [id, ctl] of activeStreams) {
          ctl.abort();
          activeStreams.delete(id);
        }
        // Clean up any leftover live-page overlay when DevTools closes.
        if (inspectedTabId != null) {
          chrome.scripting
            .executeScript({
              target: { tabId: inspectedTabId },
              world: 'MAIN',
              func: () => {
                try {
                  (window as any).__dom_lens__?.clearHighlight?.();
                } catch {
                  /* ignore */
                }
                const el = document.getElementById('__dom_lens_highlight__');
                if (el) el.remove();
              },
            })
            .catch(() => {
              /* tab may have been closed already */
            });
        }
      });
    });
  },
});
