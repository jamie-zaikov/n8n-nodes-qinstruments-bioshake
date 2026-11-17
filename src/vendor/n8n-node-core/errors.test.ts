/**
 * Suite for the `errors` module of n8n-node-core (Task 10, FR-9.*).
 *
 * Imports the public surface through the barrel (`./index.js` under NodeNext) so the tests bind to
 * the exported contract, not the module internals. Every assertion is pure and offline (NFR-7).
 * A credential value never appears in an error's message or fields: the shared hierarchy carries a
 * safe message and a numeric status only, never an `Authorization` header or a token (NFR-1).
 */
import { describe, it, expect } from 'vitest';

import { InstrumentApiError, NodeCoreError } from './index.js';

describe('NodeCoreError (FR-9, FR-9.1)', () => {
  it('extends Error', () => {
    const err = new NodeCoreError('boom');
    expect(err).toBeInstanceOf(NodeCoreError);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the message passed to the constructor', () => {
    const err = new NodeCoreError('a safe diagnostic message');
    expect(err.message).toBe('a safe diagnostic message');
  });

  it('sets name === "NodeCoreError"', () => {
    const err = new NodeCoreError('boom');
    expect(err.name).toBe('NodeCoreError');
  });

  it('is throwable and catchable as an Error', () => {
    expect(() => {
      throw new NodeCoreError('boom');
    }).toThrow(Error);
    expect(() => {
      throw new NodeCoreError('boom');
    }).toThrow('boom');
  });
});

describe('InstrumentApiError (FR-9, FR-9.2)', () => {
  it('extends NodeCoreError, and the instanceof chain reaches Error', () => {
    const err = new InstrumentApiError(503, 'service unavailable');
    expect(err).toBeInstanceOf(InstrumentApiError);
    expect(err).toBeInstanceOf(NodeCoreError);
    expect(err).toBeInstanceOf(Error);
  });

  it('sets name === "InstrumentApiError"', () => {
    const err = new InstrumentApiError(500, 'internal error');
    expect(err.name).toBe('InstrumentApiError');
  });

  it('preserves the message and exposes the numeric statusCode', () => {
    const err = new InstrumentApiError(404, 'not found');
    expect(err.message).toBe('not found');
    expect(err.statusCode).toBe(404);
    expect(typeof err.statusCode).toBe('number');
  });

  it('exposes statusCode as a readonly field (compile-time guarantee)', () => {
    const err = new InstrumentApiError(429, 'too many requests');
    // A write to `statusCode` is a tsc error: the field is declared `readonly`.
    // The `@ts-expect-error` assertion fails the strict build if the write ever
    // becomes legal, so readonly is verified at compile time (NFR-5).
    // @ts-expect-error statusCode is readonly and must not be assignable.
    err.statusCode = 500;
    // `readonly` is a compile-time-only guarantee (proven by the `@ts-expect-error`
    // on the write above); at runtime the write succeeds, so the field now holds the
    // written value, which is exactly what this assertion reads back.
    expect(err.statusCode).toBe(500);
  });
});

describe('Error subclassing correctness (FR-9.1, FR-9.2)', () => {
  it('a NodeCoreError has a stack — the Error super() ran and name applied', () => {
    const err = new NodeCoreError('boom');
    // A defined stack proves `super(message)` was called: a missing super() in an
    // Error subclass yields an error with no stack. The name on the first stack
    // line confirms `this.name` is set on the instance, not lost.
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('NodeCoreError');
  });

  it('an InstrumentApiError has a stack — the Error super() chain ran and name applied', () => {
    const err = new InstrumentApiError(500, 'internal error');
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('InstrumentApiError');
  });

  it('a thrown InstrumentApiError is caught as its own type and its bases, fields intact', () => {
    // A real throw/catch (not just a constructed instance) confirms the instance
    // survives the throw boundary as its own type and every base, and that both
    // the message and the numeric statusCode are retained unchanged.
    let caught: unknown;
    try {
      throw new InstrumentApiError(502, 'bad gateway');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InstrumentApiError);
    expect(caught).toBeInstanceOf(NodeCoreError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as InstrumentApiError).statusCode).toBe(502);
    expect((caught as InstrumentApiError).message).toBe('bad gateway');
  });
});

describe('error message/field hygiene (FR-9.3, NFR-1)', () => {
  it('a NodeCoreError carries no Authorization field and no credential field', () => {
    const err = new NodeCoreError('a safe message');
    expect((err as { Authorization?: unknown }).Authorization).toBeUndefined();
    expect((err as { authorization?: unknown }).authorization).toBeUndefined();
    // The class adds no own field of its own (`name` is set on Error itself).
    expect(Object.keys(err)).toEqual(['name']);
  });

  it('an InstrumentApiError exposes only statusCode as its own added field — no credential field', () => {
    const err = new InstrumentApiError(401, 'unauthorized');
    // `name` is the Error-level field; `statusCode` is the only field this
    // class adds. No credential-shaped field is present.
    expect(Object.keys(err).sort()).toEqual(['name', 'statusCode']);
    expect((err as { Authorization?: unknown }).Authorization).toBeUndefined();
    expect((err as { bearerToken?: unknown }).bearerToken).toBeUndefined();
    expect((err as { token?: unknown }).token).toBeUndefined();
  });

  it('a token-shaped message string still exposes no Authorization header or credential field', () => {
    // Even when the caller embeds a bearer-shaped string in the message, the
    // error carries no `Authorization` header and adds no credential field. The
    // message is the caller's literal; the class never derives a header from it.
    const tokenShaped = 'Authorization: Bearer sk-secret-abc123'; // pragma: allowlist secret
    const err = new InstrumentApiError(403, tokenShaped);

    // No `Authorization` field materializes from the message content.
    expect((err as { Authorization?: unknown }).Authorization).toBeUndefined();
    // The only field this class adds is the numeric status; nothing
    // credential-like is added from parsing the message.
    expect(Object.keys(err).sort()).toEqual(['name', 'statusCode']);
    expect(err.statusCode).toBe(403);
    // The message is preserved verbatim — the class does not parse or reshape it.
    expect(err.message).toBe(tokenShaped);
  });
});
