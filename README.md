# Automate Habitica++

**Automate Habitica++** is a TypeScript port of [automate-habitica](https://github.com/douglasrizzo/automate-habitica/) (a Google Apps Script project) that runs on **Cloudflare Workers** instead of GAS.

## Prerequisites

- [Node.js 22 or newer](https://nodejs.org/en/download) and [Git](https://git-scm.com/downloads).
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) is installed locally by `npm install`; no global installation is required.
- A Cloudflare account. The setup command opens `wrangler login` when needed.
- Your Habitica User ID and API token, available from Habitica's [Settings > Site Data](https://habitica.com/user/settings/siteData) page. Habitica does not expose an OAuth or API flow to obtain these credentials programmatically.

## Install and deploy

```sh
git clone <repository-url>
cd automate-habitica-plus-plus
npm install
npm run setup
```

`npm run setup` prompts for the Habitica credentials, validates them, creates a Cloudflare KV namespace, deploys the Worker, atomically installs its secrets, and registers the Habitica webhooks. It stores credentials in ignored `.env`, deployment details in ignored `.wrangler.toml`, and creates ignored `config.local.ts` from the example. Setup keeps the real cron detached until the Worker, secrets, and application setup are stable, then attaches and deliberately recreates the configured schedule before finishing. Once the Worker finishes setup, it sends a Habitica private message as confirmation.

## Everyday commands

```sh
npm run update    # fast-forward the repository and install changed dependencies
npm run redeploy  # deploy code/config changes without resetting stored automation state
npm run status    # show the last scheduled run and fail if it is stale
npm run repair-cron # recreate a stale Cloudflare cron trigger
npm run disable   # remove webhooks and delete the Worker; KV data is retained
```

Each successful `npm run redeploy` also sends a Habitica private message from the new Worker as a deployment check.

The Worker records every scheduled invocation and its cron expression before running automation. After the next scheduled time, `npm run status` reports the last invocation and exits with an error if it is stale or came from a different expression. If it is unhealthy, `npm run repair-cron` recreates the trigger immediately; run `npm run status` later to verify execution after Cloudflare propagation.

Run `npm run setup` again to reinitialize the Worker and webhooks. It reuses the existing KV namespace, but clears its automation state as part of initialization.

## Personal settings

The versioned [defaults.ts](defaults.ts) contains the project defaults. Put only personal changes in the ignored `config.local.ts`; start from [config.local.example.ts](config.local.example.ts). For example:

```ts
const overrides = {
  AUTO_PURCHASE_GEMS: true,
  BANNED_SCROLLS: ['The Basi-List'],
}

export default overrides
```
