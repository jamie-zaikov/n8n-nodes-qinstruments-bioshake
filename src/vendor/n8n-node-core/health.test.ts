/**
 * Suite for the `health` module of n8n-node-core (Task 10, FR-10).
 *
 * Imports the public surface through the barrel (`./index.js` under NodeNext) so the test binds to
 * the exported contract, not the module internals. The assertion is pure and offline (NFR-7): the
 * constant is a documented mirror of `instrument_api_core.health.HEALTH_PATH` on the Python side,
 * asserted here as the literal string.
 */
import { describe, it, expect } from 'vitest';

import { HEALTH_PATH } from './index.js';

describe('HEALTH_PATH (FR-10)', () => {
  it('=== "/healthz", mirroring the Python constant', () => {
    expect(HEALTH_PATH).toBe('/healthz');
  });

  it('is a string carrying no host or port detail', () => {
    expect(typeof HEALTH_PATH).toBe('string');
    // The path is a bare route only — never a full URL with a host or port.
    expect(HEALTH_PATH.startsWith('/')).toBe(true);
    expect(HEALTH_PATH).not.toContain('://');
    expect(HEALTH_PATH).not.toContain(':');
  });

  it('is a leading-slash route with no trailing slash', () => {
    // The contract is a bare route the API mounts at exactly `/healthz`. A trailing
    // slash would form a distinct route (`/healthz/`) that need not resolve, so the
    // mirror must carry none.
    expect(HEALTH_PATH.endsWith('/')).toBe(false);
  });
});
