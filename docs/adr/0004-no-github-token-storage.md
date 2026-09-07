# ADR-0004: Never store a GitHub token; unauthenticated raw reads only

- **Status:** Accepted
- **Date:** 2026-05-28 (v0.3.14 / v0.3.16)

## Context

GitHub source mappings let the Modules tab fetch the canonical source for
a sourcemapped file (`raw.githubusercontent.com/owner/repo/branch/path`)
when `sourcesContent` was stripped, and Propose PR exports a change plan.
Both would be more capable with a Personal Access Token: private repos,
higher rate limits, opening a PR directly.

## Decision

Do not add a token field. GitHub reads are unauthenticated `GET`s of
public raw URLs, proxied through the service worker with
`credentials: 'omit'`. Propose PR hands an inert Markdown plan to an
external tool (Cursor, Claude Desktop, Claude.ai, or GitHub's new-issue
form) through a deep link; the tool — not the extension — holds any
credential needed to act on it.

## Alternatives considered

- **PAT in `chrome.storage.local`.** Readable by any code executing in
  the extension's contexts; a supply-chain compromise of one of ~15
  runtime dependencies would exfiltrate it. The extension already asks
  for `<all_urls>`; adding a long-lived GitHub credential to that blast
  radius was judged disproportionate to the benefit.
- **OAuth device flow with a short-lived token.** Better, but still a
  stored bearer token, plus a registered OAuth app to maintain.
- **Prompt for the token per session, keep in memory only.** Reduces
  persistence risk but not the runtime exposure; deferred until a
  feature actually needs authenticated access.

## Consequences

- Private repositories are not viewable in 🐙 GitHub mode; the 📦
  Sourcemap mode and the skeleton extractor still work.
- Rate limits are GitHub's anonymous limits, which are adequate for
  one-file-at-a-time viewing.
- The extension's stored secrets remain exactly one: the optional AI
  server API key, which points at a server the user controls.
