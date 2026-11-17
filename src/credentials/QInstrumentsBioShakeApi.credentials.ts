/**
 * Adapted from inheco_tec credentials/InhecoTecApi.credentials.ts (inheco-tec feature); promotion candidate, see design DD-1.
 *
 * The `qInstrumentsBioShakeApi` n8n credential (design C16, P6, FR-18.1, FR-1.3).
 *
 * It holds the HTTPS base URL of the QInstruments BioShake API, the bearer token (an n8n password
 * field), and an optional CA certificate (public PEM of the platform private CA) that verifies the
 * API's TLS certificate. No option turns off certificate verification. The node sends requests
 * itself over `node:https` (DD-8), so this credential declares no `authenticate` or `test` block
 * that would route through the n8n request helpers without the per-credential CA.
 */

import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/** The credential type name the node references. */
export const QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME = 'qInstrumentsBioShakeApi';

/** The values the credential stores, as the transport reads them. */
export interface QInstrumentsBioShakeCredentialData {
  baseUrl: string;
  token: string;
  caCertificate?: string;
}

/**
 * Fail unless `baseUrl` is an absolute `https://` URL (FR-1.3: the API is reached over HTTPS only).
 *
 * The error message never echoes the value: a mistyped credential field could hold the token.
 */
export function assertHttpsBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new Error(
      'QInstruments BioShake API base URL is not a valid URL; it must start with https://',
    );
  }
  if (parsed.protocol !== 'https:' || !baseUrl.trim().toLowerCase().startsWith('https://')) {
    throw new Error('QInstruments BioShake API base URL must start with https://');
  }
}

export class QInstrumentsBioShakeApi implements ICredentialType {
  name = QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME;

  displayName = 'QInstruments BioShake API';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://<host>:8744',
      description:
        'HTTPS base URL of the QInstruments BioShake API. It must start with https://; plain HTTP is rejected.',
    },
    {
      displayName: 'Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Bearer token of the QInstruments BioShake API, sent in the bearer Authorization header',
    },
    {
      displayName: 'CA Certificate',
      name: 'caCertificate',
      type: 'string',
      typeOptions: { rows: 6 },
      default: '',
      placeholder: '-----BEGIN CERTIFICATE-----',
      description:
        'Optional PEM of the CA that issued the API certificate (public data). When empty, the system trust store verifies the certificate. Certificate verification is always on.',
    },
  ];
}
