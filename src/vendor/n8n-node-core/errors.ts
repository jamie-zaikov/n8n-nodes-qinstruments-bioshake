/**
 * The shared error hierarchy for every n8n node built on this base (C12, FR-5.2).
 *
 * A concrete node maps these to n8n's `NodeOperationError` / `NodeApiError` at its boundary. No
 * error message here ever carries a credential value: a node's bearer token comes from an n8n
 * credential at runtime and is referenced, never logged or embedded (NFR-1).
 */

/** Base for every error raised by this shared node base. */
export class NodeCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeCoreError';
  }
}

/**
 * A call to a paired instrument API returned a non-success HTTP status.
 *
 * Carries the numeric `statusCode` and a safe message. It never carries the request's
 * `Authorization` header or any credential value (NFR-1).
 */
export class InstrumentApiError extends NodeCoreError {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'InstrumentApiError';
    this.statusCode = statusCode;
  }
}
