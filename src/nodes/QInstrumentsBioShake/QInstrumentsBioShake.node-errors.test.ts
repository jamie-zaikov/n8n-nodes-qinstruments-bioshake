/**
 * Suite for the QInstruments BioShake n8n node class (Task 24, FR-6.2, FR-18, FR-18.3, design C16):
 * error mapping, token redaction and the no-wait / no-polling source checks. The description and
 * execute tests are in `QInstrumentsBioShake.node.test.ts`.
 *
 * Offline: `sendQInstrumentsBioShakeRequest` is replaced by a spy whose default implementation is
 * the real transport with a fake `requestFn` (see `node-test-helpers.ts`), so the node never
 * opens a socket, binds a port or makes a real HTTPS call. The token is a short placeholder.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeOperationError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transport')>();
  return { ...actual, sendQInstrumentsBioShakeRequest: vi.fn() };
});

import { TOK, fake, installFakeTransport, rejected, run, send } from './node-test-helpers';
import { QInstrumentsBioShakeApiError, QInstrumentsBioShakeTransportError } from './transport';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE_FILES = ['operations.ts', 'parameters.ts', 'QInstrumentsBioShake.node.ts'];
const SOURCES = NODE_FILES.map((file) => ({ file, text: readFileSync(path.join(here, file), 'utf8') }));

/** Source text without block and line comments (string contents are kept). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '');
}

/** The text between the `{` that follows `start` and its matching `}`. */
function blockAfter(text: string, start: number): string {
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces');
}

beforeEach(() => {
  installFakeTransport();
});

