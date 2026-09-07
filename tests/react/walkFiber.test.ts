// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installDevtoolsHookShim, walkAllFiberRoots } from '@/lib/react/walkFiber';
import type { ComponentNode } from '@/lib/react/fiberToTree';

/**
 * Minimal fiber-shaped fixtures. Tags follow React's ReactWorkTags:
 * 0 FunctionComponent, 1 ClassComponent, 3 HostRoot, 5 HostComponent,
 * 6 HostText, 7 Fragment, 11 ForwardRef, 13 Suspense, 14/15 Memo.
 */
interface FakeFiber {
  tag: number;
  type: any;
  elementType: any;
  key: string | null;
  child: FakeFiber | null;
  sibling: FakeFiber | null;
  return: FakeFiber | null;
  stateNode: any;
  memoizedProps: any;
  alternate: FakeFiber | null;
}

function fiber(tag: number, type: any, opts: { key?: string; stateNode?: any } = {}): FakeFiber {
  return {
    tag,
    type,
    elementType: type,
    key: opts.key ?? null,
    child: null,
    sibling: null,
    return: null,
    stateNode: opts.stateNode ?? null,
    memoizedProps: null,
    alternate: null,
  };
}

function children(parent: FakeFiber, ...kids: FakeFiber[]): FakeFiber {
  parent.child = kids[0] ?? null;
  for (let i = 0; i < kids.length; i++) {
    kids[i].return = parent;
    kids[i].sibling = kids[i + 1] ?? null;
  }
  return parent;
}

function mountRoot(rootFiber: FakeFiber): HTMLElement {
  const container = document.createElement('div');
  (container as any)['__reactContainer$abc123'] = { current: rootFiber };
  document.body.appendChild(container);
  return container;
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string, rect?: Partial<DOMRect>) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  if (rect) {
    node.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect;
  }
  return node;
}

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

