/**
 * CommonJS load suite (Task 25.4, design C16 / DD-8; supports FR-18.4: the examples import a
 * node type that n8n can load).
 *
 * n8n loads community nodes with `require()`. This suite loads the built bundles through
 * `createRequire(import.meta.url)`, the same CommonJS path, and checks that each bundle exports
 * its class. The bundle paths come from the `package.json` `n8n` block.
 *
 * `dist/` robustness: `<private-doc-ref>` runs `npm run build` before `npm test`. For a bare
 * `npm test` on a fresh checkout, `beforeAll` runs the esbuild step (`node build.mjs`) once when a
 * manifest file is missing. It never rebuilds a present `dist/`. Nothing here opens a socket.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { OPERATION_IDS } from './nodes/QInstrumentsBioShake/operations';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface PackageManifest {
  name: string;
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

beforeAll(() => {
  if (manifestEntries.every((entry) => existsSync(abs(entry)))) return;
  execFileSync(process.execPath, ['build.mjs'], { cwd: packageRoot, stdio: 'pipe' });
}, 120_000);

describe('CommonJS load of the built bundles (C16, DD-8)', () => {
  it('test_c16_manifest_points_at_the_built_node_and_credential_bundles', () => {
    expect(manifest.n8n.nodes).toEqual(['dist/nodes/QInstrumentsBioShake/QInstrumentsBioShake.node.js']);
    expect(manifest.n8n.credentials).toEqual(['dist/credentials/QInstrumentsBioShakeApi.credentials.js']);
    for (const entry of manifestEntries) {
      expect(existsSync(abs(entry)), `${entry} is missing after the build`).toBe(true);
    }
    expect(existsSync(abs('dist/nodes/QInstrumentsBioShake/qinstrumentsBioShake.svg'))).toBe(true);
  });

  it('test_c16_node_bundle_loads_with_require_and_exports_QInstrumentsBioShake', () => {
    const NodeClass = exportedClass(manifest.n8n.nodes[0] as string);
    expect(NodeClass.name).toBe('QInstrumentsBioShake');
    const node = new NodeClass() as {
      description: {
        name: string;
        version: number;
        credentials: Array<{ name: string }>;
        properties: Array<{ name: string; options?: Array<{ value: unknown }> }>;
      };
      execute: unknown;
    };
    expect(node.description.name).toBe('qInstrumentsBioShake');
    expect(node.description.version).toBe(1);
    expect(node.description.credentials.map((c) => c.name)).toEqual(['qInstrumentsBioShakeApi']);
    expect(typeof node.execute).toBe('function');
    // The loaded bundle offers exactly the 22 operations of operations.ts.
    const op = node.description.properties.find((p) => p.name === 'operation');
    expect((op?.options ?? []).map((o) => o.value).sort()).toEqual([...OPERATION_IDS].sort());
  });

  it('test_c16_credential_bundle_loads_with_require_and_exports_QInstrumentsBioShakeApi', () => {
    const CredentialClass = exportedClass(manifest.n8n.credentials[0] as string);
    expect(CredentialClass.name).toBe('QInstrumentsBioShakeApi');
    const credential = new CredentialClass() as { name: string; properties: Array<{ name: string }> };
    expect(credential.name).toBe('qInstrumentsBioShakeApi');
    expect(credential.properties.map((p) => p.name)).toEqual(
      expect.arrayContaining(['baseUrl', 'token', 'caCertificate']), // pragma: allowlist secret (field names)
    );
  });

  it('test_dd8_node_bundle_is_commonjs_inlines_core_and_keeps_n8n_workflow_external', () => {
    const bundle = readFileSync(abs(manifest.n8n.nodes[0] as string), 'utf8');
    expect(bundle).toMatch(/module\.exports\s*=/);
    expect(bundle).not.toMatch(/^\s*import\s.+\sfrom\s/m);
    expect(bundle).not.toMatch(/^\s*export\s/m);
    expect(bundle).not.toContain('require("n8n-node-core")');
    expect(bundle).toContain('require("n8n-workflow")');
  });
});
