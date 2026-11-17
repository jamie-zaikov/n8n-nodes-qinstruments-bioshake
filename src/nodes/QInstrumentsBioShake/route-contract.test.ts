/**
 * The node half of the split route-contract test (FR-3.4, FR-13.4; design C-13, C16).
 *
 * Ported from the paired API repo, whose suite read this repo's `operations.ts` from outside: the
 * node's operation table is the client contract of the API. The expected table below restates the
 * design C16 table (operation ID -> method, path, body fields and query fields, in table order) as
 * the source suite did; it is not copied from the implementation, so a drift on either side fails
 * here. The route-contract snapshot `contract/api-routes.json`, which the paired API repo commits
 * byte for byte and checks its own route table against, must hold exactly the method, path and
 * query names of the same table. The test name is the one of the source test (FR-12.5.3).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildOperationRequest, OPERATION_IDS, OPERATIONS, type OperationParameters } from './operations';

const CONTRACT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../contract/api-routes.json');

/** (method, path, body fields, query fields) of one operation. */
type Row = [method: string, path: string, body: string[], query: string[]];

/** Design C16: operation ID -> row, in table order (the source suite's NODE_CONTRACT). */
const NODE_CONTRACT: Array<[string, Row]> = [
  ['getStatus', ['GET', '/v1/status', [], []]],
  ['connect', ['POST', '/v1/connect', [], []]],
  ['getDeviceInfo', ['GET', '/v1/device-info', [], []]],
  ['getLimits', ['GET', '/v1/limits', [], []]],
  ['getShakeState', ['GET', '/v1/shake/state', [], []]],
  ['getElmState', ['GET', '/v1/elm/state', [], []]],
  ['getErrorList', ['GET', '/v1/errors', [], []]],
  ['setShakeSpeed', ['PUT', '/v1/shake/speed', ['rpm'], []]],
  ['setShakeAcceleration', ['PUT', '/v1/shake/acceleration', ['acceleration_s'], []]],
  ['startShaking', ['POST', '/v1/shake/start', ['rpm', 'acceleration_s'], []]],
  ['stopShaking', ['POST', '/v1/shake/stop', ['deceleration_s'], []]],
  ['home', ['POST', '/v1/shake/home', [], []]],
  ['lockPlate', ['POST', '/v1/elm/lock', [], []]],
  ['unlockPlate', ['POST', '/v1/elm/unlock', [], []]],
  ['setTargetTemperature', ['PUT', '/v1/temperature/target', ['temperature_c'], []]],
  ['startTemperatureControl', ['POST', '/v1/temperature/start', [], []]],
  ['stopTemperatureControl', ['POST', '/v1/temperature/stop', [], []]],
  ['getActualTemperature', ['GET', '/v1/temperature/actual', [], []]],
  ['checkAtTarget', ['GET', '/v1/temperature/at-target', [], ['target_c', 'tolerance_c']]],
  ['stopAll', ['POST', '/v1/stop-all', [], []]],
  ['release', ['POST', '/v1/release', [], []]],
  ['reacquire', ['POST', '/v1/reacquire', [], []]],
];

/** Every parameter field, in the order the contract lists fields. */
const ALL_FIELDS = ['rpm', 'acceleration_s', 'deceleration_s', 'temperature_c', 'target_c', 'tolerance_c'];

/** One well-formed value per parameter, so every optional field is sent. */
const FULL: OperationParameters = {
  rpm: 1500,
  acceleration_s: 5,
  deceleration_s: 5,
  temperature_c: 37,
  target_c: 25,
  tolerance_c: 1,
};

interface ContractRoute {
  method: string;
  path: string;
  query: string[];
}

/** Field names in contract order; a field outside ALL_FIELDS fails the suite. */
function ordered(fields: string[], op: string): string[] {
  expect(fields.filter((field) => !ALL_FIELDS.includes(field)), op).toEqual([]);
  return ALL_FIELDS.filter((field) => fields.includes(field));
}

/** The node's operation table as rows: method and path of the table, fields of the built request. */
function nodeTable(): Array<[string, Row]> {
  return OPERATION_IDS.map((op): [string, Row] => {
    const definition = OPERATIONS[op];
    const request = buildOperationRequest(op, FULL);
    expect(request.method, op).toBe(definition.method);
    expect(request.path, op).toBe(definition.path);
    const body = ordered(Object.keys(request.body ?? {}), op);
    const query = ordered(Object.keys(request.query ?? {}), op);
    return [op, [definition.method, definition.path, body, query]];
  });
}

/** The routes of the snapshot; a malformed entry fails the suite. */
function contractRoutes(): ContractRoute[] {
  const document = JSON.parse(readFileSync(CONTRACT, 'utf8')) as { schema: unknown; routes: unknown };
  expect(Object.keys(document).sort()).toEqual(['routes', 'schema']);
  expect(document.schema).toBe(1);
  expect(Array.isArray(document.routes)).toBe(true);
  const routes = document.routes as ContractRoute[];
  for (const route of routes) {
    expect(Object.keys(route).sort()).toEqual(['method', 'path', 'query']);
    expect(typeof route.method === 'string' && typeof route.path === 'string').toBe(true);
    expect(Array.isArray(route.query) && route.query.every((q) => typeof q === 'string')).toBe(true);
  }
  return routes;
}

/** One comparable key per route: method, path and the query names in the given order. */
function routeKey(method: string, routePath: string, query: string[]): string {
  return `${method} ${routePath} ?${query.join('&')}`;
}

describe('node operation table is the client contract (FR-13.4, design C16)', () => {
  it('test_fr13_4_node_operation_table_matches_the_contract', () => {
    const parsed = nodeTable();
    expect(parsed).toHaveLength(22);
    expect(Object.fromEntries(parsed)).toEqual(Object.fromEntries(NODE_CONTRACT));
    // Design C16 table order.
    expect(parsed.map(([op]) => op)).toEqual(NODE_CONTRACT.map(([op]) => op));

    // The shared snapshot holds exactly the method, path and (sorted) query names of the contract,
    // as the API half of this test checks in the paired repo.
    const snapshot = contractRoutes().map((route) => routeKey(route.method, route.path, route.query));
    expect(snapshot).toHaveLength(22);
    expect(new Set(snapshot).size).toBe(22);
    const expected = NODE_CONTRACT.map(([, [method, routePath, , query]]) =>
      routeKey(method, routePath, [...query].sort()),
    );
    expect(new Set(snapshot)).toEqual(new Set(expected));
  });
});
