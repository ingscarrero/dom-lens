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
  /** Hide position:fixed/sticky on the page so they aren't recaptured every tile.
   * Returns the number of elements hidden. Optional — when omitted we just
   * skip the mitigation. */
  beginFullPageCapture?: () => Promise<{ ok: boolean; hiddenCount: number }>;
  /** Restore whatever beginFullPageCapture hid. Always called from finally. */
  endFullPageCapture?: () => Promise<void>;
  /** Read the actual current scroll position so we can verify scrollTo()
   * landed. Used to detect scroll-locked or nested-scrolled pages where
   * window.scrollTo silently does nothing. */
  getScrollPosition?: () => Promise<{ x: number; y: number } | null>;
  /** Pre-scroll the page to trigger lazy-loaded content. Returns the
   * post-prime document dimensions so we can plan tiles against the
   * final size rather than the pre-prime size. Optional — when omitted
   * we skip priming. */
  primeLazyLoad?: () => Promise<{ ok: boolean; finalHeight: number; finalWidth: number } | null>;
  /** Callback invoked when the priming pass starts/ends so the panel can
   * surface progress. */
  onPrimingProgress?: (phase: 'start' | 'done') => void;
}

/** A raw viewport tile captured at a specific scroll offset. Keeping these
 * around the snapshot enables re-stitching: e.g. the AI-enhanced flow asks
 * the LLM how much of each tile's top should be cropped, then composes a
 * corrected image without re-capturing the page. */
export interface RawTile {
  /** Scroll position the tile was captured at (CSS px). */
  x: number;
  y: number;
  /** Tile pixel dimensions (logical * dpr). */
  pixelWidth: number;
  pixelHeight: number;
  dataUrl: string;
}

export type CaptureFullPageResult =
  | { ok: true; screenshot: SnapshotScreenshot; rawTiles: RawTile[]; dpr: number }
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
  let m = metricsRes.metrics;

  const origX = m.scrollX;
  const origY = m.scrollY;

  // Priming pass: scroll top-to-bottom to wake up lazy-loaded content and
  // observe the final document height. Without this, pages with
  // `loading="lazy"` images and "load more on scroll" handlers report a
  // pre-prime scrollHeight that's much shorter than the real page — we
  // plan too few tiles and miss content below the fold.
  if (deps.primeLazyLoad) {
    deps.onPrimingProgress?.('start');
    const primed = await deps.primeLazyLoad();
    deps.onPrimingProgress?.('done');
    if (primed?.ok) {
      // Merge the post-prime dimensions into the metrics. We keep the
      // original viewport / DPR but update document size.
      m = {
        ...m,
        scrollHeight: Math.max(m.scrollHeight, primed.finalHeight),
        scrollWidth: Math.max(m.scrollWidth, primed.finalWidth),
      };
    }
  }

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
  let stickyHidden = false;
  // Track scroll-progress evidence so we can detect a scroll-locked or
  // nested-scrolled page (where window.scrollTo silently does nothing). On
  // such pages every "tile" captures the same viewport and the stitched
  // output is N copies of the same content — exactly the artifact users
  // hit on pages with custom inner-scroll layouts.
  let scrollLockDetected: string | null = null;
  try {
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      await deps.scrollTo(pos.x, pos.y);
      await new Promise((r) => setTimeout(r, delayMs));

      // After the first tile, hide fixed/sticky elements so they don't get
      // recaptured at every viewport offset. Standard scroll-and-stitch
      // mitigation used by GoFullPage, Full Page Capture, etc.
      if (i === 1 && !stickyHidden && deps.beginFullPageCapture) {
        try {
          await deps.beginFullPageCapture();
          stickyHidden = true;
          // Give the page a frame to reflow now that fixed elements are gone.
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          /* fall through — capture without the mitigation */
        }
      }

      // Verify the scroll actually moved (only when we asked it to). If the
      // page didn't budge, the scroller is somewhere else (inner div with
      // overflow:auto, scroll-lock, etc.) and continuing would just produce
      // duplicate tiles.
      if (i > 0 && deps.getScrollPosition && (pos.x > 0 || pos.y > 0)) {
        const actual = await deps.getScrollPosition();
        if (actual) {
          const dyExpected = pos.y;
          const dxExpected = pos.x;
          const dyActual = actual.y;
          const dxActual = actual.x;
          const yMissed = Math.abs(dyActual - dyExpected) > 30;
          const xMissed = Math.abs(dxActual - dxExpected) > 30;
          if (yMissed && xMissed) {
            scrollLockDetected = `scroll did not advance — requested (${dxExpected},${dyExpected}), actual (${dxActual},${dyActual}). Page likely uses an inner scroller.`;
            break;
          }
        }
      }

      deps.onProgress?.({ step: i + 1, total: positions.length });
      const cap = await deps.captureTile(deps.tabId);
      if (!cap.ok) {
        return { ok: false, reason: `tile ${i + 1}/${positions.length}: ${cap.message}` };
      }
      tiles.push({ x: pos.x, y: pos.y, dataUrl: cap.dataUrl });
    }
  } finally {
    if (stickyHidden && deps.endFullPageCapture) {
      try {
        await deps.endFullPageCapture();
      } catch {
        /* ignore — page may have navigated */
      }
    }
    await deps.scrollTo(origX, origY);
  }

  if (scrollLockDetected) {
    return { ok: false, reason: scrollLockDetected };
  }
  if (tiles.length === 0) {
    return { ok: false, reason: 'no tiles captured' };
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

  // We need to know each tile's actual pixel dimensions so re-stitching can
  // crop accurately. Read them once via a quick decode pass — sneak that
  // into the rawTiles result.
  const sizedTiles: RawTile[] = [];
  for (const t of tiles) {
    try {
      const img = await loadImage(t.dataUrl);
      sizedTiles.push({
        x: t.x,
        y: t.y,
        pixelWidth: img.naturalWidth,
        pixelHeight: img.naturalHeight,
        dataUrl: t.dataUrl,
      });
    } catch {
      sizedTiles.push({
        x: t.x,
        y: t.y,
        pixelWidth: Math.round(m.viewportWidth * dpr),
        pixelHeight: Math.round(m.viewportHeight * dpr),
        dataUrl: t.dataUrl,
      });
    }
  }

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
    rawTiles: sizedTiles,
    dpr,
  };
}

export async function captureViewportOnly(
  tabId: number,
  metrics: PageMetrics,
  captureTile: CaptureFullPageDeps['captureTile'],
): Promise<CaptureFullPageResult> {
  const cap = await captureTile(tabId);
  if (!cap.ok) return { ok: false, reason: cap.message };
  const dpr = metrics.devicePixelRatio || 1;
  const pixelWidth = Math.round(metrics.viewportWidth * dpr);
  const pixelHeight = Math.round(metrics.viewportHeight * dpr);
  return {
    ok: true,
    screenshot: {
      dataUrl: cap.dataUrl,
      width: metrics.viewportWidth,
      height: metrics.viewportHeight,
      pixelWidth,
      pixelHeight,
      originX: metrics.scrollX,
      originY: metrics.scrollY,
      tileCount: 1,
      kind: 'viewport',
      orientation: metrics.orientation,
    },
    rawTiles: [
      {
        x: metrics.scrollX,
        y: metrics.scrollY,
        pixelWidth,
        pixelHeight,
        dataUrl: cap.dataUrl,
      },
    ],
    dpr,
  };
}
