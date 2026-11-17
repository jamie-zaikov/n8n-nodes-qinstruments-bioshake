/**
 * Suite for the QInstruments BioShake operation table (Task 24, FR-6.2, FR-18, FR-18.2, FR-18.3,
 * design C16).
 *
 * The expected method, path, body and query of each operation are written out below from the
 * design C16 table (not copied from the implementation), so a drift on either side fails here.
 * The wire check passes each built request through the real transport with a fake `requestFn`,
 * so no socket is opened, no port is bound and no real HTTPS call is made. The token is a short
 * placeholder.
 */
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';

import { describe, expect, it } from 'vitest';

import {
  buildOperationRequest,
  isQInstrumentsBioShakeOperation,
  OPERATION_IDS,
  OPERATIONS,
  OperationParameterError,
  requestPath,
  toTransportRequest,
  type OperationParameters,
  type QInstrumentsBioShakeOperation,
} from './operations';
import { sendQInstrumentsBioShakeRequest, type HttpsRequestFn } from './transport';

const TOK = 'test-tok';
const CREDS = { baseUrl: 'https://bioshake.example:8744', token: TOK };

/** Parameters that every operation accepts (each reads only its own subset). */
const FULL: OperationParameters = {
  rpm: 1500,
  acceleration_s: 5,
  deceleration_s: 3,
  temperature_c: 37.5,
  target_c: 40.5,
  tolerance_c: 0.5,
};

interface Expected {
  name: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  /** Body for FULL parameters; `undefined` = no body. */
  body?: Record<string, number>;
  /** Query for FULL parameters; `undefined` = no query. */
  query?: Record<string, string>;
}

/** The design C16 table, row by row, in the FR-18.2 order. */
const C16: [QInstrumentsBioShakeOperation, Expected][] = [
  ['getStatus', { name: 'Get Status', method: 'GET', path: '/v1/status' }],
  ['connect', { name: 'Connect', method: 'POST', path: '/v1/connect' }],
  ['getDeviceInfo', { name: 'Get Device Info', method: 'GET', path: '/v1/device-info' }],
  ['getLimits', { name: 'Get Limits', method: 'GET', path: '/v1/limits' }],
  ['getShakeState', { name: 'Get Shake State', method: 'GET', path: '/v1/shake/state' }],
  ['getElmState', { name: 'Get ELM State', method: 'GET', path: '/v1/elm/state' }],
  ['getErrorList', { name: 'Get Error List', method: 'GET', path: '/v1/errors' }],
  ['setShakeSpeed', { name: 'Set Shake Speed', method: 'PUT', path: '/v1/shake/speed', body: { rpm: 1500 } }],
  [
    'setShakeAcceleration',
    { name: 'Set Shake Acceleration', method: 'PUT', path: '/v1/shake/acceleration', body: { acceleration_s: 5 } },
  ],
  [
    'startShaking',
    { name: 'Start Shaking', method: 'POST', path: '/v1/shake/start', body: { rpm: 1500, acceleration_s: 5 } },
  ],
  ['stopShaking', { name: 'Stop Shaking', method: 'POST', path: '/v1/shake/stop', body: { deceleration_s: 3 } }],
  ['home', { name: 'Home', method: 'POST', path: '/v1/shake/home' }],
  ['lockPlate', { name: 'Lock Plate', method: 'POST', path: '/v1/elm/lock' }],
  ['unlockPlate', { name: 'Unlock Plate', method: 'POST', path: '/v1/elm/unlock' }],
  [
    'setTargetTemperature',
    { name: 'Set Target Temperature', method: 'PUT', path: '/v1/temperature/target', body: { temperature_c: 37.5 } },
  ],
  ['startTemperatureControl', { name: 'Start Temperature Control', method: 'POST', path: '/v1/temperature/start' }],
  ['stopTemperatureControl', { name: 'Stop Temperature Control', method: 'POST', path: '/v1/temperature/stop' }],
  ['getActualTemperature', { name: 'Get Actual Temperature', method: 'GET', path: '/v1/temperature/actual' }],
  [
    'checkAtTarget',
    {
      name: 'Check At Target',
      method: 'GET',
      path: '/v1/temperature/at-target',
      query: { target_c: '40.5', tolerance_c: '0.5' },
    },
  ],
  ['stopAll', { name: 'Stop All', method: 'POST', path: '/v1/stop-all' }],
  ['release', { name: 'Release', method: 'POST', path: '/v1/release' }],
  ['reacquire', { name: 'Reacquire', method: 'POST', path: '/v1/reacquire' }],
];

