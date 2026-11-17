/**
 * The HTTP contract every node uses to reach its paired instrument API (C12, FR-5.2, NFR-1).
 *
 * A node consumes its API only over HTTP, never by code import (see `<private-doc-ref>`
 * module boundaries). This module holds the shared, dependency-free pieces of that contract:
 *
 * - {@link InstrumentApiClientOptions} — how a node addresses its API (base URL + bearer token).
 * - {@link buildAuthHeader} — build the `Authorization` header with the bearer token.
 * - {@link buildApiRequest} — compose a request descriptor (method, URL, headers) from the options.
 *
 * The bearer token is supplied at runtime from an n8n credential and is referenced, never
 * hard-coded, logged, or committed (NFR-1). The actual transport (fetch / n8n request helper) is
 * performed by the concrete node; this base builds only the pure request descriptor so it is easy
 * to unit-test without a network.
 */

/** Default per-request timeout, in milliseconds, a concrete node applies to the transport. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** How a node addresses its paired instrument API. The token is referenced, never stored at rest. */
export interface InstrumentApiClientOptions {
  /** Base URL of the paired API, for example `https://api-host.example.com`. */
  baseUrl: string;
  /** Bearer token from the node's n8n credential (a runtime value, never committed). */
  bearerToken: string;
  /** Optional per-request timeout in milliseconds; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** A composed HTTP request descriptor the concrete node hands to its transport. */
export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

/**
 * Build the `Authorization` header for a bearer token (NFR-1).
 *
 * The token is placed in the header value only; it is never logged or embedded elsewhere. The
 * caller keeps the returned object out of logs.
 */
export function buildAuthHeader(bearerToken: string): Record<string, string> {
  return { Authorization: `Bearer ${bearerToken}` };
}

/**
 * Compose an {@link ApiRequest} for `method` and `path` against the client options (FR-5.2).
 *
 * Joins `baseUrl` and `path` with exactly one slash, attaches the bearer auth header, and resolves
 * the timeout (falling back to {@link DEFAULT_TIMEOUT_MS}). This is pure: it opens no socket, so a
 * unit test can assert the descriptor without a network. The transport itself is the concrete
 * node's responsibility.
 */
export function buildApiRequest(
  options: InstrumentApiClientOptions,
  method: string,
  path: string,
): ApiRequest {
  const base = options.baseUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return {
    method,
    url: `${base}/${suffix}`,
    headers: buildAuthHeader(options.bearerToken),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
