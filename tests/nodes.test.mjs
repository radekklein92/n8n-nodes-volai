import test from 'node:test';
import assert from 'node:assert/strict';
import { Volai } from '../dist/nodes/Volai/Volai.node.js';
import { VolaiTrigger } from '../dist/nodes/VolaiTrigger/VolaiTrigger.node.js';

function nodeContext(parameters, request) {
  const calls = [];
  const context = {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name, _index, fallback) => Object.hasOwn(parameters, name) ? parameters[name] : fallback,
    getNode: () => ({ name: 'Volai test' }),
    continueOnFail: () => false,
    helpers: { httpRequestWithAuthentication: async (_credential, options) => { calls.push(options); return request(options, calls.length); } },
  };
  return { context, calls };
}

test('SMS create sends API-shaped payload and stable idempotency key once', async () => {
  const { context, calls } = nodeContext({ resource: 'message', operation: 'send', to: '+420777111222', body: 'Hello', fromNumber: '+420777333444', idempotencyKey: 'crm:lead-81' }, async () => ({ id: 'msg_12345678', status: 'queued' }));
  const [[result]] = await new Volai().execute.call(context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://volai.cz/v1/messages');
  assert.deepEqual(calls[0].body, { to: '+420777111222', body: 'Hello', fromNumber: '+420777333444' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'crm:lead-81');
  assert.deepEqual(result.json, { id: 'msg_12345678', status: 'queued' });
});

test('write refuses blank idempotency and never makes a network request', async () => {
  const { context, calls } = nodeContext({ resource: 'call', operation: 'create', callType: 'agent', to: '+420777111222', callAgentId: 'agent_abc', idempotencyKey: '' }, async () => assert.fail('unexpected request'));
  await assert.rejects(() => new Volai().execute.call(context), /Idempotency Key is required/);
  assert.equal(calls.length, 0);
});

test('call creation uses selected native variant; list return-all follows API cursor', async () => {
  const create = nodeContext({ resource: 'call', operation: 'create', callType: 'from', to: '+420777111222', callFrom: '+420777333444', idempotencyKey: 'order-54' }, async () => ({ id: 'call_abc12345' }));
  await new Volai().execute.call(create.context);
  assert.deepEqual(create.calls[0].body, { to: '+420777111222', from: '+420777333444' });
  const { context, calls } = nodeContext({ resource: 'message', operation: 'list', limit: 2, before: '', direction: 'in', returnAll: true }, async (options, index) => {
    assert.equal(options.qs.direction, 'in');
    return index === 1 ? { messages: [{ id: 'm1' }], hasMore: true, nextBefore: 'cursor-2' } : { messages: [{ id: 'm2' }], hasMore: false, nextBefore: null };
  });
  const [[out]] = await new Volai().execute.call(context);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].qs.before, 'cursor-2');
  assert.deepEqual(out.json, { messages: [{ id: 'm1' }, { id: 'm2' }], hasMore: false, nextBefore: null });
});

function hookContext({ state = {}, mode = 'trigger', events = ['message.received'], credential = 'cred-1', request } = {}) {
  const calls = [];
  const httpResponses = [];
  const context = {
    getWorkflowStaticData: () => state,
    getMode: () => mode,
    getActivationMode: () => mode,
    getNodeParameter: (name, fallback) => name === 'events' ? events : fallback,
    getNodeWebhookUrl: () => mode === 'manual' ? 'https://n8n.test/webhook-test/events' : 'https://n8n.test/webhook/events',
    getWorkflow: () => ({ id: 'wf-1' }),
    getNode: () => ({ name: 'Volai Trigger', credentials: { volaiApi: { id: credential } } }),
    getBodyData: () => ({ event_id: 'evt_12345678', subscription_id: 'sub_12345678' }),
    getHeaderData: () => ({ 'x-volai-webhook-token': 'deliver-secret' }),
    getResponseObject: () => {
      const response = {
        statusCode: 200,
        body: undefined,
        ended: false,
        status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; return this; },
        end() { this.ended = true; httpResponses.push({ statusCode: this.statusCode, body: this.body, ended: this.ended }); return this; },
      };
      return response;
    },
    helpers: { httpRequestWithAuthentication: async (_credential, options) => { calls.push(options); return request(options, calls.length); } },
  };
  return { context, state, calls, httpResponses };
}

const publicSubscription = { id: 'sub_12345678', url: 'https://n8n.test/webhook/events', events: ['message.received'] };

