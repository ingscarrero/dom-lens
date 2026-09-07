# ADR-0006: Discover React roots read-only; no DevTools hook shim

- **Status:** Accepted
- **Date:** 2026-05-28 (v0.2.0)

## Context

To walk the fiber tree without React DevTools installed, v0.1 installed a
minimal `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` shim at `document_start`
so React would call `onCommitFiberRoot` and hand us its roots. Two
problems surfaced:

- When DOM Lens's script ran before the real React DevTools extension,
  RDT's `backendManager.registerRenderer` crashed on our incomplete hook
  object, breaking RDT for the user.
- When RDT was already present, patching its hook to also record roots
  raced its own commit path and occasionally dropped commits.

## Decision

Stop installing or patching the hook. `installDevtoolsHookShim()` is now
an intentional no-op kept for API stability. Roots are discovered by
scanning the DOM for the `__reactContainer$<hash>` property React writes
on container elements (React 18+) and the legacy
`_reactRootContainer._internalRoot` (React 16/17). If an RDT hook happens
to exist, its `getFiberRoots()` output is merged in, read-only.

## Alternatives considered

- **A complete, spec-faithful hook shim.** Fragile: RDT's expectations of
  the hook change across versions, and two extensions cannot both own
  the global.
- **`bippy`'s `instrument()`**, which also installs a hook. Same conflict.
- **Require React DevTools.** Contradicts the goal of working on any
  page without setup.

## Consequences

- Zero interference with React DevTools in either load order.
- Root discovery is a linear scan over `document.querySelectorAll('*')`
  at capture time — a few milliseconds on typical pages, bounded by the
  5 000-node walk cap downstream.
- Roots rendered into detached containers or portals not attached to the
  document are only found when an RDT hook reports them.
