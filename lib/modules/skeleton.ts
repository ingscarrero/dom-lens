/**
 * Quick-and-dirty structural extractor for JS / CSS source files.
 *
 * Why regex and not a real AST? We're operating inside a DevTools panel —
 * shipping acorn / @babel/parser (~200KB minified each) is a lot of weight
 * for a "give me a navigable outline of this 1MB minified file" feature
 * that doesn't need perfect parsing. Regex misses some edge cases (think
 * of arrow functions used as IIFEs, weird minifier output) but reliably
 * surfaces 80% of the top-level structure, which is what matters for a
 * skim-and-navigate workflow.
 *
 * Design pattern: hierarchical-summarization-via-AST-segments, like the
 * approach in the ICCSA 2025 "Repository-Level Code Understanding"
 * paper and how webpack-bundle-analyzer uses acorn to map minified
 * bundle contents back to source files. We provide the navigation layer
 * (this file). The LLM provides per-symbol semantics (lazy, on click,
 * via lib/lm-studio/streamingProxy).
 */

export type SkeletonKind =
  | 'webpack-module'
  | 'export'
  | 'import'
  | 'require'
  | 'class'
  | 'function'
  | 'arrow'
  | 'css-rule'
  | 'css-media'
  | 'css-keyframes';

export interface SkeletonSymbol {
  /** Symbolic kind for grouping/colour. */
  kind: SkeletonKind;
  /** Display name. Best-effort — for minified code, often a digit ID. */
  name: string;
  /** Byte offset of the start of the symbol in source. */
  start: number;
  /** Byte offset of the end. Best-effort — may be approximate for nested
   * bodies. */
  end: number;
  /** First ~80 chars of the body, useful as a preview. */
  preview: string;
  /** Optional extra metadata (callsite count, module deps, etc.). */
  meta?: Record<string, string | number>;
}

export interface JsSkeleton {
  language: 'javascript';
  symbols: SkeletonSymbol[];
  isWebpackBundle: boolean;
  isVite: boolean;
  /** Total module IDs detected for webpack bundles. */
  moduleCount?: number;
}

export interface CssSkeleton {
  language: 'css';
  symbols: SkeletonSymbol[];
  atRules: Array<{ rule: string; offset: number }>;
}

export type Skeleton = JsSkeleton | CssSkeleton;

/* ---------- JavaScript ---------- */

