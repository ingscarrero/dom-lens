/**
 * URL policy for the background service worker's `net.fetch` / `net.head`
 * proxy.
 *
 * The panel asks the SW to fetch URLs it derived from page content
 * (`<script src>`, `//# sourceMappingURL=` comments, sourcemap `sources`).
 * The SW runs with `<all_urls>` host permissions and is not subject to
 * CORS, so without a policy a hostile page could use the proxy to probe
 * loopback / LAN services that the page itself cannot reach. Only public
 * `http:` / `https:` targets are allowed, plus the explicitly trusted
 * hosts the caller passes in (the user's configured LLM endpoint and the
 * inspected page's own host).
 *
 * Accepted residual risk: the check is syntactic. Browser `fetch` gives
 * no access to the resolved address, so a public DNS name that resolves
 * (or is rebound) to a private address is not detected. What that buys
 * an attacker is limited to a credential-less, redirect-free GET / HEAD
 * whose body is only ever shown in the user's own DevTools panel — the
 * page cannot read it. See docs/REQUIREMENTS.md §2.2 (NFR-S.8).
 */

export type ProxyUrlDecision =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/** Normalise a hostname for comparison: lower-case, strip IPv6 brackets
 * and a trailing dot. */
function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** Parse a dotted-quad IPv4 literal. Returns null for anything else
 * (the WHATWG URL parser already normalises octal / hex / int forms, so
 * plain dotted decimal is all we need to accept here). */
function parseIpv4(h: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const octets = m.slice(1).map(Number) as [number, number, number, number];
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Expand an IPv6 literal to eight 16-bit groups. Handles `::`
 * compression and a trailing embedded IPv4 (`::ffff:127.0.0.1`).
 * Returns null when the text is not a valid IPv6 address. */
function parseIpv6(h: string): number[] | null {
  if (!h.includes(':')) return null;
  // Embedded IPv4 tail → two hextets.
  let text = h;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    text =
      text.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ':' +
      ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    a >= 224 // multicast + reserved + broadcast
  );
}

function isPrivateIpv6(groups: number[]): boolean {
  const [g0] = groups;
  const isZeroPrefix = groups.slice(0, 5).every((g) => g === 0);
  // `::` (unspecified) and `::1` (loopback)
  if (isZeroPrefix && groups[5] === 0 && groups[6] === 0 && (groups[7] === 0 || groups[7] === 1)) {
    return true;
  }
  // IPv4-mapped `::ffff:a.b.c.d` → judge the embedded IPv4.
  if (isZeroPrefix && groups[5] === 0xffff) {
    return isPrivateIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** `localhost`, `*.localhost` and the IPv4 / IPv6 loopback literals. */
export function isLoopbackHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = parseIpv4(h);
  if (v4) return v4[0] === 127;
  const v6 = parseIpv6(h);
  if (v6) {
    if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true;
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
      return (v6[6] >> 8) === 127;
    }
  }
  return false;
}

/**
 * True for hostnames that resolve to the local machine or a private
 * network: `localhost` / `*.localhost`, loopback, link-local, RFC1918
 * (10/8, 172.16/12, 192.168/16), CGNAT, unique-local (fc00::/7),
 * IPv6 link-local (fe80::/10), IPv4-mapped forms of any of those, and
 * the unspecified / multicast / reserved blocks.
 *
 * Names are judged syntactically — a public DNS name that resolves to
 * a private address (DNS rebinding) is not detected here.
 */
export function isPrivateHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (h === '' || h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = parseIpv4(h);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(h);
  if (v6) return isPrivateIpv6(v6);
  return false;
}

/** `host` (hostname + non-default port) of a URL string, or null when it
 * does not parse. Used to build the trusted-host list for the proxy. */
export function hostOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Decide whether the SW proxy may fetch `raw`. Allowed when the URL is
 * `http:` / `https:` and either its host is in `trustedHosts` (compared
 * as `hostname[:port]`, case-insensitive) or its hostname is not
 * private per `isPrivateHostname`.
 */
export function isAllowedProxyUrl(
  raw: string,
  trustedHosts: Iterable<string> = [],
): ProxyUrlDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `invalid URL: ${raw}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `unsupported protocol ${url.protocol}` };
  }
  const host = url.host.toLowerCase();
  for (const t of trustedHosts) {
    if (t && t.toLowerCase() === host) return { ok: true, url };
  }
  if (isPrivateHostname(url.hostname)) {
    return {
      ok: false,
      reason: `${url.hostname} is a loopback, link-local or private-range address (only the configured AI endpoint and the inspected page's own host are exempt)`,
    };
  }
  return { ok: true, url };
}