/** The FR-18.2 operation names, verbatim from the requirement. */
const FR18_2_NAMES = [
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
];

/** The expected wire path (path + encoded query) of a C16 row. */
function wirePath(expected: Expected): string {
  if (expected.query === undefined) return expected.path;
  return `${expected.path}?${new URLSearchParams(expected.query).toString()}`;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

interface Captured {
  url: URL;
  options: RequestOptions;
  payload: string | undefined;
}

/** A fake `https.request` that records the call and answers 200 `{}`; no socket is opened. */
function fakeRequestFn(): { requestFn: HttpsRequestFn; calls: Captured[] } {
  const calls: Captured[] = [];
  const requestFn: HttpsRequestFn = (url, options, callback) => {
    const call: Captured = { url, options, payload: undefined };
    calls.push(call);
    const req = new EventEmitter() as EventEmitter & { end: (p?: string) => void; destroy: () => void };
    req.destroy = () => undefined;
    req.end = (p?: string) => {
      call.payload = p;
      setImmediate(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode?: number };
        res.statusCode = 200;
        callback(res as unknown as IncomingMessage);
        res.emit('data', '{}');
        res.emit('end');
      });
    };
    return req as unknown as ClientRequest;
  };
  return { requestFn, calls };
}

describe('operation set (FR-18, FR-18.2, design C16)', () => {
  it('test_fr18_2_offers_exactly_twenty_two_operations', () => {
    expect(OPERATION_IDS).toHaveLength(22);
    expect(new Set(OPERATION_IDS).size).toBe(22);
    expect(Object.keys(OPERATIONS).sort()).toEqual([...OPERATION_IDS].sort());
  });

  it('test_fr18_2_operation_names_are_the_fr18_2_names_in_order', () => {
    expect(OPERATION_IDS.map((op) => OPERATIONS[op].name)).toEqual(FR18_2_NAMES);
  });

  it('test_fr18_2_c16_expectation_table_covers_every_operation', () => {
    expect(C16.map(([op]) => op)).toEqual([...OPERATION_IDS]);
    expect(C16.map(([, e]) => e.name)).toEqual(FR18_2_NAMES);
  });

  it('test_fr18_2_every_operation_has_a_description', () => {
    for (const op of OPERATION_IDS) {
      expect(OPERATIONS[op].description.trim().length, op).toBeGreaterThan(0);
    }
  });
});

describe('method, path, body and query per operation (FR-18, design C16)', () => {
  it.each(C16)('test_fr18_c16_request_of_%s', (op, expected) => {
    const request = buildOperationRequest(op, FULL);
    expect(request.method).toBe(expected.method);
    expect(request.path).toBe(expected.path);
    expect(request.body).toEqual(expected.body);
    expect(request.query).toEqual(expected.query);
    expect(OPERATIONS[op].method).toBe(expected.method);
    expect(OPERATIONS[op].path).toBe(expected.path);
    expect(OPERATIONS[op].name).toBe(expected.name);
  });

  it.each(C16)('test_fr18_c16_transport_request_of_%s', (op, expected) => {
    const transportRequest = toTransportRequest(buildOperationRequest(op, FULL));
    expect(transportRequest.method).toBe(expected.method);
    expect(transportRequest.path).toBe(wirePath(expected));
    expect(transportRequest.body).toEqual(expected.body);
  });

  it('test_fr18_operations_without_c16_body_have_no_body_and_no_query', () => {
    for (const [op, expected] of C16) {
      if (expected.body !== undefined || expected.query !== undefined || op === 'stopShaking') continue;
      const request = buildOperationRequest(op, FULL);
      expect(request, op).toEqual({ method: expected.method, path: expected.path });
      expect('body' in toTransportRequest(request), op).toBe(false);
    }
  });

  it('test_fr18_only_get_put_post_are_used', () => {
    for (const op of OPERATION_IDS) {
      expect(['GET', 'POST', 'PUT']).toContain(buildOperationRequest(op, FULL).method);
    }
  });
});

