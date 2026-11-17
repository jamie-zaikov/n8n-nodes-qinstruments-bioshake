/**
 * Example workflow suite (Task 25.1, 25.2, 25.4; FR-18.4, FR-18.3; design C16, OQ-4).
 *
 * Both example files are read as text and parsed as JSON; nothing here opens a socket. The
 * operation and parameter names are checked against `operations.ts` and the node description
 * from source, so an example that names an unknown operation or field fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { QInstrumentsBioShake } from './nodes/QInstrumentsBioShake/QInstrumentsBioShake.node';
import { isQInstrumentsBioShakeOperation } from './nodes/QInstrumentsBioShake/operations';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_TYPE = 'n8n-nodes-qinstruments-bioshake.qInstrumentsBioShake';
const CRED_TYPE = 'qInstrumentsBioShakeApi';

interface WorkflowNode {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  onError?: string;
  credentials?: Record<string, { id: string; name: string }>;
}

interface Workflow {
  nodes: WorkflowNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
}

interface Example {
  file: string;
  text: string;
  workflow: Workflow;
}

function load(file: string): Example {
  const text = readFileSync(path.join(packageRoot, 'examples', file), 'utf8');
  return { file, text, workflow: JSON.parse(text) as Workflow };
}

const timed = load('timed-shake.workflow.json');
const heat = load('heat-and-wait.workflow.json');
const examples = [timed, heat];

function byName(workflow: Workflow, name: string): WorkflowNode {
  const node = workflow.nodes.find((n) => n.name === name);
  expect(node, `node "${name}"`).toBeDefined();
  return node as WorkflowNode;
}

/** The node names reached from output `index` of `from`. */
function targets(workflow: Workflow, from: string, index = 0): string[] {
  return (workflow.connections[from]?.main[index] ?? []).map((t) => t.node);
}

/** The single instrument node with this operation. */
function op(workflow: Workflow, operation: string): WorkflowNode {
  const found = workflow.nodes.filter((n) => n.type === NODE_TYPE && n.parameters.operation === operation);
  expect(found, `one node with operation ${operation}`).toHaveLength(1);
  return found[0] as WorkflowNode;
}

/** True when the connection graph, without the `skip` nodes, has a directed cycle. */
function hasCycle(workflow: Workflow, skip: Set<string>): boolean {
  const state = new Map<string, 'open' | 'done'>();
  const visit = (name: string): boolean => {
    if (skip.has(name) || state.get(name) === 'done') return false;
    if (state.get(name) === 'open') return true;
    state.set(name, 'open');
    const next = (workflow.connections[name]?.main ?? []).flat().map((t) => t.node);
    const cyclic = next.some(visit);
    state.set(name, 'done');
    return cyclic;
  };
  return workflow.nodes.some((n) => visit(n.name));
}

const nodeProperties = new QInstrumentsBioShake().description.properties.map((p) => p.name);

describe.each(examples)('example $file (FR-18.4)', ({ text, workflow }) => {
  it('test_fr18_4_example_parses_and_every_connection_names_a_node', () => {
    expect(Array.isArray(workflow.nodes)).toBe(true);
    const names = new Set(workflow.nodes.map((n) => n.name));
    expect(names.size).toBe(workflow.nodes.length);
    for (const [from, value] of Object.entries(workflow.connections)) {
      expect(names.has(from), `connection source ${from}`).toBe(true);
      for (const target of value.main.flat()) expect(names.has(target.node), target.node).toBe(true);
    }
    expect(text.trim().startsWith('{')).toBe(true);
  });

  it('test_fr18_4_example_uses_only_operations_and_fields_of_the_node', () => {
    const steps = workflow.nodes.filter((n) => !n.type.startsWith('n8n-nodes-base.'));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.type, step.name).toBe(NODE_TYPE);
      expect(step.typeVersion, step.name).toBe(1);
      expect(isQInstrumentsBioShakeOperation(step.parameters.operation), String(step.parameters.operation)).toBe(true);
      for (const key of Object.keys(step.parameters)) expect(nodeProperties, `${step.name}.${key}`).toContain(key);
    }
  });

  it('test_fr18_4_example_references_the_credential_by_name_with_a_placeholder_id', () => {
    for (const step of workflow.nodes.filter((n) => n.type === NODE_TYPE)) {
      expect(Object.keys(step.credentials ?? {}), step.name).toEqual([CRED_TYPE]);
      const ref = step.credentials?.[CRED_TYPE] as { id: string; name: string };
      expect(Object.keys(ref).sort()).toEqual(['id', 'name']);
      expect(ref.id).toBe('REPLACE_WITH_CREDENTIAL_ID');
      expect(ref.name).toBe('qinstruments-bioshake-lab');
    }
  });

  it('test_fr18_4_example_holds_no_token_host_cert_or_secret_value', () => {
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/bearer/i);
    expect(text).not.toMatch(/-----BEGIN /);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(text).not.toMatch(/:8744\b/);
    expect(text).not.toMatch(/\bCOM\d+\b/);
    expect(text).not.toMatch(/"(baseUrl|caCertificate|password|apiKey)"/);
    expect(text).not.toMatch(/\beyJ[A-Za-z0-9_-]{8,}\./);
  });

  it('test_fr18_3_example_waits_only_with_n8n_wait_nodes', () => {
    const waits = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.wait');
    expect(waits).toHaveLength(1);
    const wait = waits[0] as WorkflowNode;
    expect(typeof wait.parameters.amount).toBe('number');
    expect(wait.parameters.amount as number).toBeGreaterThan(0);
    expect(['seconds', 'minutes', 'hours']).toContain(wait.parameters.unit);
    // No instrument node feeds itself: any loop goes through n8n nodes.
    for (const step of workflow.nodes.filter((n) => n.type === NODE_TYPE)) {
      expect((workflow.connections[step.name]?.main ?? []).flat().map((t) => t.node)).not.toContain(step.name);
    }
  });
});

