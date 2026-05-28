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

export interface PartialSnapshot {
  url: string;
  title: string;
  dom: { html: string; markdown: string; charCount: number };
  react?: { rootCount: number; tree: ComponentNode[] };
  federation?: FederationGraph;
  console: ConsoleEntry[];
  webVitals?: WebVitals;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

export interface Snapshot extends PartialSnapshot {
  id: string;
  capturedAt: number;
  screenshot: { dataUrl: string; width: number; height: number } | null;
  network: HarEntry[];
}
