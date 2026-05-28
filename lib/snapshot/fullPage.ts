import type { PageMetrics, SnapshotScreenshot } from './types';

export interface CaptureProgress {
  step: number;
  total: number;
}

export interface CaptureFullPageDeps {
  tabId: number;
  /** Fetch live page metrics from the inspected page. */
  scrollMetrics(): Promise<{ ok: true; metrics: PageMetrics } | { ok: false; reason: string }>;
  /** Scroll the inspected page to (x, y). */
  scrollTo(x: number, y: number): Promise<void>;
  /** Take a screenshot of the inspected tab's currently visible viewport. */
  captureTile(
    tabId: number,
  ): Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>;
  onProgress?: (p: CaptureProgress) => void;
  /** ms to wait after scroll before capturing each tile. */
  delayMs?: number;
  /** Cap on number of tiles (covers chrome.tabs.captureVisibleTab quota). */
  maxTiles?: number;
}

export type CaptureFullPageResult =
  | { ok: true; screenshot: SnapshotScreenshot }
  | { ok: false; reason: string };

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

export async function captureFullPage(deps: CaptureFullPageDeps): Promise<CaptureFullPageResult> {
  const metricsRes = await deps.scrollMetrics();
  if (!metricsRes.ok) return { ok: false, reason: metricsRes.reason };
  const m = metricsRes.metrics;

  const origX = m.scrollX;
  const origY = m.scrollY;
  const stepX = Math.max(1, Math.floor(m.viewportWidth));
  const stepY = Math.max(1, Math.floor(m.viewportHeight));
  const cols = Math.max(1, Math.ceil(m.scrollWidth / stepX));
  const rows = Math.max(1, Math.ceil(m.scrollHeight / stepY));

  const positions: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Clamp last row/col so we don't scroll past document end
      const x = Math.max(0, Math.min(c * stepX, m.scrollWidth - stepX));
      const y = Math.max(0, Math.min(r * stepY, m.scrollHeight - stepY));
      positions.push({ x, y });
    }
  }

  const maxTiles = deps.maxTiles ?? 30;
  if (positions.length > maxTiles) {
    return {
      ok: false,
      reason: `page too large for full-page capture (${positions.length} tiles > ${maxTiles}). Disable full-page or increase limit.`,
    };
  }

  const tiles: Array<{ x: number; y: number; dataUrl: string }> = [];
  const delayMs = deps.delayMs ?? 80;
  try {
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      await deps.scrollTo(pos.x, pos.y);
      await new Promise((r) => setTimeout(r, delayMs));
      deps.onProgress?.({ step: i + 1, total: positions.length });
      const cap = await deps.captureTile(deps.tabId);
      if (!cap.ok) {
        return { ok: false, reason: `tile ${i + 1}/${positions.length}: ${cap.message}` };
      }
      tiles.push({ x: pos.x, y: pos.y, dataUrl: cap.dataUrl });
    }
  } finally {
    await deps.scrollTo(origX, origY);
  }

  const dpr = m.devicePixelRatio || 1;
  const pixelWidth = Math.round(m.scrollWidth * dpr);
  const pixelHeight = Math.round(m.scrollHeight * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'no 2d canvas context' };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);

  for (const t of tiles) {
    try {
      const img = await loadImage(t.dataUrl);
      ctx.drawImage(img, Math.round(t.x * dpr), Math.round(t.y * dpr));
    } catch (e) {
      return { ok: false, reason: `stitch failed at (${t.x},${t.y}): ${(e as Error).message}` };
    }
  }

  const dataUrl = canvas.toDataURL('image/png');
  return {
    ok: true,
    screenshot: {
      dataUrl,
      width: m.scrollWidth,
      height: m.scrollHeight,
      pixelWidth,
      pixelHeight,
      originX: 0,
      originY: 0,
      tileCount: tiles.length,
      kind: 'fullpage',
      orientation: m.orientation,
    },
  };
}

export async function captureViewportOnly(
  tabId: number,
  metrics: PageMetrics,
  captureTile: CaptureFullPageDeps['captureTile'],
): Promise<CaptureFullPageResult> {
  const cap = await captureTile(tabId);
  if (!cap.ok) return { ok: false, reason: cap.message };
  return {
    ok: true,
    screenshot: {
      dataUrl: cap.dataUrl,
      width: metrics.viewportWidth,
      height: metrics.viewportHeight,
      pixelWidth: Math.round(metrics.viewportWidth * metrics.devicePixelRatio),
      pixelHeight: Math.round(metrics.viewportHeight * metrics.devicePixelRatio),
      originX: metrics.scrollX,
      originY: metrics.scrollY,
      tileCount: 1,
      kind: 'viewport',
      orientation: metrics.orientation,
    },
  };
}
