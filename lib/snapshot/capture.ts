import { serializeDom } from './serializeDom';
import { walkAllFiberRoots } from '../react/walkFiber';
import { detectFederation } from '../federation/detect';
import type { ConsoleEntry, PartialSnapshot } from './types';

export interface ConsoleBuffer {
  push(entry: ConsoleEntry): void;
  drain(): ConsoleEntry[];
  setCap(n: number): void;
}

export function createConsoleBuffer(cap = 200): ConsoleBuffer {
  let buffer: ConsoleEntry[] = [];
  return {
    push(entry) {
      buffer.push(entry);
      if (buffer.length > cap) buffer = buffer.slice(-cap);
    },
    drain() {
      const out = buffer;
      buffer = [];
      return out;
    },
    setCap(n) {
      cap = n;
    },
  };
}

export interface CaptureOptions {
  maxMarkdownChars: number;
}

export function runCapture(
  consoleBuffer: ConsoleBuffer,
  opts: CaptureOptions,
): PartialSnapshot {
  const dom = serializeDom(opts.maxMarkdownChars);
  const react = walkAllFiberRoots() || undefined;
  const fed = detectFederation();
  const federation = fed.detected ? fed : undefined;

  return {
    url: location.href,
    title: document.title,
    dom,
    react: react
      ? {
          rootCount: react.rootCount,
          tree: react.tree,
        }
      : undefined,
    federation,
    console: consoleBuffer.drain(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}