describe('optional fields omitted when unset (FR-18, design C16)', () => {
  it('test_fr18_start_shaking_omits_acceleration_when_unset', () => {
    expect(buildOperationRequest('startShaking', { rpm: 800 })).toEqual({
      method: 'POST',
      path: '/v1/shake/start',
      body: { rpm: 800 },
    });
  });

  it('test_fr18_stop_shaking_omits_deceleration_when_unset', () => {
    const request = buildOperationRequest('stopShaking', {});
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/shake/stop');
    // C16: `{deceleration_s?}` - no deceleration key when not set (an empty object or no body).
    expect(request.body === undefined || Object.keys(request.body).length === 0).toBe(true);
    expect(request.query).toBeUndefined();
    expect(buildOperationRequest('stopShaking').path).toBe('/v1/shake/stop');
  });

  it('test_fr18_check_at_target_omits_tolerance_when_unset', () => {
    const request = buildOperationRequest('checkAtTarget', { target_c: 37 });
    expect(request.query).toEqual({ target_c: '37' });
    expect(requestPath(request)).toBe('/v1/temperature/at-target?target_c=37');
  });

  it('test_fr18_zero_is_a_set_value_not_an_unset_one', () => {
    expect(buildOperationRequest('startShaking', { rpm: 0, acceleration_s: 0 }).body).toEqual({
      rpm: 0,
      acceleration_s: 0,
    });
    expect(buildOperationRequest('stopShaking', { deceleration_s: 0 }).body).toEqual({ deceleration_s: 0 });
    expect(buildOperationRequest('checkAtTarget', { target_c: 0, tolerance_c: 0.1 }).query).toEqual({
      target_c: '0',
      tolerance_c: '0.1',
    });
  });

  it('test_fr18_operations_ignore_parameters_of_other_operations', () => {
    expect(buildOperationRequest('setShakeSpeed', FULL).body).toEqual({ rpm: 1500 });
    expect(buildOperationRequest('setTargetTemperature', FULL).body).toEqual({ temperature_c: 37.5 });
    expect(buildOperationRequest('stopShaking', FULL).body).toEqual({ deceleration_s: 3 });
  });
});

describe('query encoding (FR-18, design C16, T23-SR-L4)', () => {
  it('test_fr18_check_at_target_query_order_and_names', () => {
    expect(requestPath(buildOperationRequest('checkAtTarget', FULL))).toBe(
      '/v1/temperature/at-target?target_c=40.5&tolerance_c=0.5',
    );
  });

  it('test_fr18_negative_and_exponent_values_are_encoded_and_round_trip', () => {
    const samples: [number, number][] = [
      [-5.5, 0.1],
      [1e-7, 5],
      [1e21, 2.5],
    ];
    for (const [target, tolerance] of samples) {
      const built = requestPath(buildOperationRequest('checkAtTarget', { target_c: target, tolerance_c: tolerance }));
      expect(built).toMatch(/^\/v1\/temperature\/at-target\?target_c=[A-Za-z0-9.%-]+&tolerance_c=[A-Za-z0-9.%-]+$/);
      const query = new URLSearchParams(built.split('?')[1]);
      expect(Number(query.get('target_c'))).toBe(target);
      expect(Number(query.get('tolerance_c'))).toBe(tolerance);
    }
  });

  it('test_fr18_request_path_encodes_reserved_characters_in_keys_and_values', () => {
    const built = requestPath({ method: 'GET', path: '/v1/x', query: { 'a&b': '1/2?3#4 5' } });
    expect(built).toBe('/v1/x?a%26b=1%2F2%3F3%234%205');
  });

  it('test_fr18_request_path_without_query_is_the_bare_path', () => {
    expect(requestPath({ method: 'GET', path: '/v1/status' })).toBe('/v1/status');
    expect(requestPath({ method: 'GET', path: '/v1/status', query: {} })).toBe('/v1/status');
  });

  it('test_fr18_every_built_path_has_only_safe_characters', () => {
    for (const op of OPERATION_IDS) {
      const built = requestPath(buildOperationRequest(op, FULL));
      expect(built, op).toMatch(/^\/v1\/[a-z/-]+(\?[a-z_]+=[A-Za-z0-9.%-]+(&[a-z_]+=[A-Za-z0-9.%-]+)*)?$/);
    }
  });
});

