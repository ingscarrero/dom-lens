# Runbook: Local Development Setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | `node --version` |
| pnpm | any | `npm i -g pnpm` |
| Chrome | 115+ | MV3 support |
| Git | any | |

---

## 1. Clone and install

```bash
git clone https://github.com/ingscarrero/dom-lens.git
cd dom-lens
pnpm install
```

`postinstall` runs `wxt prepare` automatically — this generates the WXT type stubs and `.wxt/` directory.

---

## 2. Type-check only

```bash
pnpm compile
```

Runs `tsc --noEmit` over `entrypoints/`, `lib/` and `tests/`. Fix all TS errors before pushing; CI runs this gate.

### Unit tests

```bash
pnpm test             # vitest run
pnpm test:watch       # watch mode
pnpm test:coverage    # with coverage — floors enforced in vitest.config.ts
```

Suites live in `tests/` and cover the pure `lib/` modules; see [CONTRIBUTING.md](../../CONTRIBUTING.md#tests).

---

## 3. Development build (hot reload)

```bash
pnpm dev
```

WXT starts Vite in watch mode and launches a dedicated Chrome profile with the extension pre-loaded. Any file change in `entrypoints/` or `lib/` triggers a hot reload of the panel.

**Note:** changes to `background.ts` or `injected.content.ts` require a manual extension reload in `chrome://extensions` because those scripts are not hot-swappable.

---

## 4. Production build

```bash
pnpm build
```

Output: `.output/chrome-mv3/`. Load this directory in `chrome://extensions` → Load unpacked.

---

## 5. Package for distribution

```bash
pnpm zip
```

Produces a `.zip` of `.output/chrome-mv3/` ready for Chrome Web Store upload.

---

## 6. Load the built extension manually

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `dom-lens/.output/chrome-mv3/`
5. Open any webpage → open DevTools (`Cmd+Opt+I`) → click **DOM Lens** tab

---

## 7. Running the MF demo

See the [MF demo runbook](mf-demo.md). The demo provides a local Module Federation host+remote pair that exercises all the Modules tab features (sourcemaps, GitHub links, module tree).

---

## Project layout

```
dom-lens/
├── entrypoints/
│   ├── background.ts          # Service worker (SW)
│   ├── content.ts             # ISOLATED-world placeholder
│   ├── injected.content.ts    # MAIN-world injected script
│   ├── devtools/
│   │   ├── index.html         # DevTools registration page
│   │   └── main.ts
│   └── panel/
│       ├── index.html
│       ├── main.tsx           # React root
│       ├── App.tsx            # Port connection + tab shell
│       ├── store.ts           # Zustand state
│       ├── captureFlow.ts     # Capture orchestration
│       ├── enhanceFlow.ts     # AI-enhanced stitch
│       ├── hooks/
│       │   ├── usePort.ts
│       │   ├── useInspectedEval.ts
│       │   └── useNetwork.ts
│       └── tabs/
│           ├── SnapshotTab.tsx
│           ├── ComponentsTab.tsx
│           ├── FederationTab.tsx
│           ├── ModulesTab.tsx
│           ├── InsightsTab.tsx
│           ├── AnalyzeTab.tsx
│           ├── SettingsTab.tsx
│           └── modules/
│               ├── ModulesTree.tsx
│               ├── FileDetail.tsx
│               └── ModuleAnalysis.tsx
├── lib/                       # Shared modules (see module reference)
├── examples/
│   └── mf-demo/               # Module Federation demo app
│       ├── host/              # webpack5 host (port 3001)
│       └── remote/            # webpack5 remote (port 3002)
├── tests/                     # Vitest suites mirroring lib/
├── docs/
│   ├── architecture.md
│   ├── SYSTEM_DESIGN.md
│   ├── REQUIREMENTS.md
│   ├── modules-reference.md
│   ├── CODE_MAPPING.md
│   ├── adr/
│   └── runbooks/
├── .github/workflows/ci.yml
├── vitest.config.ts
├── wxt.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Common development tasks

### Add a new analysis preset (Modules tab)

1. Add a new prompt builder function to `lib/modules/analyzeFile.ts` or `lib/modules/analyzeModule.ts`.
2. Add the action button to `entrypoints/panel/tabs/modules/FileDetail.tsx` or `ModuleAnalysis.tsx`.
3. Add a new tab kind to the `AnalysisKind` union in the relevant file.

### Add a new UX vision preset (Components tab)

1. Add an entry to `UX_PRESETS` in `lib/components/uxVisionPrompts.ts`.
2. The preset picker in `ComponentsTab.tsx` is driven by this array; no UI changes needed.

### Add a new port message type

1. Add the type to `PanelToBg` or `BgToPanel` in `lib/bridge/protocol.ts`.
2. Add a handler in `entrypoints/background.ts`.
3. Add a resolver in `App.tsx`'s port message handler.

### Modify the manifest

Edit `wxt.config.ts` → `manifest` block. WXT merges this into the generated `manifest.json`.

---

## Debugging tips

### Panel not appearing in DevTools

- Open `chrome://extensions` → find DOM Lens → check for errors.
- Click **service worker** link to inspect the background SW console.
- Make sure the extension is enabled.

### Changes not reflecting

- `pnpm dev` hot-reloads the panel but not the background SW or injected script. After editing those, go to `chrome://extensions` → click the reload ↺ icon on DOM Lens, then hard-refresh the inspected page.

### Inspecting the panel

Right-click inside the DOM Lens panel → **Inspect** opens a separate DevTools window for the panel's own context. Very useful for debugging React state and network calls.

### Inspecting the background SW

`chrome://extensions` → DOM Lens → click **service worker** → opens DevTools for the SW. Check the Console for fetch errors, port connection issues, etc.

### `window.__dom_lens__ is undefined`

The MAIN-world injected script didn't run before capture. Reload the inspected page (not just the extension) and try again. The script runs at `document_start` and cannot retroactively inject into an already-loaded page.
