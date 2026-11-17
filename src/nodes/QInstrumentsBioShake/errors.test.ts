/**
 * Suite for the QInstruments BioShake node error mapping (Task 23, FR-18.5, FR-18.6, NFR-1,
 * design C16 errors).
 *
 * Pure and offline: errors are constructed directly, or produced by the transport with a fake
 * `requestFn`; no socket is opened. The token is a short placeholder and must never appear in a
 * mapped message or in any property of a mapped error.
 */
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';

import { NodeOperationError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
  errorMessageOf,
  formatApiErrorMessage,
  formatTransportErrorMessage,
  redact,
  toNodeOperationError,
} from './errors';
import {
  QInstrumentsBioShakeApiError,
  QInstrumentsBioShakeTransportError,
  sendQInstrumentsBioShakeRequest,
  type HttpsRequestFn,
} from './transport';

const TOK = 'test-tok';

const NODE: INode = {
  id: 'n1',
  name: 'QInstruments BioShake',
  type: 'n8n-nodes-qinstruments-bioshake.qInstrumentsBioShake',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/**
 * Every API error kind and its fixed HTTP status, copied from STATUS_BY_KIND in
 * `api/qinstruments_bioshake_api/http/errors.py` (design C13 table).
 */
const STATUS_BY_KIND: readonly (readonly [string, number])[] = [
  ['unauthorized', 401],
  ['not_found', 404],
  ['validation_error', 422],
  ['device_released', 409],
  ['family_not_permitted', 409],
  ['gate_refused', 409],
  ['invalid_state', 409],
  ['stop_not_delivered', 409],
  ['command_unsupported', 501],
  ['device_error', 502],
  ['stop_all_failed', 502],
  ['reconnect_stop_failed', 502],
  ['device_not_connected', 503],
  ['device_busy', 503],
  ['service_stopping', 503],
  ['transport_error', 504],
  ['state_persist_failed', 500],
  ['internal_error', 500],
];

/** The unified API error body: every key present, `null` when unused (design C13). */
function body(fields: Record<string, unknown>): unknown {
  return {
    error: {
      kind: null,
      message: null,
      command: null,
      device_reply: null,
      failure: null,
      reply_class: null,
      attempts: null,
      state: null,
      effective_limits: null,
      gate: null,
      observed_state: null,
      outcomes: null,
      completed: null,
      ...fields,
    },
  };
}

/** Walk every own property (enumerable or not) of `value`, recursively, and collect strings. */
function deepStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return [String(value)];
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out: string[] = [];
  for (const key of Reflect.ownKeys(value as object)) {
    out.push(String(key));
    let child: unknown;
    try {
      child = (value as Record<string | symbol, unknown>)[key];
    } catch {
      continue;
    }
    out.push(...deepStrings(child, seen));
  }
  return out;
}

function expectNoToken(error: Error): void {
  expect(error.message).not.toContain(TOK);
  expect(String(error.stack)).not.toContain(TOK);
  expect(JSON.stringify(error)).not.toContain(TOK);
  const offenders = deepStrings(error).filter((s) => s.includes(TOK));
  expect(offenders).toEqual([]);
}