export function extractJsSkeleton(source: string): JsSkeleton {
  const symbols: SkeletonSymbol[] = [];
  const isWebpackBundle = detectWebpackBundle(source);
  const isVite = /__vite__|@vite\/|node_modules\/\.vite\//.test(source);

  // Webpack modules: `123: function(module, exports, __webpack_require__) {…}`
  // or `123: (e, t, n) => {…}` for newer/minified output. We detect the
  // numeric key + open-brace and balance-match braces to find the end.
  let moduleCount = 0;
  if (isWebpackBundle) {
    const moduleRe = /(?:^|[,{])\s*(\d+|"[a-zA-Z0-9_\-./@]+")\s*:\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = moduleRe.exec(source)) != null) {
      const id = m[1].replace(/"/g, '');
      const openBrace = source.indexOf('{', m.index + m[0].length - 1);
      if (openBrace === -1) continue;
      const end = findMatchingBrace(source, openBrace);
      if (end === -1) continue;
      symbols.push({
        kind: 'webpack-module',
        name: id,
        start: m.index,
        end,
        preview: source.slice(openBrace + 1, openBrace + 1 + 100).replace(/\s+/g, ' ').trim(),
        meta: { bytes: end - m.index },
      });
      moduleCount += 1;
      // Skip ahead to avoid nested matches inside the body.
      moduleRe.lastIndex = end + 1;
    }
  }

  // import statements
  const importRe = /(?:^|[\n;])\s*import\s+(?:[^"';]+\s+from\s+)?["']([^"']+)["']/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(source)) != null) {
    symbols.push({
      kind: 'import',
      name: im[1],
      start: im.index,
      end: im.index + im[0].length,
      preview: im[0].trim(),
    });
  }

  // require() calls — capped at first 200 to keep the panel responsive.
  const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  let rm: RegExpExecArray | null;
  let requireCount = 0;
  const requireDedupe = new Set<string>();
  while ((rm = requireRe.exec(source)) != null) {
    if (requireDedupe.has(rm[1])) continue;
    requireDedupe.add(rm[1]);
    symbols.push({
      kind: 'require',
      name: rm[1],
      start: rm.index,
      end: rm.index + rm[0].length,
      preview: rm[0].trim(),
    });
    requireCount += 1;
    if (requireCount >= 200) break;
  }

  // export { … } / export default / export class / export function
  const exportRe =
    /(?:^|[\n;{}])\s*export\s+(?:default\s+)?(?:(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)|let\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*)|\{([^}]+)\})/g;
  let em: RegExpExecArray | null;
  while ((em = exportRe.exec(source)) != null) {
    const name = em[1] || em[2] || em[3] || em[4] || em[5] || (em[6] && em[6].trim().split(',')[0].trim()) || 'default';
    symbols.push({
      kind: 'export',
      name,
      start: em.index,
      end: em.index + em[0].length,
      preview: em[0].trim().slice(0, 100),
    });
  }

  // Top-level function declarations (not nested) — only at line start.
  // Minified code usually doesn't have these but unminified bundles do.
  const fnRe = /(?:^|\n)\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let fm: RegExpExecArray | null;
  let fnCount = 0;
  while ((fm = fnRe.exec(source)) != null) {
    const openBrace = source.indexOf('{', fm.index + fm[0].length);
    if (openBrace === -1) continue;
    const end = findMatchingBrace(source, openBrace);
    if (end === -1) continue;
    symbols.push({
      kind: 'function',
      name: fm[1],
      start: fm.index,
      end,
      preview: source.slice(openBrace + 1, openBrace + 1 + 100).replace(/\s+/g, ' ').trim(),
    });
    fnCount += 1;
    fnRe.lastIndex = end + 1;
    if (fnCount > 200) break;
  }

  // Top-level class declarations
  const classRe = /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(source)) != null) {
    const openBrace = source.indexOf('{', cm.index + cm[0].length);
    if (openBrace === -1) continue;
    const end = findMatchingBrace(source, openBrace);
    if (end === -1) continue;
    symbols.push({
      kind: 'class',
      name: cm[1],
      start: cm.index,
      end,
      preview: source.slice(openBrace + 1, openBrace + 1 + 100).replace(/\s+/g, ' ').trim(),
    });
  }

  // Sort by position
  symbols.sort((a, b) => a.start - b.start);
  return {
    language: 'javascript',
    symbols,
    isWebpackBundle,
    isVite,
    moduleCount: isWebpackBundle ? moduleCount : undefined,
  };
}

function detectWebpackBundle(source: string): boolean {
  return (
    source.includes('__webpack_require__') ||
    source.includes('webpackJsonp') ||
    source.includes('__webpack_modules__') ||
    /\b\d+:\s*function\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)\s*\{/.test(source.slice(0, 200_000))
  );
}

/**
 * Skips strings and comments while balance-matching braces. Returns the
 * index of the closing brace or -1 if unbalanced (which means we ran out
 * of input — likely a truncated source).
 */
function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  const len = source.length;
  while (i < len) {
    const c = source[i];
    // Skip line comments
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    // Skip block comments
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? len : close + 2;
      continue;
    }
    // Skip strings
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(source, i, c);
      continue;
    }
    // Skip regex (very rough — assumes a regex follows `=`, `(`, `,`, `return`, etc.)
    if (c === '/' && isLikelyRegexStart(source, i)) {
      i = skipRegex(source, i);
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function skipString(source: string, i: number, quote: string): number {
  i += 1;
  const len = source.length;
  while (i < len) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    // Template literal interpolation
    if (quote === '`' && c === '$' && source[i + 1] === '{') {
      // Recursively skip the interpolation
      const close = findMatchingBrace(source, i + 1);
      if (close === -1) return len;
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return len;
}

function isLikelyRegexStart(source: string, i: number): boolean {
  // Walk back to the previous non-whitespace char. If it's one of these,
  // we're probably looking at a regex literal, not a divide.
  for (let j = i - 1; j >= 0; j--) {
    const c = source[j];
    if (c === ' ' || c === '\t' || c === '\n') continue;
    return '=(,;:[!&|?{}+~^*-/%<>'.includes(c) || /[A-Za-z]/.test(c) === false;
  }
  return true;
}

function skipRegex(source: string, i: number): number {
  i += 1;
  const len = source.length;
  let inClass = false;
  while (i < len) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      // Skip flags
      i += 1;
      while (i < len && /[gimsuy]/.test(source[i])) i += 1;
      return i;
    } else if (c === '\n') {
      // Unterminated — bail
      return i;
    }
    i += 1;
  }
  return len;
}

