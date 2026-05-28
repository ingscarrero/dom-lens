import type { ComponentNode } from '../react/fiberToTree';
import type { FederationGraph } from '../federation/graph';

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  stack?: string;
}

export interface HarEntry {
  url: string;
  method: string;
  status: number;
  resourceType?: string;
  startedDateTime?: string;
  timeMs?: number;
  responseSize?: number;
  mimeType?: string;
}

export interface WebVitals {
  LCP?: number;
  CLS?: number;
  INP?: number;
  FCP?: number;
  TTFB?: number;
}

export interface PageMetrics {
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /** Layout flow inferred from scroll dimensions. */
  orientation: 'vertical' | 'horizontal';
}

export interface PartialSnapshot {
  url: string;
  title: string;
  dom: { html: string; markdown: string; charCount: number };
  react?: { rootCount: number; tree: ComponentNode[] };
  federation?: FederationGraph;
  console: ConsoleEntry[];
  webVitals?: WebVitals;
  viewport: { width: number; height: number; devicePixelRatio: number };
  pageMetrics: PageMetrics;
}

export type ScreenshotKind = 'viewport' | 'fullpage';

export interface SnapshotScreenshot {
  /** A stitched (or single-viewport) PNG dataURL */
  dataUrl: string;
  /** Logical (CSS) px dimensions */
  width: number;
  height: number;
  /** Image pixel dimensions (logical × DPR) */
  pixelWidth: number;
  pixelHeight: number;
  /** Origin in document coords (0,0 for full-page; scroll position for viewport) */
  originX: number;
  originY: number;
  /** Number of viewport tiles used to compose */
  tileCount: number;
  kind: ScreenshotKind;
  orientation: 'vertical' | 'horizontal';
}

export interface Snapshot extends PartialSnapshot {
  id: string;
  capturedAt: number;
  screenshot: SnapshotScreenshot | null;
  network: HarEntry[];
}
