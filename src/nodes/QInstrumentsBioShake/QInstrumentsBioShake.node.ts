/**
 * Adapted from inheco_tec nodes/InhecoTec/InhecoTec.node.ts (inheco-tec feature); promotion candidate, see design DD-1.
 *
 * n8n node for the QInstruments BioShake instrument API (design C16, FR-18).
 *
 * The 22 operations of FR-18.2 (`operations.ts`, `parameters.ts`). For each input item the node
 * builds one request, sends it once (`transport.ts`) and returns the API response as soon as it
 * arrives; the node has no wait, timer or polling loop of its own (FR-18.3). A timed shake uses an
 * n8n Wait node between Start Shaking and Stop Shaking; a temperature wait uses Check At Target in
 * an n8n loop (README patterns).
 *
 * The node reaches the API only over HTTPS and imports no code from `api/`. API, transport and
 * parameter errors are mapped by `errors.ts` to a `NodeOperationError` built from body fields only,
 * with the token passed as a redaction value as a second guard (FR-18.5, FR-18.6, T23-SR-L2).
 */

import {
  NodeConnectionTypes,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';

import {
  QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME,
  type QInstrumentsBioShakeCredentialData,
} from '../../credentials/QInstrumentsBioShakeApi.credentials';
import { toNodeOperationError } from './errors';
import {
  buildOperationRequest,
  isQInstrumentsBioShakeOperation,
  OperationParameterError,
  toTransportRequest,
} from './operations';
import { properties, readParameters } from './parameters';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  sendQInstrumentsBioShakeRequest,
  type TransportOptions,
} from './transport';

/** The node icon, next to this file in `src/` and `dist/` (tasks 24.3). */
export const NODE_ICON = 'file:qinstrumentsBioShake.svg';

/** The output item of one API response. */
function toJson(response: unknown): IDataObject {
  return response !== null && typeof response === 'object' && !Array.isArray(response)
    ? (response as IDataObject)
    : { result: response as IDataObject[keyof IDataObject] };
}

export class QInstrumentsBioShake implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'QInstruments BioShake',
    name: 'qInstrumentsBioShake',
    icon: NODE_ICON,
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Control a QInstruments BioShake shaker through the QInstruments BioShake API',
    defaults: { name: 'QInstruments BioShake' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME, required: true }],
    properties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const credentials = (await this.getCredentials(
      QINSTRUMENTS_BIOSHAKE_CREDENTIAL_NAME,
    )) as unknown as QInstrumentsBioShakeCredentialData;
    const secrets = [credentials.token];
    const output: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const operation = this.getNodeParameter('operation', itemIndex) as string;
        if (!isQInstrumentsBioShakeOperation(operation)) {
          throw new OperationParameterError('operation', 'Unknown QInstruments BioShake operation');
        }
        const request = buildOperationRequest(operation, readParameters(this, operation, itemIndex));
        const options: TransportOptions = {
          timeoutMs: this.getNodeParameter('timeoutMs', itemIndex, DEFAULT_REQUEST_TIMEOUT_MS) as number,
        };
        // Exactly one request per item; the result is returned as soon as the API responds (FR-18.3).
        const response = await sendQInstrumentsBioShakeRequest(credentials, toTransportRequest(request), options);
        output.push({ json: toJson(response), pairedItem: { item: itemIndex } });
      } catch (error) {
        const nodeError = toNodeOperationError(this.getNode(), error, itemIndex, secrets);
        if (this.continueOnFail()) {
          output.push({ json: { error: nodeError.message }, pairedItem: { item: itemIndex } });
          continue;
        }
        throw nodeError;
      }
    }
    return [output];
  }
}
