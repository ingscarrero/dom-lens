import type { ComponentNode, FiberKind, NodeBounds } from './fiberToTree';

interface Fiber {
  tag: number;
  type: any;
  elementType: any;
  key: string | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  stateNode: any;
  memoizedProps: any;
  alternate: Fiber | null;
}

interface FiberRoot {
  current: Fiber;
}

interface DevtoolsHook {
  supportsFiber: boolean;
  supportsFlight?: boolean;
  renderers: Map<number, any>;
  rendererInterfaces?: Map<number, any>;
  helpers?: Map<number, any>;
  listeners?: Record<string, Set<(data: any) => void>>;
  emit?: (event: string, data: any) => void;
  sub?: (event: string, fn: (data: any) => void) => () => void;
  on?: (event: string, fn: (data: any) => void) => void;
  off?: (event: string, fn: (data: any) => void) => void;
  once?: (event: string, fn: (data: any) => void) => void;
  getFiberRoots?: (id: number) => Set<FiberRoot>;
  onCommitFiberRoot: (id: number, root: FiberRoot, ...rest: any[]) => void;
  onCommitFiberUnmount: (...args: any[]) => void;
  onPostCommitFiberRoot?: (...args: any[]) => void;
  inject: (renderer: any) => number;
  checkDCE?: (fn: any) => void;
  __domLensRoots?: Map<number, Set<FiberRoot>>;
  __domLensShim?: boolean;
}

const HOOK_KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

const FIBER_TAG: Record<number, FiberKind> = {
  0: 'function',
  1: 'class',
  3: 'root',
  5: 'host',
  6: 'text',
  7: 'fragment',
  10: 'provider',
  9: 'consumer',
  11: 'forwardRef',
  13: 'suspense',
  14: 'memo',
  15: 'memo',
  16: 'lazy',
  4: 'portal',
};

/**
 * v0.2.x: we no longer install or patch __REACT_DEVTOOLS_GLOBAL_HOOK__.
 *
 * Why: even a "complete" shim caused crashes inside the React DevTools
 * extension's backendManager.registerRenderer when DOM Lens's script ran
 * before RDT. Conversely, patching an existing hook (when RDT was already
 * present) was racy with their own commit-root path.
 *
 * What we do instead: discover fiber roots purely by reading the
 * `__reactContainer$<hash>` property React itself writes onto the root
 * container DOM element. We additionally read any roots tracked by RDT's
 * hook if it happens to be installed. Either path is non-mutating and
 * cannot conflict with RDT.
 */
export function installDevtoolsHookShim(): void {
  // Intentionally a no-op. See comment above.
}

function findRootsByDomScan(): FiberRoot[] {
  const out: FiberRoot[] = [];
  const seen = new Set<unknown>();
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as any;
    for (const k in el) {
      if (k.charCodeAt(0) === 95 && k.startsWith('__reactContainer$')) {
        const root = el[k];
        if (root && !seen.has(root)) {
          seen.add(root);
          out.push(root as FiberRoot);
        }
        break; // a node has at most one container key
      }
    }
    // Legacy React 16/17
    if (el._reactRootContainer && el._reactRootContainer._internalRoot) {
      const root = el._reactRootContainer._internalRoot;
      if (root && !seen.has(root)) {
        seen.add(root);
        out.push(root as FiberRoot);
      }
    }
  }
  return out;
}

