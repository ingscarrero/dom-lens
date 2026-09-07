# ADR-0005: Keep the component tree mounted with `display:none`

- **Status:** Accepted
- **Date:** 2026-06-09 (v0.3.20)

## Context

The Components tab hosts a `react-arborist` tree in a "Tree" sub-tab and
one sub-tab per UX-vision analysis. Switching to an analysis and back
left the tree rendered at a fraction of the pane. `react-arborist`
measures its container with a `ResizeObserver`; unmounting the tree on
tab switch destroyed the observer, and on remount the first measurement
happened while the container had zero size, which the virtualiser then
kept.

## Decision

Render the tree once and toggle visibility with CSS (`display:none`)
when another sub-tab is active. The observer, scroll position and
selection survive tab switches.

## Alternatives considered

- **Force a re-measure after remount** (`key` bump, `requestAnimationFrame`
  + manual `resize` event). Worked intermittently; depended on layout
  timing inside DevTools' docked/undocked modes.
- **Pass explicit `width`/`height` props** measured by our own observer.
  Duplicates what the library already does and still needed a
  post-mount tick.
- **Replace `react-arborist`.** Disproportionate for a measurement bug.

## Consequences

- Tree state persists across analysis tabs at the cost of keeping its
  DOM alive (a few hundred rows virtualised — negligible).
- The same pattern is used for analysis result panes so streaming output
  is not lost on tab switch.
- Hidden panes must not run effects that assume visibility (for example
  `scrollIntoView`); those are gated on the active sub-tab.
