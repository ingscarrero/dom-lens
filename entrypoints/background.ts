import { defineBackground } from 'wxt/utils/define-background';
import type { PanelToBg, BgToPanel } from '@/lib/bridge/protocol';
import { chatStream, listModels } from '@/lib/lm-studio/client';

/**
 * Chrome's chrome.tabs.captureVisibleTab is rate-limited to ~2 calls/sec per
 * window. Long pages stitching many tiles regularly trip this. Retry with
 * exponential backoff when the call rejects, up to a few attempts.
 */
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
          if (msg.type === 'lm.test') {
            const result = await listModels(msg.baseUrl, msg.apiKey);
            if (result.ok) send({ type: 'lm.test.result', ok: true, models: result.models });
            else send({ type: 'lm.test.result', ok: false, message: result.message });
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
      });
    });
  },
});