function getFiberRoots(): FiberRoot[] {
  const out: FiberRoot[] = [];
  const seen = new Set<unknown>();

  // 1) Primary: scan the DOM for React's container properties. This works
  //    regardless of whether the React DevTools extension is installed.
  for (const r of findRootsByDomScan()) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }

  // 2) Secondary: if the React DevTools hook is present, pull any roots
  //    it knows about (in case DOM scan missed a portal-style root).
  const hook = (window as any)[HOOK_KEY] as any;
  if (hook && typeof hook.getFiberRoots === 'function' && hook.renderers?.size) {
    for (const [id] of hook.renderers) {
      try {
        const set = hook.getFiberRoots(id) as Set<FiberRoot> | undefined;
        if (set) {
          for (const r of set) {
            if (!seen.has(r)) {
              seen.add(r);
              out.push(r);
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

function fiberKind(fiber: Fiber): FiberKind {
  const tag = fiber.tag;
  if (tag in FIBER_TAG) return FIBER_TAG[tag];
  return 'unknown';
}

function fiberName(fiber: Fiber): string {
  const t = fiber.type;
  if (!t) {
    if (fiber.tag === 3) return 'HostRoot';
    if (fiber.tag === 7) return 'Fragment';
    if (fiber.tag === 13) return 'Suspense';
    return 'Anonymous';
  }
  if (typeof t === 'string') return t;
  if (typeof t === 'function') return t.displayName || t.name || 'Anonymous';
  if (t.$$typeof) {
    const inner = t.render || t.type;
    if (inner) return (inner.displayName || inner.name || '') + '*';
    return 'SpecialComponent';
  }
  return 'Component';
}

const MAX_NODES = 5000;

function findHostNode(fiber: Fiber | null): Node | null {
  if (!fiber) return null;
  if (fiber.tag === 5 || fiber.tag === 6) return fiber.stateNode as Node | null;
  if (fiber.stateNode && (fiber.stateNode as any).nodeType === 1) {
    return fiber.stateNode as Node;
  }
  // DFS into children
  let cur = fiber.child;
  while (cur) {
    const found = findHostNode(cur);
    if (found) return found;
    cur = cur.sibling;
  }
  return null;
}

function readBounds(fiber: Fiber, scrollX: number, scrollY: number): NodeBounds | undefined {
  const node = findHostNode(fiber);
  if (!node || (node as Element).nodeType !== 1) return undefined;
  try {
    const rect = (node as Element).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return undefined;
    return {
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  } catch {
    return undefined;
  }
}

function directText(el: Element): string {
  let out = '';
  for (let n: Node | null = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      out += (n as Text).data;
      if (out.length > 80) break;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function clip(s: string, n = 60): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function readMetadata(fiber: Fiber): { tag?: string; hint?: string } {
  const node = findHostNode(fiber);
  if (!node || (node as Element).nodeType !== 1) return {};
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // aria-label first — explicit author intent for accessibility
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return { tag, hint: clip(ariaLabel) };

  const title = el.getAttribute('title');
  if (title) return { tag, hint: clip(title) };

  if (tag === 'img') {
    const alt = (el as HTMLImageElement).alt;
    if (alt) return { tag, hint: 'alt: ' + clip(alt, 50) };
    const src = (el as HTMLImageElement).getAttribute('src');
    if (src) {
      const fname = src.split('/').pop()?.split('?')[0] ?? src;
      return { tag, hint: clip(fname, 50) };
    }
    return { tag };
  }

  if (tag === 'a') {
    const href = (el as HTMLAnchorElement).getAttribute('href');
    const text = directText(el);
    if (text) return { tag, hint: clip(text) };
    if (href) return { tag, hint: '→ ' + clip(href, 50) };
    return { tag };
  }

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const ph = el.getAttribute('placeholder');
    const name = el.getAttribute('name');
    const type = el.getAttribute('type');
    if (ph) return { tag, hint: 'placeholder: ' + clip(ph, 40) };
    if (name) return { tag, hint: `name: ${name}${type ? ' (' + type + ')' : ''}` };
    if (type) return { tag, hint: 'type: ' + type };
    return { tag };
  }

  if (tag === 'button') {
    const text = directText(el);
    if (text) return { tag, hint: clip(text) };
  }

  // Generic: direct text content (first text-node child only — no recursion)
  const text = directText(el);
  if (text) return { tag, hint: clip(text) };

  return { tag };
}

function buildNode(
  fiber: Fiber,
  counter: { n: number },
  idCounter: { n: number },
  scrollX: number,
  scrollY: number,
): ComponentNode {
  counter.n += 1;
  const meta = readMetadata(fiber);
  const node: ComponentNode = {
    id: String(idCounter.n++),
    name: fiberName(fiber),
    kind: fiberKind(fiber),
    key: fiber.key ?? undefined,
    childrenCount: 0,
    children: [],
    bounds: readBounds(fiber, scrollX, scrollY),
    tag: meta.tag,
    hint: meta.hint,
  };

  let child = fiber.child;
  while (child && counter.n < MAX_NODES) {
    const skipHost = child.tag === 5 || child.tag === 6;
    if (skipHost) {
      let grand = child.child;
      while (grand && counter.n < MAX_NODES) {
        node.children.push(buildNode(grand, counter, idCounter, scrollX, scrollY));
        grand = grand.sibling;
      }
    } else {
      node.children.push(buildNode(child, counter, idCounter, scrollX, scrollY));
    }
    child = child.sibling;
  }
  node.childrenCount = node.children.length;
  return node;
}

export interface ReactTreeResult {
  rootCount: number;
  tree: ComponentNode[];
  truncated: boolean;
}

export function walkAllFiberRoots(): ReactTreeResult | null {
  const roots = getFiberRoots();
  if (roots.length === 0) return null;
  const idCounter = { n: 0 };
  const counter = { n: 0 };
  const trees: ComponentNode[] = [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  for (const root of roots) {
    if (!root.current) continue;
    trees.push(buildNode(root.current, counter, idCounter, scrollX, scrollY));
  }
  return {
    rootCount: roots.length,
    tree: trees,
    truncated: counter.n >= MAX_NODES,
  };
}
