/**
 * The health-probe path contract shared with the paired instrument API (C12, FR-5.2).
 *
 * This mirrors `instrument_api_core.health.HEALTH_PATH` on the Python side. A node may probe the
 * paired API's liveness over HTTP at this path; the probe is unauthenticated on the API and its
 * body carries a status token only, never a host or port.
 */

/** The unauthenticated liveness/readiness path the paired API exposes (mirrors the API core). */
export const HEALTH_PATH = '/healthz';