describe('API error message per kind (FR-18.5)', () => {
  it('test_fr18_5_the_kind_table_has_the_18_api_kinds', () => {
    expect(STATUS_BY_KIND).toHaveLength(18);
    expect(new Set(STATUS_BY_KIND.map(([kind]) => kind)).size).toBe(18);
  });

  it.each(STATUS_BY_KIND.filter(([kind]) => kind !== 'stop_not_delivered'))(
    'test_fr18_5_kind_%s_maps_to_status_kind_and_message',
    (kind, status) => {
      const message = formatApiErrorMessage(status, body({ kind, message: `Message of ${kind}` }));
      expect(message).toBe(`QInstruments BioShake API ${status} ${kind}: Message of ${kind}`);
    },
  );

  it.each(STATUS_BY_KIND)('test_fr18_5_kind_%s_maps_through_the_node_error', (kind, status) => {
    const error = toNodeOperationError(
      NODE,
      new QInstrumentsBioShakeApiError(status, body({ kind, message: 'Stop was NOT delivered: m' })),
      0,
      [TOK],
    );
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toBe(`QInstruments BioShake API ${status} ${kind}: Stop was NOT delivered: m`);
  });

  it('test_fr18_5_device_reply_suffix_for_command_unsupported', () => {
    const message = formatApiErrorMessage(
      501,
      body({ kind: 'command_unsupported', message: 'Device does not support the command', device_reply: 'u ssts' }),
    );
    expect(message).toBe(
      'QInstruments BioShake API 501 command_unsupported: Device does not support the command; device reply: u ssts',
    );
  });

  it('test_fr18_5_device_reply_suffix_for_device_error', () => {
    const message = formatApiErrorMessage(
      502,
      body({ kind: 'device_error', message: 'Device rejected the command', device_reply: 'e' }),
    );
    expect(message).toBe('QInstruments BioShake API 502 device_error: Device rejected the command; device reply: e');
  });

  it.each(['no_reply', 'parse', 'unexpected_reply'])(
    'test_fr18_5_transport_failure_suffix_%s',
    (failure) => {
      const message = formatApiErrorMessage(504, body({ kind: 'transport_error', message: 'No usable reply', failure }));
      expect(message).toBe(`QInstruments BioShake API 504 transport_error: No usable reply; transport failure ${failure}`);
    },
  );

  it('test_fr18_5_device_reply_takes_precedence_over_failure', () => {
    const message = formatApiErrorMessage(502, body({ kind: 'device_error', message: 'm', device_reply: 'r', failure: 'f' }));
    expect(message).toBe('QInstruments BioShake API 502 device_error: m; device reply: r');
    expect(message).not.toContain('transport failure');
  });

  it('test_fr18_5_unknown_or_malformed_kind_becomes_unknown_error', () => {
    expect(formatApiErrorMessage(500, body({ message: 'x' }))).toBe('QInstruments BioShake API 500 unknown_error: x');
    expect(formatApiErrorMessage(500, body({ kind: 'Bad Kind!', message: 'x' }))).toBe(
      'QInstruments BioShake API 500 unknown_error: x',
    );
    expect(formatApiErrorMessage(500, body({ kind: 12, message: 'x' }))).toBe(
      'QInstruments BioShake API 500 unknown_error: x',
    );
  });

  it('test_fr18_5_missing_or_non_json_body_still_gives_status', () => {
    expect(formatApiErrorMessage(503, null)).toBe('QInstruments BioShake API 503 unknown_error: no error message');
    expect(formatApiErrorMessage(503, 'text')).toBe('QInstruments BioShake API 503 unknown_error: no error message');
    expect(formatApiErrorMessage(503, { error: 'flat' })).toBe(
      'QInstruments BioShake API 503 unknown_error: no error message',
    );
    expect(formatApiErrorMessage(502, body({ kind: 'device_error' }))).toBe(
      'QInstruments BioShake API 502 device_error: no error message',
    );
  });

  it('test_fr18_5_control_characters_are_stripped_and_fields_capped', () => {
    const message = formatApiErrorMessage(
      500,
      body({ kind: 'internal_error', message: `line1\n\r\u0007line2${'x'.repeat(1000)}` }),
    );
    // eslint-disable-next-line no-control-regex
    expect(message).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(message).toContain('line1 line2');
    expect(message.length).toBeLessThan(400);
    expect(message.endsWith('...')).toBe(true);
  });

  it('test_fr18_5_only_body_error_fields_are_used', () => {
    const message = formatApiErrorMessage(401, {
      error: { kind: 'unauthorized', message: 'Missing or invalid bearer token' },
      headers: { Authorization: `Bearer ${TOK}` },
      token: TOK,
    });
    expect(message).toBe('QInstruments BioShake API 401 unauthorized: Missing or invalid bearer token');
    expect(message).not.toContain(TOK);
  });
});

describe('stop not delivered (FR-18.6)', () => {
  it('test_fr18_6_409_stop_not_delivered_keeps_the_api_message', () => {
    const message = formatApiErrorMessage(
      409,
      body({ kind: 'stop_not_delivered', message: 'Stop was NOT delivered: the device is released' }),
    );
    expect(message).toBe(
      'QInstruments BioShake API 409 stop_not_delivered: Stop was NOT delivered: the device is released',
    );
  });

  it('test_fr18_6_not_delivered_is_stated_even_if_the_body_lacks_it', () => {
    for (const raw of [
      body({ kind: 'stop_not_delivered', message: 'port cannot be opened' }),
      body({ kind: 'stop_not_delivered' }),
    ]) {
      const message = formatApiErrorMessage(409, raw);
      expect(message).toContain('409');
      expect(message).toContain('stop_not_delivered');
      expect(message).toContain('NOT delivered');
    }
  });

  it('test_fr18_6_node_error_for_409_contains_not_delivered', () => {
    const error = toNodeOperationError(
      NODE,
      new QInstrumentsBioShakeApiError(409, body({ kind: 'stop_not_delivered', message: 'Stop was NOT delivered' })),
      0,
      [TOK],
    );
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toContain('NOT delivered');
    expect(error.message).toContain('409');
  });

  it('test_fr18_6_409_from_the_transport_maps_to_not_delivered', async () => {
    const raw = await apiErrorFromTransport(
      409,
      body({ kind: 'stop_not_delivered', message: 'Stop was NOT delivered: port cannot be opened' }),
    );
    const error = toNodeOperationError(NODE, raw, 0, [TOK]);
    expect(error.message).toBe(
      'QInstruments BioShake API 409 stop_not_delivered: Stop was NOT delivered: port cannot be opened',
    );
    expectNoToken(error);
  });
});

