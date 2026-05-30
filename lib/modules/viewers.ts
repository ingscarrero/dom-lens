import type { ChunkKind } from './types';
import type { ReformatLanguage } from './reformat';

/**
 * Per-kind viewer capabilities. The Modules tab uses this registry to
 * pick the right detail component for a row and to decide which buttons
 * to show (sourcemap fetch, reformat with AI, image preview, etc.).
 */
export interface ViewerSpec {
  /** Display label shown in the row + detail header. */
  label: string;
  /** Symbolic family — drives the detail component choice. */
  family: 'js' | 'style' | 'data' | 'image' | 'font' | 'wasm' | 'sourcemap' | 'other';
  /** Language passed to the LLM reformat path, when supported. */
  reformatLanguage?: ReformatLanguage;
  /** True if a .map sibling is worth probing for this kind. */
  supportsSourcemap: boolean;
  /** True if the detail panel can render a direct preview (image, font). */
  supportsPreview: boolean;
  /** True if "Find usages on the page" makes sense for this kind. */
  supportsDomUsageScan: boolean;
}

const VIEWERS: Record<ChunkKind, ViewerSpec> = {
  main: {
    label: 'JS · main',
    family: 'js',
    reformatLanguage: 'javascript',
    supportsSourcemap: true,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  vendor: {
    label: 'JS · vendor',
    family: 'js',
    reformatLanguage: 'javascript',
    supportsSourcemap: true,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  runtime: {
    label: 'JS · runtime',
    family: 'js',
    reformatLanguage: 'javascript',
    supportsSourcemap: true,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  chunk: {
    label: 'JS · chunk',
    family: 'js',
    reformatLanguage: 'javascript',
    supportsSourcemap: true,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  remoteEntry: {
    label: 'JS · MF remote entry',
    family: 'js',
    reformatLanguage: 'javascript',
    supportsSourcemap: true,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  manifest: {
    label: 'Manifest (JSON)',
    family: 'data',
    reformatLanguage: 'json',
    supportsSourcemap: false,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  css: {
    label: 'Stylesheet',
    family: 'style',
    reformatLanguage: 'css',
    supportsSourcemap: true,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  sourcemap: {
    label: 'Sourcemap',
    family: 'sourcemap',
    supportsSourcemap: false,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  image: {
    label: 'Image',
    family: 'image',
    supportsSourcemap: false,
    supportsPreview: true,
    supportsDomUsageScan: true,
  },
  font: {
    label: 'Font',
    family: 'font',
    supportsSourcemap: false,
    supportsPreview: true,
    supportsDomUsageScan: true,
  },
  wasm: {
    label: 'WebAssembly',
    family: 'wasm',
    reformatLanguage: 'wasm-wat',
    supportsSourcemap: false,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
  other: {
    label: 'Other',
    family: 'other',
    supportsSourcemap: false,
    supportsPreview: false,
    supportsDomUsageScan: false,
  },
};

export function viewerFor(kind: ChunkKind): ViewerSpec {
  return VIEWERS[kind] ?? VIEWERS.other;
}
