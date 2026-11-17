/**
 * Adapted from inheco_tec nodes/InhecoTec/operations.ts (inheco-tec feature); promotion candidate, see design DD-1.
 *
 * Operation table of the QInstruments BioShake node (design C16, FR-18.2, FR-6.2).
 *
 * Pure: maps one operation and its parameters to the API request `{method, path, body?, query?}`.
 * Nothing here opens a socket or imports n8n runtime code.
 *
 * - There is one operation per API capability (22) and no operation or field that accepts a raw
 *   command string (FR-6.2): every body is a fixed, closed shape.
 * - Optional fields (`acceleration_s`, `deceleration_s`, `tolerance_c`) are omitted when unset.
 * - Every query value is URL-encoded by `requestPath`, because `buildApiRequest` joins the base
 *   URL and the path raw (carry-forward T23-SR-L4). No path holds a user-supplied segment.
 * - Range checks (effective limits, tolerance window) belong to the API; this module only rejects
 *   values that are not well-formed numbers, so no `NaN`, `Infinity` or `1.5` rpm is sent.
 */

import type { HttpMethod, QInstrumentsBioShakeRequest } from './transport';

/** The 22 operations of FR-18.2, by n8n option value, in the order of the design C16 table. */
export const OPERATION_IDS = [
  'getStatus',
  'connect',
  'getDeviceInfo',
  'getLimits',
  'getShakeState',
  'getElmState',
  'getErrorList',
  'setShakeSpeed',
  'setShakeAcceleration',
  'startShaking',
  'stopShaking',
  'home',
  'lockPlate',
  'unlockPlate',
  'setTargetTemperature',
  'startTemperatureControl',
  'stopTemperatureControl',
  'getActualTemperature',
  'checkAtTarget',
  'stopAll',
  'release',
  'reacquire',
] as const;

export type QInstrumentsBioShakeOperation = (typeof OPERATION_IDS)[number];

/** The parameters an operation may read; each operation uses only its own subset. */
export interface OperationParameters {
  /** Shake speed in rpm (Set Shake Speed, Start Shaking). */
  rpm?: number;
  /** Acceleration in seconds (Set Shake Acceleration; optional for Start Shaking). */
  acceleration_s?: number;
  /** Optional deceleration in seconds (Stop Shaking). */
  deceleration_s?: number;
  /** Target temperature in degrees C (Set Target Temperature). */
  temperature_c?: number;
  /** Target temperature in degrees C to compare against (Check At Target). */
  target_c?: number;
  /** Optional at-target tolerance in degrees C (Check At Target). */
  tolerance_c?: number;
}

/** One API request as built by the table; `query` values are raw (encoded by `requestPath`). */
export interface OperationRequest {
  method: HttpMethod;
  path: string;
  body?: Record<string, number>;
  query?: Record<string, string>;
}

/** One row of the operation table. */
export interface OperationDefinition {
  name: string;
  description: string;
  method: HttpMethod;
  /** Path (without query), for documentation and tests. */
  path: string;
  build: (params: OperationParameters) => OperationRequest;
}

/** A parameter value is not a well-formed number for its operation. */
export class OperationParameterError extends Error {
  readonly parameter: string;

  constructor(parameter: string, message: string) {
    super(message);
    this.name = 'OperationParameterError';
    this.parameter = parameter;
  }
}

function integer(name: string, value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new OperationParameterError(name, `Parameter ${name} must be an integer`);
  }
  return value;
}

function finite(name: string, value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OperationParameterError(name, `Parameter ${name} must be a finite number`);
  }
  return value;
}

/** A request without a body or query. */
function plain(name: string, description: string, method: HttpMethod, path: string): OperationDefinition {
  return { name, description, method, path, build: () => ({ method, path }) };
}

function row(
  name: string,
  description: string,
  method: HttpMethod,
  path: string,
  build: (params: OperationParameters) => OperationRequest,
): OperationDefinition {
  return { name, description, method, path, build };
}