describe('error mapping (FR-18, Task 23 errors)', () => {
  it('test_fr18_api_error_is_a_node_operation_error_with_status_and_device_reply', async () => {
    fake.responses = [
      {
        status: 502,
        body: JSON.stringify({ error: { kind: 'device_error', message: 'device refused', device_reply: 'e: 3' } }),
      },
    ];
    const error = await rejected(run([{ operation: 'home' }]).promise);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toBe('QInstruments BioShake API 502 device_error: device refused; device reply: e: 3');
    expect((error as NodeOperationError).context.itemIndex).toBe(0);
  });

  it('test_fr18_stop_not_delivered_message_is_kept', async () => {
    send.mockRejectedValue(
      new QInstrumentsBioShakeApiError(409, {
        error: { kind: 'stop_not_delivered', message: 'Stop was NOT delivered: port released' },
      }),
    );
    for (const operation of ['stopShaking', 'stopAll', 'stopTemperatureControl'] as const) {
      const error = await rejected(run([{ operation }]).promise);
      expect(error).toBeInstanceOf(NodeOperationError);
      expect(error.message).toContain('409');
      expect(error.message).toContain('Stop was NOT delivered');
    }
  });

  it('test_fr18_transport_failure_is_mapped', async () => {
    send.mockRejectedValue(
      new QInstrumentsBioShakeTransportError('timeout', 'QInstruments BioShake API request timed out after 5 ms'),
    );
    const error = await rejected(run([{ operation: 'getStatus' }]).promise);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toBe(
      'QInstruments BioShake API request failed (timeout): QInstruments BioShake API request timed out after 5 ms',
    );
  });

  it('test_fr18_bad_parameter_is_a_node_error_without_a_request', async () => {
    const error = await rejected(run([{ operation: 'setShakeSpeed', rpm: 1.5 }]).promise);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toBe('QInstruments BioShake parameter error: Parameter rpm must be an integer');
    expect(send).not.toHaveBeenCalled();
  });

  it('test_fr6_2_unknown_operation_is_refused_without_a_request', async () => {
    for (const operation of ['sendCommand', 'rawCommand', 'resetDevice']) {
      const error = await rejected(run([{ operation }]).promise);
      expect(error).toBeInstanceOf(NodeOperationError);
      expect(error.message).toContain('Unknown QInstruments BioShake operation');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('test_fr18_without_continue_on_fail_the_first_error_stops_execution', async () => {
    send.mockRejectedValueOnce(new QInstrumentsBioShakeTransportError('request_failed', 'request failed'));
    const error = await rejected(run([{ operation: 'getStatus' }, { operation: 'getStatus' }]).promise);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect((error as NodeOperationError).context.itemIndex).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('test_fr18_error_on_a_later_item_carries_its_item_index', async () => {
    send.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new QInstrumentsBioShakeApiError(503, null));
    const error = await rejected(run([{ operation: 'getStatus' }, { operation: 'connect' }]).promise);
    expect((error as NodeOperationError).context.itemIndex).toBe(1);
    expect(error.message).toContain('503');
  });

  it('test_fr18_continue_on_fail_gives_an_error_item_and_continues', async () => {
    send
      .mockRejectedValueOnce(
        new QInstrumentsBioShakeApiError(409, {
          error: { kind: 'stop_not_delivered', message: 'Stop was NOT delivered' },
        }),
      )
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new QInstrumentsBioShakeTransportError('timeout', 'timed out'));
    const result = await run([{ operation: 'stopAll' }, { operation: 'getStatus' }, { operation: 'home' }], {
      continueOnFail: true,
    }).promise;
    expect(send).toHaveBeenCalledTimes(3);
    expect(result).toEqual([
      [
        {
          json: { error: 'QInstruments BioShake API 409 stop_not_delivered: Stop was NOT delivered' },
          pairedItem: { item: 0 },
        },
        { json: { ok: true }, pairedItem: { item: 1 } },
        {
          json: { error: 'QInstruments BioShake API request failed (timeout): timed out' },
          pairedItem: { item: 2 },
        },
      ],
    ]);
  });

  it('test_fr18_continue_on_fail_covers_a_parameter_error', async () => {
    const result = await run([{ operation: 'setTargetTemperature', temperature_c: Number.NaN }], {
      continueOnFail: true,
    }).promise;
    expect(send).not.toHaveBeenCalled();
    expect(result[0]![0]!.json.error).toContain('temperature_c');
  });
});

describe('token redaction (FR-18, Task 23 errors)', () => {
  const failures = (): unknown[] => [
    new QInstrumentsBioShakeApiError(401, { error: { kind: 'unauthorized', message: `bad token ${TOK}` } }),
    new QInstrumentsBioShakeApiError(502, { error: { kind: 'device_error', message: 'm', device_reply: TOK } }),
    new QInstrumentsBioShakeApiError(504, { error: { kind: 'device_timeout', message: 'm', failure: TOK } }),
    new QInstrumentsBioShakeTransportError('invalid_credentials', `token ${TOK}`),
    new Error(`unexpected ${TOK}`),
  ];

  it('test_fr18_token_never_appears_in_a_thrown_error', async () => {
    for (const failure of failures()) {
      send.mockRejectedValueOnce(failure);
      const error = await rejected(run([{ operation: 'getStatus' }]).promise);
      expect(error).toBeInstanceOf(NodeOperationError);
      expect(error.message).not.toContain(TOK);
      expect(JSON.stringify(error)).not.toContain(TOK);
      expect(String(error.stack)).not.toContain(TOK);
      expect(String((error as NodeOperationError).description ?? '')).not.toContain(TOK);
    }
  });

  it('test_fr18_token_in_api_body_is_redacted_on_the_real_wire_path', async () => {
    fake.responses = [{ status: 401, body: JSON.stringify({ error: { kind: 'unauthorized', message: `got ${TOK}` } }) }];
    const error = await rejected(run([{ operation: 'getStatus' }]).promise);
    expect(error.message).toContain('401');
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain(TOK);
  });

  it('test_fr18_token_never_appears_in_continue_on_fail_output', async () => {
    for (const failure of failures()) {
      send.mockRejectedValueOnce(failure);
      const items = await run([{ operation: 'getStatus' }], { continueOnFail: true }).promise;
      expect(JSON.stringify(items)).not.toContain(TOK);
    }
  });

  it('test_fr18_successful_output_does_not_carry_the_token_or_headers', async () => {
    const items = await run([{ operation: 'getStatus' }, { operation: 'stopAll' }]).promise;
    const text = JSON.stringify(items);
    expect(text).not.toContain(TOK);
    expect(text).not.toMatch(/authorization|bearer/i);
  });
});

describe('no wait, timer or polling loop in the node files (FR-18.3)', () => {
  it('test_fr18_3_node_files_have_no_timer_sleep_or_while_loop', () => {
    for (const { file, text } of SOURCES) {
      const body = code(text);
      expect(body, file).not.toMatch(/setTimeout|setInterval|setImmediate|\bsleep\b|\bdelay\s*\(/);
      expect(body, file).not.toMatch(/\bwhile\s*\(/);
      expect(body, file).not.toMatch(/\bdo\s*\{/);
      expect(body, file).not.toMatch(/\bfor\s+await\b|\.forEach\s*\(|node:timers/);
    }
  });

  it('test_fr18_3_only_for_loop_is_the_per_item_loop_with_one_transport_call', () => {
    const loops = SOURCES.flatMap(({ file, text }) =>
      [...code(text).matchAll(/\bfor\s*\(/g)].map((m) => ({ file, index: m.index! })),
    );
    expect(loops).toHaveLength(1);
    expect(loops[0]!.file).toBe('QInstrumentsBioShake.node.ts');
    const nodeCode = code(SOURCES.find((s) => s.file === 'QInstrumentsBioShake.node.ts')!.text);
    const header = nodeCode.slice(loops[0]!.index, nodeCode.indexOf('{', loops[0]!.index));
    expect(header).toMatch(/for\s*\(\s*let\s+itemIndex\s*=\s*0\s*;\s*itemIndex\s*<\s*items\.length\s*;\s*itemIndex\+\+\s*\)/);
    const body = blockAfter(nodeCode, loops[0]!.index);
    expect(body.match(/sendQInstrumentsBioShakeRequest\s*\(/g)).toHaveLength(1);
    // The loop body never re-enters the loop (no `itemIndex--`, no assignment to `itemIndex`).
    expect(body).not.toMatch(/itemIndex\s*(--|-=|\+=|=(?!=))/);
  });

  it('test_fr18_3_the_transport_is_called_in_exactly_one_place', () => {
    const calls = SOURCES.flatMap(({ file, text }) =>
      [...code(text).matchAll(/sendQInstrumentsBioShakeRequest\s*\(/g)].map(() => file),
    );
    expect(calls).toEqual(['QInstrumentsBioShake.node.ts']);
  });

  it('test_fr18_3_source_check_detects_a_forbidden_construct', () => {
    // Guard the guard: the stripping keeps code, so a real timer or loop would be seen.
    expect(code('const a = 1; // setTimeout\n/* while (x) */ setTimeout(f, 1);')).toMatch(/setTimeout\(/);
    expect(code('// while (true) {}\n')).not.toMatch(/while/);
    expect(code('do { x++ } while (x < 3);')).toMatch(/\bdo\s*\{/);
  });
});
