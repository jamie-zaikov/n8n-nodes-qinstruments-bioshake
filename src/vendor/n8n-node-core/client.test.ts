/**
 * Suite for the `client` module of n8n-node-core (Task 9, FR-8.*).
 *
 * Imports the public surface through the barrel (`./index.js` under NodeNext) so the tests bind to
 * the exported contract, not the module internals. Every assertion is pure and offline (NFR-7): the
 * `client` base builds only a request descriptor, so nothing here opens a socket. The bearer token
 * appears in the auth-header value only, never in a key, URL, method, or log (NFR-1).
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import {
  DEFAULT_TIMEOUT_MS,
  buildApiRequest,
  buildAuthHeader,
  type ApiRequest,
  type InstrumentApiClientOptions,
} from './index.js';

describe('DEFAULT_TIMEOUT_MS (FR-8, FR-8.1)', () => {
  it('is exactly 10_000 milliseconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});

describe('InstrumentApiClientOptions / ApiRequest shapes (FR-8.2)', () => {
  it('InstrumentApiClientOptions has the documented shape (compile-time)', () => {
    expectTypeOf<InstrumentApiClientOptions>().toEqualTypeOf<{
      baseUrl: string;
      bearerToken: string;
      timeoutMs?: number;
    }>();
  });

  it('ApiRequest has the documented shape (compile-time)', () => {
    expectTypeOf<ApiRequest>().toEqualTypeOf<{
      method: string;
      url: string;
      headers: Record<string, string>;
      timeoutMs: number;
    }>();
  });

  it('buildApiRequest returns an ApiRequest (compile-time)', () => {
    expectTypeOf(buildApiRequest).returns.toEqualTypeOf<ApiRequest>();
  });

  it('the interfaces accept a conformant value at runtime', () => {
    // Typed as the interface (not narrowed via `satisfies`) so the optional
    // `timeoutMs` member is reachable — omitted in one value, supplied in the other.
    const minimal: InstrumentApiClientOptions = {
      baseUrl: 'https://h',
      bearerToken: 't',
    };
    const withTimeout: InstrumentApiClientOptions = {
      baseUrl: 'https://h',
      bearerToken: 't',
      timeoutMs: 500,
    };

    expect(minimal.timeoutMs).toBeUndefined();
    expect(withTimeout.timeoutMs).toBe(500);
  });
});

describe('buildAuthHeader (FR-8.3, NFR-1)', () => {
  it('returns { Authorization: "Bearer " + token }', () => {
    const header = buildAuthHeader('abc123');
    expect(header).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('keeps the token in the header value only — never a key', () => {
    const token = 'super-secret-token-value'; // pragma: allowlist secret
    const header = buildAuthHeader(token);

    expect(Object.keys(header)).toEqual(['Authorization']);
    expect(header.Authorization).toBe(`Bearer ${token}`);
    // The token never leaks into a header key.
    expect(Object.keys(header).some((k) => k.includes(token))).toBe(false);
  });

  it('emits "Bearer " with an empty value for an empty-string token', () => {
    // No validation in client.ts: the empty token flows straight into the value.
    const header = buildAuthHeader('');
    expect(header).toEqual({ Authorization: 'Bearer ' });
  });
});

describe('buildApiRequest (FR-8.4)', () => {
  const options: InstrumentApiClientOptions = {
    baseUrl: 'https://h',
    bearerToken: 'tok',
  };

  it('carries the method, the FR-8.3 auth header, and a URL', () => {
    const req = buildApiRequest(options, 'POST', 'measure');

    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(req.headers).toEqual(buildAuthHeader(options.bearerToken));
    expect(req.url).toBe('https://h/measure');
  });

  it('resolves timeoutMs from options.timeoutMs when supplied', () => {
    const req = buildApiRequest(
      { ...options, timeoutMs: 250 },
      'GET',
      'healthz',
    );
    expect(req.timeoutMs).toBe(250);
  });

  it('falls back to DEFAULT_TIMEOUT_MS when options.timeoutMs is omitted', () => {
    const req = buildApiRequest(options, 'GET', 'healthz');
    expect(req.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(req.timeoutMs).toBe(10_000);
  });

  it('keeps a supplied timeoutMs of 0 (?? preserves 0, unlike ||)', () => {
    // `0 ?? DEFAULT` === 0: an explicit 0 is a supplied value, not a nullish gap.
    const req = buildApiRequest({ ...options, timeoutMs: 0 }, 'GET', 'healthz');
    expect(req.timeoutMs).toBe(0);
  });

  it('passes the method through verbatim, preserving case', () => {
    const req = buildApiRequest(options, 'patch', 'measure');
    expect(req.method).toBe('patch');
  });

  it('is a pure return — a plain descriptor object, no socket, no Promise', () => {
    const req = buildApiRequest(options, 'GET', 'healthz');

    // A synchronous plain object, never a thenable (no async transport).
    expect(req).not.toBeInstanceOf(Promise);
    expect((req as { then?: unknown }).then).toBeUndefined();
    expect(Object.keys(req).sort()).toEqual([
      'headers',
      'method',
      'timeoutMs',
      'url',
    ]);
    // Deterministic: identical inputs yield an equal descriptor.
    expect(buildApiRequest(options, 'GET', 'healthz')).toEqual(req);
  });

  it('keeps the token in the auth-header value only — not in url or method (NFR-1)', () => {
    const token = 'leak-canary-token'; // pragma: allowlist secret
    const req = buildApiRequest(
      { baseUrl: 'https://h', bearerToken: token },
      'GET',
      'healthz',
    );

    expect(req.url).not.toContain(token);
    expect(req.method).not.toContain(token);
    expect(req.headers.Authorization).toBe(`Bearer ${token}`);
  });
});

describe('buildApiRequest URL join (FR-8.5)', () => {
  const options: InstrumentApiClientOptions = {
    baseUrl: 'https://h',
    bearerToken: 'tok',
  };

  // Observed behavior of client.ts: trailing slashes on baseUrl are stripped
  // (`/\/+$/`), leading slashes on path are stripped (`/^\/+/`), and the two are
  // joined with exactly one separator. All three rows collapse to one URL.
  it.each([
    ['https://h', 'healthz'],
    ['https://h/', '/healthz'],
    ['https://h///', '///healthz'],
  ])('joins (%s, %s) to https://h/healthz', (baseUrl, path) => {
    const req = buildApiRequest({ ...options, baseUrl }, 'GET', path);
    expect(req.url).toBe('https://h/healthz');
  });

  it('preserves a path segment on baseUrl and joins with one separator', () => {
    // `/\/+$/` strips only trailing slashes, so an intermediate `/api` survives.
    const req = buildApiRequest(
      { ...options, baseUrl: 'https://h/api' },
      'GET',
      'v1/x',
    );
    expect(req.url).toBe('https://h/api/v1/x');
  });

  it.each([['', 'empty path'], ['///', 'slashes-only path']])(
    'joins a %s to a single trailing separator (https://h/)',
    (path) => {
      const req = buildApiRequest({ ...options, baseUrl: 'https://h' }, 'GET', path);
      expect(req.url).toBe('https://h/');
    },
  );
});