/* ---------- CSS ---------- */

export function extractCssSkeleton(source: string): CssSkeleton {
  const symbols: SkeletonSymbol[] = [];
  const atRules: Array<{ rule: string; offset: number }> = [];

  // @media / @keyframes / @supports / @import
  const atRe = /@([a-zA-Z-]+)\b[^{;]*[{;]/g;
  let am: RegExpExecArray | null;
  while ((am = atRe.exec(source)) != null) {
    const kind = am[1].toLowerCase();
    atRules.push({ rule: am[0].trim().replace(/[{;]\s*$/, ''), offset: am.index });
    if (kind === 'keyframes') {
      const openBrace = source.indexOf('{', am.index);
      if (openBrace !== -1) {
        const end = findMatchingBrace(source, openBrace);
        if (end !== -1) {
          symbols.push({
            kind: 'css-keyframes',
            name: am[0].slice(0, 60).trim(),
            start: am.index,
            end,
            preview: am[0].trim(),
          });
        }
      }
    } else if (kind === 'media' || kind === 'supports') {
      const openBrace = source.indexOf('{', am.index);
      if (openBrace !== -1) {
        const end = findMatchingBrace(source, openBrace);
        if (end !== -1) {
          symbols.push({
            kind: 'css-media',
            name: am[0].slice(0, 60).trim(),
            start: am.index,
            end,
            preview: am[0].trim(),
          });
        }
      }
    }
  }

  // Top-level rules: `selector { ... }`. We skip any `@media`/`@supports`
  // wrappers already captured above.
  const ruleRe = /([^{}@]+?)\{/g;
  let prevEnd = 0;
  let rm: RegExpExecArray | null;
  let count = 0;
  while ((rm = ruleRe.exec(source)) != null && count < 500) {
    if (rm.index < prevEnd) continue;
    const selector = rm[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    const openBrace = rm.index + rm[0].length - 1;
    const end = findMatchingBrace(source, openBrace);
    if (end === -1) continue;
    symbols.push({
      kind: 'css-rule',
      name: selector.length > 60 ? selector.slice(0, 60) + '…' : selector,
      start: rm.index,
      end,
      preview: source.slice(openBrace + 1, openBrace + 1 + 100).replace(/\s+/g, ' ').trim(),
      meta: { declarations: countCommas(source.slice(openBrace + 1, end)) + 1 },
    });
    prevEnd = end + 1;
    ruleRe.lastIndex = prevEnd;
    count += 1;
  }

  symbols.sort((a, b) => a.start - b.start);
  return { language: 'css', symbols, atRules };
}

function countCommas(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0x3b /* ; */) n += 1;
  return n;
}

/**
 * Generic dispatcher used by ModulesTab. Picks the right extractor based
 * on the chunk family.
 */
export function extractSkeleton(
  source: string,
  family: 'js' | 'style' | 'data' | 'other',
): Skeleton | null {
  if (family === 'js') return extractJsSkeleton(source);
  if (family === 'style') return extractCssSkeleton(source);
  return null;
}

/**
 * Convenience: produce a one-line label for a symbol suitable for a tree
 * row. Falls back to position when no name is available.
 */
export function symbolLabel(s: SkeletonSymbol): string {
  switch (s.kind) {
    case 'webpack-module':
      return `module ${s.name}`;
    case 'import':
      return `import "${s.name}"`;
    case 'require':
      return `require("${s.name}")`;
    case 'export':
      return `export ${s.name}`;
    case 'class':
      return `class ${s.name}`;
    case 'function':
      return `function ${s.name}()`;
    case 'arrow':
      return `${s.name} = ()=>{…}`;
    case 'css-rule':
      return s.name;
    case 'css-media':
      return s.name;
    case 'css-keyframes':
      return s.name;
    default:
      return s.name;
  }
}
