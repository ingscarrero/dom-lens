# Architecture Decision Records

Short, dated records of the decisions that shaped DOM Lens. Each ADR
states the context, the decision, the alternatives and the consequences.
They are immutable once accepted; a change of mind gets a new ADR that
supersedes the old one.

| ID | Title | Status | Date |
|---|---|---|---|
| [0001](0001-main-world-eval-over-content-script-bridge.md) | Reach page globals via `inspectedWindow.eval` in the MAIN world | Accepted | 2026-05-28 |
| [0002](0002-console-patching-over-chrome-debugger.md) | Capture console output by patching `console.*`, not `chrome.debugger` | Accepted | 2026-05-28 |
| [0003](0003-sourcemap-codec-over-source-map-js.md) | Decode sourcemaps with `@jridgewell/sourcemap-codec` | Accepted | 2026-05-24 |
| [0004](0004-no-github-token-storage.md) | Never store a GitHub token; unauthenticated raw reads only | Accepted | 2026-05-28 |
| [0005](0005-keep-tree-mounted-with-display-none.md) | Keep the component tree mounted with `display:none` | Accepted | 2026-06-09 |
| [0006](0006-read-only-react-root-discovery.md) | Discover React roots read-only; no DevTools hook shim | Accepted | 2026-05-28 |

Dates are the release dates of the versions that introduced each decision
(see [CHANGELOG.md](../../CHANGELOG.md)); decisions from the pre-changelog
0.1/0.2 releases carry the date of the initial import commit.

## Template

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context
## Decision
## Alternatives considered
## Consequences
```