describe('OperationParameterError (FR-18, FR-6.2)', () => {
  it('test_fr18_missing_or_malformed_numbers_raise_operation_parameter_error', () => {
    const bad: [QInstrumentsBioShakeOperation, OperationParameters, string][] = [
      ['setShakeSpeed', {}, 'rpm'],
      ['setShakeSpeed', { rpm: 1.5 }, 'rpm'],
      ['setShakeSpeed', { rpm: Number.NaN }, 'rpm'],
      ['setShakeSpeed', { rpm: Number.POSITIVE_INFINITY }, 'rpm'],
      ['setShakeAcceleration', {}, 'acceleration_s'],
      ['setShakeAcceleration', { acceleration_s: 2.5 }, 'acceleration_s'],
      ['startShaking', {}, 'rpm'],
      ['startShaking', { rpm: 500, acceleration_s: 0.5 }, 'acceleration_s'],
      ['stopShaking', { deceleration_s: Number.NaN }, 'deceleration_s'],
      ['stopShaking', { deceleration_s: 1.25 }, 'deceleration_s'],
      ['setTargetTemperature', {}, 'temperature_c'],
      ['setTargetTemperature', { temperature_c: Number.NaN }, 'temperature_c'],
      ['setTargetTemperature', { temperature_c: Number.NEGATIVE_INFINITY }, 'temperature_c'],
      ['checkAtTarget', {}, 'target_c'],
      ['checkAtTarget', { target_c: Number.NaN }, 'target_c'],
      ['checkAtTarget', { target_c: 37, tolerance_c: Number.NaN }, 'tolerance_c'],
      ['checkAtTarget', { target_c: 37, tolerance_c: Number.POSITIVE_INFINITY }, 'tolerance_c'],
    ];
    for (const [op, params, parameter] of bad) {
      const thrown = thrownBy(() => buildOperationRequest(op, params));
      expect(thrown, `${op} ${parameter}`).toBeInstanceOf(OperationParameterError);
      expect((thrown as OperationParameterError).parameter, `${op}`).toBe(parameter);
      expect((thrown as OperationParameterError).name).toBe('OperationParameterError');
      expect((thrown as Error).message).toContain(parameter);
    }
  });

  it('test_fr18_temperatures_accept_fractions_and_negatives', () => {
    expect(buildOperationRequest('setTargetTemperature', { temperature_c: -5.05 }).body).toEqual({
      temperature_c: -5.05,
    });
    expect(buildOperationRequest('checkAtTarget', { target_c: 36.6 }).query).toEqual({ target_c: '36.6' });
  });

  it('test_fr6_2_strings_smuggled_past_the_number_type_are_rejected', () => {
    const hostile = ['500', '1500;shakeOn', 'resetDevice', '37/../../v1/stop-all', '40&x=1'];
    for (const value of hostile) {
      const s = value as unknown as number;
      expect(() => buildOperationRequest('setShakeSpeed', { rpm: s })).toThrow(OperationParameterError);
      expect(() => buildOperationRequest('setShakeAcceleration', { acceleration_s: s })).toThrow(
        OperationParameterError,
      );
      expect(() => buildOperationRequest('startShaking', { rpm: 500, acceleration_s: s })).toThrow(
        OperationParameterError,
      );
      expect(() => buildOperationRequest('stopShaking', { deceleration_s: s })).toThrow(OperationParameterError);
      expect(() => buildOperationRequest('setTargetTemperature', { temperature_c: s })).toThrow(
        OperationParameterError,
      );
      expect(() => buildOperationRequest('checkAtTarget', { target_c: s })).toThrow(OperationParameterError);
      expect(() => buildOperationRequest('checkAtTarget', { target_c: 37, tolerance_c: s })).toThrow(
        OperationParameterError,
      );
    }
  });

  it('test_fr6_2_unknown_operation_is_rejected', () => {
    expect(isQInstrumentsBioShakeOperation('getStatus')).toBe(true);
    for (const value of ['sendCommand', 'rawCommand', 'resetDevice', '', 42, null, undefined, {}]) {
      expect(isQInstrumentsBioShakeOperation(value), String(value)).toBe(false);
    }
    const thrown = thrownBy(() => buildOperationRequest('sendCommand' as QInstrumentsBioShakeOperation));
    expect(thrown).toBeInstanceOf(OperationParameterError);
    expect((thrown as OperationParameterError).parameter).toBe('operation');
  });
});