describe('timed-shake chain and error branch (FR-18.4, OQ-4)', () => {
  const wf = timed.workflow;

  it('test_fr18_4_timed_shake_chain_lock_start_wait_stop', () => {
    const lock = op(wf, 'lockPlate');
    const start = op(wf, 'startShaking');
    const stop = op(wf, 'stopShaking');
    const wait = wf.nodes.find((n) => n.type === 'n8n-nodes-base.wait') as WorkflowNode;
    expect(targets(wf, lock.name)).toEqual([start.name]);
    expect(targets(wf, start.name)).toEqual([wait.name]);
    expect(targets(wf, wait.name)).toEqual([stop.name]);
    expect(start.parameters.rpm).toBe(1200);
    expect(hasCycle(wf, new Set())).toBe(false);
  });

  it('test_fr18_4_timed_shake_errors_after_start_reach_stop_all_then_fail', () => {
    const stopAll = op(wf, 'stopAll');
    const wait = wf.nodes.find((n) => n.type === 'n8n-nodes-base.wait') as WorkflowNode;
    for (const node of [op(wf, 'startShaking'), wait, op(wf, 'stopShaking')]) {
      expect(node.onError, node.name).toBe('continueErrorOutput');
      expect(targets(wf, node.name, 1), node.name).toEqual([stopAll.name]);
    }
    // Stop All itself has no Continue On Fail and ends in Stop and Error.
    expect(stopAll.onError).toBeUndefined();
    const after = targets(wf, stopAll.name).map((n) => byName(wf, n));
    expect(after.map((n) => n.type)).toEqual(['n8n-nodes-base.stopAndError']);
  });

  it('test_fr18_4_timed_shake_lock_failure_fails_without_a_stop', () => {
    const lock = op(wf, 'lockPlate');
    expect(lock.onError).toBe('continueErrorOutput');
    const after = targets(wf, lock.name, 1).map((n) => byName(wf, n));
    expect(after.map((n) => n.type)).toEqual(['n8n-nodes-base.stopAndError']);
  });
});

describe('heat-and-wait loop and iteration cap (FR-18.4)', () => {
  const wf = heat.workflow;
  const isIf = (n: WorkflowNode) => n.type === 'n8n-nodes-base.if';
  const capNode = (): WorkflowNode => {
    const caps = wf.nodes.filter((n) => isIf(n) && JSON.stringify(n.parameters).includes('$runIndex'));
    expect(caps).toHaveLength(1);
    return caps[0] as WorkflowNode;
  };

  it('test_fr18_4_heat_chain_set_start_check_if_wait_back', () => {
    const set = op(wf, 'setTargetTemperature');
    const start = op(wf, 'startTemperatureControl');
    const check = op(wf, 'checkAtTarget');
    expect(targets(wf, set.name)).toEqual([start.name]);
    expect(targets(wf, start.name)).toEqual([check.name]);
    const atTarget = byName(wf, targets(wf, check.name)[0] as string);
    expect(isIf(atTarget)).toBe(true);
    expect(JSON.stringify(atTarget.parameters)).toContain('$json.at_target');
    expect(check.parameters.target_c).toBe(set.parameters.temperature_c);
    // false branch -> cap -> Wait -> back to Check At Target.
    const cap = capNode();
    expect(targets(wf, atTarget.name, 1)).toEqual([cap.name]);
    const wait = byName(wf, targets(wf, cap.name, 0)[0] as string);
    expect(wait.type).toBe('n8n-nodes-base.wait');
    expect(targets(wf, wait.name)).toEqual([check.name]);
  });

  it('test_fr18_4_heat_loop_has_a_finite_cap_that_every_cycle_passes', () => {
    const cap = capNode();
    const conditions = (cap.parameters.conditions as { conditions: Array<Record<string, unknown>> }).conditions;
    expect(conditions).toHaveLength(1);
    const cond = conditions[0] as { leftValue: string; rightValue: unknown; operator: { operation: string } };
    expect(cond.leftValue).toContain('$runIndex');
    expect(['lt', 'lte']).toContain(cond.operator.operation);
    expect(Number.isInteger(cond.rightValue)).toBe(true);
    expect(cond.rightValue as number).toBeGreaterThan(0);
    expect(cond.rightValue as number).toBeLessThanOrEqual(1000);
    expect(hasCycle(wf, new Set())).toBe(true);
    expect(hasCycle(wf, new Set([cap.name]))).toBe(false);
  });

  it('test_fr18_4_heat_cap_branch_stops_temperature_control_then_fails', () => {
    const cap = capNode();
    const stop = op(wf, 'stopTemperatureControl');
    expect(targets(wf, cap.name, 1)).toEqual([stop.name]);
    expect(stop.onError).toBeUndefined();
    const after = targets(wf, stop.name).map((n) => byName(wf, n));
    expect(after.map((n) => n.type)).toEqual(['n8n-nodes-base.stopAndError']);
  });
});
