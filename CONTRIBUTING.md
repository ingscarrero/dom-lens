# Contributing to DOM Lens

Thanks for taking a look. DOM Lens is a small, opinionated codebase; the
fastest way to get a change in is to keep it focused and green.

## Setup

```bash
pnpm install          # pnpm 11 (pinned in package.json#packageManager)
pnpm dev              # WXT dev build + Chrome profile with hot reload
```

`pnpm dev` hot-reloads the panel. Changes to `entrypoints/background.ts`
or `entrypoints/injected.content.ts` need a manual reload in
`chrome://extensions` and a page refresh — see
[docs/runbooks/dev-setup.md](docs/runbooks/dev-setup.md).

To exercise the Modules and Federation tabs end to end, run the demo app
in [`examples/mf-demo`](docs/runbooks/mf-demo.md).

## The gate

CI runs exactly these, in this order. Run them locally before pushing:

```bash
pnpm compile          # tsc --noEmit (entrypoints, lib, tests)
pnpm test:coverage    # vitest run --coverage — thresholds in vitest.config.ts
pnpm build            # wxt build → .output/chrome-mv3
```

`pnpm test:watch` runs vitest in watch mode.

## Where things live

| Path | What |
|---|---|
| `entrypoints/panel/` | React panel: tabs, store, capture orchestration |
| `entrypoints/background.ts` | Service worker: port router, LLM/network proxy |
| `entrypoints/injected.content.ts` | MAIN-world API (`window.__dom_lens__`) |
| `lib/` | Framework-agnostic logic — see [docs/modules-reference.md](docs/modules-reference.md) |
| `tests/` | Vitest suites mirroring `lib/` |
| `docs/` | Architecture, requirements, system design, ADRs, runbooks |

## Writing code

- **Keep logic out of React.** Anything that can be a pure function in
  `lib/` should be, with a test next to it in `tests/`. The panel and the
  service worker are thin adapters over `lib/`.
- **Respect the CSP.** No `eval`, `new Function`, or libraries that use
  them (see [ADR-0003](docs/adr/0003-sourcemap-codec-over-source-map-js.md)).
- **Budget everything that crosses a boundary.** Messages between panel,
  worker and page are copied; add or reuse a cap
  ([REQUIREMENTS.md §2.1](docs/REQUIREMENTS.md#21-performance-budgets)).
- **Never send cookies or store third-party credentials**
  ([ADR-0004](docs/adr/0004-no-github-token-storage.md)).
- **Adding a port message:** extend `PanelToBg` / `BgToPanel` in
  `lib/bridge/protocol.ts`, handle it in `background.ts`, route it in
  `App.tsx`. Every request carries a `requestId`.
- **Adding a preset or analysis:** see "Common development tasks" in the
  [dev-setup runbook](docs/runbooks/dev-setup.md#common-development-tasks).

## Tests

- Pure modules run under Node. DOM-dependent suites add
  `// @vitest-environment jsdom` at the top of the file.
- jsdom has no canvas or image decoder; stub `Image` with `vi.stubGlobal`
  and spy on `HTMLCanvasElement.prototype` methods with `vi.spyOn` (restored
  in `afterEach`) as `tests/snapshot/slicer.test.ts` does — never assign to
  prototypes directly, it leaks across suites.
- Coverage thresholds are floors, not targets. Raise them when you add
  coverage; do not lower them to pass.

## Docs

- A design decision with alternatives gets an ADR in `docs/adr/`
  (template in the README there).
- New user-visible behaviour gets a CHANGELOG entry under *Unreleased*
  (Keep a Changelog format) and, if it changes a number, an update to the
  budget table in `docs/REQUIREMENTS.md`.
- Diagrams are Mermaid, inline in Markdown, so they render on GitHub.

## Pull requests

- Branch from `main`; `main` is protected and only accepts PRs.
- One logical change per PR, conventional commit titles
  (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
- Fill in the PR template: what changed, why, how you tested it.
- CI must be green. Address review comments in follow-up commits rather
  than force-pushing over them.

## Reporting bugs

Open an issue with the page URL (or a minimal reproduction), the DOM Lens
version from the Settings tab, Chrome version, and the model/server if an
AI feature is involved. For security issues see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
