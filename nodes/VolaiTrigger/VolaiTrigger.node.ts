import type { IDataObject, IHookFunctions, INodeType, INodeTypeDescription, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://volai.cz';
const EVENTS = ['call.completed', 'call.failed', 'call.no_answer', 'call.missed', 'message.sent', 'message.received'];
type Subscription = { id: string; url?: string; events?: string[]; deliveryToken?: string };
type TriggerState = { live?: (Subscription & { credentialId?: string; seenEventIds?: string[] }) ; test?: (Subscription & { credentialId?: string; seenEventIds?: string[] }) };
type Notification = { event_id?: unknown; subscription_id?: unknown; event?: unknown };

function stateFor(context: IHookFunctions | IWebhookFunctions): TriggerState {
  return context.getWorkflowStaticData('node') as TriggerState;
}
function modeKey(mode: string): 'test' | 'live' { return mode === 'manual' ? 'test' : 'live'; }
async function api<T>(context: IHookFunctions | IWebhookFunctions, method: 'GET' | 'POST' | 'DELETE', path: string, body?: object): Promise<T> {
  const request: { method: 'GET' | 'POST' | 'DELETE'; url: string; json: true; body?: object; timeout: number } = {
    method, url: `${BASE_URL}${path}`, json: true, timeout: 30_000,
  };
  if (body) request.body = body;
  return await context.helpers.httpRequestWithAuthentication.call(context, 'volaiApi', request) as T;
}
function selectedEvents(context: IHookFunctions | IWebhookFunctions): string[] {
  const value = context.getNodeParameter('events', []) as string[];
  return Array.isArray(value) ? value.filter((event) => EVENTS.includes(event)) : [];
}
function selectedSubscription(state: TriggerState, mode: string): (Subscription & { credentialId?: string; seenEventIds?: string[] }) | undefined {
  return state[modeKey(mode)];
}
function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { statusCode?: unknown; httpCode?: unknown; response?: { statusCode?: unknown } };
  for (const candidate of [value.statusCode, value.httpCode, value.response?.statusCode]) if (typeof candidate === 'number') return candidate;
  return undefined;
}
function credentialId(context: IHookFunctions): string {
  const configured = context.getNode().credentials?.volaiApi as { id?: string } | undefined;
  return configured?.id ?? '';
}
function sameEvents(a: string[] | undefined, b: string[]): boolean {
  return !!a && a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}
function respond(context: IWebhookFunctions, status: number, message: string): IWebhookResponseData {
  const response = context.getResponseObject();
  response.status(status).send(message).end();
  return { noWebhookResponse: true };
}