describe('no raw-command operation or field (FR-6.2)', () => {
  it('test_fr6_2_no_operation_name_id_or_path_suggests_a_raw_command', () => {
    for (const op of OPERATION_IDS) {
      const text = `${op} ${OPERATIONS[op].name} ${OPERATIONS[op].path}`.toLowerCase();
      expect(text, op).not.toMatch(/raw|command|send|passthrough|custom|execute|cmd/);
    }
  });

  it('test_fr6_2_bodies_and_queries_are_fixed_shapes_and_ignore_extra_fields', () => {
    const extra = { ...FULL, command: 'resetDevice', raw: 'shakeOn', cmd: 'setShakeDefault' } as OperationParameters;
    for (const [op, expected] of C16) {
      const request = buildOperationRequest(op, extra);
      expect(request.body, op).toEqual(expected.body);
      expect(request.query, op).toEqual(expected.query);
      expect(JSON.stringify(toTransportRequest(request)), op).not.toMatch(/resetDevice|shakeOn|setShakeDefault/);
    }
  });

  it('test_fr6_2_every_body_and_query_value_is_numeric', () => {
    for (const op of OPERATION_IDS) {
      const request = buildOperationRequest(op, FULL);
      for (const value of Object.values(request.body ?? {})) expect(typeof value, op).toBe('number');
      for (const value of Object.values(request.query ?? {})) expect(Number.isFinite(Number(value)), op).toBe(true);
    }
  });
});

describe('auth header, method, URL and body on the wire (FR-18, design C16)', () => {
  it.each(C16)('test_fr18_wire_request_of_%s', async (op, expected) => {
    const { requestFn, calls } = fakeRequestFn();
    const result = await sendQInstrumentsBioShakeRequest(CREDS, toTransportRequest(buildOperationRequest(op, FULL)), {
      requestFn,
    });
    expect(result).toEqual({});
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const headers = call.options.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOK}`);
    expect(call.options.method).toBe(expected.method);
    expect(call.url.protocol).toBe('https:');
    expect(call.url.host).toBe('bioshake.example:8744');
    expect(`${call.url.pathname}${call.url.search}`).toBe(wirePath(expected));
    if (expected.body === undefined) {
      expect(call.payload).toBeUndefined();
    } else {
      expect(JSON.parse(call.payload!)).toEqual(expected.body);
      expect(headers['Content-Type']).toBe('application/json');
    }
  });
});
