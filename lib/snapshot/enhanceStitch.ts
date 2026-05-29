import type { LmChatPayload, ContentPart } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';
import type { RawTile } from './fullPage';
import type { SnapshotScreenshot } from './types';

/**
 * AI-enhanced re-stitching.
 *
 * When the page has fixed/sticky headers, hidden cookie banners that reappear
 * between tiles, or other content that bleeds across consecutive viewport
 * captures, the naive `tile_n placed at y=n*viewport_height` stitch produces
 * a stripey output with duplicated bands. Even with the v0.3.2 hide-fixed
 * fix, some pages still slip content through (sticky elements that aren't
 * actually `position: sticky`, JS-driven floating bars, etc.).
 *
 * Workflow:
 *   1. Send the raw tiles to a multimodal local model with a structured
 *      prompt asking how many pixels at the top of each tile (after the
 *      first) are duplicates of content already shown above.
 *   2. Parse the JSON response.
 *   3. Re-compose: keep tile 0 in full; for tiles 1+, crop `trimTop` pixels
 *      off the top, then place at the cumulative offset.
 *
 * The LLM gets pixel hints (per-tile pixel height) so its numeric answers
 * are grounded in the actual image sizes.
 */

export interface StitchAdjustment {
  /** Tile index in raw order. */
  index: number;
  /** Pixels to crop from the top of this tile before stitching. */
  trimTop: number;
  /** Optional pixels to crop from the bottom (rarely needed but allowed). */
  trimBottom?: number;
}

const ENHANCE_SYSTEM_PROMPT = `You are a precise image-analysis assistant.

You receive N viewport screenshots taken in scroll order (top to bottom) from a single web page. Some pages have fixed/sticky elements (headers, banners, navigation bars) that appear at the same place in every tile — when these are stitched naively they produce visible duplicated bands.

For each tile, determine how many pixels at the TOP show content that ALSO appears in the previous tile (the "duplicate band"). Tile 0 always has trimTop = 0. For tile N (N>=1) compare its top region to the bottom of tile N-1's NEW content; if the first K pixels of tile N show content visible in earlier tiles, return trimTop = K.

If a tile shows NO new content at all (entirely duplicate, e.g. the page didn't actually scroll), set trimTop equal to that tile's pixelHeight so it contributes nothing.

Return ONLY a JSON object with this exact shape, inside a single \`\`\`json fenced block:

{
  "tiles": [
    { "index": 0, "trimTop": 0 },
    { "index": 1, "trimTop": <integer pixels> },
    { "index": 2, "trimTop": <integer pixels> }
  ]
}

No commentary, no markdown outside the json fence. Integers only.`;

/**
 * Build the chat payload for the enhance-stitch request.
 */
export function buildEnhanceStitchPayload(
  tiles: RawTile[],
  settings: Settings,
): LmChatPayload {
  const parts: ContentPart[] = [];

  parts.push({
    type: 'text',
    text:
      `I have ${tiles.length} viewport screenshots in scroll order (top to bottom). ` +
      `Each tile has these pixel dimensions:\n\n` +
      tiles
        .map(
          (t, i) =>
            `- Tile ${i}: ${t.pixelWidth} x ${t.pixelHeight} px (captured at scrollY=${t.y})`,
        )
        .join('\n') +
      `\n\nAnalyze the tiles and tell me how many top pixels of each (after tile 0) duplicate content from the previous tile. Reply with the JSON schema described in the system prompt.`,
  });

  for (let i = 0; i < tiles.length; i++) {
    parts.push({
      type: 'text',
      text: `--- Tile ${i} (${tiles[i].pixelWidth}x${tiles[i].pixelHeight}) ---`,
    });
    parts.push({ type: 'image_url', image_url: { url: tiles[i].dataUrl } });
  }

  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    messages: [
      { role: 'system', content: ENHANCE_SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ],
    temperature: 0,
  };
}

/**
 * Pull the JSON block out of the LLM reply. Accepts either bare JSON or a
 * fenced ```json block. Returns null on failure.
 */
export function parseEnhanceResponse(text: string): StitchAdjustment[] | null {
  // Look for fenced json first
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  let raw = fenced ? fenced[1] : text;
  // Trim to the first { ... matching }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  raw = raw.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed?.tiles) ? parsed.tiles : null;
    if (!arr) return null;
    const out: StitchAdjustment[] = [];
    for (const t of arr) {
      if (typeof t?.index !== 'number') continue;
      const trimTop = Math.max(0, Math.round(Number(t.trimTop) || 0));
      const trimBottom = Math.max(0, Math.round(Number(t.trimBottom) || 0));
      out.push({ index: t.index, trimTop, trimBottom });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

/**
 * Apply LLM-supplied crops and re-stitch into a single PNG. Tile 0 is kept
 * intact; subsequent tiles are vertically cropped per the trim values, then
 * stacked with no gaps. The result is a tight, deduplicated full-page image.
 */
export async function restitchWithAdjustments(
  tiles: RawTile[],
  adjustments: StitchAdjustment[],
  origScreenshot: SnapshotScreenshot,
): Promise<{ ok: true; screenshot: SnapshotScreenshot } | { ok: false; reason: string }> {
  if (tiles.length === 0) return { ok: false, reason: 'no tiles to restitch' };

  // Index adjustments by tile index for O(1) lookup.
  const byIdx = new Map<number, StitchAdjustment>();
  for (const a of adjustments) byIdx.set(a.index, a);

  // Compute cropped heights and total output height.
  type Plan = { tile: RawTile; sy: number; sh: number };
  const plan: Plan[] = [];
  let totalH = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const adj = byIdx.get(i);
    const trimTop = Math.min(adj?.trimTop ?? 0, t.pixelHeight);
    const trimBottom = Math.min(adj?.trimBottom ?? 0, t.pixelHeight - trimTop);
    const sy = trimTop;
    const sh = Math.max(0, t.pixelHeight - trimTop - trimBottom);
    if (sh === 0) continue; // entirely duplicate tile — skip
    plan.push({ tile: t, sy, sh });
    totalH += sh;
  }

  if (totalH === 0) return { ok: false, reason: 'every tile was flagged as a duplicate' };

  const pixelWidth = Math.max(...tiles.map((t) => t.pixelWidth));
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'no 2d canvas context' };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelWidth, totalH);

  let cursor = 0;
  for (const p of plan) {
    try {
      const img = await loadImage(p.tile.dataUrl);
      ctx.drawImage(
        img,
        0, // sx
        p.sy, // sy
        p.tile.pixelWidth, // sw
        p.sh, // sh
        0, // dx
        cursor, // dy
        p.tile.pixelWidth, // dw
        p.sh, // dh
      );
      cursor += p.sh;
    } catch (e) {
      return { ok: false, reason: `restitch failed at tile ${tiles.indexOf(p.tile)}: ${(e as Error).message}` };
    }
  }

  const dataUrl = canvas.toDataURL('image/png');
  const dpr = origScreenshot.pixelHeight / origScreenshot.height || 1;
  return {
    ok: true,
    screenshot: {
      ...origScreenshot,
      dataUrl,
      pixelWidth,
      pixelHeight: totalH,
      width: Math.round(pixelWidth / dpr),
      height: Math.round(totalH / dpr),
      tileCount: plan.length,
    },
  };
}
