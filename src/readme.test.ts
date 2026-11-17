/**
 * Node README suite (Task 25.4, FR-3.12 Amendment A2 revised 2026-10-13, FR-18.3, FR-18.4,
 * design C16 "README + examples" and "README: API description access").
 *
 * The README is read as text only; nothing here opens a socket. The header and env-var names
 * are assembled from parts so this file itself holds no secret-shaped line for the scanner.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OPERATION_IDS } from './nodes/QInstrumentsBioShake/operations';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
const lines = readme.split(/\r?\n/);

const OPENAPI_URL = 'https://192.0.2.10:8744/openapi.json';
const ENV_NAME = 'QINSTRUMENTS_BIOSHAKE_API_TOKEN';
const AUTH = 'Authorization';
const BEARER = 'Bearer';

/** The text of the "API documentation" section (up to the next level-2 heading or the end). */
function section(heading: string): string {
  const start = readme.search(new RegExp(`^## ${heading}\\s*$`, 'm'));
  expect(start, `section "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = readme.slice(start + 3);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** README lines that hold a curl call to /openapi.json. */
function openapiCurlLines(): string[] {
  return lines.filter((line) => /\bcurl(\.exe)?\s/.test(line) && line.includes('/openapi.json'));
}

/** Escape a literal for use inside a RegExp. */
function re(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('README API documentation section (FR-3.12, A2 revised)', () => {
  const docs = section('API documentation');

  it('test_fr3_12_readme_mentions_authorize_and_private_ca_trust', () => {
    expect(docs).toMatch(/"Authorize"/);
    expect(docs).toMatch(/private CA/i);
    expect(docs).toMatch(/current-user store/i);
    expect(docs).toMatch(/api\/README\.md`? section 5c/);
  });

  it('test_fr3_12_readme_has_authenticated_openapi_curl_with_cacert_posix', () => {
    const header = `-H "${AUTH}: ${BEARER} $${ENV_NAME}"`;
    const posix = openapiCurlLines().filter((line) => /^curl\s/.test(line.trim()));
    expect(posix).toHaveLength(1);
    const line = (posix[0] as string).trim();
    expect(line).toMatch(/--cacert <path-to-platform-ca\.crt>/);
    expect(line).toContain(header);
    expect(line).toContain(OPENAPI_URL);
    // Only the scanner marker may follow the URL (a shell comment, no command change).
    expect(line).toMatch(new RegExp(`${re(OPENAPI_URL)}(\\s+# pragma: allowlist secret)?$`));
  });

  it('test_fr3_12_readme_has_authenticated_openapi_curl_with_cacert_windows', () => {
    const header = `-H "${AUTH}: ${BEARER} $env:${ENV_NAME}"`;
    const windows = openapiCurlLines().filter((line) => /^curl\.exe\s/.test(line.trim()));
    expect(windows).toHaveLength(1);
    const line = (windows[0] as string).trim();
    expect(line).toMatch(/--cacert <path-to-platform-ca\.crt>/);
    expect(line).toMatch(/--ssl-no-revoke/);
    expect(line).toContain(header);
    expect(line).toMatch(new RegExp(`${re(OPENAPI_URL)}(\\s+# pragma: allowlist secret)?$`));
    expect(docs).toMatch(/`--ssl-no-revoke` only skips the CRL lookup/);
    expect(docs).toMatch(/chain is still verified/);
  });

  it('test_fr3_12_every_bearer_header_in_readme_is_an_env_var_reference', () => {
    const headerRe = new RegExp(`${AUTH}\\s*[:=]\\s*(?:${BEARER}|basic|token)\\s+(\\S+)`, 'gi');
    const values = [...readme.matchAll(headerRe)].map((m) => m[1]);
    expect(values.length).toBeGreaterThanOrEqual(2);
    for (const value of values) {
      expect(value).toMatch(new RegExp(`^\\$(env:)?${ENV_NAME}"?$`));
    }
  });

  it('test_fr3_12_readme_has_no_insecure_flag', () => {
    expect(readme).not.toMatch(/(^|\s)-k(\s|$)/m);
    expect(readme).not.toMatch(/--insecure/);
    expect(readme).not.toMatch(/rejectUnauthorized\s*:\s*false/);
    for (const line of openapiCurlLines()) {
      expect(line).not.toMatch(/\s-[a-zA-Z]*k[a-zA-Z]*\s/);
    }
  });

  it('test_fr3_12_readme_has_no_secret_shaped_literal', () => {
    const shapes: Array<[string, RegExp]> = [
      ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['certificate block', /-----BEGIN CERTIFICATE-----/],
      ['aws key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
      ['github token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
      ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
      ['sk key', /\bsk-[A-Za-z0-9]{20,}\b/],
      ['api key header', /x-api-key\s*[:=]\s*\S+/i],
      [
        'secret assignment',
        /\b[\w.-]*(?:api[_-]?key|secret|token|passwd|password|pwd)[\w.-]*\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{8,}/i,
      ],
    ];
    for (const [label, shape] of shapes) expect(readme, label).not.toMatch(shape);
  });
});

