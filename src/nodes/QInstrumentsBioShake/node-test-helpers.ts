/**
 * Shared offline fakes for the QInstruments BioShake node suites (Task 24):
 * `QInstrumentsBioShake.node.test.ts` and `QInstrumentsBioShake.node-errors.test.ts`.
 *
 * Not a test file and not a build entry point: vitest collects only `*.test.ts`, and build.mjs
 * bundles only `*.credentials.ts` and `*.node.ts`. Each suite declares its own
 * `vi.mock('./transport', ...)` (vi.mock is hoisted per file) and calls `installFakeTransport`
 * in `beforeEach`, so the node never opens a socket or makes a real HTTPS call, while the
 * bearer header is still checked on the wire. The token is a short placeholder.
 */
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';

import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { vi } from 'vitest';

import { QInstrumentsBioShake } from './QInstrumentsBioShake.node';
import { sendQInstrumentsBioShakeRequest, type HttpsRequestFn } from './transport';

const actualTransport = await vi.importActual<typeof import('./transport')>('./transport');

export const TOK = 'test-tok-24';
export const CREDS = { baseUrl: 'https://bioshake.example:8744', token: TOK };

/** The mocked transport entry point (the suite must mock `./transport`). */
export const send = vi.mocked(sendQInstrumentsBioShakeRequest);

export const NODE: INode = {
  id: 'n1',
  name: 'QInstruments BioShake',
  type: 'n8n-nodes-qinstruments-bioshake.qInstrumentsBioShake',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

export interface WireCall {
  url: URL;
  options: RequestOptions;
  payload: string | undefined;
}

/** Wire calls of the fake `https.request` and its scripted responses (default 200 `{}`). */
export const fake: { wire: WireCall[]; responses: { status: number; body: string }[] } = {
  wire: [],
  responses: [],
};

const fakeRequestFn: HttpsRequestFn = (url, options, callback) => {
  const call: WireCall = { url, options, payload: undefined };
  fake.wire.push(call);
  const scripted = fake.responses.shift() ?? { status: 200, body: '{}' };
  const req = new EventEmitter() as EventEmitter & { end: (p?: string) => void; destroy: () => void };
  req.destroy = () => undefined;
  req.end = (p?: string) => {
    call.payload = p;
    setImmediate(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = scripted.status;
      callback(res as unknown as IncomingMessage);
      res.emit('data', scripted.body);
      res.emit('end');
    });
  };
  return req as unknown as ClientRequest;
};

/** Reset the wire state and route the mocked transport through the real one with the fake request. */
export function installFakeTransport(): void {
  fake.wire = [];
  fake.responses = [];
  send.mockReset();
  send.mockImplementation((credentials, request, options) =>
    actualTransport.sendQInstrumentsBioShakeRequest(credentials, request, { ...options, requestFn: fakeRequestFn }),
  );
}

export type Params = Record<string, unknown>;

/** A fake n8n execute context: one parameter map per item. */
function context(items: Params[], options: { continueOnFail?: boolean; creds?: unknown } = {}) {
  const getCredentials = vi.fn(async () => options.creds ?? CREDS);
  const ctx = {
    getInputData: () => items.map(() => ({ json: {} })),
    getCredentials,
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      const value = items[itemIndex]![name];
      if (value === undefined) {
        if (fallback === undefined) throw new Error(`parameter ${name} has no value`);
        return fallback;
      }
      return value;
    },
    getNode: () => NODE,
    continueOnFail: () => options.continueOnFail ?? false,
  };
  return { ctx: ctx as unknown as IExecuteFunctions, getCredentials };
}

export function run(items: Params[], options: { continueOnFail?: boolean; creds?: unknown } = {}) {
  const { ctx, getCredentials } = context(items, options);
  return { promise: new QInstrumentsBioShake().execute.call(ctx), getCredentials };
}

export async function rejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected execute to reject');
}
