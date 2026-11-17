/**
 * Suite for the QInstruments BioShake n8n node class (Task 24, FR-6.2, FR-18, FR-18.2, FR-18.3,
 * design C16): node description and per-item execute. Error mapping, token redaction and the
 * source checks are in `QInstrumentsBioShake.node-errors.test.ts`.
 *
 * Offline: `sendQInstrumentsBioShakeRequest` is replaced by a spy whose default implementation is
 * the real transport with a fake `requestFn` (see `node-test-helpers.ts`), so the node never
 * opens a socket, binds a port or makes a real HTTPS call, while the bearer header is still
 * checked on the wire. The n8n execute context is a small fake. The token is a short placeholder.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INodeProperties } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transport')>();
  return { ...actual, sendQInstrumentsBioShakeRequest: vi.fn() };
});

import { QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME } from '../../credentials/QInstrumentsBioShakeApi.credentials';
import { QInstrumentsBioShake } from './QInstrumentsBioShake.node';
import { CREDS, TOK, fake, installFakeTransport, run, send, type Params } from './node-test-helpers';
import { OPERATION_IDS, type QInstrumentsBioShakeOperation } from './operations';
import { TIMEOUT_DESCRIPTION } from './parameters';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './transport';

const here = path.dirname(fileURLToPath(import.meta.url));

const description = new QInstrumentsBioShake().description;

function property(name: string, operation?: QInstrumentsBioShakeOperation): INodeProperties {
  const found = description.properties.find(
    (p) =>
      p.name === name &&
      (operation === undefined || (p.displayOptions?.show?.operation as string[] | undefined)?.includes(operation)),
  );
  if (found === undefined) throw new Error(`node property ${name} is missing`);
  return found;
}

beforeEach(() => {
  installFakeTransport();
});

describe('node description (FR-18, FR-18.2, design C16)', () => {
  it('test_fr18_node_identity_credential_and_icon', () => {
    expect(description.name).toBe('qInstrumentsBioShake');
    expect(description.icon).toBe('file:qinstrumentsBioShake.svg');
    expect(description.credentials).toEqual([{ name: QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME, required: true }]);
    expect(QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME).toBe('qInstrumentsBioShakeApi');
  });

  it('test_fr18_icon_file_exists_next_to_the_node_and_is_svg', () => {
    const icon = path.join(here, 'qinstrumentsBioShake.svg');
    expect(existsSync(icon)).toBe(true);
    expect(readFileSync(icon, 'utf8')).toMatch(/<svg[\s>]/);
  });

  it('test_fr18_2_operation_selector_lists_the_twenty_two_fr18_2_names', () => {
    const options = property('operation').options as { name: string; value: string }[];
    expect(options).toHaveLength(22);
    expect(options.map((o) => o.value)).toEqual([...OPERATION_IDS]);
    expect(options.map((o) => o.name)).toEqual([
      'Get Status',
      'Connect',
      'Get Device Info',
      'Get Limits',
      'Get Shake State',
      'Get ELM State',
      'Get Error List',
      'Set Shake Speed',
      'Set Shake Acceleration',
      'Start Shaking',
      'Stop Shaking',
      'Home',
      'Lock Plate',
      'Unlock Plate',
      'Set Target Temperature',
      'Start Temperature Control',
      'Stop Temperature Control',
      'Get Actual Temperature',
      'Check At Target',
      'Stop All',
      'Release',
      'Reacquire',
    ]);
  });

  it('test_fr18_per_operation_fields_are_present', () => {
    expect(property('rpm', 'setShakeSpeed').required).toBe(true);
    expect(property('rpm', 'startShaking').required).toBe(true);
    expect(property('acceleration_s', 'setShakeAcceleration').required).toBe(true);
    expect(property('temperature_c', 'setTargetTemperature').required).toBe(true);
    expect(property('target_c', 'checkAtTarget').required).toBe(true);
    const nested = (name: string, operation: QInstrumentsBioShakeOperation) =>
      description.properties
        .filter((p) => p.type === 'collection' && (p.displayOptions?.show?.operation as string[]).includes(operation))
        .flatMap((p) => (p.options as INodeProperties[]).map((o) => o.name))
        .includes(name);
    expect(nested('acceleration_s', 'startShaking')).toBe(true);
    expect(nested('deceleration_s', 'stopShaking')).toBe(true);
    expect(nested('tolerance_c', 'checkAtTarget')).toBe(true);
  });

  it('test_fr18_timeout_parameter_default_and_margin_description', () => {
    const timeout = property('timeoutMs');
    expect(timeout.displayName).toBe('Timeout (ms)');
    expect(timeout.default).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(120000);
    expect(timeout.typeOptions?.minValue).toBeGreaterThanOrEqual(1);
    expect(timeout.typeOptions?.maxValue).toBeLessThanOrEqual(2_147_483_647);
    const text = timeout.description ?? '';
    expect(text).toBe(TIMEOUT_DESCRIPTION);
    expect(text).toMatch(/margin/i);
    expect(text).toMatch(/worst case/i);
    expect(text).toMatch(/120000/);
  });

  it('test_fr6_2_no_raw_command_operation_or_string_field', () => {
    const options = property('operation').options as { name: string; value: string }[];
    for (const option of options) {
      expect(`${option.name} ${option.value}`.toLowerCase()).not.toMatch(/raw|command|send|cmd|passthrough/);
    }
    const all = description.properties.flatMap((p) =>
      p.type === 'collection' ? [p, ...((p.options as INodeProperties[]) ?? [])] : [p],
    );
    expect(all.filter((p) => p.type === 'string')).toEqual([]);
    for (const p of all) expect(`${p.name} ${p.displayName}`.toLowerCase()).not.toMatch(/raw|command|cmd/);
  });
});

describe('execute: one request per item (FR-18, FR-18.3)', () => {
  const cases: [QInstrumentsBioShakeOperation, Params, { method: string; path: string; body?: unknown }][] = [
    ['getStatus', {}, { method: 'GET', path: '/v1/status' }],
    ['connect', {}, { method: 'POST', path: '/v1/connect' }],
    ['getDeviceInfo', {}, { method: 'GET', path: '/v1/device-info' }],
    ['getLimits', {}, { method: 'GET', path: '/v1/limits' }],
    ['getShakeState', {}, { method: 'GET', path: '/v1/shake/state' }],
    ['getElmState', {}, { method: 'GET', path: '/v1/elm/state' }],
    ['getErrorList', {}, { method: 'GET', path: '/v1/errors' }],
    ['setShakeSpeed', { rpm: 900 }, { method: 'PUT', path: '/v1/shake/speed', body: { rpm: 900 } }],
    [
      'setShakeAcceleration',
      { acceleration_s: 4 },
      { method: 'PUT', path: '/v1/shake/acceleration', body: { acceleration_s: 4 } },
    ],
    [
      'startShaking',
      { rpm: 1200, shakeStartOptions: { acceleration_s: 6 } },
      { method: 'POST', path: '/v1/shake/start', body: { rpm: 1200, acceleration_s: 6 } },
    ],
    [
      'stopShaking',
      { shakeStopOptions: { deceleration_s: 2 } },
      { method: 'POST', path: '/v1/shake/stop', body: { deceleration_s: 2 } },
    ],
    ['home', {}, { method: 'POST', path: '/v1/shake/home' }],
    ['lockPlate', {}, { method: 'POST', path: '/v1/elm/lock' }],
    ['unlockPlate', {}, { method: 'POST', path: '/v1/elm/unlock' }],
    [
      'setTargetTemperature',
      { temperature_c: 37.5 },
      { method: 'PUT', path: '/v1/temperature/target', body: { temperature_c: 37.5 } },
    ],
    ['startTemperatureControl', {}, { method: 'POST', path: '/v1/temperature/start' }],
    ['stopTemperatureControl', {}, { method: 'POST', path: '/v1/temperature/stop' }],
    ['getActualTemperature', {}, { method: 'GET', path: '/v1/temperature/actual' }],
    [
      'checkAtTarget',
      { target_c: 40, atTargetOptions: { tolerance_c: 0.5 } },
      { method: 'GET', path: '/v1/temperature/at-target?target_c=40&tolerance_c=0.5' },
    ],
    ['stopAll', {}, { method: 'POST', path: '/v1/stop-all' }],
    ['release', {}, { method: 'POST', path: '/v1/release' }],
    ['reacquire', {}, { method: 'POST', path: '/v1/reacquire' }],
  ];

  it('test_fr18_2_cases_cover_all_operations', () => {
    expect(cases.map((c) => c[0])).toEqual([...OPERATION_IDS]);
  });

  it.each(cases)('test_fr18_execute_sends_one_authorized_request_for_%s', async (operation, params, expected) => {
    const { promise, getCredentials } = run([{ operation, ...params }]);
    const result = await promise;
    expect(getCredentials).toHaveBeenCalledWith(QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME);
    expect(send).toHaveBeenCalledTimes(1);
    const [credentials, request, options] = send.mock.calls[0]!;
    expect(credentials).toEqual(CREDS);
    if (expected.body === undefined && operation !== 'stopShaking') {
      expect(request).toEqual({ method: expected.method, path: expected.path });
    } else {
      expect(request).toEqual(expected);
    }
    expect(options).toEqual({ timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS });
    // On the wire: one HTTPS request with the bearer header.
    expect(fake.wire).toHaveLength(1);
    const call = fake.wire[0]!;
    expect((call.options.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOK}`);
    expect(call.url.protocol).toBe('https:');
    expect(call.options.method).toBe(expected.method);
    expect(`${call.url.pathname}${call.url.search}`).toBe(expected.path);
    expect(result).toEqual([[{ json: {}, pairedItem: { item: 0 } }]]);
  });

  it('test_fr18_optional_fields_unset_are_not_sent', async () => {
    await run([
      { operation: 'startShaking', rpm: 700 },
      { operation: 'stopShaking' },
      { operation: 'checkAtTarget', target_c: 37, atTargetOptions: {} },
    ]).promise;
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![1]).toEqual({ method: 'POST', path: '/v1/shake/start', body: { rpm: 700 } });
    const stop = send.mock.calls[1]![1];
    expect(stop.path).toBe('/v1/shake/stop');
    expect(stop.body === undefined || Object.keys(stop.body as object).length === 0).toBe(true);
    expect(send.mock.calls[2]![1]).toEqual({ method: 'GET', path: '/v1/temperature/at-target?target_c=37' });
  });

  it('test_fr18_timeout_parameter_is_passed_to_the_transport', async () => {
    await run([{ operation: 'getStatus', timeoutMs: 5000 }]).promise;
    expect(send.mock.calls[0]![2]).toEqual({ timeoutMs: 5000 });
  });

  it.each([1, 3, 7])('test_fr18_3_n_items_give_exactly_n_transport_calls_%i', async (n) => {
    const items = Array.from({ length: n }, (_, i) => ({ operation: 'setShakeSpeed', rpm: 100 + i }));
    const result = await run(items).promise;
    expect(send).toHaveBeenCalledTimes(n);
    expect(fake.wire).toHaveLength(n);
    expect(send.mock.calls.map((c) => (c[1].body as { rpm: number }).rpm)).toEqual(items.map((i) => i.rpm));
    expect(result[0]!.map((o) => o.pairedItem)).toEqual(items.map((_, i) => ({ item: i })));
  });

  it('test_fr18_3_zero_items_give_no_transport_call', async () => {
    const result = await run([]).promise;
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual([[]]);
  });

  it('test_fr18_3_response_is_returned_as_is_without_a_second_request', async () => {
    send
      .mockResolvedValueOnce({ shaking: true, rpm: 1500 })
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(false);
    const result = await run([
      { operation: 'startShaking', rpm: 1500 },
      { operation: 'getErrorList' },
      { operation: 'setTargetTemperature', temperature_c: 30 },
      { operation: 'checkAtTarget', target_c: 30 },
    ]).promise;
    expect(send).toHaveBeenCalledTimes(4);
    expect(result).toEqual([
      [
        { json: { shaking: true, rpm: 1500 }, pairedItem: { item: 0 } },
        { json: { result: [1, 2] }, pairedItem: { item: 1 } },
        { json: { result: null }, pairedItem: { item: 2 } },
        { json: { result: false }, pairedItem: { item: 3 } },
      ],
    ]);
  });

  it('test_fr18_3_at_target_false_is_not_re_polled', async () => {
    fake.responses = [{ status: 200, body: '{"at_target":false,"actual_c":25.0}' }];
    const result = await run([{ operation: 'checkAtTarget', target_c: 37 }]).promise;
    expect(fake.wire).toHaveLength(1);
    expect(result).toEqual([[{ json: { at_target: false, actual_c: 25 }, pairedItem: { item: 0 } }]]);
  });
});

describe('build output (optional)', () => {
  const bundleDir = path.resolve(here, '../../../dist/nodes/QInstrumentsBioShake');
  it.skipIf(!existsSync(path.join(bundleDir, 'QInstrumentsBioShake.node.js')))(
    'test_fr18_build_emits_the_node_bundle_and_icon',
    () => {
      expect(existsSync(path.join(bundleDir, 'qinstrumentsBioShake.svg'))).toBe(true);
    },
  );
});