describe('transport and other errors (FR-18.5)', () => {
  it('test_fr18_5_transport_failure_message_carries_reason', () => {
    const error = new QInstrumentsBioShakeTransportError(
      'request_failed',
      'QInstruments BioShake API request failed',
      'ECONNREFUSED',
    );
    expect(formatTransportErrorMessage(error)).toBe(
      'QInstruments BioShake API request failed (request_failed): QInstruments BioShake API request failed (ECONNREFUSED)',
    );
    expect(errorMessageOf(error)).toBe(formatTransportErrorMessage(error));
  });

  it('test_fr18_5_unexpected_errors_get_a_fixed_message', () => {
    expect(errorMessageOf(new Error(`boom ${TOK}`))).toBe(
      'QInstruments BioShake operation failed with an unexpected error',
    );
    expect(errorMessageOf('string')).toBe('QInstruments BioShake operation failed with an unexpected error');
    expect(errorMessageOf(undefined)).toBe('QInstruments BioShake operation failed with an unexpected error');
  });

  it('test_fr18_5_api_error_maps_through_error_message_of', () => {
    const error = new QInstrumentsBioShakeApiError(502, body({ kind: 'device_error', message: 'm', device_reply: 'e' }));
    expect(errorMessageOf(error)).toBe('QInstruments BioShake API 502 device_error: m; device reply: e');
  });
});

/** Run one request through the transport against a fake HTTPS layer that answers `status`. */
async function apiErrorFromTransport(status: number, responseBody: unknown): Promise<unknown> {
  const requestFn: HttpsRequestFn = (_url, _options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.destroy = () => undefined;
    req.end = () => {
      setImmediate(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode?: number };
        res.statusCode = status;
        callback(res as unknown as IncomingMessage);
        res.emit('data', JSON.stringify(responseBody));
        res.emit('end');
      });
    };
    return req as unknown as ClientRequest;
  };
  try {
    await sendQInstrumentsBioShakeRequest(
      { baseUrl: 'https://bioshake.example:8744', token: TOK },
      { method: 'POST', path: 'v1/shake/stop' },
      { requestFn },
    );
  } catch (error) {
    return error;
  }
  throw new Error('expected the request to reject');
}

describe('the token never reaches a message or property (FR-18.5, NFR-1)', () => {
  it('test_nfr1_redact_replaces_every_occurrence', () => {
    expect(redact(`a ${TOK} b ${TOK}`, [TOK])).toBe('a [redacted] b [redacted]');
    expect(redact('nothing', [TOK, undefined, ''])).toBe('nothing');
    expect(redact('x', [])).toBe('x');
  });

  it.each(STATUS_BY_KIND)('test_nfr1_kind_%s_from_the_transport_has_no_token_anywhere', async (kind, status) => {
    const text = kind === 'stop_not_delivered' ? 'Stop was NOT delivered' : `Message of ${kind}`;
    const raw = await apiErrorFromTransport(status, body({ kind, message: text, device_reply: 'r' }));
    expect(raw).toBeInstanceOf(QInstrumentsBioShakeApiError);
    expectNoToken(raw as Error);
    // Without a redaction list too: the mapper never reads the request, so the token is absent.
    for (const error of [toNodeOperationError(NODE, raw, 1), toNodeOperationError(NODE, raw, 1, [TOK])]) {
      expect(error.message).toBe(`QInstruments BioShake API ${status} ${kind}: ${text}; device reply: r`);
      expect(error.context.itemIndex).toBe(1);
      expectNoToken(error);
    }
  });

  it('test_nfr1_node_error_redacts_a_token_echoed_in_the_body', () => {
    const errors: unknown[] = [
      new QInstrumentsBioShakeApiError(401, body({ kind: 'unauthorized', message: `token ${TOK} is invalid` })),
      new QInstrumentsBioShakeApiError(502, body({ kind: 'device_error', message: 'm', device_reply: TOK })),
      new QInstrumentsBioShakeApiError(504, body({ kind: 'transport_error', message: 'm', failure: TOK })),
      new QInstrumentsBioShakeApiError(409, body({ kind: 'stop_not_delivered', message: `Stop was NOT delivered ${TOK}` })),
      new QInstrumentsBioShakeTransportError('invalid_credentials', `bad ${TOK}`),
      new Error(TOK),
    ];
    for (const raw of errors) {
      const error = toNodeOperationError(NODE, raw, 2, [TOK]);
      expect(error).toBeInstanceOf(NodeOperationError);
      expect(String(error.description ?? '')).not.toContain(TOK);
      expect(error.context.itemIndex).toBe(2);
      expectNoToken(error);
    }
  });

  it('test_nfr1_node_error_does_not_attach_the_original_error', () => {
    const raw = new QInstrumentsBioShakeApiError(500, body({ kind: 'internal_error', message: 'm' }));
    const error = toNodeOperationError(NODE, raw, 0, [TOK]);
    expect(error.cause).not.toBe(raw);
    expect(JSON.stringify(error)).not.toContain('QInstrumentsBioShakeApiError');
    expect(deepStrings(error)).not.toContain('QInstrumentsBioShakeApiError');
  });
});
