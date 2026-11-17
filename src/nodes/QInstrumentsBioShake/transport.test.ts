/**
 * Suite for the QInstruments BioShake HTTPS transport (Task 23, FR-1.3, FR-18.1, FR-18.5, NFR-1,
 * design C16, DD-8, P6).
 *
 * Offline: every test injects a fake `requestFn` in place of `node:https.request`, so no socket is
 * opened, no port is bound and no real HTTPS call is made. The token is a short placeholder. Every
 * error is checked for the token, the headers and the request options, which must never be
 * attached.
 */
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InstrumentApiError } from 'n8n-node-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  QInstrumentsBioShakeApiError,
  QInstrumentsBioShakeTransportError,
  sendQInstrumentsBioShakeRequest,
  type HttpsRequestFn,
} from './transport';

const TOK = 'test-tok';
const CREDS = { baseUrl: 'https://bioshake.example:8744/', token: TOK };

type Behaviour =
  | { kind: 'respond'; status: number; chunks?: (string | Buffer)[] }
  | { kind: 'request-error'; error: unknown }
  | { kind: 'response-error'; error: unknown }
  | { kind: 'socket-timeout' }
  | { kind: 'hang' }
  | { kind: 'throw'; error: unknown };

interface Call {
  url: URL;
  options: RequestOptions;
  payload: string | undefined;
  destroyed: boolean;
}

function fake(behaviour: Behaviour): { requestFn: HttpsRequestFn; calls: Call[] } {
  const calls: Call[] = [];
  const requestFn: HttpsRequestFn = (url, options, callback) => {
    if (behaviour.kind === 'throw') throw behaviour.error;
    const call: Call = { url, options, payload: undefined, destroyed: false };
    calls.push(call);
    const req = new EventEmitter() as EventEmitter & { end: (p?: string) => void; destroy: () => void };
    req.destroy = () => {
      call.destroyed = true;
    };
    req.end = (p?: string) => {
      call.payload = p;
      setImmediate(() => {
        if (behaviour.kind === 'request-error') {
          req.emit('error', behaviour.error);
        } else if (behaviour.kind === 'socket-timeout') {
          req.emit('timeout');
        } else if (behaviour.kind === 'respond' || behaviour.kind === 'response-error') {
          const res = new EventEmitter() as EventEmitter & { statusCode?: number };
          res.statusCode = behaviour.kind === 'respond' ? behaviour.status : 200;
          callback(res as unknown as IncomingMessage);
          if (behaviour.kind === 'response-error') {
            res.emit('error', behaviour.error);
            return;
          }
          for (const chunk of behaviour.chunks ?? []) res.emit('data', chunk);
          res.emit('end');
        }
      });
    };
    return req as unknown as ClientRequest;
  };
  return { requestFn, calls };
}

function json(status: number, value: unknown) {
  return fake({ kind: 'respond', status, chunks: [JSON.stringify(value)] });
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the request to reject');
}

