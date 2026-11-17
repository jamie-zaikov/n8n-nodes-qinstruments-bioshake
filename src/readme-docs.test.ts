/**
 * Node README items of FR-3.12 and NFR-1 (design C17 `test_readme_docs.py` part d, C16 node README
 * bullet), ported from the paired API repo.
 *
 * The API repo's suite read this repo's README from outside; its three node-README checks run here,
 * in the repo that holds the README (FR-3.4, design C-13), with the same test names (FR-12.5.3) and
 * the same assertions:
 * - every fenced command line with an authenticated `/openapi.json` request verifies the server
 *   certificate (`--cacert`), names the documented URL and reads the bearer value from the
 *   environment variable;
 * - no README line carries a `-k` or `--insecure` curl flag;
 * - the README holds no secret-shaped value: the secret-shape families of the source project's
 *   shape scanner (type and line only, never the value), a private-key body, a literal bearer
 *   value, a value assigned to the environment variable, a long hex run and a high-entropy run.
 *
 * The documented address is the documentation address that replaced the source address (FR-4.11).
 * The README is read as text only, so the checks need no build. The header and environment-variable
 * names are assembled from parts, so this file itself holds no secret-shaped line.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const README = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'README.md');
const OPENAPI_URL = 'https://192.0.2.10:8744/openapi.json';
const ENV_NAME = 'QINSTRUMENTS_BIOSHAKE_API_TOKEN';
const AUTH = 'Authorization';
const BEARER = 'Bearer';
const PRAGMA_MARKER = 'pragma: allowlist secret';

/** A `-k` or `--insecure` curl flag as a standalone token (not part of a longer option). */
const INSECURE_FLAG = /(?<![\w-])(?:-k|--insecure)(?![\w-])/;

/**
 * The secret-shape families of the source project's shape scanner, with the same pattern sources
 * and flags. The private-key block is the only multi-line family.
 */
const BLOCK_FAMILY: [string, RegExp] = [
  'private-key-block',
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const LINE_FAMILIES: Array<[string, RegExp]> = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['gitlab-pat', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['openai-secret-key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['stripe-live-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['authorization-header', /(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)\S+/i],
  ['x-api-key-header', /(x-api-key\s*[:=]\s*)\S+/i],
  [
    'secret-assignment',
    /\b([\w.-]*(?:api[_-]?key|secret|token|passwd|password|pwd|access[_-]?key|private[_-]?key)[\w.-]*\s*[:=]\s*)["']?[A-Za-z0-9_\-./+=]{8,}["']?/i,
  ],
];

function readmeText(): string {
  return readFileSync(README, 'utf8').replace(/\r\n/g, '\n');
}

/** The lines of every fenced code block. */
function codeLines(text: string): string[] {
  const blocks = [...text.matchAll(/^[ \t]*```[a-z]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => m[1] as string);
  return blocks.flatMap((block) => block.split('\n').filter((line, i, all) => i < all.length - 1 || line !== ''));
}

function authenticatedOpenapiLines(text: string): string[] {
  return codeLines(text).filter((line) => line.includes('curl') && line.includes('/openapi.json'));
}

/** Family and line of each scanner-shape match; a line with the pragma marker is skipped. */
function scanContent(text: string): string[] {
  const lines = text.split('\n');
  const findings: Array<[string, number]> = [];
  lines.forEach((line, offset) => {
    for (const [name, pattern] of LINE_FAMILIES) {
      if (pattern.test(line)) findings.push([name, offset + 1]);
    }
  });
  for (const match of text.matchAll(BLOCK_FAMILY[1])) {
    findings.push([BLOCK_FAMILY[0], text.slice(0, match.index).split('\n').length]);
  }
  return findings
    .filter(([, line]) => !(lines[line - 1] ?? '').includes(PRAGMA_MARKER))
    .map(([name, line]) => `${name}:${line}`);
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let sum = 0;
  for (const n of counts.values()) sum -= (n / value.length) * Math.log2(n / value.length);
  return sum;
}

/** Secret-shaped findings of `text`: descriptions only, never the matched value. */
function secretShaped(text: string): string[] {
  const hits = scanContent(text);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push('private-key-body');
  if (new RegExp(`${AUTH}\\s*:\\s*${BEARER}\\s+(?![<$])\\S`, 'i').test(text)) hits.push('literal-bearer-value');
  if (new RegExp(`${ENV_NAME}\\s*=\\s*['"]?[A-Za-z0-9_\\-]{8,}`).test(text)) hits.push('token-assignment');
  if (/\b[0-9a-fA-F]{40,}\b/.test(text)) hits.push('long-hex-run');
  for (const [run] of text.matchAll(/[A-Za-z0-9+/=_]{32,}/g)) {
    const mixed = /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run);
    if (mixed && entropy(run) >= 4.3) hits.push('high-entropy-run');
  }
  return hits;
}

describe('node README items of FR-3.12 and NFR-1 (design C17 part d)', () => {
  it('test_fr3_12_node_readme_holds_authenticated_openapi_request', () => {
    const lines = authenticatedOpenapiLines(readmeText());
    expect(lines.length).toBeGreaterThan(0);
    const header = new RegExp(`-H "${AUTH}: ${BEARER} \\$(?:env:)?${ENV_NAME}"`);
    for (const line of lines) {
      expect(line.includes('--cacert') && line.includes(OPENAPI_URL), line).toBe(true);
      expect(header.test(line), line).toBe(true);
    }
  });

  it('test_nfr1_node_readme_has_no_insecure_flag', () => {
    expect(readmeText().split('\n').filter((line) => INSECURE_FLAG.test(line))).toEqual([]);
  });

  it('test_nfr1_node_readme_holds_no_secret_shaped_value', () => {
    expect(secretShaped(readmeText())).toEqual([]);
  });
});