test('trigger creates one subscription per test/live URL and reuses matching owned subscription', async () => {
  const { context, state, calls } = hookContext({ request: async (options) => options.method === 'POST' ? { ...publicSubscription, secret: 'secret', deliveryToken: 'deliver-secret' } : publicSubscription });
  const node = new VolaiTrigger();
  assert.equal(await node.webhookMethods.default.create.call(context), true);
  assert.equal(calls[0].url, 'https://volai.cz/v1/webhook-subscriptions');
  assert.equal(calls[0].body.url, 'https://n8n.test/webhook/events');
  assert.equal(state.live.id, 'sub_12345678');
  assert.equal(await node.webhookMethods.default.checkExists.call(context), true);
  assert.equal(calls.length, 2);
  const testMode = hookContext({ state, mode: 'manual', request: async () => ({ ...publicSubscription, id: 'sub_test1234', url: 'https://n8n.test/webhook-test/events', secret: 'test', deliveryToken: 'test-token' }) });
  await node.webhookMethods.default.create.call(testMode.context);
  assert.equal(state.test.id, 'sub_test1234');
  assert.equal(calls.length, 2);
});


test('trigger replaces a changed event selection only after deleting the owned subscription', async () => {
  const state = { live: { ...publicSubscription, secret: 'secret', deliveryToken: 'deliver-secret', credentialId: 'cred-1', seenEventIds: [] } };
  const calls = [];
  const context = hookContext({ state, events: ['call.completed'], request: async (options) => {
    calls.push(options.method);
    if (options.method === 'GET') return publicSubscription;
    if (options.method === 'DELETE') return {};
    return { id: 'sub_new12345', url: options.body.url, events: options.body.events, secret: 'new-secret', deliveryToken: 'new-token' };
  } }).context;
  await new VolaiTrigger().webhookMethods.default.create.call(context);
  assert.deepEqual(calls, ['GET', 'DELETE', 'POST']);
  assert.equal(state.live.id, 'sub_new12345');
  assert.deepEqual(state.live.events, ['call.completed']);
});

test('trigger does not create a second subscription after a transient ownership lookup error', async () => {
  const state = { live: { ...publicSubscription, secret: 'secret', deliveryToken: 'deliver-secret', credentialId: 'cred-1' } };
  const { context, calls } = hookContext({ state, request: async () => { throw Object.assign(new Error('temporary failure'), { statusCode: 503 }); } });
  await assert.rejects(() => new VolaiTrigger().webhookMethods.default.create.call(context), /temporary failure/);
  assert.equal(calls.length, 1);
  assert.equal(state.live.id, 'sub_12345678');
});

test('trigger refuses to attach a different credential to a stored subscription', async () => {
  const state = { live: { ...publicSubscription, secret: 'secret', deliveryToken: 'deliver-secret', credentialId: 'old-credential' } };
  const { context, calls } = hookContext({ state, request: async () => assert.fail('must not query with another credential') });
  await assert.rejects(() => new VolaiTrigger().webhookMethods.default.create.call(context), /credential that owns/);
  assert.equal(calls.length, 0);
  assert.equal(state.live.id, 'sub_12345678');
});

test('trigger refuses mismatched delivery token before lookup and emits only verified matching event', async () => {
  const state = { live: { ...publicSubscription, secret: 'hmac', deliveryToken: 'deliver-secret', seenEventIds: [] } };
  const bad = hookContext({ state, request: async () => assert.fail('bad token must be rejected before API call') });
  bad.context.getHeaderData = () => ({ 'x-volai-webhook-token': 'wrong' });
  const node = new VolaiTrigger();
  const rejected = await node.webhook.call(bad.context);
  assert.deepEqual(rejected, { noWebhookResponse: true });
  assert.deepEqual(bad.httpResponses, [{ statusCode: 401, body: 'Invalid Volai delivery token.', ended: true }]);
  assert.equal(bad.calls.length, 0);

  const good = hookContext({ state, request: async (options) => {
    assert.match(options.url, /\/events\/evt_12345678$/);
    return { event: 'message.received', data: { from: '+420700000000' }, ts: 100, event_id: 'evt_12345678', subscription_id: 'sub_12345678' };
  } });
  const accepted = await node.webhook.call(good.context);
  assert.equal(accepted.workflowData[0][0].json.event, 'message.received');
  assert.equal(accepted.webhookResponse, undefined);
  assert.deepEqual(good.httpResponses, []);
  assert.equal(good.calls.length, 1);
  const duplicate = await node.webhook.call(good.context);
  assert.equal(duplicate.workflowData, undefined);
  assert.deepEqual(duplicate, { noWebhookResponse: true });
  assert.deepEqual(good.httpResponses, [{ statusCode: 200, body: 'Already accepted', ended: true }]);
  assert.equal(good.calls.length, 1);
});

