import { describe, expect, it } from 'vitest';
import {
  hostOf,
  isAllowedProxyUrl,
  isLoopbackHostname,
  isPrivateHostname,
} from '@/lib/net/urlPolicy';

describe('isPrivateHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'app.localhost',
    'localhost.',
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '[::1]',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.5',
    '::ffff:c0a8:101',
  ])('treats %s as private', (host) => {
    expect(isPrivateHostname(host)).toBe(true);
  });

  it.each([
    'example.com',
    'cdn.example.com',
    'localhost.example.com',
    'notlocalhost',
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '11.0.0.1',
    '2606:4700::1111',
    'fe00::1',
    'fec0::1',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('treats %s as public', (host) => {
    expect(isPrivateHostname(host)).toBe(false);
  });

  it('rejects malformed IPv6 literals as non-private (URL parser guards earlier)', () => {
    expect(isPrivateHostname('1:2:3:4:5:6:7:8:9')).toBe(false);
    expect(isPrivateHostname('::1::2')).toBe(false);
    expect(isPrivateHostname('::ffff:999.1.1.1')).toBe(false);
    expect(isPrivateHostname('1:2:3:4:5:6:7:8::')).toBe(false);
    expect(isPrivateHostname('zz::1')).toBe(false);
  });
});

describe('isLoopbackHostname', () => {
  it('matches localhost, *.localhost and loopback literals', () => {
    for (const h of ['localhost', 'api.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '::ffff:127.0.0.1']) {
      expect(isLoopbackHostname(h), h).toBe(true);
    }
  });
  it('does not match other private or public hosts', () => {
    for (const h of ['10.0.0.1', '192.168.0.1', 'fe80::1', '::ffff:10.0.0.1', 'example.com', '::']) {
      expect(isLoopbackHostname(h), h).toBe(false);
    }
  });
});

describe('hostOf', () => {
  it('returns hostname plus non-default port, lower-cased', () => {
    expect(hostOf('http://localhost:1234/v1')).toBe('localhost:1234');
    expect(hostOf('https://API.Example.com/v1')).toBe('api.example.com');
    expect(hostOf('https://example.com:443/')).toBe('example.com');
  });
  it('returns null for empty or unparsable input', () => {
    expect(hostOf('')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf('not a url')).toBeNull();
  });
});

describe('isAllowedProxyUrl', () => {
  it('allows public http(s) URLs', () => {
    expect(isAllowedProxyUrl('https://cdn.example.com/app.js').ok).toBe(true);
    expect(isAllowedProxyUrl('http://example.com/app.js.map').ok).toBe(true);
  });

  it('rejects non-http protocols', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'chrome://settings', 'data:text/plain,hi', 'javascript:alert(1)']) {
      const d = isAllowedProxyUrl(u);
      expect(d.ok, u).toBe(false);
      if (!d.ok) expect(d.reason).toMatch(/unsupported protocol/);
    }
  });

  it('rejects unparsable URLs', () => {
    const d = isAllowedProxyUrl('::not a url::');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/invalid URL/);
  });

  it('rejects loopback, link-local and private ranges by default', () => {
    for (const u of [
      'http://localhost:3000/app.js',
      'http://app.localhost/app.js',
      'http://127.0.0.1:8080/',
      'http://[::1]:8080/',
      'http://10.0.0.2/admin',
      'http://172.16.5.5/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:7f00:1]/',
      // The URL parser normalises exotic IPv4 spellings to dotted decimal.
      'http://0x7f.0.0.1/',
      'http://2130706433/',
      'http://127.1/',
      'http://0/',
    ]) {
      const d = isAllowedProxyUrl(u);
      expect(d.ok, u).toBe(false);
      if (!d.ok) expect(d.reason).toMatch(/local or private host/);
    }
  });

  it('exempts trusted hosts (hostname + port) case-insensitively', () => {
    const trusted = ['localhost:1234', 'LOCALHOST:3000'];
    expect(isAllowedProxyUrl('http://localhost:1234/v1/models', trusted).ok).toBe(true);
    expect(isAllowedProxyUrl('http://LocalHost:3000/app.js', trusted).ok).toBe(true);
    // Same hostname, different port → still blocked.
    expect(isAllowedProxyUrl('http://localhost:5173/app.js', trusted).ok).toBe(false);
    // Empty entries are ignored.
    expect(isAllowedProxyUrl('http://localhost/', ['']).ok).toBe(false);
  });

  it('returns the parsed URL on success', () => {
    const d = isAllowedProxyUrl('https://example.com/a.js');
    expect(d.ok && d.url.hostname).toBe('example.com');
  });
});
