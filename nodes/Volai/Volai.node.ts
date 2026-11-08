import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, IHttpRequestOptions } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type JsonRecord = Record<string, unknown>;
const BASE_URL = 'https://volai.cz';



function listQuery(context: IExecuteFunctions, itemIndex: number): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = { limit: context.getNodeParameter('limit', itemIndex) as number };
  const before = context.getNodeParameter('before', itemIndex, '') as string;
  if (before) query.before = before;
  const direction = context.getNodeParameter('direction', itemIndex, 'all') as string;
  if (direction !== 'all') query.direction = direction;
  return query;
}

export class Volai implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Volai', name: 'volai', icon: { light: 'file:volai.svg', dark: 'file:volai.svg' }, group: ['transform'], version: 1,
    description: 'Send messages and manage calls with the Volai API', subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}', defaults: { name: 'Volai' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main], usableAsTool: true,
    credentials: [{ name: 'volaiApi', required: true }],
    properties: [
      { displayName: 'Resource', name: 'resource', type: 'options', noDataExpression: true, options: [
        { name: 'Agent', value: 'agent' }, { name: 'Balance', value: 'balance' }, { name: 'Call', value: 'call' },
        { name: 'Message', value: 'message' }, { name: 'Phone Number', value: 'number' }, { name: 'Voice Message', value: 'voiceMessage' },
      ], default: 'message' },
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
        displayOptions: { show: { resource: ['message'] } }, options: [
          { name: 'Get', value: 'get', action: 'Get a message' }, { name: 'List', value: 'list', action: 'List messages' }, { name: 'Send SMS', value: 'send', action: 'Send an SMS' },
        ], default: 'send' },
      { displayName: 'To', name: 'to', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['message'], operation: ['send'] } } },
      { displayName: 'Message', name: 'body', type: 'string', typeOptions: { rows: 4 }, required: true, default: '', displayOptions: { show: { resource: ['message'], operation: ['send'] } } },
      { displayName: 'From Number', name: 'fromNumber', type: 'string', default: '', displayOptions: { show: { resource: ['message'], operation: ['send'] } } },
      { displayName: 'Idempotency Key', name: 'idempotencyKey', type: 'string', required: true, default: '', description: 'Stable key from the upstream business event. Reuse it when retrying this same send.', displayOptions: { show: { resource: ['message'], operation: ['send'] } } },
      { displayName: 'Message ID', name: 'messageId', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['message'], operation: ['get'] } } },
      { displayName: 'Limit', name: 'limit', type: 'number',
																																													description: 'Max number of results to return', typeOptions: { minValue: 1, maxValue: 200 }, default: 50, displayOptions: { show: { resource: ['message', 'call'], operation: ['list'] } } },
      { displayName: 'Before', name: 'before', type: 'string', default: '', description: 'Continue from the API nextBefore cursor', displayOptions: { show: { resource: ['message', 'call'], operation: ['list'] } } },
      { displayName: 'Direction', name: 'direction', type: 'options', options: [{ name: 'All', value: 'all' }, { name: 'Incoming', value: 'in' }, { name: 'Outgoing', value: 'out' }], default: 'all', displayOptions: { show: { resource: ['message', 'call'], operation: ['list'] } } },
      { displayName: 'Return All', name: 'returnAll', type: 'boolean', default: false, description: 'Whether to return all results or only up to a given limit', displayOptions: { show: { resource: ['message', 'call'], operation: ['list'] } } },
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, displayOptions: { show: { resource: ['call'] } }, options: [
        { name: 'Create', value: 'create', action: 'Create a call' }, { name: 'Get', value: 'get', action: 'Get a call' }, { name: 'List', value: 'list', action: 'List calls' },
      ], default: 'create' },
      { displayName: 'Call Type', name: 'callType', type: 'options', options: [{ name: 'AI Agent', value: 'agent' }, { name: 'Direct Number', value: 'from' }, { name: 'Trial Prompt', value: 'trial' }], default: 'agent', displayOptions: { show: { resource: ['call'], operation: ['create'] } } },
      { displayName: 'To', name: 'to', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['call'], operation: ['create'] } } },
      { displayName: 'Agent ID', name: 'callAgentId', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['call'], operation: ['create'], callType: ['agent'] } } },
      { displayName: 'From Number', name: 'callFrom', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['call'], operation: ['create'], callType: ['from'] } } },
      { displayName: 'System Prompt', name: 'systemPrompt', type: 'string', typeOptions: { rows: 4 }, required: true, default: '', displayOptions: { show: { resource: ['call'], operation: ['create'], callType: ['trial'] } } },
      { displayName: 'Idempotency Key', name: 'idempotencyKey', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['call'], operation: ['create'] } } },
      { displayName: 'Call ID', name: 'callId', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['call'], operation: ['get'] } } },
      { displayName: 'Wait Seconds', name: 'waitSecs', type: 'number', typeOptions: { minValue: 0, maxValue: 45 }, default: 0, displayOptions: { show: { resource: ['call'], operation: ['get'] } } },

      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, displayOptions: { show: { resource: ['voiceMessage'] } }, options: [ { name: 'Send', value: 'send', action: 'Send a voice message' } ], default: 'send' },
      { displayName: 'To', name: 'to', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['voiceMessage'] } } },
      { displayName: 'Text', name: 'voiceText', type: 'string', typeOptions: { rows: 4 }, required: true, default: '', displayOptions: { show: { resource: ['voiceMessage'] } } },
      { displayName: 'From Number', name: 'voiceFrom', type: 'string', default: '', displayOptions: { show: { resource: ['voiceMessage'] } } },
      { displayName: 'Language', name: 'voiceLanguage', type: 'string', default: '', displayOptions: { show: { resource: ['voiceMessage'] } } },
      { displayName: 'Repeat', name: 'repeat', type: 'number', typeOptions: { minValue: 1, maxValue: 3 }, default: 1, displayOptions: { show: { resource: ['voiceMessage'] } } },
      { displayName: 'Idempotency Key', name: 'idempotencyKey', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['voiceMessage'] } } },
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, displayOptions: { show: { resource: ['balance'] } }, options: [{ name: 'Get', value: 'get', action: 'Get the balance' }], default: 'get' },
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, displayOptions: { show: { resource: ['agent'] } }, options: [{ name: 'Get', value: 'get', action: 'Get an agent' }, { name: 'List', value: 'list', action: 'List agents' }], default: 'list' },
      { displayName: 'Agent ID', name: 'agentId', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['agent'], operation: ['get'] } } },
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, displayOptions: { show: { resource: ['number'] } }, options: [{ name: 'Get', value: 'get', action: 'Get a number' }, { name: 'List', value: 'list', action: 'List phone numbers' }], default: 'list' },
      { displayName: 'Phone Number', name: 'phoneNumber', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['number'], operation: ['get'] } } },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;
        let method: IHttpRequestOptions['method'] = 'GET';
        let path = '';
        let body: JsonRecord | undefined;
        let qs: Record<string, string | number | boolean> = {};
        let idempotencyKey = '';
        if (resource === 'message') {
          if (operation === 'send') {
            method = 'POST'; path = '/v1/messages'; idempotencyKey = this.getNodeParameter('idempotencyKey', i) as string;
            body = { to: this.getNodeParameter('to', i), body: this.getNodeParameter('body', i) };
            const fromNumber = this.getNodeParameter('fromNumber', i, '') as string; if (fromNumber) body.fromNumber = fromNumber;
          } else if (operation === 'get') path = `/v1/messages/${encodeURIComponent(this.getNodeParameter('messageId', i) as string)}`;
          else { path = '/v1/messages'; qs = listQuery(this, i); }
        } else if (resource === 'call') {
          if (operation === 'create') {
            method = 'POST'; path = '/v1/calls'; idempotencyKey = this.getNodeParameter('idempotencyKey', i) as string;
            const callType = this.getNodeParameter('callType', i) as string;
            body = { to: this.getNodeParameter('to', i) };
            if (callType === 'agent') body.agentId = this.getNodeParameter('callAgentId', i);
            else if (callType === 'from') body.from = this.getNodeParameter('callFrom', i);
            else if (callType === 'trial') body.systemPrompt = this.getNodeParameter('systemPrompt', i);
            else throw new NodeOperationError(this.getNode(), 'Choose a supported call type.');
          }
          else if (operation === 'get') { path = `/v1/calls/${encodeURIComponent(this.getNodeParameter('callId', i) as string)}`; qs = { waitSecs: this.getNodeParameter('waitSecs', i) as number }; }
          else { path = '/v1/calls'; qs = listQuery(this, i); }
        } else if (resource === 'voiceMessage') {
          method = 'POST'; path = '/v1/voice-messages'; idempotencyKey = this.getNodeParameter('idempotencyKey', i) as string;
          body = { to: this.getNodeParameter('to', i), text: this.getNodeParameter('voiceText', i), repeat: this.getNodeParameter('repeat', i) };
          const from = this.getNodeParameter('voiceFrom', i, '') as string; if (from) body.from = from;
          const language = this.getNodeParameter('voiceLanguage', i, '') as string; if (language) body.language = language;
        }
        else if (resource === 'balance') path = '/v1/balance';
        else if (resource === 'agent') path = operation === 'get' ? `/v1/agents/${encodeURIComponent(this.getNodeParameter('agentId', i) as string)}` : '/v1/agents';
        else if (resource === 'number') path = operation === 'get' ? `/v1/numbers/${encodeURIComponent(this.getNodeParameter('phoneNumber', i) as string)}` : '/v1/numbers';
        else throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`);
        if (method === 'POST' && !idempotencyKey.trim()) throw new NodeOperationError(this.getNode(), 'A stable Idempotency Key is required for write operations.');
        const options: IHttpRequestOptions = { method, url: `${BASE_URL}${path}`, qs, json: true, timeout: 120_000 };
        if (body) options.body = body;
        if (idempotencyKey) options.headers = { 'Idempotency-Key': idempotencyKey };
        let response = await this.helpers.httpRequestWithAuthentication.call(this, 'volaiApi', options);
        if (method === 'GET' && (resource === 'message' || resource === 'call') && operation === 'list' && this.getNodeParameter('returnAll', i, false)) {
          const key = resource === 'message' ? 'messages' : 'calls';
          const first = response as { [key: string]: unknown; hasMore?: unknown; nextBefore?: unknown };
          const rows = Array.isArray(first[key]) ? [...first[key] as unknown[]] : [];
          let hasMore = first.hasMore === true;
          let cursor = first.nextBefore;
          let pages = 1;
          const seenCursors = new Set<string>();
          while (hasMore) {
            if (typeof cursor !== 'string' && typeof cursor !== 'number') throw new NodeOperationError(this.getNode(), 'Volai returned hasMore without a usable nextBefore cursor.');
            if (++pages > 1000) throw new NodeOperationError(this.getNode(), 'Stopped after 1,000 pages. Narrow the query and continue from nextBefore.');
            const cursorKey = String(cursor);
            if (seenCursors.has(cursorKey)) throw new NodeOperationError(this.getNode(), 'Volai repeated a pagination cursor; stop and continue manually from nextBefore.');
            seenCursors.add(cursorKey);
            options.qs = { ...qs, before: cursor };
            const page = await this.helpers.httpRequestWithAuthentication.call(this, 'volaiApi', options) as { [key: string]: unknown; hasMore?: unknown; nextBefore?: unknown };
            if (Array.isArray(page[key])) rows.push(...page[key] as unknown[]);
            hasMore = page.hasMore === true;
            cursor = page.nextBefore;
          }
          response = { [key]: rows, hasMore: false, nextBefore: null };
        }
        output.push({ json: (response && typeof response === 'object' ? response : { result: response }) as IDataObject, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) { output.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: i } }); continue; }
        throw new NodeOperationError(this.getNode(), error instanceof Error ? error : String(error), { itemIndex: i });
      }
    }
    return [output];
  }
}