/** The error must not carry the token, the headers or the request options anywhere (NFR-1). */
function expectNoLeak(error: Error): void {
  expect(error.message).not.toContain(TOK);
  expect(String(error.stack)).not.toContain(TOK);
  expect(JSON.stringify(error)).not.toContain(TOK);
  for (const key of Object.getOwnPropertyNames(error)) {
    const value = (error as unknown as Record<string, unknown>)[key];
    expect(JSON.stringify(value) ?? '').not.toContain(TOK);
    expect(String(value)).not.toContain(TOK);
  }
  expect(error).not.toHaveProperty('headers');
  expect(error).not.toHaveProperty('options');
  expect(error).not.toHaveProperty('request');
  expect(error).not.toHaveProperty('config');
  expect((error as { cause?: unknown }).cause).toBeUndefined();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('request construction (FR-18.1, DD-8, P6)', () => {
  it('test_fr18_1_sends_bearer_header_to_joined_https_url', async () => {
    const { requestFn, calls } = json(200, { ok: true });
    await sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: '/v1/status' }, { requestFn });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url.href).toBe('https://bioshake.example:8744/v1/status');
    expect(call.url.protocol).toBe('https:');
    expect(call.options.method).toBe('GET');
    const headers = call.options.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOK}`);
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBeUndefined();
    expect(call.payload).toBeUndefined();
  });

  it('test_fr18_1_path_without_leading_slash_and_query_string_is_kept', async () => {
    const { requestFn, calls } = json(200, {});
    await sendQInstrumentsBioShakeRequest(
      { ...CREDS, baseUrl: 'https://bioshake.example:8744' },
      { method: 'GET', path: 'v1/temperature/at-target?tolerance=0.5' },
      { requestFn },
    );
    const url = calls[0]!.url;
    expect(url.pathname).toBe('/v1/temperature/at-target');
    expect(url.searchParams.get('tolerance')).toBe('0.5');
  });

  it.each(['GET', 'POST', 'PUT'] as const)('test_fr18_1_method_%s_is_sent', async (method) => {
    const { requestFn, calls } = json(200, {});
    await sendQInstrumentsBioShakeRequest(CREDS, { method, path: 'v1/x' }, { requestFn });
    expect(calls[0]!.options.method).toBe(method);
  });

  it('test_fr18_1_sends_json_body_with_content_headers', async () => {
    const { requestFn, calls } = json(200, {});
    const body = { rpm: 1200, label: 'ü' };
    await sendQInstrumentsBioShakeRequest(CREDS, { method: 'POST', path: 'v1/shake/start', body }, { requestFn });
    const call = calls[0]!;
    const headers = call.options.headers as Record<string, string>;
    expect(call.options.method).toBe('POST');
    expect(call.payload).toBe(JSON.stringify(body));
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Content-Length']).toBe(String(Buffer.byteLength(JSON.stringify(body))));
  });

  it('test_dd8_always_sets_reject_unauthorized_true', async () => {
    const { requestFn, calls } = json(200, {});
    await sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'health' }, { requestFn });
    expect(calls[0]!.options.rejectUnauthorized).toBe(true);
  });

  it('test_dd8_extra_credential_fields_cannot_disable_verification', async () => {
    const { requestFn, calls } = json(200, {});
    const creds = { ...CREDS, rejectUnauthorized: false, allowUnauthorizedCerts: true, insecure: true };
    await sendQInstrumentsBioShakeRequest(creds, { method: 'GET', path: 'health' }, { requestFn });
    expect(calls[0]!.options.rejectUnauthorized).toBe(true);
    expect(calls[0]!.options).not.toHaveProperty('insecure');
    expect(calls[0]!.options).not.toHaveProperty('allowUnauthorizedCerts');
  });

  it('test_p6_passes_the_trimmed_ca_certificate_when_set', async () => {
    const { requestFn, calls } = json(200, {});
    const ca = 'TEST-CA-PEM-LINE-1\nTEST-CA-PEM-LINE-2';
    await sendQInstrumentsBioShakeRequest(
      { ...CREDS, caCertificate: `\n${ca}\n  ` },
      { method: 'GET', path: 'x' },
      { requestFn },
    );
    expect(calls[0]!.options.ca).toBe(ca);
    expect(calls[0]!.options.rejectUnauthorized).toBe(true);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '  \n\t '],
  ])('test_p6_ca_is_undefined_when_%s', async (_label, caCertificate) => {
    const { requestFn, calls } = json(200, {});
    await sendQInstrumentsBioShakeRequest({ ...CREDS, caCertificate }, { method: 'GET', path: 'x' }, { requestFn });
    expect(calls[0]!.options.ca).toBeUndefined();
    expect(calls[0]!.options.rejectUnauthorized).toBe(true);
  });

  it('test_c16_default_timeout_is_120000_ms', async () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(120_000);
    const { requestFn, calls } = json(200, {});
    await sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn });
    expect(calls[0]!.options.timeout).toBe(120_000);
  });

  it('test_c16_timeout_option_overrides_default', async () => {
    const { requestFn, calls } = json(200, {});
    await sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn, timeoutMs: 5000 });
    expect(calls[0]!.options.timeout).toBe(5000);
  });
});

describe('input validation (FR-1.3, FR-18.1)', () => {
  it.each(['http://bioshake.example:8744', 'ftp://bioshake.example', 'bioshake.example:8744', '', '   '])(
    'test_fr1_3_rejects_non_https_base_url_before_any_request %j',
    async (baseUrl) => {
      const { requestFn, calls } = json(200, {});
      const error = await caught(
        sendQInstrumentsBioShakeRequest({ baseUrl, token: TOK }, { method: 'GET', path: 'x' }, { requestFn }),
      );
      expect(error).toBeInstanceOf(QInstrumentsBioShakeTransportError);
      expect((error as QInstrumentsBioShakeTransportError).reason).toBe('invalid_credentials');
      expect(calls).toHaveLength(0);
      expectNoLeak(error);
    },
  );

  it('test_nfr1_base_url_rejection_does_not_echo_the_value', async () => {
    const { requestFn } = json(200, {});
    const baseUrl = `http://${TOK}@bioshake.example:8744`;
    const error = await caught(
      sendQInstrumentsBioShakeRequest({ baseUrl, token: TOK }, { method: 'GET', path: 'x' }, { requestFn }),
    );
    expect(error.message).not.toContain('bioshake.example');
    expectNoLeak(error);
  });

  it('test_fr18_1_rejects_empty_token_before_any_request', async () => {
    const { requestFn, calls } = json(200, {});
    const error = await caught(
      sendQInstrumentsBioShakeRequest({ ...CREDS, token: '' }, { method: 'GET', path: 'x' }, { requestFn }),
    );
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('invalid_credentials');
    expect(calls).toHaveLength(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('test_c16_rejects_invalid_timeout %s', async (timeoutMs) => {
    const { requestFn, calls } = json(200, {});
    const error = await caught(
      sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn, timeoutMs }),
    );
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('invalid_timeout');
    expect(calls).toHaveLength(0);
  });
});