/** The design C16 operation table, keyed by operation ID. */
export const OPERATIONS: Readonly<Record<QInstrumentsBioShakeOperation, OperationDefinition>> = {
  getStatus: plain('Get Status', 'Service state, identity, effective limits and families', 'GET', '/v1/status'),
  connect: plain('Connect', 'Connect, or reconnect after a loss', 'POST', '/v1/connect'),
  getDeviceInfo: plain('Get Device Info', 'Read the firmware version, description and serial number', 'GET', '/v1/device-info'),
  getLimits: plain('Get Limits', 'Configured, model, firmware and effective limits', 'GET', '/v1/limits'),
  getShakeState: plain('Get Shake State', 'Read the shake state code', 'GET', '/v1/shake/state'),
  getElmState: plain('Get ELM State', 'Read the plate lock (ELM) state code', 'GET', '/v1/elm/state'),
  getErrorList: plain('Get Error List', 'Read the device error list', 'GET', '/v1/errors'),
  setShakeSpeed: row('Set Shake Speed', 'Set the target shake speed in rpm', 'PUT', '/v1/shake/speed', (p) => ({
    method: 'PUT',
    path: '/v1/shake/speed',
    body: { rpm: integer('rpm', p.rpm) },
  })),
  setShakeAcceleration: row(
    'Set Shake Acceleration',
    'Set the shake acceleration in seconds',
    'PUT',
    '/v1/shake/acceleration',
    (p) => ({
      method: 'PUT',
      path: '/v1/shake/acceleration',
      body: { acceleration_s: integer('acceleration_s', p.acceleration_s) },
    }),
  ),
  startShaking: row(
    'Start Shaking',
    'Start shaking; returns when the API responds (use a Wait node for the duration)',
    'POST',
    '/v1/shake/start',
    (p) => {
      const body: Record<string, number> = { rpm: integer('rpm', p.rpm) };
      if (p.acceleration_s !== undefined) body.acceleration_s = integer('acceleration_s', p.acceleration_s);
      return { method: 'POST', path: '/v1/shake/start', body };
    },
  ),
  stopShaking: row('Stop Shaking', 'Stop shaking, with an optional deceleration', 'POST', '/v1/shake/stop', (p) => {
    // The body is always a JSON object; `deceleration_s` is present only when set.
    const body: Record<string, number> = {};
    if (p.deceleration_s !== undefined) body.deceleration_s = integer('deceleration_s', p.deceleration_s);
    return { method: 'POST', path: '/v1/shake/stop', body };
  }),
  home: plain('Home', 'Move the shaker to its home position', 'POST', '/v1/shake/home'),
  lockPlate: plain('Lock Plate', 'Lock the plate (ELM lock position)', 'POST', '/v1/elm/lock'),
  unlockPlate: plain('Unlock Plate', 'Unlock the plate (ELM unlock position)', 'POST', '/v1/elm/unlock'),
  setTargetTemperature: row(
    'Set Target Temperature',
    'Set the target temperature in °C; returns when the API responds',
    'PUT',
    '/v1/temperature/target',
    (p) => ({
      method: 'PUT',
      path: '/v1/temperature/target',
      body: { temperature_c: finite('temperature_c', p.temperature_c) },
    }),
  ),
  startTemperatureControl: plain(
    'Start Temperature Control',
    'Switch temperature control on; returns when the API responds',
    'POST',
    '/v1/temperature/start',
  ),
  stopTemperatureControl: plain('Stop Temperature Control', 'Switch temperature control off', 'POST', '/v1/temperature/stop'),
  getActualTemperature: plain('Get Actual Temperature', 'Read the actual temperature', 'GET', '/v1/temperature/actual'),
  checkAtTarget: row(
    'Check At Target',
    'One instantaneous check whether the actual temperature is within tolerance of a target',
    'GET',
    '/v1/temperature/at-target',
    (p) => {
      const query: Record<string, string> = { target_c: String(finite('target_c', p.target_c)) };
      if (p.tolerance_c !== undefined) query.tolerance_c = String(finite('tolerance_c', p.tolerance_c));
      return { method: 'GET', path: '/v1/temperature/at-target', query };
    },
  ),
  stopAll: plain('Stop All', 'Stop shaking and stop temperature control', 'POST', '/v1/stop-all'),
  release: plain('Release', 'Release the serial port so that another program (VENUS) can use it', 'POST', '/v1/release'),
  reacquire: plain('Reacquire', 'Reacquire the released serial port', 'POST', '/v1/reacquire'),
};

export function isQInstrumentsBioShakeOperation(value: unknown): value is QInstrumentsBioShakeOperation {
  return typeof value === 'string' && (OPERATION_IDS as readonly string[]).includes(value);
}

/** The API request for `operation` with `params` (design C16 table). */
export function buildOperationRequest(
  operation: QInstrumentsBioShakeOperation,
  params: OperationParameters = {},
): OperationRequest {
  if (!isQInstrumentsBioShakeOperation(operation)) {
    throw new OperationParameterError('operation', 'Unknown QInstruments BioShake operation');
  }
  return OPERATIONS[operation].build(params);
}

/** The path with its query string; every query key and value is URL-encoded (T23-SR-L4). */
export function requestPath(request: OperationRequest): string {
  const entries = Object.entries(request.query ?? {});
  if (entries.length === 0) return request.path;
  const query = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return `${request.path}?${query}`;
}

/** The transport request (path with encoded query, body when present) of a table request. */
export function toTransportRequest(request: OperationRequest): QInstrumentsBioShakeRequest {
  const transportRequest: QInstrumentsBioShakeRequest = { method: request.method, path: requestPath(request) };
  if (request.body !== undefined) transportRequest.body = request.body;
  return transportRequest;
}
