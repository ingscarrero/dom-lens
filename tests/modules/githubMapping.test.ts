import { describe, expect, it } from 'vitest';
import {
  findMappingForModule,
  normalizeSourcePathForGithub,
  parseRepoSpec,
  repoHomeUrl,
  resolveBranch,
  resolveGithubFileUrl,
  type GithubMapping,
} from '@/lib/modules/githubMapping';

const base: GithubMapping = {
  id: 'm1',
  label: 'host',
  urlPattern: 'localhost:3001',
  owner: 'ingscarrero',
  repo: 'dom-lens-mf-host',
  branch: 'main',
};

describe('findMappingForModule', () => {
  it('returns the first mapping whose pattern is a substring of the URL', () => {
    const second = { ...base, id: 'm2', urlPattern: 'localhost' };
    expect(findMappingForModule('http://localhost:3001/main.js', [second, base])).toBe(second);
    expect(findMappingForModule('http://localhost:3001/main.js', [base, second])).toBe(base);
  });

  it('returns null for empty URL, empty pattern, or no match', () => {
    expect(findMappingForModule('', [base])).toBeNull();
    expect(findMappingForModule('http://cdn.x.com/a.js', [{ ...base, urlPattern: '' }])).toBeNull();
    expect(findMappingForModule('http://cdn.x.com/a.js', [base])).toBeNull();
  });
});

describe('normalizeSourcePathForGithub', () => {
  it.each([
    ['webpack:///./src/App.jsx', 'src/App.jsx'],
    ['webpack:///src/App.jsx', 'src/App.jsx'],
    ['webpack://mf-host/src/App.jsx', 'src/App.jsx'],
    ['webpack://mf-host/./src/App.jsx', 'src/App.jsx'],
    ['vite:///src/App.tsx', 'src/App.tsx'],
    ['vite://my-app/src/App.tsx', 'src/App.tsx'],
    ['../src/foo.js', 'src/foo.js'],
    ['(cdn.example.com)/src/x.js', 'src/x.js'],
    ['src\\win\\path.ts', 'src/win/path.ts'],
    ['src//double.ts?query#frag', 'src/double.ts'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeSourcePathForGithub(input)).toBe(expected);
  });

  it('rejects paths that cannot live in the user repo', () => {
    expect(normalizeSourcePathForGithub('')).toBeNull();
    expect(normalizeSourcePathForGithub('webpack:///node_modules/react/index.js')).toBeNull();
    expect(normalizeSourcePathForGithub('webpack:///webpack/bootstrap')).toBeNull();
    expect(normalizeSourcePathForGithub('webpack:///')).toBeNull();
  });
});

describe('resolveBranch', () => {
  it('returns the literal branch when there is no placeholder', () => {
    expect(resolveBranch(base, 'http://x/v1.2.3/a.js')).toBe('main');
    expect(resolveBranch({ ...base, branch: '' })).toBe('main');
  });

  it('substitutes {version} from the capture group', () => {
    const m = { ...base, branch: 'v{version}', versionCapture: '/v([0-9.]+)/' };
    expect(resolveBranch(m, 'https://cdn.x.com/v1.2.3/main.js')).toBe('v1.2.3');
  });

  it('leaves the placeholder visible when capture is missing, unmatched, or invalid', () => {
    const tmpl = { ...base, branch: 'v{version}' };
    expect(resolveBranch(tmpl)).toBe('v{version}');
    expect(resolveBranch({ ...tmpl, versionCapture: '/v([0-9.]+)/' }, 'https://x/a.js')).toBe('v{version}');
    expect(resolveBranch({ ...tmpl, versionCapture: '(' }, 'https://x/v1/a.js')).toBe('v{version}');
  });
});

describe('resolveGithubFileUrl', () => {
  it('builds raw + blob URLs, honouring basePath and encoding', () => {
    const m = { ...base, basePath: 'examples/mf-demo/host/', branch: 'feat/x y' };
    const r = resolveGithubFileUrl('webpack://mf-host/./src/App.jsx', m)!;
    expect(r.pathInRepo).toBe('examples/mf-demo/host/src/App.jsx');
    expect(r.branch).toBe('feat/x y');
    expect(r.rawUrl).toBe(
      'https://raw.githubusercontent.com/ingscarrero/dom-lens-mf-host/feat%2Fx%20y/examples/mf-demo/host/src/App.jsx',
    );
    expect(r.webUrl).toBe(
      'https://github.com/ingscarrero/dom-lens-mf-host/blob/feat%2Fx%20y/examples/mf-demo/host/src/App.jsx',
    );
  });

  it('returns null for unmappable sources', () => {
    expect(resolveGithubFileUrl('webpack:///node_modules/x/index.js', base)).toBeNull();
  });
});

describe('repoHomeUrl', () => {
  it('points at the repo root for default branches and /tree/<ref> otherwise', () => {
    expect(repoHomeUrl(base)).toBe('https://github.com/ingscarrero/dom-lens-mf-host');
    expect(repoHomeUrl({ ...base, branch: 'master' })).toBe('https://github.com/ingscarrero/dom-lens-mf-host');
    expect(repoHomeUrl({ ...base, branch: 'release/2' })).toBe(
      'https://github.com/ingscarrero/dom-lens-mf-host/tree/release%2F2',
    );
  });
});

describe('parseRepoSpec', () => {
  it.each([
    ['owner/repo', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo', { owner: 'owner', repo: 'repo' }],
    ['https://www.github.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
    [
      'https://github.com/owner/repo/tree/dev/apps/web',
      { owner: 'owner', repo: 'repo', branch: 'dev', basePath: 'apps/web' },
    ],
    ['https://github.com/owner/repo/tree/dev', { owner: 'owner', repo: 'repo', branch: 'dev', basePath: undefined }],
    ['git@github.com:owner/repo.git', { owner: 'owner', repo: 'repo' }],
  ])('parses %s', (input, expected) => {
    expect(parseRepoSpec(input)).toEqual(expected);
  });

  it('returns null for unparseable input', () => {
    expect(parseRepoSpec('')).toBeNull();
    expect(parseRepoSpec('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseRepoSpec('https://github.com/only-owner')).toBeNull();
    expect(parseRepoSpec('not a url or spec')).toBeNull();
  });
});