test('trigger sends malformed notifications as actual HTTP 4xx, not response-body status fields', async () => {
  const state = { live: { ...publicSubscription, deliveryToken: 'deliver-secret', seenEventIds: [] } };
  const malformed = hookContext({ state, request: async () => assert.fail('malformed event must not fetch') });
  malformed.context.getBodyData = () => ({ event_id: 'evt_12345678', subscription_id: 'sub_other' });
  const result = await new VolaiTrigger().webhook.call(malformed.context);
  assert.deepEqual(result, { noWebhookResponse: true });
  assert.deepEqual(malformed.httpResponses, [{ statusCode: 400, body: 'Invalid Volai event notification.', ended: true }]);
});

test('trigger leaves a notification retryable when the authenticated event lookup fails', async () => {
  const state = { live: { ...publicSubscription, deliveryToken: 'deliver-secret', seenEventIds: [] } };
  const { context, calls, httpResponses } = hookContext({ state, request: async () => { throw Object.assign(new Error('temporary lookup failure'), { statusCode: 503 }); } });
  await assert.rejects(() => new VolaiTrigger().webhook.call(context), /temporary lookup failure/);
  assert.equal(calls.length, 1);
  assert.deepEqual(state.live.seenEventIds, []);
  assert.deepEqual(httpResponses, []);
});

test('trigger does not discard subscription identity when delete fails', async () => {
  const state = { live: { ...publicSubscription, secret: 'secret', deliveryToken: 'deliver-secret', credentialId: 'cred-1' } };
  const { context } = hookContext({ state, request: async () => { throw Object.assign(new Error('temporary failure'), { statusCode: 503 }); } });
  await assert.rejects(() => new VolaiTrigger().webhookMethods.default.delete.call(context), /temporary failure/);
  assert.equal(state.live.id, 'sub_12345678');
});

test('trigger rejects malformed notification IDs without fetching and leaves no dedupe marker on lookup failure', async () => {
  const state = { live: { ...publicSubscription, secret: 'hmac', deliveryToken: 'deliver-secret', seenEventIds: [], credentialId: 'cred-1' } };
  const malformed = hookContext({ state, request: async () => assert.fail('invalid ID must be rejected before lookup') });
  malformed.context.getBodyData = () => ({ event_id: '../wrong', subscription_id: 'sub_12345678' });
  const node = new VolaiTrigger();
  const bad = await node.webhook.call(malformed.context);
  assert.deepEqual(bad, { noWebhookResponse: true });
  assert.deepEqual(malformed.httpResponses, [{ statusCode: 400, body: 'Invalid Volai event notification.', ended: true }]);
  assert.equal(malformed.calls.length, 0);

  const failing = hookContext({ state, request: async () => { throw Object.assign(new Error('event lookup unavailable'), { statusCode: 503 }); } });
  await assert.rejects(() => node.webhook.call(failing.context), /event lookup unavailable/);
  assert.deepEqual(state.live.seenEventIds, []);
});

test('trigger refuses a mismatched event response with an actual HTTP 404', async () => {
  const state = { live: { ...publicSubscription, secret: 'hmac', deliveryToken: 'deliver-secret', seenEventIds: [], credentialId: 'cred-1' } };
  const { context, httpResponses } = hookContext({ state, request: async () => ({ event: 'call.completed', data: {}, ts: 100, event_id: 'evt_other123', subscription_id: 'sub_12345678' }) });
  const response = await new VolaiTrigger().webhook.call(context);
  assert.deepEqual(response, { noWebhookResponse: true });
  assert.deepEqual(httpResponses, [{ statusCode: 404, body: 'Volai event could not be verified.', ended: true }]);
  assert.equal(response.workflowData, undefined);
  assert.deepEqual(state.live.seenEventIds, []);
});

test('Return All stops on incomplete or repeated pagination cursors', async () => {
  const incomplete = nodeContext({ resource: 'message', operation: 'list', limit: 2, before: '', direction: 'all', returnAll: true }, async () => ({ messages: [], hasMore: true, nextBefore: null }));
  await assert.rejects(() => new Volai().execute.call(incomplete.context), /usable nextBefore cursor/);
  const repeated = nodeContext({ resource: 'call', operation: 'list', limit: 2, before: '', direction: 'all', returnAll: true }, async () => ({ calls: [], hasMore: true, nextBefore: 21 }));
  await assert.rejects(() => new Volai().execute.call(repeated.context), /repeated a pagination cursor/);
  assert.equal(repeated.calls.length, 2);
});
