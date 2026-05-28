import { defineBackground } from 'wxt/utils/define-background';
import type { PanelToBg, BgToPanel } from '@/lib/bridge/protocol';
import type { Snapshot } from '@/lib/snapshot/types';
import { chatStream, listModels } from '@/lib/lm-studio/client';

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
          if (msg.type === 'capture.finalize') {
            const snapshot = await finalizeSnapshot(msg.tabId, msg.partial, msg.network);
            send({ type: 'capture.result', snapshot });
            return;
          }
          if (msg.type === 'lm.chat.start') {
            const controller = new AbortController();
            activeStreams.set(msg.requestId, controller);
            try {
              for await (const chunk of chatStream(msg.payload, controller.signal)) {
                if (chunk.delta) send({ type: 'lm.chat.delta', requestId: msg.requestId, text: chunk.delta });
                if (chunk.done) {
                  send({ type: 'lm.chat.done', requestId: msg.requestId });
                  break;
                }
              }
            } catch (e: any) {
              if (e?.name !== 'AbortError') {
                send({ type: 'lm.chat.error', requestId: msg.requestId, message: e?.message ?? String(e) });
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
            if (result.ok) {
              send({ type: 'lm.test.result', ok: true, models: result.models });
            } else {
              send({ type: 'lm.test.result', ok: false, message: result.message });
            }
            return;
          }
        } catch (e: any) {
          if (msg.type === 'capture.finalize') {
            send({ type: 'capture.error', message: e?.message ?? String(e) });
          }
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

async function finalizeSnapshot(
  tabId: number,
  partial: Parameters<typeof finalize>[1],
  network: Parameters<typeof finalize>[2],
): Promise<Snapshot> {
  return finalize(tabId, partial, network);
}

async function captureScreenshot(
  tabId: number,
  fallbackViewport: { width: number; height: number },
): Promise<Snapshot['screenshot']> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    return {
      dataUrl,
      width: fallbackViewport.width,
      height: fallbackViewport.height,
    };
  } catch {
    return null;
  }
}

async function finalize(
  tabId: number,
  partial: import('@/lib/snapshot/types').PartialSnapshot,
  network: import('@/lib/snapshot/types').HarEntry[],
): Promise<Snapshot> {
  const screenshot = await captureScreenshot(tabId, {
    width: partial.viewport.width,
    height: partial.viewport.height,
  });
  return {
    id: crypto.randomUUID(),
    capturedAt: Date.now(),
    screenshot,
    network,
    ...partial,
  };
}
