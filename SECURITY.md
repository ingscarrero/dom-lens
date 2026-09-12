# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*) or email the maintainer at the
address on the [GitHub profile](https://github.com/ingscarrero). Include
the DOM Lens version, Chrome version, a reproduction, and the impact you
believe it has.

You can expect an acknowledgement within 7 days and a fix or a
mitigation plan within 30 days for confirmed issues. Credit is given in
the CHANGELOG unless you prefer otherwise.

## Supported versions

Only the latest release on `main` receives fixes.

## Threat model in one paragraph

DOM Lens runs in three privileged contexts (DevTools panel, background
service worker, MAIN-world content script) with `host_permissions:
<all_urls>`, and it reads arbitrary web pages plus model output. The
assets we protect are: the user's optional AI-server API key, the
integrity of the extension's own contexts (no page or model output may
run with extension privileges), and the user's cookies on inspected
sites (never sent by the extension). What we deliberately *do not* hold:
GitHub tokens, cloud accounts, telemetry
([ADR-0004](docs/adr/0004-no-github-token-storage.md)).

## What is in scope

- Model output escaping its sandbox: HTML artifacts render in an iframe
  with `sandbox="allow-scripts"` only (null origin, no `chrome.*`);
  Mermaid renders as SVG with mermaid's `securityLevel` defaults.
- Page-controlled data reaching a privileged context unescaped
  (DOM markdown, console messages, `window` globals, sourcemap contents,
  federation container names).
- Network requests that carry credentials to the inspected site
  (all proxied requests use `credentials: 'omit'`).
- CSP bypasses (`eval` / `new Function` / inline script) in the panel.
- Leakage of the stored API key anywhere other than the `Authorization`
  header sent to the user-configured `baseUrl`.

## Out of scope

- The security of the local AI server itself (LM Studio, Ollama, …) or
  of a remote endpoint the user chooses to configure.
- Content of the pages you inspect. DOM Lens sends page content to the
  configured model endpoint when you trigger an analysis; review
  [REQUIREMENTS.md §2.3](docs/REQUIREMENTS.md#23-privacy-and-data-flow)
  before pointing it at a remote service.
- Deep-link targets (Cursor, Claude, GitHub) opened by Propose PR.

## Hardening notes for reviewers

- `wxt.config.ts` declares the manifest; permissions are `storage`,
  `scripting`, `tabs` plus `<all_urls>` host access, which the CORS-free
  LLM proxy and `.map` probing require
  ([ADR-0001](docs/adr/0001-main-world-eval-over-content-script-bridge.md)).
- The service-worker fetch proxy only reaches public `http(s)` hosts
  (plus the configured AI endpoint and the inspected page's own host) and
  never follows redirects; the hostname check is syntactic, so DNS
  rebinding is an accepted residual risk documented in
  [REQUIREMENTS.md NFR-S.8](docs/REQUIREMENTS.md#22-security-and-csp-posture).
- The MAIN-world script never patches React DevTools' hook
  ([ADR-0006](docs/adr/0006-read-only-react-root-discovery.md)) and wraps
  every cross-window read in try/catch.
- Dependency build scripts are opt-in (`pnpm-workspace.yaml`
  `allowBuilds`); only `esbuild` is allowed to run one.
- CI installs with `--frozen-lockfile`.
