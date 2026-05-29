import {
  FINGERPRINTS,
  confidenceFromEvidence,
  readVersionAt,
  type FingerprintSpec,
} from './fingerprints';
import type { FingerprintMatch, TechStack } from './types';

/**
 * Reads window globals + DOM to build a TechStack summary.
 * Runs in MAIN world (via inspectedWindow.eval or as part of __dom_lens__.capture()).
 * URL-pattern evidence is folded in panel-side via mergeUrlEvidence().
 */
export function detectTechStackFromWindow(): TechStack {
  const w = window as any;
  const matches: FingerprintMatch[] = [];

  const allScripts = collectScriptUrlsSafely();

  for (const spec of FINGERPRINTS) {
    const evidence: string[] = [];
    let version: string | undefined;
    let globalHit = false;

    if (spec.globals) {
      for (const g of spec.globals) {
        let val: any;
        try {
          val = w[g];
        } catch {
          continue;
        }
        if (val != null) {
          globalHit = true;
          evidence.push(`window.${g}`);
          if (!version) version = readVersionAt(val, spec.versionPath);
          break;
        }
      }
    }

    let urlHits = 0;
    if (spec.urlPatterns?.length) {
      for (const pattern of spec.urlPatterns) {
        for (const url of allScripts) {
          if (pattern.test(url)) {
            urlHits += 1;
            evidence.push(`url: ${shortenUrl(url)}`);
            break;
          }
        }
      }
    }

    if (globalHit || urlHits > 0) {
      matches.push({
        id: spec.id,
        name: spec.name,
        category: spec.category,
        version,
        confidence: confidenceFromEvidence(globalHit, urlHits, !!version),
        evidence: dedupe(evidence).slice(0, 6),
      });
    }
  }

  return groupByCategory(matches);
}

function collectScriptUrlsSafely(): string[] {
  try {
    const set = new Set<string>();
    const scripts = document.querySelectorAll('script[src]');
    for (let i = 0; i < scripts.length; i++) {
      const src = (scripts[i] as HTMLScriptElement).src;
      if (src) set.add(src);
    }
    const links = document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"][as="script"]');
    for (let i = 0; i < links.length; i++) {
      const href = (links[i] as HTMLLinkElement).href;
      if (href) set.add(href);
    }
    return Array.from(set);
  } catch {
    return [];
  }
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname.split('/').slice(-2).join('/');
    if (p.length > 60) p = '…' + p.slice(-60);
    return `${u.host}/${p}`;
  } catch {
    return url.length > 80 ? url.slice(0, 80) + '…' : url;
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function groupByCategory(matches: FingerprintMatch[]): TechStack {
  const byCategory: TechStack['byCategory'] = {};
  for (const m of matches) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    byCategory[m.category]!.push(m);
  }
  return { matches, byCategory };
}

/**
 * Merges URL-pattern evidence collected panel-side (from the network entries)
 * into a TechStack returned by the in-page detector. Boosts confidence when
 * URL hits accumulate.
 */
export function mergeUrlEvidence(stack: TechStack, urls: string[]): TechStack {
  const matchesById = new Map(stack.matches.map((m) => [m.id, { ...m, evidence: [...m.evidence] }]));

  for (const spec of FINGERPRINTS as FingerprintSpec[]) {
    if (!spec.urlPatterns?.length) continue;
    let hits = 0;
    const seen = new Set<string>();
    for (const pattern of spec.urlPatterns) {
      for (const url of urls) {
        if (seen.has(url)) continue;
        if (pattern.test(url)) {
          hits += 1;
          seen.add(url);
        }
      }
    }
    if (hits === 0) continue;
    const existing = matchesById.get(spec.id);
    if (existing) {
      const all = [...existing.evidence];
      let added = 0;
      for (const url of seen) {
        if (added >= 4) break;
        const tag = `network: ${shortenUrl(url)}`;
        if (!all.includes(tag)) {
          all.push(tag);
          added += 1;
        }
      }
      existing.evidence = all.slice(0, 8);
      existing.confidence = confidenceFromEvidence(
        existing.evidence.some((e) => e.startsWith('window.')),
        hits,
        !!existing.version,
      );
    } else {
      matchesById.set(spec.id, {
        id: spec.id,
        name: spec.name,
        category: spec.category,
        confidence: confidenceFromEvidence(false, hits, false),
        evidence: Array.from(seen)
          .slice(0, 4)
          .map((u) => `network: ${shortenUrl(u)}`),
      });
    }
  }

  return groupByCategory(Array.from(matchesById.values()));
}