describe('responses (FR-18.5)', () => {
  it.each([200, 201, 202, 299])('test_fr18_2xx_%s_returns_parsed_json', async (status) => {
    const value = { state: 'connected', shake: { rpm: 0 }, list: [1, 2] };
    const { requestFn } = json(status, value);
    await expect(
      sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }),
    ).resolves.toEqual(value);
  });

  it('test_fr18_2xx_body_split_across_chunks_is_reassembled', async () => {
    const text = JSON.stringify({ name: 'ünïcode', n: 42 });
    const bytes = Buffer.from(text, 'utf8');
    const { requestFn } = fake({ kind: 'respond', status: 200, chunks: [bytes.subarray(0, 11), bytes.subarray(11)] });
    await expect(
      sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }),
    ).resolves.toEqual(JSON.parse(text));
  });

  it('test_fr18_2xx_empty_body_returns_null', async () => {
    const { requestFn } = fake({ kind: 'respond', status: 204, chunks: [] });
    await expect(
      sendQInstrumentsBioShakeRequest(CREDS, { method: 'PUT', path: 'x', body: {} }, { requestFn }),
    ).resolves.toBeNull();
  });

  it.each([401, 404, 409, 422, 500, 501, 502, 503, 504])(
    'test_fr18_5_non_2xx_%s_throws_instrument_api_error_with_status_and_body',
    async (status) => {
      const body = { error: { kind: 'device_error', message: 'rejected', device_reply: 'e', failure: null } };
      const { requestFn } = json(status, body);
      const error = await caught(
        sendQInstrumentsBioShakeRequest(CREDS, { method: 'POST', path: 'x', body: { a: 1 } }, { requestFn }),
      );
      expect(error).toBeInstanceOf(QInstrumentsBioShakeApiError);
      expect(error).toBeInstanceOf(InstrumentApiError);
      expect((error as QInstrumentsBioShakeApiError).statusCode).toBe(status);
      expect((error as QInstrumentsBioShakeApiError).body).toEqual(body);
      expect(error.message).toContain(String(status));
      expectNoLeak(error);
    },
  );

  it('test_fr18_5_non_2xx_with_non_json_body_has_null_body', async () => {
    const { requestFn } = fake({ kind: 'respond', status: 502, chunks: ['<html>bad gateway</html>'] });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect(error).toBeInstanceOf(InstrumentApiError);
    expect((error as QInstrumentsBioShakeApiError).statusCode).toBe(502);
    expect((error as QInstrumentsBioShakeApiError).body).toBeNull();
    expectNoLeak(error);
  });

  it('test_fr18_5_2xx_invalid_json_throws_transport_error', async () => {
    const { requestFn } = fake({ kind: 'respond', status: 200, chunks: ['{not json'] });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect(error).toBeInstanceOf(QInstrumentsBioShakeTransportError);
    expect(error).not.toBeInstanceOf(InstrumentApiError);
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('invalid_json');
    expectNoLeak(error);
  });

  it('test_c16_oversized_response_throws_and_destroys_request', async () => {
    const { requestFn, calls } = fake({
      kind: 'respond',
      status: 200,
      chunks: [Buffer.alloc(MAX_RESPONSE_BYTES, 0x20), Buffer.from('x')],
    });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('response_too_large');
    expect(calls[0]!.destroyed).toBe(true);
    expectNoLeak(error);
  });
});

