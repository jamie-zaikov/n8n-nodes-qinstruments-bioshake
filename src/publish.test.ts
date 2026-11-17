/**
 * Publish-readiness suite (n8n-node-deploy Task 1, design C7; FR-5.1, FR-5.2, FR-5.4), adapted for
 * the public npm package.
 *
 * The package is published to the public npm registry with provenance. Expected values never come
 * from this package's own manifest alone (FR-5.5):
 * - the public metadata values (name, license, GitHub URLs, keyword, shipped files, the
 *   `n8n-workflow` peer range) are fixed in this suite;
 * - the tarball file list comes from `npm pack --dry-run`, compared with the manifest entries;
 * - the node type and credential type names come from the **built** bundles, loaded with
 *   `require()` as n8n loads them, and are compared with fixed values.
 *
 * Adapted from the monorepo suite: its parity checks against the manifest of another, private node
 * package and against the pre-push expectations of the monorepo deployment file are dropped,
 * because no public repo holds either file. The exact public values below take their place.
 *
 * `dist/` robustness: the CI workflow runs `npm run build` before `npm test`. For a bare
 * `npm test`, `beforeAll` runs `node build.mjs` once when a manifest entry is missing. It never
 * rebuilds a present `dist/`. Offline: `npm pack --dry-run --ignore-scripts` writes no file and
 * reads no registry.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM_TIMEOUT_MS = 60_000;

/** The public identity of this package (FR-8.1, FR-8.4). */
const PACKAGE_NAME = 'n8n-nodes-qinstruments-bioshake';
const REPO_URL = `https://github.com/jamie-zaikov/${PACKAGE_NAME}`;
/** The n8n-workflow major this node is built and tested against (FR-8.7). */
const PEER_RANGE = '>=2.22.0 <3';
/** The n8n node type and credential type that workflows reference. */
const NODE_TYPE = `${PACKAGE_NAME}.qInstrumentsBioShake`;
const CREDENTIAL_TYPE = 'qInstrumentsBioShakeApi';
/** Files that npm always packs in addition to the `files` list. */
const NPM_DEFAULT_FILES = new Set(['package.json', 'README.md', 'LICENSE']);

interface PackageManifest {
  name: string;
  version: string;
  license?: unknown;
  author?: unknown;
  homepage?: unknown;
  repository?: { type?: unknown; url?: unknown };
  bugs?: { url?: unknown };
  keywords?: unknown;
  files?: unknown;
  private?: unknown;
  main?: unknown;
  publishConfig?: unknown;
  overrides?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  n8n: { credentials: string[]; nodes: string[] };
}

type Constructor = new () => Record<string, unknown>;

const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as PackageManifest;
const manifestEntries = [...manifest.n8n.credentials, ...manifest.n8n.nodes];

function abs(relative: string): string {
  return path.join(packageRoot, relative);
}

/** The single class exported by a CommonJS bundle. */
function exportedClass(relative: string): Constructor {
  const mod = require(abs(relative)) as Record<string, unknown>;
  const classes = Object.values(mod).filter(
    (value): value is Constructor => typeof value === 'function' && /^class\s/.test(String(value)),
  );
  expect(classes, `${relative} must export exactly one class`).toHaveLength(1);
  return classes[0] as Constructor;
}

/** Every file under `dir` (relative paths, `/` separators). */
function walkFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walkFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

// npm passes lifecycle and workspace settings to `npm test` children through npm_* variables. The
// nested npm command must not inherit them, so drop every npm_* variable except the ones that
// locate the cache, the config files and the registry.
const KEEP_NPM_VARS = new Set([
  'npm_config_cache',
  'npm_config_userconfig',
  'npm_config_globalconfig',
  'npm_config_registry',
]);

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const lower = key.toLowerCase();
    if (lower.startsWith('npm_') && !KEEP_NPM_VARS.has(lower)) continue;
    env[key] = value;
  }
  return env;
}

/** The file paths `npm pack` would put in the tarball (dry run: no file, no registry). */
function packedFiles(): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot,
    env: childEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: NPM_TIMEOUT_MS,
  });
  const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  expect(parsed).toHaveLength(1);
  return (parsed[0] as { files: Array<{ path: string }> }).files.map((f) => f.path);
}

beforeAll(() => {
  if (manifestEntries.every((entry) => existsSync(abs(entry)))) return;
  execFileSync(process.execPath, ['build.mjs'], { cwd: packageRoot, stdio: 'pipe' });
}, 120_000);

