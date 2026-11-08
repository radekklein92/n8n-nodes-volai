# n8n-nodes-volai

Community nodes for [Volai](https://volai.cz): send SMS, place and inspect calls, send voice messages, read account resources, and start workflows from call or message events.

## Installation

This package is being prepared for publication and is not yet available from npm. Until the public release, build it from this source directory and install the resulting package archive in a self-hosted n8n instance:

```sh
npm ci
npm run build
npm pack
```

Then install the generated `.tgz` using your self-hosted n8n community-node procedure. The generated archive includes the compiled Volai node, trigger, credential, and icons. After npm publication, self-hosted users can install `n8n-nodes-volai` from **Settings → Community nodes → Install**. n8n Cloud availability requires separate approval through the n8n Creator Portal; publication on npm does not imply verification.

The public source repository is [radekklein92/n8n-nodes-volai](https://github.com/radekklein92/n8n-nodes-volai). Releases use the `publish.yml` GitHub Actions workflow with npm provenance. Run it on a matching version tag (for example `v0.1.0`). Its default `stage` mode uploads a candidate using a stage-only `NPM_TOKEN`; an npm maintainer then approves it with 2FA. After configuring an npm Trusted Publisher for this repository and workflow, `publish` mode can publish directly. Never commit registry credentials.

## Credentials

Create an API key in Volai under **API and MCP**, then add a **Volai API** credential in n8n. The key is stored as a password and sent as `Authorization: Bearer …`. n8n tests the credential with `GET /v1/balance`; this reads the account balance and does not change it.

## Nodes

**Volai** provides:

- Message: Send SMS, Get, List
- Call: Create, Get, List
- Voice Message: Send
- Balance: Get
- Agent: Get, List
- Phone Number: Get, List

For create/send operations, supply a stable **Idempotency Key** tied to the upstream business event. Reuse the same key when retrying the same operation. The node deliberately does not retry writes automatically; if a request times out, inspect the corresponding resource before choosing whether to retry.

List operations return the API page envelope (`messages` or `calls`, `hasMore`, `nextBefore`). By default, the node fetches one page. Enable **Return All** to explicitly follow `nextBefore` until the API reports no more results; it stops with an error if a cursor is missing or after 1,000 pages.

**Volai Trigger** creates independent Volai webhook subscriptions for the n8n test URL and active URL. It supports `call.completed`, `call.failed`, `call.no_answer`, `call.missed`, `message.sent`, and `message.received`. Each delivery must include the saved `X-Volai-Webhook-Token`, and its event is confirmed through Volai's authenticated event lookup endpoint before the immutable payload is emitted. A failed verification is not acknowledged as a successful event. Removing or deactivating the node deletes only the subscription IDs stored by that node. If the API credential changes, restore the credential that owns the saved subscription before changing or removing it.

The trigger does not use the legacy single-webhook endpoint. Volai retries failed webhook deliveries with the same event ID. The trigger keeps a bounded history of 500 emitted event IDs per workflow mode to suppress recent duplicates; this is best-effort deduplication, not an exactly-once guarantee. A successful webhook acknowledgement confirms acceptance by n8n, not successful completion of every downstream step. Make external side effects idempotent using `event_id` and configure n8n workflow error handling.

## Example workflows

- [SMS from an upstream event](examples/send-sms.json)
- [Run on an incoming message](examples/incoming-message-trigger.json)

## Development

```sh
npm ci
npm run lint
npm run build
npm test
npm pack --dry-run
npx n8n-node dev
```

The nodes use the Volai REST API and have no runtime npm dependencies, shell access, filesystem access, or external services.

## License

MIT