describe('README patterns and node behaviour notes (FR-18.3, FR-18.4, C16)', () => {
  it('test_fr18_4_readme_documents_both_patterns_with_the_examples', () => {
    expect(readme).toMatch(/^## Timed-shake pattern$/m);
    expect(readme).toMatch(/^## Temperature-poll pattern$/m);
    expect(readme).toContain('(examples/timed-shake.workflow.json)');
    expect(readme).toContain('(examples/heat-and-wait.workflow.json)');
    expect(section('Timed-shake pattern')).toMatch(/\*\*Wait\*\* node between Start\s+Shaking and Stop Shaking/);
    expect(section('Temperature-poll pattern')).toMatch(/Always cap the iterations/);
    expect(section('Temperature-poll pattern')).toMatch(/\$runIndex/);
  });

  it('test_fr18_4_readme_states_the_oq4_keeps_shaking_risk', () => {
    const timed = section('Timed-shake pattern').replace(/\s+/g, ' ');
    expect(timed).toMatch(/Risk \(OQ-4\)/);
    expect(timed).toMatch(/the device keeps shaking until a stop arrives/);
  });

  it('test_c16_readme_states_the_timeout_margin_formula', () => {
    expect(readme).toMatch(/^### Timeout \(ms\): the margin formula$/m);
    expect(readme).toContain(
      'Timeout (ms) > max(Home: 12.6 s + (home_read_timeout + 1.2 s) + lock_wait_s + 2 s × 4, Stop All: 4 × 12.6 s + lock_wait_s + 2 s × 12)',
    );
    expect(readme).not.toMatch(/Timeout \(ms\) > 12\.6 s/);
    expect(readme).toMatch(/default `120000` ms still fits/);
    expect(readme).toMatch(/fits the \*\*default\*\* API configuration only/);
    expect(readme).toMatch(/raise "Timeout \(ms\)" on every node/);
  });

  it('test_c16_readme_has_device_reply_html_escape_note', () => {
    const text = readme.replace(/\s+/g, ' ');
    expect(text).toMatch(/`device reply` is raw device text/);
    expect(text).toMatch(/`device_reply` field as HTML .*escape it first/);
  });

  it('test_c16_readme_has_409_not_delivered_and_gate_refused_rows', () => {
    const text = readme.replace(/\s+/g, ' ');
    expect(text).toMatch(/\| 409 \| `stop_not_delivered` \| The message starts \*\*"Stop was NOT delivered"\*\*/);
    expect(text).toMatch(/\| 409 \| `gate_refused` \|.*\(#state-gates-vendor-manual-decode-table\)/);
  });

  it('test_fr18_8_readme_names_already_stopped_as_a_successful_stop', () => {
    const text = readme.replace(/\s+/g, ' ');
    expect(text).toMatch(/\*\*Stop Shaking\*\* returns `outcome`: `stopped` or `already_stopped`/);
    expect(text).toMatch(/`stopped`, `already_stopped`, `failed` \(with the failure\) or `not_delivered`/);
    expect(text).toMatch(/It is a \*\*successful stop\*\*/);
    expect(text).toMatch(/the two clear successes are the outcomes `stopped` and `already_stopped`/);
    expect(text).toMatch(/A `device_error` or `stop_all_failed` error body may also carry `confirmation`\. That body is \*\*not\*\* a stop/);
  });

  it('test_c16_readme_lists_all_22_operations', () => {
    const rows = lines.filter((line) => /^\| [A-Z][\w ]+ \| `[a-zA-Z]+` \| `(GET|POST|PUT) \/v1\//.test(line));
    const values = rows.map((line) => /`([a-zA-Z]+)`/.exec(line)?.[1]);
    expect(values).toEqual([...OPERATION_IDS]);
  });
});