const flatten = (nodes: ComponentNode[]): ComponentNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('walkAllFiberRoots', () => {
  it('returns null when no React root is mounted', () => {
    expect(walkAllFiberRoots()).toBeNull();
  });

  it('is safe to call the (intentionally no-op) hook shim', () => {
    expect(() => installDevtoolsHookShim()).not.toThrow();
  });

  it('classifies fiber kinds and names, skipping host nodes but keeping their children', () => {
    function App() {}
    class Panel {}
    const Memoed = { $$typeof: Symbol.for('react.memo'), type: { displayName: 'Card' } };
    const Fwd = { $$typeof: Symbol.for('react.forward_ref'), render: function Input() {} };
    const Weird = { $$typeof: Symbol.for('react.context') };

    const button = el('button', {}, 'Save', { left: 10, top: 20, width: 100, height: 30 });
    const root = children(
      fiber(3, null),
      children(
        fiber(0, App),
        children(
          fiber(5, 'div', { stateNode: el('div') }),
          fiber(1, Panel, { key: 'p1' }),
          fiber(14, Memoed),
          fiber(11, Fwd, { stateNode: null }),
          fiber(10, Weird),
          fiber(7, null),
          fiber(13, null),
          fiber(99, null),
          fiber(0, function Btn() {}, { stateNode: null }),
        ),
      ),
    );
    // give Btn a host child so bounds/hint resolve
    const btnFiber = flattenFibers(root).find((f) => f.type?.name === 'Btn')!;
    children(btnFiber, fiber(5, 'button', { stateNode: button }));

    mountRoot(root);
    const res = walkAllFiberRoots()!;
    expect(res.rootCount).toBe(1);
    expect(res.truncated).toBe(false);

    const all = flatten(res.tree);
    const byName = Object.fromEntries(all.map((n) => [n.name, n]));
    expect(res.tree[0].name).toBe('HostRoot');
    expect(res.tree[0].kind).toBe('root');
    expect(byName.App.kind).toBe('function');
    // host <div> was skipped; its children were hoisted under App
    expect(byName.App.children.map((c) => c.name)).toEqual([
      'Panel',
      'Card*',
      'Input*',
      'SpecialComponent',
      'Fragment',
      'Suspense',
      'Anonymous',
      'Btn',
    ]);
    expect(byName.Panel.kind).toBe('class');
    expect(byName.Panel.key).toBe('p1');
    expect(byName['Card*'].kind).toBe('memo');
    expect(byName['Input*'].kind).toBe('forwardRef');
    expect(byName.SpecialComponent.kind).toBe('provider');
    expect(byName.Anonymous.kind).toBe('unknown');
    expect(byName.Btn.bounds).toEqual({ x: 10, y: 20, w: 100, h: 30 });
    expect(byName.Btn.tag).toBe('button');
    expect(byName.Btn.hint).toBe('Save');
    expect(byName.App.childrenCount).toBe(8);
  });

  it('derives hints from aria-label, title, img alt/src, links and inputs', () => {
    const cases: [HTMLElement, string | undefined][] = [
      [el('div', { 'aria-label': 'Close dialog' }, 'x'), 'Close dialog'],
      [el('div', { title: 'Tooltip' }, 'x'), 'Tooltip'],
      [el('img', { alt: 'Logo' }), 'alt: Logo'],
      [el('img', { src: '/static/hero.png?x=1' }), 'hero.png'],
      [el('img'), undefined],
      [el('a', { href: '/docs' }, 'Docs'), 'Docs'],
      [el('a', { href: '/docs' }), '→ /docs'],
      [el('a'), undefined],
      [el('input', { placeholder: 'Search…' }), 'placeholder: Search…'],
      [el('input', { name: 'email', type: 'email' }), 'name: email (email)'],
      [el('input', { type: 'checkbox' }), 'type: checkbox'],
      [el('textarea'), undefined],
      [el('button', {}, '   Click   me  '), 'Click me'],
      [el('button'), undefined],
      [el('p', {}, 'a'.repeat(200)), 'a'.repeat(59) + '…'],
      [el('span'), undefined],
    ];
    const kids = cases.map(([node]) => {
      const comp = fiber(0, function Leaf() {});
      children(comp, fiber(5, node.tagName.toLowerCase(), { stateNode: node }));
      return comp;
    });
    mountRoot(children(fiber(3, null), ...kids));
    const leaves = walkAllFiberRoots()!.tree[0].children;
    expect(leaves.map((l) => l.hint)).toEqual(cases.map(([, hint]) => hint));
    expect(leaves[0].bounds).toBeUndefined(); // jsdom reports 0x0 rects
  });

  it('dedupes roots seen both via DOM scan and the DevTools hook, and reads legacy roots', () => {
    const shared = fiber(3, null);
    mountRoot(shared);
    const legacy = document.createElement('div');
    (legacy as any)._reactRootContainer = { _internalRoot: { current: fiber(3, null) } };
    document.body.appendChild(legacy);
    const hookOnly = { current: fiber(3, null) };
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, {}]]),
      getFiberRoots: () => new Set([{ current: shared }, hookOnly]),
    };
    // The DOM-scanned root object and the hook root wrap the same fiber but
    // are different objects, so both count; the legacy root adds a third.
    const res = walkAllFiberRoots()!;
    expect(res.rootCount).toBe(4);
    expect(res.tree).toHaveLength(4);
  });

  it('marks the walk truncated past MAX_NODES', () => {
    const root = fiber(3, null);
    const kids = Array.from({ length: 5100 }, () => fiber(0, function Row() {}));
    children(root, ...kids);
    mountRoot(root);
    const res = walkAllFiberRoots()!;
    expect(res.truncated).toBe(true);
    expect(res.tree[0].children.length).toBeLessThan(5100);
  });
});

function flattenFibers(f: FakeFiber | null): FakeFiber[] {
  if (!f) return [];
  return [f, ...flattenFibers(f.child), ...flattenFibers(f.sibling)];
}
