# n8n-nodes-volai

Community nodes for [Volai](https://volai.cz): send SMS, place and inspect calls, send voice messages, read account resources, and start workflows from call or message events.

## Installation

### Install from the n8n UI

In self-hosted n8n, open **Settings → Community nodes → Install**, enter `n8n-nodes-volai`, and confirm the installation. The current release is [n8n-nodes-volai 0.1.1 on npm](https://www.npmjs.com/package/n8n-nodes-volai/v/0.1.1). It was published with GitHub Actions provenance.

### Install from the GitHub archive

Use the [v0.1.1 GitHub release](https://github.com/radekklein92/n8n-nodes-volai/releases/tag/v0.1.1) as an alternative when you install community nodes manually. Download `n8n-nodes-volai-0.1.1.tgz` and verify its SHA-256 checksum:

```sh
shasum -a 256 n8n-nodes-volai-0.1.1.tgz
```

The expected checksum is `d25f85422f49a8e85600e3aa852f8aae088b7c5936d86507e7367b25d025abab`. Install the archive in the n8n runtime and restart n8n:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /path/to/n8n-nodes-volai-0.1.1.tgz
```

For Docker, run these commands in the n8n container and use the path where you copied the archive. Make sure the custom-node directory persists when the container is recreated. In queue mode, install the package wherever n8n loads workflow nodes. See the [official n8n manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation/).

Verification through the n8n Creator Portal has been requested and automated checks passed. Manual review requires a demo video and is not complete. The package is not yet verified or available on n8n Cloud.

The public source repository is [radekklein92/n8n-nodes-volai](https://github.com/radekklein92/n8n-nodes-volai). Future releases use the `publish.yml` GitHub Actions workflow with npm provenance. Its default `stage` mode uploads a candidate using a stage-only `NPM_TOKEN`; an npm maintainer then approves it with 2FA. After configuring an npm Trusted Publisher for this repository and workflow, `publish` mode can publish directly. Never commit registry credentials.

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
