import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import { useStore } from '../store';
import type { ComponentNode } from '@/lib/react/fiberToTree';
import {
  callScrollToBounds,
  callInspectAtBounds,
  type InspectedRegion,
} from '../hooks/useInspectedEval';
import { cropRegion } from '@/lib/snapshot/cropRegion';
import {
  UX_PRESETS,
  buildUxVisionPayload,
  customPromptId,
  customPromptLabel,
  describeInputs,
  type UxPreset,
} from '@/lib/components/uxVisionPrompts';
import { useLlm } from '@/lib/lm-studio/LlmContext';
import { Tabs, type TabItem } from '@/lib/ui/Tabs';
import { MarkdownRenderer } from '@/lib/ui/MarkdownRenderer';
import {
  pageKey,
  memoryStats,
  type MemoryEntry,
} from '@/lib/memory/sessionMemory';

interface TreeRow {
  id: string;
  name: string;
  kind: string;
  key?: string;
  tag?: string;
  hint?: string;
  childrenCount: number;
  hasBounds: boolean;
  bounds?: { x: number; y: number; w: number; h: number };
  children?: TreeRow[];
}

function toRows(nodes: ComponentNode[], prefix = ''): TreeRow[] {
  return nodes.map((n, i): TreeRow => {
    const id = prefix + '/' + i + ':' + n.id;
    return {
      id,
      name: n.name,
      kind: n.kind,
      key: n.key,
      tag: n.tag,
      hint: n.hint,
      childrenCount: n.childrenCount,
      hasBounds: !!n.bounds,
      bounds: n.bounds,
      children: n.children.length ? toRows(n.children, id) : undefined,
    };
  });
}

// "Significant" = a node worth showing in the tree.
// Pure wrappers (providers, fragments, single-letter anonymous components with
// no bounds and no content hint) are pruned and their children reparent up.
function isSignificant(row: TreeRow): boolean {
  if (!row.hasBounds) return false;
  // Always keep nodes with a real semantic name
  const namedWell = /^[A-Z]/.test(row.name) && row.name.length > 2;
  if (namedWell) return true;
  // Keep anything with a content hint
  if (row.hint) return true;
  // Keep host elements (real DOM)
  if (row.kind === 'host') return true;
  return false;
}

function pruneToSignificant(rows: TreeRow[]): TreeRow[] {
  const out: TreeRow[] = [];
  for (const r of rows) {
    const prunedChildren = r.children ? pruneToSignificant(r.children) : undefined;
    if (isSignificant(r)) {
      out.push({
        ...r,
        children: prunedChildren && prunedChildren.length ? prunedChildren : undefined,
        childrenCount: prunedChildren?.length ?? 0,
      });
    } else if (prunedChildren && prunedChildren.length) {
      out.push(...prunedChildren);
    }
  }
  return out;
}

function findById(rows: TreeRow[], id: string): TreeRow | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children) {
      const sub = findById(r.children, id);
      if (sub) return sub;
    }
  }
  return null;
}

function filterRows(rows: TreeRow[], q: string): TreeRow[] {
  if (!q) return rows;
  const needle = q.toLowerCase();
  const matches = (r: TreeRow) =>
    r.name.toLowerCase().includes(needle) ||
    r.kind.toLowerCase().includes(needle) ||
    (r.tag?.toLowerCase() ?? '').includes(needle) ||
    (r.hint?.toLowerCase() ?? '').includes(needle);
  const out: TreeRow[] = [];
  for (const row of rows) {
    const filteredChildren = row.children ? filterRows(row.children, q) : undefined;
    if (matches(row) || (filteredChildren && filteredChildren.length)) {
      out.push({
        ...row,
        children: filteredChildren && filteredChildren.length ? filteredChildren : undefined,
      });
    }
  }
  return out;
}

