/**
 * Suite for the `already_stopped` stop outcome in the QInstruments BioShake node (Task 37,
 * Amendment A4; FR-18.8, FR-18.5, FR-18.3; design C16 A4, C13 examples).
 *
 * An HTTP 200 `already_stopped` reply to Stop Shaking or Stop All is output data, never a node
 * error; a 502 `device_error` / `stop_all_failed` body that carries a `confirmation` still raises.
 * Offline: the mocked transport of `node-test-helpers.ts` (real transport, fake `requestFn`), so
 * no socket is opened. The token is a short placeholder.
 */
import { NodeOperationError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transport')>();
  return { ...actual, sendQInstrumentsBioShakeRequest: vi.fn() };
});

import { TOK, fake, installFakeTransport, rejected, run, send } from './node-test-helpers';

const CONFIRMATION_3 = {
  shake_state: { raw: '3', code: 3, name: 'stopped_locked_home' },
  shake_state_failure: null,
  error_list: { raw: '{}', entries: [] },
  error_list_failure: null,
};

const CONFIRMATION_9 = { ...CONFIRMATION_3, shake_state: { raw: '9', code: 9, name: 'stopped_not_locked' } };

/** C13 example: `POST /v1/shake/stop` with the device idle at home (F2). */
const STOP_ALREADY_STOPPED = {
  outcome: 'already_stopped',
  device_reply: 'e',
  confirmation: CONFIRMATION_3,
  deceleration: null,
  released: false,
};

/** C13 example: stop-all with the idle device (rows `already_stopped` and `stopped`). */
const STOP_ALL_ALREADY_STOPPED = {
  outcomes: [
    { command: 'shakeOff', outcome: 'already_stopped', failure: null, reply_class: 'error', device_reply: 'e', confirmation: CONFIRMATION_3 },
    { command: 'tempOff', outcome: 'stopped', failure: null, reply_class: null, device_reply: null, confirmation: null },
  ],
  released: false,
};

const NULL_ERROR_FIELDS = {
  state: null, effective_limits: null, gate: null, observed_state: null, outcomes: null, completed: null,
};

/** C13 example: the same stop request with shake state `9` (FR-10.12) -> HTTP 502. */
const STOP_DEVICE_ERROR = {
  error: {
    kind: 'device_error', message: 'device replied with an error to shakeOff', command: 'shakeOff',
    device_reply: 'e', failure: 'device_error', reply_class: 'error', attempts: 1,
    ...NULL_ERROR_FIELDS, confirmation: CONFIRMATION_9,
  },
};

/** Stop-all whose shakeOff row was not confirmed (shake state `9`) -> HTTP 502 `stop_all_failed`. */
const STOP_ALL_FAILED = {
  error: {
    kind: 'stop_all_failed', message: 'stop-all failed: shakeOff', command: null, device_reply: null,
    failure: null, reply_class: null, attempts: null, ...NULL_ERROR_FIELDS, confirmation: null,
    outcomes: [
      { command: 'shakeOff', outcome: 'failed', failure: 'device_error', reply_class: 'error', device_reply: 'e', confirmation: CONFIRMATION_9 },
      { command: 'tempOff', outcome: 'stopped', failure: null, reply_class: null, device_reply: null, confirmation: null },
    ],
  },
};

beforeEach(() => {
  installFakeTransport();
});

describe('already_stopped is output data (FR-18.8, FR-18.3)', () => {
  it.each([
    ['stopShaking', '/v1/shake/stop', STOP_ALREADY_STOPPED],
    ['stopAll', '/v1/stop-all', STOP_ALL_ALREADY_STOPPED],
  ] as const)('test_fr18_8_%s_200_already_stopped_gives_one_item_equal_to_the_body', async (operation, path, body) => {
    fake.responses = [{ status: 200, body: JSON.stringify(body) }];
    const result = await run([{ operation }]).promise;
    expect(result).toEqual([[{ json: body, pairedItem: { item: 0 } }]]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(fake.wire).toHaveLength(1);
    expect(fake.wire[0]!.options.method).toBe('POST');
    expect(fake.wire[0]!.url.pathname).toBe(path);
  });

  it('test_fr18_8_stop_shaking_output_outcome_is_already_stopped', async () => {
    fake.responses = [{ status: 200, body: JSON.stringify(STOP_ALREADY_STOPPED) }];
    const result = await run([{ operation: 'stopShaking' }]).promise;
    const json = result[0]![0]!.json as typeof STOP_ALREADY_STOPPED;
    expect(json.outcome).toBe('already_stopped');
    expect(json.device_reply).toBe('e');
    expect(json.confirmation.shake_state.name).toBe('stopped_locked_home');
    expect(json).not.toHaveProperty('error');
  });

  it('test_fr18_8_stop_all_output_rows_keep_already_stopped_and_stopped', async () => {
    fake.responses = [{ status: 200, body: JSON.stringify(STOP_ALL_ALREADY_STOPPED) }];
    const result = await run([{ operation: 'stopAll' }]).promise;
    const json = result[0]![0]!.json as typeof STOP_ALL_ALREADY_STOPPED;
    expect(json.outcomes.map((row) => [row.command, row.outcome])).toEqual([
      ['shakeOff', 'already_stopped'],
      ['tempOff', 'stopped'],
    ]);
    expect(json).not.toHaveProperty('error');
  });

  it('test_fr18_8_already_stopped_items_do_not_stop_later_items', async () => {
    fake.responses = [
      { status: 200, body: JSON.stringify(STOP_ALREADY_STOPPED) },
      { status: 200, body: JSON.stringify(STOP_ALL_ALREADY_STOPPED) },
    ];
    const result = await run([{ operation: 'stopShaking' }, { operation: 'stopAll' }]).promise;
    expect(result[0]!.map((item) => item.json)).toEqual([STOP_ALREADY_STOPPED, STOP_ALL_ALREADY_STOPPED]);
    expect(fake.wire.map((call) => call.url.pathname)).toEqual(['/v1/shake/stop', '/v1/stop-all']);
  });
});

describe('a 502 with a confirmation still raises (FR-18.5)', () => {
  it('test_fr18_5_stop_shaking_502_device_error_with_confirmation_throws', async () => {
    fake.responses = [{ status: 502, body: JSON.stringify(STOP_DEVICE_ERROR) }];
    const error = await rejected(run([{ operation: 'stopShaking' }]).promise);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toBe(
      'QInstruments BioShake API 502 device_error: device replied with an error to shakeOff; device reply: e',
    );
    expect(error.message).toContain('device reply: e');
    expect(error.message).not.toContain(TOK);
    expect(error.message).not.toContain('already_stopped');
    expect((error as NodeOperationError).context.itemIndex).toBe(0);
  });

  it('test_fr18_5_stop_all_502_stop_all_failed_with_confirmation_throws', async () => {
    fake.responses = [{ status: 502, body: JSON.stringify(STOP_ALL_FAILED) }];
    const error = await rejected(run([{ operation: 'stopAll' }]).promise);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toContain('QInstruments BioShake API 502 stop_all_failed');
    expect(error.message).not.toContain(TOK);
  });

  it('test_fr18_5_device_error_with_continue_on_fail_is_an_error_item_not_a_stop', async () => {
    fake.responses = [{ status: 502, body: JSON.stringify(STOP_DEVICE_ERROR) }];
    const result = await run([{ operation: 'stopShaking' }], { continueOnFail: true }).promise;
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    const json = result[0]![0]!.json;
    expect(Object.keys(json)).toEqual(['error']);
    expect(String(json.error)).toContain('502 device_error');
    expect(String(json.error)).not.toContain(TOK);
  });
});
