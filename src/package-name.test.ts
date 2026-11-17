/**
 * FR-18.7: the node package name (design C1), ported from the paired API repo.
 *
 * The API repo's scaffold suite read this repo's `package.json` from outside; the check runs here,
 * in the repo that holds the file (FR-3.4, design C-13), with the same test name (FR-12.5.3) and the
 * same assertions: the package name is the unscoped `n8n-nodes-qinstruments-bioshake`, and the
 * package is publishable (no `"private": true`). The expected name comes from the requirement, not
 * from the manifest under test.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

describe('node package name (FR-18.7)', () => {
  it('test_fr_18_7_node_package_is_unscoped_and_publishable', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { name?: unknown; private?: unknown };
    expect(pkg.name).toBe('n8n-nodes-qinstruments-bioshake');
    expect(String(pkg.name).startsWith('@')).toBe(false);
    const publishable = !('private' in pkg) || pkg.private === false;
    expect(publishable, 'FR-1.1: the node package is publishable; "private": true is not allowed').toBe(true);
  });
});