function NodeRow({ node, style, dragHandle }: NodeRendererProps<TreeRow>) {
  return (
    <div
      style={style}
      ref={dragHandle}
      className={
        'group flex cursor-pointer items-center gap-1.5 px-1 text-xs ' +
        (node.isSelected ? 'bg-panel-accent/30 text-white' : 'hover:bg-white/5')
      }
      onClick={() => node.toggle()}
    >
      <span className="w-3 shrink-0 text-panel-muted">{node.isLeaf ? '·' : node.isOpen ? '▾' : '▸'}</span>
      <span className="shrink-0 font-medium">{node.data.name}</span>
      {node.data.tag && (
        <span className="shrink-0 rounded bg-emerald-900/40 px-1 text-[10px] text-emerald-300">
          {node.data.tag}
        </span>
      )}
      <span className="shrink-0 text-[10px] text-panel-muted">{node.data.kind}</span>
      {node.data.key && <span className="shrink-0 text-[10px] text-yellow-200">key={node.data.key}</span>}
      {node.data.hint && (
        <span
          className="truncate italic text-[11px] text-panel-text/70"
          title={node.data.hint}
        >
          “{node.data.hint}”
        </span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-panel-muted">
        {node.data.hasBounds ? '📐 ' : ''}
        {node.data.childrenCount}
      </span>
    </div>
  );
}

export default function ComponentsTab() {
  const snap = useStore((s) => s.snapshot);
  const setFocused = useStore((s) => s.setFocused);
  const componentFilter = useStore((s) => s.componentFilter);
  const setComponentFilter = useStore((s) => s.setComponentFilter);
  const significantOnly = useStore((s) => s.significantOnly);
  const setSignificantOnly = useStore((s) => s.setSignificantOnly);
  const subtreeRootId = useStore((s) => s.subtreeRootId);
  const setSubtreeRootId = useStore((s) => s.setSubtreeRootId);
  const [selected, setSelected] = useState<TreeRow | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const treeApiRef = useRef<any>(null);
  const llm = useLlm();
  const settings = useStore((s) => s.settings);
  const llmConfigured = !!settings.baseUrl && !!settings.model;
  // Session memory for this page (origin + pathname keyed).
  const memoryByPage = useStore((s) => s.memoryByPage);
  const addMemory = useStore((s) => s.addMemoryEntry);
  const removeMemory = useStore((s) => s.removeMemoryEntry);
  const clearMemory = useStore((s) => s.clearMemory);
  const pk = pageKey(snap?.url);
  const memoryEntries = memoryByPage[pk] ?? [];
  const memStats = memoryStats(memoryEntries);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  // UX-vision analysis state: each run lands in a tab; same id replaces.
  const [analyses, setAnalyses] = useState<
    Record<
      string,
      {
        label: string;
        icon: string;
        text: string;
        state: 'streaming' | 'done' | 'error';
        error?: string;
        /** Cropped PNG sent to the model (dataURL). */
        imageDataUrl?: string;
        /** Pixel dims of the crop. */
        imageDims?: { w: number; h: number };
        /** Bytes (approx) of the encoded PNG. */
        imageBytes?: number;
        /** DOM context bundled into the prompt. */
        domContext?: InspectedRegion | null;
        /** Human-readable bullets of what was sent. */
        inputs?: string[];
        /** Preset / source id used for memory labelling. */
        sourceId?: string;
        componentName?: string;
        componentKind?: string;
      }
    >
  >({});
  const [activeTab, setActiveTab] = useState<string>('tree');
  const [customOpen, setCustomOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  // When the snapshot changes (new capture), reset analyses + selection.
  useEffect(() => {
    setAnalyses({});
    setActiveTab('tree');
    setSelected(null);
    setCustomOpen(false);
    setCustomPrompt('');
  }, [snap?.id]);

  const runUxAnalysis = async (
    preset: UxPreset | { id: string; customPrompt: string; label: string; icon: string },
  ) => {
    if (!llm || !snap?.screenshot || !selected?.bounds) return;
    const isCustom = 'customPrompt' in preset;
    const tabId = preset.id;
    const label = preset.label;
    const icon = preset.icon;
    const boundsLabel = `${Math.round(selected.bounds.w)}×${Math.round(selected.bounds.h)} at (${Math.round(selected.bounds.x)},${Math.round(selected.bounds.y)})`;

    // Show the "preparing" state immediately + jump to the tab so the
    // user sees progress while we collect context + crop the image.
    setAnalyses((a) => ({
      ...a,
      [tabId]: { label, icon, text: '', state: 'streaming' },
    }));
    setActiveTab(tabId);

    // 1. Inspect the live DOM at the bounds centre. Best-effort —
    //    failures (cross-origin, off-screen, etc.) just mean we ship
    //    the prompt without DOM context, the image is still useful.
    let domContext: InspectedRegion | null = null;
    try {
      domContext = await callInspectAtBounds(
        selected.bounds.x,
        selected.bounds.y,
        selected.bounds.w,
        selected.bounds.h,
      );
    } catch (e) {
      console.warn('[DOM Lens] inspectAtBounds failed', e);
    }

    // 2. Crop the region from the snapshot screenshot. When bounds are
    //    off-screen, cropRegion returns null and we fall back to the
    //    full image so the model still has something to look at.
    let imageDataUrl: string | null = null;
    try {
      imageDataUrl = await cropRegion(snap.screenshot, selected.bounds, { pad: 16 });
    } catch (e) {
      console.warn('[DOM Lens] cropRegion failed', e);
    }
    if (!imageDataUrl) imageDataUrl = snap.screenshot.dataUrl;

    // Derive crop dims + size for the inputs panel.
    const imgDims = await measureDataUrl(imageDataUrl);
    const imageBytes = approxDataUrlBytes(imageDataUrl);

    const memoryToInclude = includeMemory ? memoryEntries : [];

    const inputs = describeInputs({
      imageBytes,
      imageDims: imgDims ?? undefined,
      domContext,
      componentName: selected.name,
      componentKind: selected.kind,
      boundsLabel,
      memoryEntries: memoryToInclude,
    });

    const payload = buildUxVisionPayload(
      {
        imageDataUrl,
        componentName: selected.name,
        componentKind: selected.kind,
        boundsLabel,
        domContext: domContext
          ? {
              element: domContext.element,
              computed: domContext.computed,
              cssRules: domContext.cssRules,
              sheetsBlocked: domContext.sheetsBlocked,
            }
          : null,
        memoryEntries: memoryToInclude,
      },
      isCustom
        ? { id: preset.id, customPrompt: preset.customPrompt }
        : (preset as UxPreset),
      settings,
    );

    setAnalyses((a) => ({
      ...a,
      [tabId]: {
        label,
        icon,
        text: '',
        state: 'streaming',
        imageDataUrl: imageDataUrl ?? undefined,
        imageDims: imgDims ?? undefined,
        imageBytes,
        domContext,
        inputs,
        sourceId: tabId,
        componentName: selected.name,
        componentKind: selected.kind,
      },
    }));

    let acc = '';
    const handle = llm(payload, (delta) => {
      acc += delta;
      setAnalyses((a) => ({
        ...a,
        [tabId]: {
          ...a[tabId],
          label,
          icon,
          text: acc,
          state: 'streaming',
        },
      }));
    });
    handle.result
      .then((full) =>
        setAnalyses((a) => ({
          ...a,
          [tabId]: { ...a[tabId], label, icon, text: full, state: 'done' },
        })),
      )
      .catch((e) =>
        setAnalyses((a) => ({
          ...a,
          [tabId]: {
            ...a[tabId],
            label,
            icon,
            text: acc,
            state: 'error',
            error: e instanceof Error ? e.message : String(e),
          },
        })),
      );
  };

  /* helpers (defined here so they close over component scope cheaply) */

  function approxDataUrlBytes(dataUrl: string): number {
    const i = dataUrl.indexOf(',');
    if (i === -1) return dataUrl.length;
    // base64 → 3/4 ratio. Strip ==/= padding tokens for a tighter approximation.
    const payload = dataUrl.slice(i + 1).replace(/=+$/, '');
    return Math.floor((payload.length * 3) / 4);
  }
  function measureDataUrl(dataUrl: string): Promise<{ w: number; h: number } | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  const runCustomPrompt = () => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    void runUxAnalysis({
      id: customPromptId(trimmed),
      customPrompt: trimmed,
      label: customPromptLabel(trimmed),
      icon: '💬',
    });
    setCustomOpen(false);
    setCustomPrompt('');
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.max(100, r.width - 16), height: Math.max(100, r.height - 40) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fullRows = useMemo(() => (snap?.react ? toRows(snap.react.tree) : []), [snap]);

  const subtreeAnchor = subtreeRootId ? findById(fullRows, subtreeRootId) : null;
  const baseRows = subtreeAnchor?.children ?? fullRows;

  const prunedRows = useMemo(
    () => (significantOnly ? pruneToSignificant(baseRows) : baseRows),
    [baseRows, significantOnly],
  );
  const rows = useMemo(() => filterRows(prunedRows, componentFilter.trim()), [prunedRows, componentFilter]);

  // Open all branches when filter is active or "significant only" compressed the tree
  const openByDefault = componentFilter.trim().length > 0 || significantOnly;

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No snapshot yet.
      </div>
    );
  }
  if (!snap.react || fullRows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-panel-muted text-xs">
        No React fiber roots detected on this page.
      </div>
    );
  }

  const tabItems: TabItem[] = [
    { id: 'tree', label: 'Tree', icon: '🧩' },
    ...Object.entries(analyses).map(([id, a]) => ({
      id,
      label: a.label,
      icon: a.icon,
      badge: a.state,
      closable: true,
    })),
  ];

  // Keep the tree body mounted at all times (just hidden when an
  // analysis tab is active). Unmounting kills the react-arborist
  // ResizeObserver's measurement and the tree comes back at the
  // placeholder size until the next resize event — visible bug
  // reported by the user in v0.3.19.
  const treeActive = activeTab === 'tree';

  return (
    <div className="flex h-full flex-col">
      <Tabs
        tabs={tabItems}
        activeId={activeTab}
        onSelect={setActiveTab}
        onClose={(id) => {
          if (id === 'tree') return;
          setAnalyses((a) => {
            const next = { ...a };
            delete next[id];
            return next;
          });
          if (activeTab === id) setActiveTab('tree');
        }}
      >
        {!treeActive && (
          <UxAnalysisPane
            result={analyses[activeTab]}
            tabId={activeTab}
            inMemory={memoryEntries.some((m) => m.sourceId === activeTab)}
            onSaveToMemory={(entry) => addMemory(pk, entry)}
          />
        )}
        <div
          style={{ display: treeActive ? 'flex' : 'none' }}
          className="h-full flex-col"
        >
      <div className="flex flex-wrap items-center gap-2 border-b border-panel-border bg-panel-surface px-2 py-1.5 text-[11px]">
        <input
          type="text"
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
          placeholder='Filter by name, tag, kind, or content (e.g. "submit", "section")…'
          className="min-w-[200px] flex-1 rounded border border-panel-border bg-black/30 px-2 py-0.5 text-panel-text focus:border-panel-accent focus:outline-none"
        />
        {componentFilter && (
          <button
            type="button"
            className="text-panel-muted hover:text-white"
            onClick={() => setComponentFilter('')}
          >
            clear
          </button>
        )}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={significantOnly}
            onChange={(e) => setSignificantOnly(e.target.checked)}
          />
          <span>Significant only</span>
        </label>
        <span className="text-panel-muted">
          {rows.length}/{fullRows.length} · {snap.react.rootCount} root(s)
        </span>
      </div>

      {subtreeAnchor && (
        <div className="flex items-center gap-2 border-b border-panel-border bg-panel-surface/60 px-2 py-1 text-[11px]">
          <button
            type="button"
            className="text-panel-accent hover:underline"
            onClick={() => setSubtreeRootId(null)}
          >
            ← Back to full tree
          </button>
          <span className="text-panel-muted">Subtree of</span>
          <span className="font-medium text-white">{subtreeAnchor.name}</span>
          {subtreeAnchor.tag && (
            <span className="rounded bg-emerald-900/40 px-1 text-[10px] text-emerald-300">
              {subtreeAnchor.tag}
            </span>
          )}
          {subtreeAnchor.hint && (
            <span className="truncate italic text-panel-text/70" title={subtreeAnchor.hint}>
              “{subtreeAnchor.hint}”
            </span>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="min-w-0 flex-1 p-2">
          <Tree<TreeRow>
            ref={treeApiRef}
            data={rows}
            openByDefault={openByDefault}
            rowHeight={22}
            width={size.width}
            height={size.height}
            indent={14}
            onSelect={(nodes: NodeApi<TreeRow>[]) => {
              const row = nodes[0]?.data ?? null;
              setSelected(row);
              if (row) {
                setFocused({
                  id: row.id,
                  name: row.name,
                  kind: row.kind,
                  tag: row.tag,
                  hint: row.hint,
                  bounds: row.bounds,
                });
                // Bring the selected fiber into view on the inspected page.
                // The highlight overlay is positioned in document coords,
                // so scrolling here is the difference between the user
                // seeing the rect and seeing a blank scroll position.
                if (row.bounds && row.bounds.w > 0 && row.bounds.h > 0) {
                  void callScrollToBounds(
                    row.bounds.x,
                    row.bounds.y,
                    row.bounds.w,
                    row.bounds.h,
                  );
                }
              } else {
                setFocused(null);
              }
            }}
          >
            {NodeRow}
          </Tree>
        </div>
        <aside className="scrollbar-thin w-64 shrink-0 overflow-auto border-l border-panel-border bg-panel-surface p-3 text-xs">
          <div className="mb-1 text-[10px] uppercase text-panel-muted">Selection</div>
          {selected ? (
            <>
              <dl className="space-y-1">
                <div>
                  <dt className="text-[10px] text-panel-muted">Name</dt>
                  <dd className="font-medium text-white">{selected.name}</dd>
                </div>
                {selected.tag && (
                  <div>
                    <dt className="text-[10px] text-panel-muted">Host element</dt>
                    <dd className="font-mono text-emerald-300">&lt;{selected.tag}&gt;</dd>
                  </div>
                )}
                {selected.hint && (
                  <div>
                    <dt className="text-[10px] text-panel-muted">Content</dt>
                    <dd className="italic text-panel-text/80">“{selected.hint}”</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] text-panel-muted">Kind</dt>
                  <dd>{selected.kind}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-panel-muted">Key</dt>
                  <dd>{selected.key ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-panel-muted">Direct children</dt>
                  <dd>{selected.childrenCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-panel-muted">Bounds (doc coords)</dt>
                  <dd className="font-mono text-[11px]">
                    {selected.bounds
                      ? `${selected.bounds.x},${selected.bounds.y} · ${selected.bounds.w}×${selected.bounds.h}`
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="mt-2 flex flex-col gap-1">
                <button
                  type="button"
                  className="rounded bg-panel-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400 disabled:opacity-50"
                  disabled={!selected.children || selected.children.length === 0}
                  onClick={() => setSubtreeRootId(selected.id)}
                >
                  Focus subtree →
                </button>
                {selected.bounds && (
                  <div className="text-[10px] text-emerald-300">
                    Live overlay shown on the page and on the snapshot.
                  </div>
                )}
              </div>
              {selected.bounds && (
                <div className="mt-3 border-t border-panel-border pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-panel-muted">
                    Analyze region with AI
                  </div>
                  {!llmConfigured ? (
                    <div className="text-[10px] text-panel-muted">
                      Configure a local LLM in Settings to enable.
                    </div>
                  ) : !snap.screenshot ? (
                    <div className="text-[10px] text-panel-muted">
                      Capture a snapshot screenshot first (needs an image
                      to send to the model).
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 rounded border border-panel-border bg-black/30 px-1.5 py-1 text-[10px]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-panel-text/90">
                            📚 Memory:{' '}
                            <span className={memStats.count > 0 ? 'text-white' : 'text-panel-muted'}>
                              {memStats.count} entr{memStats.count === 1 ? 'y' : 'ies'}
                            </span>
                            {memStats.count > 0 && (
                              <span className="text-panel-muted">
                                {' '}
                                · {(memStats.bytes / 1024).toFixed(1)} KB
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1">
                            <label className="flex cursor-pointer items-center gap-1 text-panel-muted">
                              <input
                                type="checkbox"
                                checked={includeMemory}
                                onChange={(e) => setIncludeMemory(e.target.checked)}
                                disabled={memStats.count === 0}
                                className="h-3 w-3"
                              />
                              <span>Include</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => setMemoryOpen((v) => !v)}
                              disabled={memStats.count === 0}
                              className="rounded border border-panel-border px-1 text-panel-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {memoryOpen ? 'hide' : 'view'}
                            </button>
                            <button
                              type="button"
                              onClick={() => clearMemory(pk)}
                              disabled={memStats.count === 0}
                              className="rounded border border-panel-border px-1 text-panel-muted hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              clear
                            </button>
                          </div>
                        </div>
                        {memStats.count > 0 && (
                          <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full bg-panel-accent/60"
                              style={{
                                width:
                                  Math.min(100, (memStats.bytes / memStats.budget) * 100) + '%',
                              }}
                            />
                          </div>
                        )}
                        {memoryOpen && memStats.count > 0 && (
                          <ul className="mt-1.5 space-y-1 border-t border-panel-border pt-1.5">
                            {memoryEntries.map((m) => (
                              <li
                                key={m.id}
                                className="flex items-start justify-between gap-2 rounded bg-black/30 px-1.5 py-1"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10px] font-medium text-white">
                                    {m.icon} {m.label}
                                  </div>
                                  {m.componentName && (
                                    <div className="text-[10px] text-panel-muted">
                                      {m.componentName}
                                      {m.componentKind ? ` · ${m.componentKind}` : ''}
                                    </div>
                                  )}
                                  <div className="text-[10px] text-panel-muted">
                                    {(m.text.length / 1024).toFixed(1)} KB
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeMemory(pk, m.id)}
                                  title="Remove entry"
                                  className="shrink-0 rounded border border-panel-border px-1 text-[10px] text-panel-muted hover:text-red-300"
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-1">
                        {UX_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => void runUxAnalysis(p)}
                            title={p.hint}
                            disabled={analyses[p.id]?.state === 'streaming'}
                            className="flex items-center gap-1.5 rounded border border-panel-accent/40 bg-panel-accent/10 px-1.5 py-0.5 text-left text-[10px] text-panel-accent hover:bg-panel-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span>{p.icon}</span>
                            <span className="font-medium">{p.label}</span>
                            {analyses[p.id]?.state === 'streaming' && (
                              <span className="ml-auto text-panel-muted">…</span>
                            )}
                            {analyses[p.id]?.state === 'done' && (
                              <span className="ml-auto text-emerald-300">✓</span>
                            )}
                            {analyses[p.id]?.state === 'error' && (
                              <span className="ml-auto text-red-300">✗</span>
                            )}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCustomOpen((v) => !v)}
                          className="flex items-center gap-1.5 rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-left text-[10px] text-violet-200 hover:bg-violet-500/20"
                        >
                          <span>💬</span>
                          <span className="font-medium">
                            {customOpen ? 'Hide custom prompt' : 'Custom prompt…'}
                          </span>
                        </button>
                      </div>
                      {customOpen && (
                        <div className="mt-2 rounded border border-panel-border bg-black/20 p-1.5">
                          <textarea
                            className="block w-full rounded border border-panel-border bg-black/30 p-1 text-[10px] text-panel-text"
                            rows={3}
                            placeholder="Ask anything UX/brand/research about this region…"
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                          />
                          <div className="mt-1 flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setCustomOpen(false);
                                setCustomPrompt('');
                              }}
                              className="rounded border border-panel-border px-1.5 py-0.5 text-[10px] text-panel-muted hover:text-white"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={runCustomPrompt}
                              disabled={!customPrompt.trim()}
                              className="rounded bg-panel-accent px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Run
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-panel-muted">Click a node to inspect, highlight, or focus its subtree.</div>
          )}
        </aside>
      </div>
        </div>
      </Tabs>
    </div>
  );
}

function UxAnalysisPane({
  result,
  tabId,
  inMemory,
  onSaveToMemory,
}: {
  result:
    | {
        label: string;
        icon: string;
        text: string;
        state: 'streaming' | 'done' | 'error';
        error?: string;
        imageDataUrl?: string;
        imageDims?: { w: number; h: number };
        imageBytes?: number;
        inputs?: string[];
        sourceId?: string;
        componentName?: string;
        componentKind?: string;
      }
    | undefined;
  tabId?: string;
  inMemory?: boolean;
  onSaveToMemory?: (entry: Omit<MemoryEntry, 'id' | 'timestamp'>) => void;
}) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-panel-muted">
        Result lost — re-run the analysis from the Tree tab.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-panel-border bg-panel-surface px-3 py-1.5 text-[10px] uppercase tracking-wide text-panel-muted">
        <span>
          <span className="mr-1">{result.icon}</span>
          {result.label}
        </span>
        <div className="flex items-center gap-2 normal-case">
          {result.state === 'done' && result.text && onSaveToMemory && (
            inMemory ? (
              <span
                title="This analysis is in this page's session memory"
                className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200"
              >
                📚 In memory
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onSaveToMemory({
                    label: result.label,
                    sourceId: tabId,
                    icon: result.icon,
                    componentName: result.componentName,
                    componentKind: result.componentKind,
                    text: result.text,
                  })
                }
                title="Save this analysis to the page's session memory so later prompts can fold it in"
                className="rounded border border-panel-accent/60 bg-panel-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-panel-accent hover:bg-panel-accent/20"
              >
                💾 Save to memory
              </button>
            )
          )}
          <span className="text-panel-muted">
            {result.state === 'streaming'
              ? '· streaming'
              : result.state === 'error'
                ? '· error'
                : '· done'}
          </span>
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3 text-[12px]">
        {(result.imageDataUrl || (result.inputs && result.inputs.length > 0)) && (
          <details
            open
            className="mb-3 rounded border border-panel-border bg-panel-bg/40 p-2 text-[11px]"
          >
            <summary className="cursor-pointer text-panel-text/90 hover:text-white">
              Context sent to model
              {result.imageDims
                ? ` · ${result.imageDims.w}×${result.imageDims.h} crop`
                : ''}
              {result.imageBytes
                ? ` · ${Math.round(result.imageBytes / 1024)} KB image`
                : ''}
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              {result.imageDataUrl && (
                <a
                  href={result.imageDataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block shrink-0"
                  title="Open the cropped image in a new tab"
                >
                  <img
                    src={result.imageDataUrl}
                    alt="Cropped region sent to the model"
                    className="max-h-40 max-w-[240px] rounded border border-panel-border bg-black/30 object-contain"
                  />
                </a>
              )}
              {result.inputs && result.inputs.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-panel-text/90">
                  {result.inputs.map((b, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-panel-muted">·</span>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: b.replace(
                            /`([^`]+)`/g,
                            '<code class="rounded bg-black/40 px-1 text-[10px] text-amber-200">$1</code>',
                          ),
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}
        {result.text ? (
          <MarkdownRenderer
            source={result.text}
            streaming={result.state === 'streaming'}
          />
        ) : (
          <div className="text-[11px] text-panel-muted">
            {result.imageDataUrl
              ? 'Asking model… (image + DOM context sent)'
              : 'Preparing inputs…'}
          </div>
        )}
        {result.state === 'streaming' && (
          <span className="ml-0.5 inline-block animate-pulse">▍</span>
        )}
        {result.state === 'error' && result.error && (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
            {result.error}
          </div>
        )}
      </div>
    </div>
  );
}
