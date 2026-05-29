import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { sliceImage, suggestSliceCount } from '@/lib/snapshot/slicer';
import { MarkdownRenderer } from '@/lib/ui/MarkdownRenderer';
import { JsonViewer } from '@/lib/ui/JsonViewer';

interface Props {
  /** Called when the user clicks "Enhance with AI" — kicks off an LLM
   * round-trip that asks the local model for per-tile trim offsets, then
   * re-stitches the screenshot. Driven from App.tsx. */
  onEnhanceWithAI(): void;
}

export default function SnapshotTab({ onEnhanceWithAI }: Props) {
  const snap = useStore((s) => s.snapshot);
  const settings = useStore((s) => s.settings);
  const focused = useStore((s) => s.focused);
  const tiles = useStore((s) => s.tiles);
  const setTiles = useStore((s) => s.setTiles);
  const rawTiles = useStore((s) => s.rawTiles);
  const enhanceStatus = useStore((s) => s.enhanceStatus);
  const enhanceMessage = useStore((s) => s.enhanceMessage);
  const enhanceError = useStore((s) => s.enhanceError);

  const llmConfigured = !!settings.baseUrl && !!settings.model;
  const enhanceBusy = enhanceStatus === 'asking' || enhanceStatus === 'restitching';
  const canEnhance = llmConfigured && rawTiles.length > 1 && !enhanceBusy;

  const [showJson, setShowJson] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<'rendered' | 'source'>('rendered');
  const [orientationOverride, setOrientationOverride] = useState<'auto' | 'vertical' | 'horizontal'>('auto');
  const [sliceCount, setSliceCount] = useState<number>(settings.defaultSliceCount);
  const [slicing, setSlicing] = useState(false);
  const [sliceError, setSliceError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgClient, setImgClient] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!imgRef.current) return;
    const el = imgRef.current;
    const measure = () => setImgClient({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap?.id]);

  const orientation = useMemo<'vertical' | 'horizontal'>(() => {
    if (orientationOverride !== 'auto') return orientationOverride;
    return snap?.screenshot?.orientation ?? 'vertical';
  }, [orientationOverride, snap]);

  const autoSuggestedSlices = useMemo(() => {
    if (!snap?.screenshot) return 1;
    const longest =
      orientation === 'vertical'
        ? snap.screenshot.pixelHeight
        : snap.screenshot.pixelWidth;
    return suggestSliceCount(longest, 2048);
  }, [snap, orientation]);

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No snapshot yet. Click <span className="mx-1 font-semibold text-panel-text">Capture snapshot</span> to start.
      </div>
    );
  }

  const screenshot = snap.screenshot;
  const overlayBox = focused?.bounds && screenshot
    ? (() => {
        const scale = imgClient.w / screenshot.width;
        return {
          left: Math.max(0, focused.bounds.x * scale),
          top: Math.max(0, focused.bounds.y * scale),
          width: Math.max(2, focused.bounds.w * scale),
          height: Math.max(2, focused.bounds.h * scale),
        };
      })()
    : null;

  const runSlice = async () => {
    if (!screenshot) return;
    setSlicing(true);
    setSliceError(null);
    try {
      const result = await sliceImage(screenshot.dataUrl, {
        count: sliceCount,
        orientation,
        overlap: 24,
      });
      setTiles(result);
    } catch (e) {
      setSliceError((e as Error).message);
    } finally {
      setSlicing(false);
    }
  };

  return (
    <div className="scrollbar-thin h-full overflow-auto p-3 text-xs">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Page</div>
          <div className="truncate font-medium text-white">{snap.title || '(no title)'}</div>
          <div className="truncate text-panel-muted">{snap.url}</div>
        </div>
        <div className="rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Captured</div>
          <div>{new Date(snap.capturedAt).toLocaleString()}</div>
          <div className="text-panel-muted">
            {snap.pageMetrics.scrollWidth}×{snap.pageMetrics.scrollHeight} doc ·{' '}
            {snap.pageMetrics.viewportWidth}×{snap.pageMetrics.viewportHeight} vp ·{' '}
            {snap.dom.charCount.toLocaleString()} md · {snap.network.length} net · {snap.console.length} console
          </div>
        </div>
      </div>

      {screenshot && (
        <div className="mb-3 rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] uppercase text-panel-muted">
              Screenshot — {screenshot.kind === 'fullpage' ? 'full page' : 'visible viewport'} ·{' '}
              {screenshot.width}×{screenshot.height} · {screenshot.tileCount} tile(s) ·{' '}
              {screenshot.orientation}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onEnhanceWithAI}
                disabled={!canEnhance}
                title={
                  !llmConfigured
                    ? 'Configure a local model in Settings to enable AI enhancement.'
                    : rawTiles.length <= 1
                      ? 'Need at least 2 raw tiles to re-stitch — capture again.'
                      : 'Ask the local LLM to analyze the tiles and re-stitch with corrected offsets.'
                }
                className="rounded border border-panel-accent/60 bg-panel-accent/10 px-2 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-transparent disabled:text-panel-muted"
              >
                {enhanceBusy
                  ? enhanceStatus === 'asking'
                    ? 'Analyzing…'
                    : 'Re-stitching…'
                  : '✨ Enhance with AI'}
              </button>
              <a
                href={screenshot.dataUrl}
                download={`dom-lens-${snap.id.slice(0, 8)}.png`}
                className="text-[10px] text-panel-accent hover:underline"
              >
                download
              </a>
            </div>
          </div>

          {(enhanceStatus === 'asking' ||
            enhanceStatus === 'restitching' ||
            enhanceStatus === 'done' ||
            enhanceStatus === 'error') && (
            <div
              className={
                'mb-1 rounded border px-2 py-1 text-[10px] ' +
                (enhanceStatus === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : enhanceStatus === 'done'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-sky-500/40 bg-sky-500/10 text-sky-200')
              }
            >
              {enhanceStatus === 'error'
                ? `AI enhance failed: ${enhanceError ?? 'unknown error'}`
                : enhanceMessage ?? ''}
            </div>
          )}
          <div
            className="scrollbar-thin relative max-h-96 overflow-auto rounded border border-panel-border bg-black/30"
            style={{ resize: 'vertical' }}
          >
            <div className="relative inline-block min-w-full">
              <img
                ref={imgRef}
                src={screenshot.dataUrl}
                alt="page screenshot"
                className="block w-full"
                style={{ imageRendering: 'auto' }}
              />
              {overlayBox && (
                <div
                  className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/20"
                  style={overlayBox}
                >
                  {focused && (
                    <div className="absolute -top-5 left-0 whitespace-nowrap rounded bg-sky-500 px-1 text-[10px] text-white">
                      {focused.name}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-panel-muted">Slice into</span>
            <input
              type="number"
              min={1}
              max={16}
              value={sliceCount}
              onChange={(e) => setSliceCount(Math.max(1, Math.min(16, parseInt(e.target.value || '1', 10))))}
              className="w-14 rounded border border-panel-border bg-black/30 px-1 py-0.5 text-panel-text"
            />
            <span className="text-panel-muted">tiles ·</span>
            <select
              value={orientationOverride}
              onChange={(e) => setOrientationOverride(e.target.value as any)}
              className="rounded border border-panel-border bg-black/30 px-1 py-0.5 text-panel-text"
            >
              <option value="auto">auto ({screenshot.orientation})</option>
              <option value="vertical">vertical</option>
              <option value="horizontal">horizontal</option>
            </select>
            <button
              type="button"
              className="rounded bg-panel-accent px-2 py-0.5 text-white hover:bg-sky-400 disabled:opacity-50"
              onClick={runSlice}
              disabled={slicing}
            >
              {slicing ? 'Slicing…' : 'Slice'}
            </button>
            <button
              type="button"
              className="text-panel-accent hover:underline"
              onClick={() => setSliceCount(autoSuggestedSlices)}
            >
              suggest ({autoSuggestedSlices})
            </button>
            {tiles.length > 0 && (
              <button
                type="button"
                className="text-panel-muted hover:text-white"
                onClick={() => setTiles([])}
              >
                clear
              </button>
            )}
            {sliceError && <span className="text-red-300">{sliceError}</span>}
          </div>

          {tiles.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] uppercase text-panel-muted">
                Tiles in sequence ({orientation === 'vertical' ? 'top → bottom' : 'left → right'})
              </div>
              <div
                className={
                  'flex gap-2 ' +
                  (orientation === 'vertical' ? 'flex-col' : 'flex-row overflow-x-auto')
                }
              >
                {tiles.map((t) => (
                  <div
                    key={t.index}
                    className="rounded border border-panel-border bg-black/40 p-1"
                    style={
                      orientation === 'horizontal'
                        ? { minWidth: 160, maxWidth: 240 }
                        : undefined
                    }
                  >
                    <div className="mb-1 flex items-center justify-between text-[10px] text-panel-muted">
                      <span>
                        {t.index}/{t.total}
                      </span>
                      <a
                        href={t.dataUrl}
                        download={`dom-lens-${snap.id.slice(0, 8)}-tile-${t.index}.png`}
                        className="text-panel-accent hover:underline"
                      >
                        download
                      </a>
                    </div>
                    <img src={t.dataUrl} alt={`tile ${t.index}`} className="block max-h-48 w-full object-contain" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-3 rounded border border-panel-border bg-panel-surface p-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] uppercase text-panel-muted">DOM markdown</div>
          <div className="flex items-center gap-2 text-[10px] text-panel-muted">
            <span>{snap.dom.charCount.toLocaleString()} chars</span>
            <span className="h-3 w-px bg-panel-border" />
            <button
              type="button"
              className={
                'rounded px-1.5 py-0.5 ' +
                (markdownMode === 'rendered'
                  ? 'bg-black/30 text-white'
                  : 'hover:text-white')
              }
              onClick={() => setMarkdownMode('rendered')}
            >
              Rendered
            </button>
            <button
              type="button"
              className={
                'rounded px-1.5 py-0.5 ' +
                (markdownMode === 'source'
                  ? 'bg-black/30 text-white'
                  : 'hover:text-white')
              }
              onClick={() => setMarkdownMode('source')}
            >
              Source
            </button>
          </div>
        </div>
        <div className="scrollbar-thin max-h-72 overflow-auto rounded bg-black/30 p-2">
          {markdownMode === 'rendered' ? (
            <MarkdownRenderer source={snap.dom.markdown} />
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug">
{snap.dom.markdown}
            </pre>
          )}
        </div>
      </div>

      {snap.console.length > 0 && (
        <div className="mb-3 rounded border border-panel-border bg-panel-surface p-2">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Console ({snap.console.length})</div>
          <div className="scrollbar-thin max-h-40 overflow-auto font-mono text-[11px]">
            {snap.console.map((c, i) => (
              <div
                key={i}
                className={
                  'border-b border-panel-border/50 py-0.5 ' +
                  (c.level === 'error'
                    ? 'text-red-300'
                    : c.level === 'warn'
                      ? 'text-yellow-200'
                      : 'text-panel-text')
                }
              >
                <span className="mr-2 text-[10px] uppercase text-panel-muted">{c.level}</span>
                {c.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded border border-panel-border bg-panel-surface p-2">
        <button
          type="button"
          className="text-[11px] text-panel-accent hover:underline"
          onClick={() => setShowJson((v) => !v)}
        >
          {showJson ? '− Hide raw JSON' : '+ Show raw JSON'}
        </button>
        {showJson && (
          <div className="mt-2">
            <JsonViewer
              value={snap}
              maxHeight={420}
              collapsed={2}
              elideKeys={['dataUrl', 'markdown', 'html']}
            />
          </div>
        )}
      </div>
    </div>
  );
}
