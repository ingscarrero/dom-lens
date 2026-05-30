export type FingerprintCategory =
  | 'framework'
  | 'bundler'
  | 'stateLib'
  | 'router'
  | 'utility'
  | 'ui'
  | 'analytics';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface FingerprintMatch {
  id: string;
  name: string;
  category: FingerprintCategory;
  version?: string;
  confidence: ConfidenceLevel;
  evidence: string[];
}

export interface TechStack {
  matches: FingerprintMatch[];
  /** Concise grouping used in summaries */
  byCategory: Partial<Record<FingerprintCategory, FingerprintMatch[]>>;
}

export type ChunkKind =
  | 'main'
  | 'vendor'
  | 'runtime'
  | 'chunk'
  | 'remoteEntry'
  | 'manifest'
  | 'css'
  | 'sourcemap'
  | 'image'
  | 'font'
  | 'wasm'
  | 'other';

export interface ModuleClassification {
  chunkKind: ChunkKind;
  framework?: string;
  library?: string;
  bundler?: string;
  /** Best-guess logical name (e.g. "vendors~main", "remote_app.bundle") */
  label?: string;
}

export interface LoadedModule {
  /** URL is the natural ID */
  id: string;
  url: string;
  origin: string;
  pathname: string;
  resourceType?: string;
  mimeType?: string;
  transferredBytes?: number;
  responseBytes?: number;
  timeMs?: number;
  startedDateTime?: string;
  classification: ModuleClassification;
  sourceMapUrl?: string;
  /**
   * Layered availability signal:
   *   - 'declared'  — page sent a `SourceMap`/`X-SourceMap` response header
   *                   pointing to the .map. Strongest signal short of fetching.
   *   - 'found'     — HEAD probe on the conventional `<url>.map` sibling
   *                   returned 2xx.
   *   - 'missing'   — HEAD probe returned 404 (or another 4xx/5xx).
   *   - 'fetched'   — we've actually downloaded + parsed the .map.
   *   - 'error'     — fetch+parse attempted and failed.
   *   - 'probing'   — probe in flight.
   *   - 'unknown'   — never probed.
   *   - 'absent' / 'present' — legacy aliases kept for backward-compat.
   */
  sourceMapStatus:
    | 'unknown'
    | 'declared'
    | 'found'
    | 'missing'
    | 'probing'
    | 'present'
    | 'absent'
    | 'fetched'
    | 'error';
  /** Populated lazily after fetch+parse */
  sourceMap?: ParsedSourceMap;
  sourceMapError?: string;
}

export interface SourceFileNode {
  name: string;
  fullPath: string;
  bytes: number;
  children?: SourceFileNode[];
}

export interface ParsedSourceMap {
  /** Raw `sources` array as written in the .map */
  sources: string[];
  /** Per-source byte counts derived from VLQ mappings */
  sizes: number[];
  /** Total bytes accounted for */
  totalBytes: number;
  /** Hierarchical view, grouped by path segments */
  tree: SourceFileNode;
  /** Optional original source code per `sources` entry. Aligned with
   * `sources` by index. Missing entries are stored as null. Webpack,
   * Vite, Rollup, esbuild all emit this by default in dev mode — only
   * `nosources-source-map` builds intentionally strip it. */
  sourcesContent: Array<string | null>;
}
