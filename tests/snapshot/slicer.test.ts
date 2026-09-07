// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImage, sliceImage, suggestSliceCount } from '@/lib/snapshot/slicer';

/**
 * jsdom has no real canvas or image decoder. We stub just enough surface
 * to exercise the tile geometry: a fake Image that reports fixed natural
 * dimensions and a 2D context that records drawImage calls.
 */
let drawCalls: number[][] = [];
let imageShouldFail = false;

class FakeImage {
  naturalWidth = 1000;
  naturalHeight = 3000;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => (imageShouldFail ? this.onerror?.() : this.onload?.()));
  }
}

beforeEach(() => {
  drawCalls = [];
  imageShouldFail = false;
  vi.stubGlobal('Image', FakeImage);
  HTMLCanvasElement.prototype.getContext = function () {
    return { drawImage: (...args: unknown[]) => drawCalls.push(args.slice(1) as number[]) } as any;
  } as any;
  HTMLCanvasElement.prototype.toDataURL = function (mime?: string) {
    return `data:${mime ?? 'image/png'};base64,${this.width}x${this.height}`;
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('suggestSliceCount', () => {
  it('targets ~2048px per slice and clamps to [1, 16]', () => {
    expect(suggestSliceCount(1000)).toBe(1);
    expect(suggestSliceCount(2048)).toBe(1);
    expect(suggestSliceCount(2049)).toBe(2);
    expect(suggestSliceCount(10000)).toBe(5);
    expect(suggestSliceCount(1_000_000)).toBe(16);
    expect(suggestSliceCount(0)).toBe(1);
    expect(suggestSliceCount(3000, 1000)).toBe(3);
  });
});

describe('loadImage', () => {
  it('rejects when the image fails to decode', async () => {
    imageShouldFail = true;
    await expect(loadImage('data:x')).rejects.toThrow('failed to load stitched image');
  });
});

describe('sliceImage', () => {
  it('cuts vertical tiles that cover the image exactly with no overlap', async () => {
    const tiles = await sliceImage('data:x', { count: 3, orientation: 'vertical' });
    expect(tiles.map((t) => [t.index, t.total, t.x, t.y, t.w, t.h])).toEqual([
      [1, 3, 0, 0, 1000, 1000],
      [2, 3, 0, 1000, 1000, 1000],
      [3, 3, 0, 2000, 1000, 1000],
    ]);
    expect(tiles[0].dataUrl).toBe('data:image/png;base64,1000x1000');
    expect(drawCalls[1]).toEqual([0, 1000, 1000, 1000, 0, 0, 1000, 1000]);
  });

  it('extends interior tiles by the overlap on both sides', async () => {
    const tiles = await sliceImage('data:x', { count: 3, orientation: 'vertical', overlap: 50 });
    expect(tiles.map((t) => [t.y, t.h])).toEqual([
      [0, 1050],
      [950, 1100],
      [1950, 1050],
    ]);
  });

  it('slices horizontally and honours the mime option', async () => {
    const tiles = await sliceImage('data:x', {
      count: 2,
      orientation: 'horizontal',
      overlap: 10,
      mime: 'image/jpeg',
    });
    expect(tiles.map((t) => [t.x, t.y, t.w, t.h])).toEqual([
      [0, 0, 510, 3000],
      [490, 0, 510, 3000],
    ]);
    expect(tiles[0].dataUrl.startsWith('data:image/jpeg')).toBe(true);
  });

  it('clamps the tile count to [1, 16] and ignores negative overlap', async () => {
    expect((await sliceImage('data:x', { count: 0, orientation: 'vertical' })).length).toBe(1);
    const many = await sliceImage('data:x', { count: 99, orientation: 'vertical', overlap: -5 });
    expect(many.length).toBe(16);
    expect(many[0].h).toBe(Math.ceil(3000 / 16));
  });
});
