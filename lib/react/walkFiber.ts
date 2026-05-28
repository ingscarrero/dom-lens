import type { ComponentNode, FiberKind } from './fiberToTree';

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

function createShim(): DevtoolsHook {
  let nextRendererId = 0;
  const listeners: Record<string, Set<(data: any) => void>> = {};
  const fiberRoots = new Map<number, Set<FiberRoot>>();

  const emit = (event: string, data: any) => {
    const set = listeners[event];
    if (!set) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch {
        /* swallow listener errors */
      }
    }
  };

  const sub = (event: string, fn: (data: any) => void) => {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event]!.add(fn);
    return () => {
      listeners[event]?.delete(fn);
    };
  };

  const shim: DevtoolsHook = {
    supportsFiber: true,
    supportsFlight: true,
    renderers: new Map(),
    rendererInterfaces: new Map(),
    helpers: new Map(),
    listeners,
    emit,
    sub,
    on: (event, fn) => {
      sub(event, fn);
    },
    off: (event, fn) => {
      listeners[event]?.delete(fn);
    },
    once: (event, fn) => {
      const unsub = sub(event, (data) => {
        unsub();
        fn(data);
      });
    },
    getFiberRoots(id: number) {
      if (!fiberRoots.has(id)) fiberRoots.set(id, new Set());
      return fiberRoots.get(id)!;
    },
    inject(renderer) {
      const id = ++nextRendererId;
      shim.renderers.set(id, renderer);
      try {
        emit('renderer', { id, renderer });
      } catch {
        /* ignore */
      }
      return id;
    },
    onCommitFiberRoot(id, root) {
      if (!fiberRoots.has(id)) fiberRoots.set(id, new Set());
      fiberRoots.get(id)!.add(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    __domLensRoots: fiberRoots,
    __domLensShim: true,
  };
  return shim;
}

export function installDevtoolsHookShim(): void {
  const w = window as any;
  const existing: DevtoolsHook | undefined = w[HOOK_KEY];
  if (!existing) {
    const shim = createShim();
    try {
      Object.defineProperty(w, HOOK_KEY, {
        value: shim,
        configurable: true,
        writable: true, // allow React DevTools to replace if it loads later (rare)
      });
    } catch {
      w[HOOK_KEY] = shim;
    }
    return;
  }
  if (existing.__domLensRoots) return; // already patched
  // Non-destructively augment an existing hook (React DevTools is installed).
  const roots = new Map<number, Set<FiberRoot>>();
  existing.__domLensRoots = roots;
  const origCommit = existing.onCommitFiberRoot?.bind(existing);
  existing.onCommitFiberRoot = function (id: number, root: FiberRoot, ...rest: any[]) {
    try {
      if (!roots.has(id)) roots.set(id, new Set());
      roots.get(id)!.add(root);
    } catch {
      /* ignore */
    }
    if (origCommit) return origCommit(id, root, ...rest);
  };
}

function getFiberRoots(): FiberRoot[] {
  const hook = (window as any)[HOOK_KEY] as DevtoolsHook | undefined;
  if (!hook) return [];
  const out: FiberRoot[] = [];

  if (hook.__domLensRoots) {
    for (const set of hook.__domLensRoots.values()) {
      for (const r of set) out.push(r);
    }
  }

  const anyHook = hook as any;
  if (typeof anyHook.getFiberRoots === 'function') {
    for (const [id] of hook.renderers) {
      try {
        const set: Set<FiberRoot> = anyHook.getFiberRoots(id);
        if (set) for (const r of set) out.push(r);
      } catch {
        /* ignore */
      }
    }
  }

  if (out.length === 0) {
    const containers = document.querySelectorAll('[id]');
    containers.forEach((el) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactContainer$'));
      if (key) {
        const root = (el as any)[key];
        if (root) out.push(root as FiberRoot);
      }
    });
  }

  return Array.from(new Set(out));
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

function buildNode(fiber: Fiber, counter: { n: number }, idCounter: { n: number }): ComponentNode {
  counter.n += 1;
  const node: ComponentNode = {
    id: String(idCounter.n++),
    name: fiberName(fiber),
    kind: fiberKind(fiber),
    key: fiber.key ?? undefined,
    childrenCount: 0,
    children: [],
  };

  let child = fiber.child;
  while (child && counter.n < MAX_NODES) {
    const skipHost = child.tag === 5 || child.tag === 6;
    if (skipHost) {
      let grand = child.child;
      while (grand && counter.n < MAX_NODES) {
        node.children.push(buildNode(grand, counter, idCounter));
        grand = grand.sibling;
      }
    } else {
      node.children.push(buildNode(child, counter, idCounter));
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
  for (const root of roots) {
    if (!root.current) continue;
    trees.push(buildNode(root.current, counter, idCounter));
  }
  return {
    rootCount: roots.length,
    tree: trees,
    truncated: counter.n >= MAX_NODES,
  };
}
