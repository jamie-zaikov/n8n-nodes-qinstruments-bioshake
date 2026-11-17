/**
 * Adapted from inheco_tec nodes/InhecoTec/errors.ts (inheco-tec feature); promotion candidate, see design DD-1.
 *
 * Error mapping of the QInstruments BioShake node (design C16 errors, FR-18.5, FR-18.6).
 *
 * An API error (`QInstrumentsBioShakeApiError`: HTTP status + parsed unified error body) becomes
 * one message built only from body fields:
 *
 *   `QInstruments BioShake API <status> <kind>: <message>` plus `; device reply: <device_reply>`
 *   or `; transport failure <failure>`.
 *
 * For `stop_not_delivered` the API message (which starts "Stop was NOT delivered") is kept; if a
 * body ever lacks it, a fixed "Stop was NOT delivered" text is prefixed so the message always
 * states it (FR-18.6).
 *
 * The request options and headers are never read here, so the token cannot reach a message
 * (FR-18.5). The node can additionally pass the token as a redaction value (defence in depth).
 */

import { NodeOperationError, type INode } from 'n8n-workflow';

import { OperationParameterError } from './operations';
import { QInstrumentsBioShakeApiError, QInstrumentsBioShakeTransportError } from './transport';

/** Longest body field copied into a message. */
const MAX_FIELD_LENGTH = 300;

const NOT_DELIVERED_FALLBACK = 'Stop was NOT delivered';

interface ApiErrorFields {
  kind: string;
  message: string | undefined;
  deviceReply: string | undefined;
  failure: string | undefined;
}

/** A body field as one short printable line, or `undefined` when absent or not a string/number. */
function field(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (text === '') return undefined;
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}...` : text;
}

/** The `error` object of the unified body `{"error": {...}}`, or an empty object. */
function errorObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {};
  const inner = (body as { error?: unknown }).error;
  return inner !== null && typeof inner === 'object' ? (inner as Record<string, unknown>) : {};
}

function fieldsOf(body: unknown): ApiErrorFields {
  const error = errorObject(body);
  const kind = field(error.kind);
  return {
    // A kind is a snake_case word; anything else is not trusted as one.
    kind: kind !== undefined && /^[a-z_]{1,64}$/.test(kind) ? kind : 'unknown_error',
    message: field(error.message),
    deviceReply: field(error.device_reply),
    failure: field(error.failure),
  };
}

/** The node error message of an API error response (FR-18.5, FR-18.6). */
export function formatApiErrorMessage(statusCode: number, body: unknown): string {
  const fields = fieldsOf(body);
  let message = fields.message ?? 'no error message';
  if (fields.kind === 'stop_not_delivered' && !message.includes('NOT delivered')) {
    message = `${NOT_DELIVERED_FALLBACK}: ${message}`;
  }
  let text = `QInstruments BioShake API ${statusCode} ${fields.kind}: ${message}`;
  if (fields.deviceReply !== undefined) {
    text += `; device reply: ${fields.deviceReply}`;
  } else if (fields.failure !== undefined) {
    text += `; transport failure ${fields.failure}`;
  }
  return text;
}

/** The node error message of a transport failure (no API response). */
export function formatTransportErrorMessage(error: QInstrumentsBioShakeTransportError): string {
  return `QInstruments BioShake API request failed (${error.reason}): ${error.message}`;
}

/** The node error message of any error raised while sending one request. */
export function errorMessageOf(error: unknown): string {
  if (error instanceof QInstrumentsBioShakeApiError) {
    return formatApiErrorMessage(error.statusCode, error.body);
  }
  if (error instanceof QInstrumentsBioShakeTransportError) return formatTransportErrorMessage(error);
  if (error instanceof OperationParameterError) {
    return `QInstruments BioShake parameter error: ${error.message}`;
  }
  return 'QInstruments BioShake operation failed with an unexpected error';
}

/** Replace every occurrence of each non-empty value of `redactValues` in `text`. */
export function redact(text: string, redactValues: readonly (string | undefined)[]): string {
  let result = text;
  for (const value of redactValues) {
    if (typeof value === 'string' && value.length > 0) result = result.split(value).join('[redacted]');
  }
  return result;
}

/**
 * The `NodeOperationError` for `error`. It is built from a message string only, so the original
 * error object (and anything it might reference) is never attached to the n8n error.
 */
export function toNodeOperationError(
  node: INode,
  error: unknown,
  itemIndex: number,
  redactValues: readonly (string | undefined)[] = [],
): NodeOperationError {
  return new NodeOperationError(node, redact(errorMessageOf(error), redactValues), { itemIndex });
}
