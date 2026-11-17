/**
 * Suite for the `qInstrumentsBioShakeApi` n8n credential (Task 23, FR-1.3, FR-18.1, design C16,
 * DD-8, P6).
 *
 * Planned as `credentials.test.ts`. The suite lives next to the transport (inheco-tec precedent):
 * the tester harness guards every `credentials/` directory as a secret store. It imports the
 * credential module unchanged.
 *
 * Pure and offline: the credential is a static description plus a base-URL guard, so nothing
 * here opens a socket. Test values are short placeholders, never real credentials.
 */
import { describe, expect, it } from 'vitest';

import {
  assertHttpsBaseUrl,
  QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME,
  QInstrumentsBioShakeApi,
} from '../../credentials/QInstrumentsBioShakeApi.credentials';

const credential = new QInstrumentsBioShakeApi();

function property(name: string) {
  const found = credential.properties.find((p) => p.name === name);
  if (found === undefined) throw new Error(`credential property ${name} is missing`);
  return found;
}

function thrown(fn: () => void): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a throw');
}

describe('QInstrumentsBioShakeApi credential description (FR-18.1, P6)', () => {
  it('test_fr18_1_credential_name_is_qInstrumentsBioShakeApi', () => {
    expect(credential.name).toBe('qInstrumentsBioShakeApi');
    expect(QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME).toBe(credential.name);
    expect(credential.displayName).toBeTruthy();
  });

  it('test_fr18_1_token_is_a_required_password_field', () => {
    const tokenField = property('token'); // pragma: allowlist secret (field name, not a value)
    expect(tokenField.type).toBe('string');
    expect(tokenField.typeOptions?.password).toBe(true);
    expect(tokenField.required).toBe(true);
    expect(tokenField.default).toBe('');
  });

  it('test_fr18_1_base_url_is_a_required_string_field_with_https_hint', () => {
    const baseUrl = property('baseUrl');
    expect(baseUrl.type).toBe('string');
    expect(baseUrl.required).toBe(true);
    expect(String(baseUrl.placeholder)).toMatch(/^https:\/\//);
    expect(baseUrl.typeOptions?.password).not.toBe(true);
  });

  it('test_p6_ca_certificate_is_an_optional_multiline_field', () => {
    const ca = property('caCertificate');
    expect(ca.type).toBe('string');
    expect(ca.required).not.toBe(true);
    expect(ca.default).toBe('');
    expect(ca.typeOptions?.rows ?? 0).toBeGreaterThan(1);
  });

  it('test_p6_has_exactly_the_three_documented_options', () => {
    expect(credential.properties.map((p) => p.name).sort()).toEqual(['baseUrl', 'caCertificate', 'token']);
  });

  it('test_fr18_1_no_option_disables_certificate_verification', () => {
    for (const p of credential.properties) {
      expect(p.type).not.toBe('boolean');
      expect(`${p.name} ${p.displayName}`).not.toMatch(
        /reject|unauthori[sz]ed|insecure|verif|ignore|skip|allow.*cert|ssl|tls/i,
      );
    }
    expect(JSON.stringify(credential)).not.toMatch(/rejectUnauthorized|allowUnauthorizedCerts|ignoreSSL/i);
  });

  it('test_dd8_no_authenticate_or_test_block', () => {
    // DD-8: the node sends requests itself over node:https so the per-credential CA applies.
    expect(credential).not.toHaveProperty('authenticate');
    expect(credential).not.toHaveProperty('test');
  });
});

describe('assertHttpsBaseUrl (FR-1.3, FR-18.1)', () => {
  it.each([
    'https://bioshake.example:8744',
    'https://bioshake.example:8744/',
    'https://203.0.113.5:8744',
    '  https://bioshake.example:8744  ',
    'HTTPS://bioshake.example:8744',
  ])('test_fr1_3_accepts_https_url %j', (url) => {
    expect(() => assertHttpsBaseUrl(url)).not.toThrow();
  });

  it.each([
    'http://bioshake.example:8744',
    'HTTP://bioshake.example:8744',
    'ftp://bioshake.example',
    'ws://bioshake.example:8744',
    'wss://bioshake.example:8744',
    'bioshake.example:8744',
    '//bioshake.example:8744',
    'https//bioshake.example',
    'https:/bioshake.example',
    '',
    '   ',
    'not a url',
  ])('test_fr1_3_rejects_non_https_base_url %j', (url) => {
    const error = thrown(() => assertHttpsBaseUrl(url));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('https://');
  });

  it.each([
    'http://user-pw-xyz@bioshake.example:8744',
    'secret-value-xyz',
    'http://bioshake.example:8744/?t=secret-value-xyz',
  ])('test_nfr1_rejection_message_does_not_echo_the_value %j', (value) => {
    const error = thrown(() => assertHttpsBaseUrl(value));
    expect(error.message).not.toContain(value);
    expect(error.message).not.toMatch(/user-pw-xyz|secret-value-xyz|bioshake\.example/);
    expect(String(error.stack)).not.toMatch(/user-pw-xyz|secret-value-xyz/);
  });
});
