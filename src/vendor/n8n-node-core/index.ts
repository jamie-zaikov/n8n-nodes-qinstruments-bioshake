/**
 * n8n-node-core: the shared TypeScript base every `instruments/<name>/node` and `n8n/nodes/<name>`
 * imports (C12, FR-5.2).
 *
 * It exposes the documented base surface for an n8n community node in this monorepo:
 *
 * - The HTTP contract to reach the paired instrument API ({@link InstrumentApiClientOptions},
 *   {@link buildAuthHeader}, {@link buildApiRequest}) — a node reaches its API only over HTTP.
 * - The shared error hierarchy ({@link NodeCoreError}, {@link InstrumentApiError}).
 * - The health-probe path contract ({@link HEALTH_PATH}), mirroring the Python API core.
 *
 * Dependency direction points inward: this core imports neither `instrument-api-core` nor any node
 * (see `<private-doc-ref>`). It is a member of the root npm workspace
 * (glob `<vendored-node-core>`) and is always `"private": true` (NFR-3). No node imports it yet.
 */

export {
  DEFAULT_TIMEOUT_MS,
  buildApiRequest,
  buildAuthHeader,
  type ApiRequest,
  type InstrumentApiClientOptions,
} from './client.js';
export { InstrumentApiError, NodeCoreError } from './errors.js';
export { HEALTH_PATH } from './health.js';

/** Package version, kept in step with `package.json`. */
export const VERSION = '0.1.0';
