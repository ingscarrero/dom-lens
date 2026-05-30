import type { LoadedModule, ParsedSourceMap } from './types';

/**
 * Hierarchical view of loaded modules + their (lazily resolved) original
 * sources, modelled on Chrome DevTools' Sources panel.
 *
 * Top level: one node per origin (`bank.gov.ua`, `cdn.example.com`).
 * Below each origin: folder nodes mirroring the URL pathname.
 * Each leaf is a "module" node — the loaded JS / CSS / image / font.
 * When a module has a sourcemap, expanding it surfaces an "Authored
 * sources" subtree of the original source files via the sourcemap's
 * `sourcesContent` array (when present).
 *
 * The tree is computed once per snapshot from the flat `LoadedModule[]`
 * list. Sourcemap expansion is incremental — the caller fetches the .map,
 * passes the parsed result to `expandModuleWithSourcemap`, and gets back
 * a new tree with the source subtree grafted under the matching module.
 * No mutation; the panel stores the tree in React state.
 */

export type ModuleTreeNodeType =
  | 'origin'
  | 'folder'
  | 'module'
  | 'source-folder'
  | 'source-file';

export interface ModuleTreeNode {
  /** Unique stable id (the absolute URL or virtual webpack:/// path). */
  id: string;
  /** Display label — the last path segment for folders/files, origin
   * host for origin nodes. */
  name: string;
  /** Subtype that drives icon + click behaviour. */
  type: ModuleTreeNodeType;
  /** Children, sorted with folders first then by name. */
  children: ModuleTreeNode[];
  /** For 'module' leaves only: the original LoadedModule. */
  module?: LoadedModule;
  /** For 'source-file' leaves only: original source code (from the
   * sourcemap's `sourcesContent`). May be null if the bundler stripped
   * content (`nosources-source-map`). */
  sourceContent?: string | null;
  /** For 'source-file' leaves only: normalized source path
   * (e.g. `webpack:///src/components/Button.tsx`). */
  sourcePath?: string;
  /** For 'source-file' leaves: byte count derived from the sourcemap. */
  bytes?: number;
}

/* ---------- Build the deployed-modules tree ---------- */

export function buildModuleTree(modules: readonly LoadedModule[]): ModuleTreeNode {
  const root: ModuleTreeNode = {
    id: '__root__',
    name: '/',
    type: 'folder',
    children: [],
  };

  // Group by origin first.
  const byOrigin = new Map<string, LoadedModule[]>();
  for (const m of modules) {
    const list = byOrigin.get(m.origin) ?? [];
    list.push(m);
    byOrigin.set(m.origin, list);
  }

  for (const [origin, mods] of byOrigin) {
    const originNode: ModuleTreeNode = {
      id: origin,
      name: stripScheme(origin),
      type: 'origin',
      children: [],
    };
    for (const m of mods) {
      placeModule(originNode, m);
    }
    sortTreeRecursively(originNode);
    root.children.push(originNode);
  }

  root.children.sort((a, b) => a.name.localeCompare(b.name));
  return root;
}

function stripScheme(origin: string): string {
  return origin.replace(/^https?:\/\//, '');
}

/**
 * Walks the URL pathname and creates folder nodes as needed, then plants
 * the module leaf at the bottom.
 */
function placeModule(originNode: ModuleTreeNode, mod: LoadedModule): void {
  const segments = mod.pathname.split('/').filter(Boolean);
  let cur = originNode;
  let acc = originNode.id;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    acc = acc + '/' + seg;
    let next = cur.children.find((c) => c.type === 'folder' && c.name === seg);
    if (!next) {
      next = { id: acc, name: seg, type: 'folder', children: [] };
      cur.children.push(next);
    }
    cur = next;
  }
  const leafName = segments[segments.length - 1] ?? '(root)';
  cur.children.push({
    id: mod.url,
    name: leafName,
    type: 'module',
    children: [],
    module: mod,
  });
}

/**
 * Folders first, then alphabetical. The source-file leaves inside an
 * expanded module subtree get the same treatment via the recursive walk.
 */
