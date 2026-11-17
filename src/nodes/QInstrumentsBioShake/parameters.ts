/**
 * Adapted from inheco_tec nodes/InhecoTec/InhecoTec.node.ts (inheco-tec feature); promotion candidate, see design DD-1.
 *
 * Node property descriptions of the QInstruments BioShake node and the reader that turns them
 * into operation parameters (design C16, FR-18.2, FR-6.2).
 *
 * The operation selector lists the 22 operations of FR-18.2. Each operation shows only its own
 * fields (`rpm`, `acceleration_s`, `deceleration_s`, `temperature_c`, `target_c`, `tolerance_c`)
 * plus "Timeout (ms)". There is no raw-command field (FR-6.2). Optional fields sit in an
 * "Options" collection so that an unset field is absent, not a default value.
 */

import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import {
  OPERATION_IDS,
  OPERATIONS,
  type OperationParameters,
  type QInstrumentsBioShakeOperation,
} from './operations';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './transport';

/** Largest timer delay Node.js accepts (2^31 - 1 ms); `transport.ts` does not clamp. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export const DEFAULT_RPM = 500;
export const DEFAULT_TEMPERATURE_C = 37;
export const DEFAULT_TOLERANCE_C = 1;

/**
 * "Timeout (ms)" description (carry-forward T23-CR-M1, T9-CR-M2): the request deadline must be
 * above the API worst case of the slowest operation.
 */
export const TIMEOUT_DESCRIPTION =
  'Deadline of one API request in milliseconds (default 120000). It must exceed the API worst case ' +
  'of one operation: 12.6 s + (home_read_timeout + 1.2 s) + lock_wait_s + a write/drain margin ' +
  '(about 59 s plus the margin with the default manifest). A shorter value can abort a request ' +
  'that the API still completes.';

function shownFor(operations: QInstrumentsBioShakeOperation[]): INodeProperties['displayOptions'] {
  return { show: { operation: operations } };
}

function integerField(
  displayName: string,
  name: string,
  defaultValue: number,
  minValue: number,
  description: string,
): INodeProperties {
  return {
    displayName,
    name,
    type: 'number',
    default: defaultValue,
    typeOptions: { minValue, numberPrecision: 0 },
    description,
  };
}

const RPM_DESCRIPTION = 'Shake speed in rpm; the API refuses a value outside the effective limits';
const ACCELERATION_DESCRIPTION =
  'Acceleration in seconds; the API refuses a value outside the effective limits';

export const properties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    options: OPERATION_IDS.map((op) => ({
      name: OPERATIONS[op].name,
      value: op,
      description: OPERATIONS[op].description,
      action: OPERATIONS[op].name,
    })),
    default: 'getStatus',
  },
  {
    ...integerField('Speed (rpm)', 'rpm', DEFAULT_RPM, 0, RPM_DESCRIPTION),
    required: true,
    displayOptions: shownFor(['setShakeSpeed', 'startShaking']),
  },
  {
    ...integerField('Acceleration (s)', 'acceleration_s', 0, 0, ACCELERATION_DESCRIPTION),
    required: true,
    displayOptions: shownFor(['setShakeAcceleration']),
  },
  {
    displayName: 'Options',
    name: 'shakeStartOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: shownFor(['startShaking']),
    options: [integerField('Acceleration (s)', 'acceleration_s', 0, 0, ACCELERATION_DESCRIPTION)],
  },
  {
    displayName: 'Options',
    name: 'shakeStopOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: shownFor(['stopShaking']),
    options: [
      integerField(
        'Deceleration (s)',
        'deceleration_s',
        0,
        0,
        'Deceleration in seconds; applied only inside the effective acceleration window. Stop is sent either way.',
      ),
    ],
  },
  {
    displayName: 'Temperature (°C)',
    name: 'temperature_c',
    type: 'number',
    required: true,
    default: DEFAULT_TEMPERATURE_C,
    typeOptions: { numberPrecision: 1 },
    displayOptions: shownFor(['setTargetTemperature']),
    description: 'Target temperature in °C; the API refuses a value outside the effective limits',
  },
  {
    displayName: 'Target (°C)',
    name: 'target_c',
    type: 'number',
    required: true,
    default: DEFAULT_TEMPERATURE_C,
    typeOptions: { numberPrecision: 1 },
    displayOptions: shownFor(['checkAtTarget']),
    description: 'Temperature in °C that the actual temperature is compared with',
  },
  {
    displayName: 'Options',
    name: 'atTargetOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: shownFor(['checkAtTarget']),
    options: [
      {
        displayName: 'Tolerance (°C)',
        name: 'tolerance_c',
        type: 'number',
        default: DEFAULT_TOLERANCE_C,
        typeOptions: { minValue: 0.1, maxValue: 5, numberPrecision: 1 },
        description: 'Tolerance in °C, 0.1-5.0. When not set, the API uses 1.0.',
      },
    ],
  },
  {
    displayName: 'Timeout (ms)',
    name: 'timeoutMs',
    type: 'number',
    default: DEFAULT_REQUEST_TIMEOUT_MS,
    typeOptions: { minValue: 1, maxValue: MAX_TIMEOUT_MS, numberPrecision: 0 },
    description: TIMEOUT_DESCRIPTION,
  },
];

/** The value of `key` in an "Options" collection, or `undefined` when the option is not added. */
function option(collection: IDataObject, key: string): number | undefined {
  const value = collection[key];
  return value === undefined || value === null || value === '' ? undefined : (value as number);
}

/** Read one operation's parameters for item `itemIndex`. */
export function readParameters(
  context: IExecuteFunctions,
  operation: QInstrumentsBioShakeOperation,
  itemIndex: number,
): OperationParameters {
  const value = (name: string): number => context.getNodeParameter(name, itemIndex) as number;
  const collection = (name: string): IDataObject =>
    (context.getNodeParameter(name, itemIndex, {}) as IDataObject | undefined) ?? {};
  const params: OperationParameters = {};
  switch (operation) {
    case 'setShakeSpeed':
      params.rpm = value('rpm');
      break;
    case 'setShakeAcceleration':
      params.acceleration_s = value('acceleration_s');
      break;
    case 'startShaking': {
      params.rpm = value('rpm');
      const acceleration = option(collection('shakeStartOptions'), 'acceleration_s');
      if (acceleration !== undefined) params.acceleration_s = acceleration;
      break;
    }
    case 'stopShaking': {
      const deceleration = option(collection('shakeStopOptions'), 'deceleration_s');
      if (deceleration !== undefined) params.deceleration_s = deceleration;
      break;
    }
    case 'setTargetTemperature':
      params.temperature_c = value('temperature_c');
      break;
    case 'checkAtTarget': {
      params.target_c = value('target_c');
      const tolerance = option(collection('atTargetOptions'), 'tolerance_c');
      if (tolerance !== undefined) params.tolerance_c = tolerance;
      break;
    }
    default:
      break;
  }
  return params;
}