export class VolaiTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Volai Trigger', name: 'volaiTrigger', icon: { light: 'file:volai.svg', dark: 'file:volai.svg' }, group: ['trigger'], version: 1,
    description: 'Start a workflow when a Volai call or message event occurs', subtitle: 'On Volai event', defaults: { name: 'Volai Trigger' },
    inputs: [], outputs: [NodeConnectionTypes.Main], credentials: [{ name: 'volaiApi', required: true }],
    webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'events', restartWebhook: true }],
    properties: [{
      displayName: 'Events', name: 'events', type: 'multiOptions', required: true, default: ['call.completed', 'message.received'],
      options: EVENTS.map((event) => ({ name: event, value: event })),
      description: 'Select the events this workflow should receive',
    }],
  };

  webhookMethods = {
    default: {
      checkExists: async function (this: IHookFunctions): Promise<boolean> {
        const state = stateFor(this);
        const key = modeKey(this.getMode());
        const existing = state[key];
        if (!existing?.id) return false;
        const url = this.getNodeWebhookUrl('default');
        const events = selectedEvents(this);
        if (existing.url !== url || !sameEvents(existing.events, events) || existing.credentialId !== credentialId(this)) return false;
        try {
          const found = await api<Subscription>(this, 'GET', `/v1/webhook-subscriptions/${encodeURIComponent(existing.id)}`);
          return found.id === existing.id && found.url === existing.url && sameEvents(found.events, events);
        } catch (error) {
          if (statusCode(error) === 404) return false;
          throw new NodeOperationError(this.getNode(), error instanceof Error ? error : String(error));
        }
      },
      create: async function (this: IHookFunctions): Promise<boolean> {
        const state = stateFor(this);
        const key = modeKey(this.getMode());
        const current = state[key];
        const url = this.getNodeWebhookUrl('default');
        if (!url) throw new NodeOperationError(this.getNode(), 'n8n did not provide a webhook URL.');
        const events = selectedEvents(this);
        if (events.length === 0) throw new NodeOperationError(this.getNode(), 'Select at least one supported Volai event.');
        if (current?.id) {
          if (current.credentialId !== credentialId(this)) {
            throw new NodeOperationError(this.getNode(), 'Restore the API credential that owns this Volai subscription before changing or removing it.');
          }
          let stillOwned = false;
          try {
            const found = await api<Subscription>(this, 'GET', `/v1/webhook-subscriptions/${encodeURIComponent(current.id)}`);
            stillOwned = found.id === current.id;
            if (stillOwned && current.url === url && sameEvents(current.events, events) && current.credentialId === credentialId(this) && found.url === url && sameEvents(found.events, events)) return true;
          } catch (error) {
            if (statusCode(error) !== 404) throw new NodeOperationError(this.getNode(), error instanceof Error ? error : String(error));
          }
          if (stillOwned) await api(this, 'DELETE', `/v1/webhook-subscriptions/${encodeURIComponent(current.id)}`);
          delete state[key];
        }
        const subscription = await api<Subscription & { secret?: string }>(this, 'POST', '/v1/webhook-subscriptions', {
          url, events, label: `n8n ${key} workflow ${this.getWorkflow().id}`,
        });
        if (!subscription.id || !subscription.secret || !subscription.deliveryToken) throw new NodeOperationError(this.getNode(), 'Volai returned an incomplete subscription response.');
        state[key] = {
          id: subscription.id,
          url: subscription.url,
          events: subscription.events,
          deliveryToken: subscription.deliveryToken,
          credentialId: credentialId(this),
          seenEventIds: [],
        };
        return true;
      },
      delete: async function (this: IHookFunctions): Promise<boolean> {
        const state = stateFor(this);
        const key = modeKey(this.getMode());
        const subscription = state[key];
        if (!subscription?.id) return true;
        if (subscription.credentialId !== credentialId(this)) throw new NodeOperationError(this.getNode(), 'Restore the API credential that owns this Volai subscription before removing it.');
        await api(this, 'DELETE', `/v1/webhook-subscriptions/${encodeURIComponent(subscription.id)}`);
        delete state[key];
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const payload = this.getBodyData() as Notification;
    const state = stateFor(this);
    const subscription = selectedSubscription(state, this.getMode());
    const eventId = typeof payload.event_id === 'string' ? payload.event_id : '';
    if (!subscription?.id || payload.subscription_id !== subscription.id || !/^[A-Za-z0-9_-]{8,200}$/.test(eventId)) {
      return respond(this, 400, 'Invalid Volai event notification.');
    }
    // Tělo notifikace obsahuje jen odkaz. Událost ověřujeme načtením
    // neměnného záznamu přes autentizované API Volai.
    const headers = this.getHeaderData();
    const deliveredToken = headers['x-volai-webhook-token'];
    if (typeof deliveredToken !== 'string' || !subscription.deliveryToken || deliveredToken !== subscription.deliveryToken) {
      return respond(this, 401, 'Invalid Volai delivery token.');
    }
    const seen = subscription.seenEventIds ?? [];
    if (seen.includes(eventId)) return respond(this, 200, 'Already accepted');
    const event = await api<Record<string, unknown>>(this, 'GET', `/v1/webhook-subscriptions/${encodeURIComponent(subscription.id)}/events/${encodeURIComponent(eventId)}`);
    if (typeof event.event_id !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(event.event_id) || event.event_id !== eventId || event.subscription_id !== subscription.id || typeof event.event !== 'string' || !selectedEvents(this).includes(event.event) || typeof event.ts !== 'number' || !event.data || typeof event.data !== 'object') {
      return respond(this, 404, 'Volai event could not be verified.');
    }
    subscription.seenEventIds = [...seen, eventId].slice(-500);
    return { workflowData: [[{ json: event as IDataObject }]] };
  }

}
