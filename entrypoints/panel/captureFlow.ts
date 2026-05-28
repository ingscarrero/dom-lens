import { captureFullPage, captureViewportOnly } from '@/lib/snapshot/fullPage';
import type { Snapshot } from '@/lib/snapshot/types';
import type { Settings } from '@/lib/storage/settings';
import type { PanelToBg, BgToPanel } from '@/lib/bridge/protocol';
import {
  callDomLensCapture,
  callScrollMetrics,
  callScrollTo,
} from './hooks/useInspectedEval';
import { useStore } from './store';

export interface CaptureContext {
  tabId: number;
  post(msg: PanelToBg): void;
  /**
   * Register a one-shot listener for a `capture.tile.result` with the given requestId.
   * The caller invokes this after posting `capture.tile` to await the response.
   */
  awaitTileResult(requestId: string): Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
}

export async function runCapture(ctx: CaptureContext, settings: Settings): Promise<void> {
  const store = useStore.getState();
  store.setCapturing(true);
  store.setCaptureProgress({ step: 0, total: 1, phase: 'metrics' });

  try {
    // 1) Get scroll metrics to detect orientation/size
    const metricsRes = await callScrollMetrics();
    if (!metricsRes.ok) {
      store.setCaptureError(metricsRes.reason);
      return;
    }
    const metrics = metricsRes.metrics;

    // 2) Read partial snapshot (DOM markdown, fiber tree with bounds, federation, console)
    //    at the original scroll position before we start scrolling around.
    const partialRes = await callDomLensCapture(settings.maxMarkdownChars);
    if (!partialRes.ok) {
      store.setCaptureError(partialRes.reason);
      return;
    }
    const partial = partialRes.partial;

    // 3) Capture screenshot(s)
    store.setCaptureProgress({ step: 0, total: 1, phase: 'tiles' });
    let screenshot: Snapshot['screenshot'] = null;

    const captureTile = (tabId: number) =>
      new Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>(
        (resolve) => {
          const requestId = crypto.randomUUID();
          ctx.awaitTileResult(requestId).then(resolve);
          ctx.post({ type: 'capture.tile', requestId, tabId });
        },
      );

    if (settings.fullPageScreenshot) {
      const res = await captureFullPage({
        tabId: ctx.tabId,
        scrollMetrics: async () => ({ ok: true, metrics }),
        scrollTo: callScrollTo,
        captureTile,
        maxTiles: settings.fullPageMaxTiles,
        onProgress: (p) =>
          store.setCaptureProgress({ step: p.step, total: p.total, phase: 'tiles' }),
        delayMs: 120,
      });
      if (res.ok) {
        screenshot = res.screenshot;
      } else {
        // Fall back to viewport-only capture if full-page fails (e.g. tile cap)
        const vp = await captureViewportOnly(ctx.tabId, metrics, captureTile);
        if (vp.ok) screenshot = vp.screenshot;
        else store.setCaptureError(`screenshot failed: ${res.reason}`);
      }
    } else {
      const vp = await captureViewportOnly(ctx.tabId, metrics, captureTile);
      if (vp.ok) screenshot = vp.screenshot;
      else store.setCaptureError(`screenshot failed: ${vp.reason}`);
    }

    store.setCaptureProgress({ step: 1, total: 1, phase: 'finalizing' });

    const network = useStore.getState().network;
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      capturedAt: Date.now(),
      screenshot,
      network,
      ...partial,
    };
    store.setSnapshot(snapshot);
    store.clearNetwork();
  } catch (e: any) {
    store.setCaptureError(e?.message ?? String(e));
  }
}
