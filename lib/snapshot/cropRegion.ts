import type { SnapshotScreenshot } from './types';

/**
 * Crop a rectangular region out of an already-captured snapshot
 * screenshot. Used by the Components tab's UX-vision action to send
 * just the selected fiber's bounding box to the LLM instead of the
 * whole page.
 *
 * Document-coord bounds (the kind walkFiber stores per ComponentNode)
 * map to image pixel coords via DPR. The screenshot stores
 * `originX/originY` (top-left of the captured region in document
 * coords) so we can subtract them to get image-relative coords.
 *
 * Returns null when the bounds don't overlap the screenshot extent
 * (component below the fold of a viewport-only capture, etc.).
 */
export async function cropRegion(
  screenshot: SnapshotScreenshot,
  bounds: { x: number; y: number; w: number; h: number },
  opts?: { pad?: number },
): Promise<string | null> {
  if (bounds.w <= 0 || bounds.h <= 0) return null;
  const dpr = screenshot.pixelHeight / Math.max(1, screenshot.height);
  const pad = Math.max(0, opts?.pad ?? 0);

  // Clip the requested rect to what's actually inside the screenshot.
  // We do this in document coords then map to pixels.
  const docLeft = Math.max(screenshot.originX, bounds.x - pad);
  const docTop = Math.max(screenshot.originY, bounds.y - pad);
  const docRight = Math.min(
    screenshot.originX + screenshot.width,
    bounds.x + bounds.w + pad,
  );
  const docBottom = Math.min(
    screenshot.originY + screenshot.height,
    bounds.y + bounds.h + pad,
  );
  const docW = docRight - docLeft;
  const docH = docBottom - docTop;
  if (docW <= 0 || docH <= 0) return null;

  const sx = Math.round((docLeft - screenshot.originX) * dpr);
  const sy = Math.round((docTop - screenshot.originY) * dpr);
  const sw = Math.round(docW * dpr);
  const sh = Math.round(docH * dpr);

  const img = await loadImage(screenshot.dataUrl);
  // Use a plain <canvas> — OffscreenCanvas is available in workers but
  // we're in the panel page so document.createElement('canvas') is the
  // simplest path and matches the rest of our image plumbing.
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}