function sortTreeRecursively(node: ModuleTreeNode): void {
  if (node.children.length === 0) return;
  const folderTypes: ModuleTreeNodeType[] = ['origin', 'folder', 'source-folder'];
  node.children.sort((a, b) => {
    const aIsFolder = folderTypes.includes(a.type);
    const bIsFolder = folderTypes.includes(b.type);
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTreeRecursively(c);
}

/* ---------- Graft an "Authored sources" subtree under a module node ---------- */

/**
 * Returns a new tree where the module node identified by `moduleId` has
 * its `children` replaced with a folder structure derived from the
 * sourcemap. The bundle URL itself is preserved as the module's
 * identity; the sources show up as nested children under it.
 *
 * Source paths are normalized (`webpack:///`, `../../` collapsed, etc.)
 * and grouped into a `webpack:///` virtual root so deeply-nested
 * `node_modules/.pnpm/...` paths stay collapsible.
 */
export function expandModuleWithSourcemap(
  tree: ModuleTreeNode,
  moduleId: string,
  sourcemap: ParsedSourceMap,
): ModuleTreeNode {
  const sources = sourcemap.sources;
  const sizes = sourcemap.sizes;
  const contents = sourcemap.sourcesContent;

  const sourceRoot: ModuleTreeNode = {
    id: moduleId + '#sources',
    name: 'Authored sources',
    type: 'source-folder',
    children: [],
  };

  for (let i = 0; i < sources.length; i++) {
    const norm = normalizeSourcePath(sources[i]);
    if (!norm.path) continue;
    insertSourcePath(sourceRoot, norm.prefix, norm.path, {
      bytes: sizes[i] ?? 0,
      content: contents[i] ?? null,
      rawPath: sources[i],
    });
  }
  sortTreeRecursively(sourceRoot);

  // Walk + replace
  return mapTree(tree, (node) => {
    if (node.id !== moduleId) return node;
    return { ...node, children: [sourceRoot] };
  });
}

function mapTree(
  node: ModuleTreeNode,
  fn: (n: ModuleTreeNode) => ModuleTreeNode,
): ModuleTreeNode {
  const replaced = fn(node);
  if (replaced.children.length === 0) return replaced;
  return {
    ...replaced,
    children: replaced.children.map((c) => mapTree(c, fn)),
  };
}

/**
 * Splits a raw sourcemap `sources` entry into (prefix, path). The prefix
 * is a short virtual root used to group siblings (`webpack:///`,
 * `vite:///`, `rollup:///`, or just `/` when there's no marker).
 */
function normalizeSourcePath(raw: string): { prefix: string; path: string } {
  if (!raw) return { prefix: '/', path: '' };
  let s = raw;
  let prefix = '/';
  const knownPrefixes: Array<[string, string]> = [
    ['webpack://', 'webpack:///'],
    ['webpack-internal://', 'webpack-internal:///'],
    ['vite://', 'vite:///'],
    ['rollup://', 'rollup:///'],
  ];
  for (const [test, label] of knownPrefixes) {
    if (s.startsWith(test)) {
      prefix = label;
      s = s.slice(test.length).replace(/^\/+/, '');
      break;
    }
  }
  // Strip cross-origin marker `(host)/...`
  s = s.replace(/^\(([^)]+)\)\//, '$1/');
  // Collapse leading dot segments
  s = s.replace(/^(\.\.\/)+/, '');
  s = s.replace(/^\.\//, '');
  s = s.replace(/\\/g, '/');
  s = s.replace(/[?#].*$/, '');
  s = s.replace(/\/{2,}/g, '/');
  return { prefix, path: s };
}

function insertSourcePath(
  root: ModuleTreeNode,
  prefix: string,
  fullPath: string,
  payload: { bytes: number; content: string | null; rawPath: string },
): void {
  // Each prefix becomes a single child of the source-folder root, so the
  // user sees `webpack:///` as a collapsible bucket.
  let prefixNode = root.children.find(
    (c) => c.type === 'source-folder' && c.name === prefix,
  );
  if (!prefixNode) {
    prefixNode = {
      id: root.id + '/' + prefix,
      name: prefix,
      type: 'source-folder',
      children: [],
    };
    root.children.push(prefixNode);
  }
  const segments = fullPath.split('/').filter(Boolean);
  let cur = prefixNode;
  let acc = prefixNode.id;
  for (let i = 0; i < segments.length - 1; i++) {
    acc += '/' + segments[i];
    let next = cur.children.find(
      (c) => c.type === 'source-folder' && c.name === segments[i],
    );
    if (!next) {
      next = {
        id: acc,
        name: segments[i],
        type: 'source-folder',
        children: [],
      };
      cur.children.push(next);
    }
    cur = next;
  }
  const leafName = segments[segments.length - 1] ?? '(root)';
  cur.children.push({
    id: prefixNode.id + '/' + fullPath,
    name: leafName,
    type: 'source-file',
    children: [],
    sourceContent: payload.content,
    sourcePath: payload.rawPath,
    bytes: payload.bytes,
  });
}

/**
 * Best-effort lookup of a tree node by id. Used when the user clicks a
 * row in a flat-table mirror and we want to mirror that selection in
 * the tree.
 */
export function findNodeById(
  tree: ModuleTreeNode,
  id: string,
): ModuleTreeNode | null {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const f = findNodeById(c, id);
    if (f) return f;
  }
  return null;
}

/**
 * Returns just the leaf source-file nodes anywhere in the tree. Used by
 * the file-detail viewer's "next / prev" navigation.
 */
export function collectSourceFiles(tree: ModuleTreeNode): ModuleTreeNode[] {
  const out: ModuleTreeNode[] = [];
  const walk = (n: ModuleTreeNode) => {
    if (n.type === 'source-file') {
      out.push(n);
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(tree);
  return out;
}
