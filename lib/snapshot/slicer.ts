export interface Tile {
  index: number;
  total: number;
  /** Logical CSS px box in stitched image */
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG dataURL of the tile */
  dataUrl: string;
}

export interface SliceOptions {
  count: number;
  orientation: 'vertical' | 'horizontal';
  /** Pixels of overlap between tiles for context continuity */
  overlap?: number;
  /** Mime type for tile encoding, default image/png */
  mime?: string;
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load stitched image for slicing'));
    img.src = dataUrl;
  });
}

export async function sliceImage(dataUrl: string, opts: SliceOptions): Promise<Tile[]> {
  const img = await loadImage(dataUrl);
  const total = Math.max(1, Math.min(opts.count, 16));
  const overlap = Math.max(0, opts.overlap ?? 0);
  const mime = opts.mime ?? 'image/png';

  const tiles: Tile[] = [];
  if (opts.orientation === 'vertical') {
    const sliceH = Math.ceil(img.naturalHeight / total);
    for (let i = 0; i < total; i++) {
      const y = Math.max(0, i * sliceH - (i > 0 ? overlap : 0));
      const bottom = Math.min(img.naturalHeight, (i + 1) * sliceH + (i < total - 1 ? overlap : 0));
      const h = bottom - y;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, y, img.naturalWidth, h, 0, 0, img.naturalWidth, h);
      tiles.push({
        index: i + 1,
        total,
        x: 0,
        y,
        w: img.naturalWidth,
        h,
        dataUrl: canvas.toDataURL(mime),
      });
    }
  } else {
    const sliceW = Math.ceil(img.naturalWidth / total);
    for (let i = 0; i < total; i++) {
      const x = Math.max(0, i * sliceW - (i > 0 ? overlap : 0));
      const right = Math.min(img.naturalWidth, (i + 1) * sliceW + (i < total - 1 ? overlap : 0));
      const w = right - x;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, x, 0, w, img.naturalHeight, 0, 0, w, img.naturalHeight);
      tiles.push({
        index: i + 1,
        total,
        x,
        y: 0,
        w,
        h: img.naturalHeight,
        dataUrl: canvas.toDataURL(mime),
      });
    }
  }
  return tiles;
}

export function suggestSliceCount(longestDim: number, target = 2048): number {
  return Math.max(1, Math.min(16, Math.ceil(longestDim / target)));
}