describe('transport failures carry no secrets (FR-18.5, NFR-1)', () => {
  it('test_nfr1_network_error_keeps_only_the_error_code', async () => {
    const netError = Object.assign(new Error(`connect failed Bearer ${TOK} at bioshake.example`), {
      code: 'ECONNREFUSED',
    });
    const { requestFn } = fake({ kind: 'request-error', error: netError });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect(error).toBeInstanceOf(QInstrumentsBioShakeTransportError);
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('request_failed');
    expect((error as QInstrumentsBioShakeTransportError).code).toBe('ECONNREFUSED');
    expect(error.message).not.toContain('connect failed');
    expectNoLeak(error);
  });

  it('test_nfr1_free_text_error_code_is_dropped', async () => {
    const netError = Object.assign(new Error('boom'), { code: `tok ${TOK}` });
    const { requestFn } = fake({ kind: 'request-error', error: netError });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect((error as QInstrumentsBioShakeTransportError).code).toBeUndefined();
    expectNoLeak(error);
  });

  it('test_dd8_tls_error_is_a_transport_failure', async () => {
    const tlsError = Object.assign(new Error('self signed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    const { requestFn } = fake({ kind: 'request-error', error: tlsError });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('request_failed');
    expect((error as QInstrumentsBioShakeTransportError).code).toBe('SELF_SIGNED_CERT_IN_CHAIN');
    expectNoLeak(error);
  });

  it('test_nfr1_response_stream_error_is_a_transport_failure', async () => {
    const { requestFn } = fake({ kind: 'response-error', error: Object.assign(new Error(TOK), { code: 'ECONNRESET' }) });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('request_failed');
    expectNoLeak(error);
  });

  it('test_nfr1_synchronous_request_throw_is_a_transport_failure', async () => {
    const { requestFn } = fake({ kind: 'throw', error: new TypeError(`Invalid character in header Bearer ${TOK}`) });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('request_failed');
    expectNoLeak(error);
  });

  it('test_c16_socket_timeout_event_rejects_with_timeout', async () => {
    const { requestFn, calls } = fake({ kind: 'socket-timeout' });
    const error = await caught(sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }));
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('timeout');
    expect(calls[0]!.destroyed).toBe(true);
    expectNoLeak(error);
  });

  it('test_c16_whole_request_deadline_rejects_with_timeout', async () => {
    const { requestFn, calls } = fake({ kind: 'hang' });
    const error = await caught(
      sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn, timeoutMs: 20 }),
    );
    expect((error as QInstrumentsBioShakeTransportError).reason).toBe('timeout');
    expect(calls[0]!.destroyed).toBe(true);
    expectNoLeak(error);
  });

  it('test_c16_default_deadline_fires_at_120000_ms', async () => {
    vi.useFakeTimers();
    const { requestFn } = fake({ kind: 'hang' });
    let settled: unknown = 'pending';
    const promise = sendQInstrumentsBioShakeRequest(CREDS, { method: 'GET', path: 'x' }, { requestFn }).catch(
      (e: unknown) => {
        settled = e;
      },
    );
    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBeInstanceOf(QInstrumentsBioShakeTransportError);
    expect((settled as QInstrumentsBioShakeTransportError).reason).toBe('timeout');
  });
});

describe('module boundary (FR-1.3)', () => {
  const thisFile = fileURLToPath(import.meta.url);
  const srcRoot = path.resolve(path.dirname(thisFile), '../..');
  // An import of `api/` code by relative path: `../api`, `../../api/...`, `require('../../../api')`.
  const apiImport =
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:\.\.?\/)*(?:\.\.\/)+(?:api|qinstruments-bioshake\/api)(?:\/[^'"]*)?['"]/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(c|m)?[jt]s$/.test(entry) ? [full] : [];
    });
  }

  it('test_fr1_3_no_source_file_imports_the_api_package', () => {
    const files = sourceFiles(srcRoot);
    expect(files.some((f) => f.endsWith(`${path.sep}transport.ts`))).toBe(true);
    expect(files.some((f) => f.includes(`${path.sep}credentials${path.sep}`))).toBe(true);
    // This suite holds the scan's own fixture strings, so it is the one file not scanned.
    const offenders = files
      .filter((f) => path.resolve(f) !== path.resolve(thisFile))
      .filter((f) => apiImport.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('test_fr1_3_transport_imports_n8n_node_core', () => {
    const transport = readFileSync(path.join(path.dirname(thisFile), 'transport.ts'), 'utf8');
    expect(transport).toMatch(/from 'n8n-node-core'/);
  });

  it('test_fr1_3_scan_pattern_detects_api_imports', () => {
    expect(apiImport.test("import { x } from '../api';")).toBe(true);
    expect(apiImport.test("import x from '../../api/src/app';")).toBe(true);
    expect(apiImport.test("const a = require('../../../api');")).toBe(true);
    expect(apiImport.test("import '../../api';")).toBe(true);
    expect(apiImport.test("import { x } from 'n8n-node-core';")).toBe(false);
    expect(apiImport.test("import { y } from '../../credentials/QInstrumentsBioShakeApi.credentials';")).toBe(false);
  });
});
