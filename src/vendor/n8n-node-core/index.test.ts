/**
 * Suite for the `index` barrel of n8n-node-core (Task 11, FR-11.*).
 *
 * This is the guard that a conformance fix never changes the TypeScript export set (NFR-8): the
 * barrel must re-export exactly the documented surface, and `VERSION` must stay in step with the
 * `package.json` manifest (FR-11.1). Every assertion is pure and offline (NFR-7) and imports only
 * through the barrel (`./index.js` under NodeNext).
 *
 * Runtime values and types are pinned by two different mechanisms because a type is erased at
 * runtime: the runtime-exported names are compared as the key set of the module namespace object,
 * while the exported types are asserted at compile time via `expectTypeOf` type-only usage. So an
 * add, remove, or rename of either a value or a type breaks this suite.
 *
 * The manifest `version` is read via a JSON import (`with { type: 'json' }`), which the NodeNext
 * runtime resolves directly, and no `node:fs` read is needed (the package carries no `@types/node`),
 * so the package stays dependency-free and `private: true` (NFR-3). The strict typecheck runs under
 * `tsconfig.typecheck.json`, which enables `resolveJsonModule` so this JSON import type-checks for
 * the VERSION assertion.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import {
  DEFAULT_TIMEOUT_MS,
  buildApiRequest,
  buildAuthHeader,
  InstrumentApiError,
  NodeCoreError,
  HEALTH_PATH,
  VERSION,
  type ApiRequest,
  type InstrumentApiClientOptions,
} from './index.js';
// The whole namespace, to pin the runtime-exported key set exactly (FR-11, NFR-8).
import * as ns from './index.js';
// The source modules the barrel re-exports from, imported ONLY as the reference for the
// pure-re-export identity check below. The public surface under test is still consumed through the
// barrel; these siblings exist solely to prove the barrel forwards the same binding and does not
// wrap or rename it (FR-11, NFR-8). No dependency, still pure/offline (NFR-7).
import * as clientNs from './client.js';
import * as errorsNs from './errors.js';
import * as healthNs from './health.js';

/**
 * The exact set of RUNTIME exports the barrel must expose. Types (`ApiRequest`,
 * `InstrumentApiClientOptions`) are erased at runtime and so are absent here; they are pinned
 * separately by the compile-time block below. Any add/remove/rename of a value export changes this
 * set and fails the comparison.
 */
const EXPECTED_RUNTIME_EXPORTS = [
  'DEFAULT_TIMEOUT_MS',
  'HEALTH_PATH',
  'InstrumentApiError',
  'NodeCoreError',
  'VERSION',
  'buildApiRequest',
  'buildAuthHeader',
].sort();

describe('barrel runtime export set (FR-11, NFR-8)', () => {
  it('exposes exactly the documented runtime exports — no more, no fewer', () => {
    // Object.keys over the ESM namespace yields the string runtime exports only (no `default`
    // here, and symbol tags such as Symbol.toStringTag are excluded). An exact set comparison
    // fails on any undeclared export as well as any missing one.
    expect(Object.keys(ns).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it('binds each documented runtime name to a defined value of the right kind', () => {
    expect(typeof DEFAULT_TIMEOUT_MS).toBe('number');
    expect(typeof HEALTH_PATH).toBe('string');
    expect(typeof VERSION).toBe('string');
    expect(typeof buildApiRequest).toBe('function');
    expect(typeof buildAuthHeader).toBe('function');
    // The two errors are constructable Error subclasses (their behavior is Task 10's remit; here
    // we only pin that the barrel re-exports the classes themselves).
    expect(typeof InstrumentApiError).toBe('function');
    expect(typeof NodeCoreError).toBe('function');
    expect(new NodeCoreError('x')).toBeInstanceOf(Error);
    expect(new InstrumentApiError(500, 'x')).toBeInstanceOf(NodeCoreError);
  });

  it('carries no undeclared runtime export (each namespace key is documented)', () => {
    for (const key of Object.keys(ns)) {
      expect(EXPECTED_RUNTIME_EXPORTS).toContain(key);
    }
  });

  it('re-exports the same binding as each source module — no wrap or rename', () => {
    // `typeof` alone would still pass a wrapper (e.g. a re-export replaced by a local function or a
    // re-derived constant). Reference identity (`toBe` / Object.is) proves the barrel forwards the
    // exact source binding, so this fails on any wrap/rename regression the kind check misses.
    // `VERSION` is defined in the barrel itself (not re-exported), so it has no source counterpart
    // here and is pinned to the manifest by the FR-11.1 block below.
    expect(ns.DEFAULT_TIMEOUT_MS).toBe(clientNs.DEFAULT_TIMEOUT_MS);
    expect(ns.buildApiRequest).toBe(clientNs.buildApiRequest);
    expect(ns.buildAuthHeader).toBe(clientNs.buildAuthHeader);
    expect(ns.InstrumentApiError).toBe(errorsNs.InstrumentApiError);
    expect(ns.NodeCoreError).toBe(errorsNs.NodeCoreError);
    expect(ns.HEALTH_PATH).toBe(healthNs.HEALTH_PATH);
  });
});

describe('barrel type exports (FR-11, NFR-8, compile-time)', () => {
  // A type is erased at runtime, so its presence is asserted by compile-time usage: if the barrel
  // stopped exporting either type (rename/remove), these type-only references would fail `tsc`
  // strict and break the build the suite guards.
  it('re-exports the ApiRequest type with the documented shape', () => {
    expectTypeOf<ApiRequest>().toEqualTypeOf<{
      method: string;
      url: string;
      headers: Record<string, string>;
      timeoutMs: number;
    }>();
  });

  it('re-exports the InstrumentApiClientOptions type with the documented shape', () => {
    expectTypeOf<InstrumentApiClientOptions>().toEqualTypeOf<{
      baseUrl: string;
      bearerToken: string;
      timeoutMs?: number;
    }>();
  });

  it('binds buildApiRequest to the exported ApiRequest return type', () => {
    expectTypeOf(buildApiRequest).returns.toEqualTypeOf<ApiRequest>();
  });
});

describe('VERSION matches the manifest (FR-11.1)', () => {
  it('is a non-empty string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it('equals package.json version, read via a JSON import', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('the manifest version is itself a non-empty string (guards a blank manifest)', () => {
    expect(typeof pkg.version).toBe('string');
    expect(pkg.version.length).toBeGreaterThan(0);
  });
});
