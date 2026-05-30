import { useMemo, useState } from 'react';
import type { ModuleTreeNode, ModuleTreeNodeType } from '@/lib/modules/moduleTree';
import { formatBytes } from '@/lib/modules/sourcemap';

interface Props {
  root: ModuleTreeNode;
  selectedId: string | null;
  onSelect(node: ModuleTreeNode): void;
  /** Called when the user expands a `module` node — drives the lazy
   * sourcemap fetch + tree-graft flow. */
  onExpandModule(node: ModuleTreeNode): void;
  /** Per-module status badge data, indexed by module url. */
  statusForUrl(url: string): JSX.Element | null;
  /** Filter string. When non-empty, the tree is pruned to nodes whose
   * subtree contains a match. Folders auto-expand. */
  filter: string;
}

/**
 * Chrome-Sources-panel-style file tree. Renders the result of
 * buildModuleTree (and any expanded sourcemap subtrees grafted in by
 * expandModuleWithSourcemap). Three behaviours:
 *
 *   - Folders open/close on click; expanded by default at depth ≤ 1.
 *   - Module leaves trigger `onExpandModule(node)` the first time they
 *     open so the parent can fetch + parse the sourcemap and re-graft.
 *   - Source-file leaves fire `onSelect(node)` for the file viewer.
 *
 * Filtering is non-destructive — we keep the underlying tree intact and
 * just hide non-matching subtrees. A "no results" empty state shows
 * when the filter eliminates everything.
 */
export function ModulesTree({
  root,
  selectedId,
  onSelect,
  onExpandModule,
  statusForUrl,
  filter,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [root.id]: true,
  });
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const filterLower = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!filterLower) return null; // null sentinel = show everything
    return collectMatchingIds(root, filterLower);
  }, [root, filterLower]);

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const renderNode = (node: ModuleTreeNode, depth: number): JSX.Element | null => {
    if (visible && !visible.has(node.id)) return null;
    const isOpen =
      expanded[node.id] ?? (visible ? true : depth < 1 || hasOnlyOriginAncestors(depth));
    const hasChildren = node.children.length > 0;
    const isLeaf = node.type === 'module' || node.type === 'source-file';

    const handleClick = () => {
      if (node.type === 'module') {
        if (!isOpen) {
          // First open — invoke onExpandModule so the parent can lazy-fetch the sourcemap
          if (!expandedModules.has(node.id)) {
            expandedModules.add(node.id);
            setExpandedModules(new Set(expandedModules));
            onExpandModule(node);
          }
        }
        toggle(node.id);
        onSelect(node);
      } else if (node.type === 'source-file') {
        onSelect(node);
      } else {
        toggle(node.id);
      }
    };

    const selected = selectedId === node.id;
    return (
      <div key={node.id}>
        <div
          className={
            'flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px] ' +
            (selected
              ? 'bg-panel-accent/30 text-white'
              : 'hover:bg-panel-surface/40 text-panel-text/90')
          }
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={handleClick}
        >
          {hasChildren || node.type === 'module' ? (
            <span className="w-3 shrink-0 text-panel-muted">{isOpen ? '▾' : '▸'}</span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <NodeIcon type={node.type} />
          <span className="flex-1 truncate font-mono">{node.name}</span>
          {node.type === 'module' && node.module && statusForUrl(node.module.url)}
          {node.type === 'source-file' && node.bytes != null && (
            <span className="ml-1 shrink-0 font-mono text-[10px] text-panel-muted">
              {formatBytes(node.bytes)}
            </span>
          )}
        </div>
        {isOpen &&
          hasChildren &&
          node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (visible && visible.size === 0) {
    return (
      <div className="p-3 text-[11px] text-panel-muted">
        No modules or sources match the filter.
      </div>
    );
  }

  return <div className="py-1">{root.children.map((c) => renderNode(c, 0))}</div>;
}

function hasOnlyOriginAncestors(depth: number): boolean {
  return depth === 0;
}

function NodeIcon({ type }: { type: ModuleTreeNodeType }) {
  const ch = (() => {
    switch (type) {
      case 'origin':
        return '🌐';
      case 'folder':
        return '📁';
      case 'source-folder':
        return '📂';
      case 'module':
        return '📦';
      case 'source-file':
        return '📄';
    }
  })();
  return <span className="w-4 shrink-0 text-center text-[11px]">{ch}</span>;
}

/**
 * Walk the tree and return the set of node ids whose name OR any
 * descendant's name contains the filter. Used to prune the render
 * without mutating the tree.
 */
function collectMatchingIds(root: ModuleTreeNode, q: string): Set<string> {
  const out = new Set<string>();
  const walk = (node: ModuleTreeNode): boolean => {
    const self = node.name.toLowerCase().includes(q);
    let anyChild = false;
    for (const c of node.children) {
      if (walk(c)) anyChild = true;
    }
    if (self || anyChild) {
      out.add(node.id);
      return true;
    }
    return false;
  };
  walk(root);
  return out;
}