describe('publishable public manifest (FR-5.1, FR-8)', () => {
  it('test_manifest_is_not_private (rejects "private": true, FR-1.1, FR-8.8)', () => {
    expect(manifest.private === undefined || manifest.private === false).toBe(true);
  });

  it('test_manifest_has_no_publish_config (rejects any registry override of public npm, FR-8.8)', () => {
    expect(manifest.publishConfig).toBeUndefined();
  });

  it('test_main_is_declared (rejects a manifest with no main, FR-1.3)', () => {
    expect(typeof manifest.main === 'string' && manifest.main.length > 0).toBe(true);
  });

  it('test_peer_range_is_the_n8n_workflow_range (rejects "*" or any other range, FR-1.6, FR-8.7)', () => {
    expect(manifest.peerDependencies?.['n8n-workflow']).toBe(PEER_RANGE);
  });

  it('test_core_is_no_dependency (rejects any n8n-node-core dependency and runtime dependencies, FR-1.7, FR-2.7, FR-8.7)', () => {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      expect(Object.keys(manifest[field] ?? {}), field).not.toContain('n8n-node-core');
    }
    expect(manifest.dependencies).toBeUndefined();
  });

  it('test_public_metadata_values (rejects a wrong name, license, URL, keyword or file list, FR-8.1..FR-8.6)', () => {
    expect(manifest.name).toBe(PACKAGE_NAME);
    expect(manifest.license).toBe('MIT');
    expect(manifest.homepage).toBe(REPO_URL);
    expect(manifest.repository?.url).toBe(`git+${REPO_URL}.git`);
    expect(manifest.bugs?.url).toBe(`${REPO_URL}/issues`);
    expect(Array.isArray(manifest.keywords) && manifest.keywords.includes('n8n-community-node-package')).toBe(true);
    expect(manifest.files).toEqual(['dist']);
    expect(manifest.overrides).toBeUndefined();
  });

  it('test_author_names_the_maintainer (rejects a missing or string-form author, FR-8.3)', () => {
    // The exact author name and e-mail are checked against the release identity by the release
    // verifier; this suite checks the object form and that both fields are filled.
    const author = manifest.author as Record<string, unknown> | undefined;
    expect(author !== undefined && typeof author === 'object').toBe(true);
    expect(Object.keys(author ?? {}).sort()).toEqual(['email', 'name']);
    const name = author?.name;
    expect(typeof name === 'string' && name.trim().length > 0 && name === name.trim()).toBe(true);
    const email = author?.email;
    expect(typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)).toBe(true);
  });
});

describe('built package (FR-5.2)', () => {
  it(
    'test_tarball_ships_main_and_n8n_entries (rejects a main or entry left out of the tarball, FR-1.4, FR-1.5)',
    () => {
      const files = packedFiles();
      expect(files).toContain(manifest.main);
      for (const entry of manifestEntries) {
        expect(files, entry).toContain(entry);
      }
      // files ["dist"]: nothing but the build output and the files npm always packs (FR-8.6).
      const extra = files.filter((file) => !file.startsWith('dist/') && !NPM_DEFAULT_FILES.has(file));
      expect(extra).toEqual([]);
    },
    NPM_TIMEOUT_MS + 10_000,
  );

  it('test_no_built_file_imports_core (rejects an n8n-node-core import left in dist, FR-1.8)', () => {
    const jsFiles = walkFiles(abs('dist')).filter((file) => file.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);
    const coreImport = [
      /require\(\s*["']n8n-node-core/,
      /import\(\s*["']n8n-node-core/,
      /from\s*["']n8n-node-core/,
    ];
    for (const file of jsFiles) {
      const text = readFileSync(abs(path.join('dist', file)), 'utf8');
      for (const pattern of coreImport) {
        expect(pattern.test(text), `dist/${file} matches ${pattern}`).toBe(false);
      }
    }
  });
});

describe('built identifiers equal the published types (FR-5.4, FR-4.4)', () => {
  it('test_built_node_type_is_the_published_type (rejects a wrong or stale node identifier)', () => {
    expect(manifest.n8n.nodes).toHaveLength(1);
    const NodeClass = exportedClass(manifest.n8n.nodes[0] as string);
    const node = new NodeClass() as { description: { name: string } };
    expect(`${manifest.name}.${node.description.name}`).toBe(NODE_TYPE);
  });

  it('test_built_credential_type_is_the_published_type (rejects a wrong or stale credential name)', () => {
    expect(manifest.n8n.credentials).toHaveLength(1);
    const CredentialClass = exportedClass(manifest.n8n.credentials[0] as string);
    const credential = new CredentialClass() as { name: string };
    expect(credential.name).toBe(CREDENTIAL_TYPE);
  });
});
