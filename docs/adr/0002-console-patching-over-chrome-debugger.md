# ADR-0002: Capture console output by patching `console.*`, not `chrome.debugger`

- **Status:** Accepted
- **Date:** 2026-05-28 (v0.2.0)

## Context

The Snapshot tab should show errors and warnings the page emitted —
including ones logged before the user opened DevTools. The complete
source of truth is the Chrome DevTools Protocol
(`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`), reachable from an
extension through `chrome.debugger.attach`.

## Decision

Wrap `console.error`, `console.warn`, `console.log` (and friends) in the
MAIN-world script at `document_start`, and register `window` `error` and
`unhandledrejection` listeners, buffering entries in a ring buffer
(cap 200, messages clipped to 4 000 chars) that `capture()` drains. Do
not use `chrome.debugger`.

## Alternatives considered

- **`chrome.debugger`.** Full fidelity, including uncaught exceptions and
  unhandled promise rejections. But attaching shows the yellow
  "Chrome is being debugged by an extension" info bar on the inspected
  tab, detaches other debugger clients, and requires the `debugger`
  permission, which is a hard sell on a public extension.
- **Only patching `console.*`** without the `error` /
  `unhandledrejection` listeners. Misses uncaught exceptions and
  rejections, which are the entries users care most about; the listeners
  are cheap, so both are installed.

## Consequences

- Zero visible footprint on the page; no extra permission.
- Output from cross-origin iframes and web workers is not seen (they
  have their own realms), and a page that captured a reference to the
  original `console` before `document_start` cannot exist, so coverage of
  the main realm is effectively complete. REQUIREMENTS.md states the
  iframe/worker gap explicitly.
- Patching must be idempotent and version-checked so a page with a stale
  injected script is detected rather than double-patched.
