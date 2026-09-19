# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Project overview

**Automate Habitica++** is a TypeScript port of [automate-habitica](https://github.com/douglasrizzo/automate-habitica/) (a Google Apps Script project) that runs on **Cloudflare Workers** instead of GAS. It automates part of Habitica gameplay: quest invites, skill casting, pet hatching/feeding, gem/armoire purchases, etc. There is no local build step beyond `tsc`/`wrangler`; deployment is via `wrangler deploy`.

## Architecture

### Execution model

`worker.ts` exports the two Cloudflare Workers entry points:

- **`scheduled()`** — runs every X minutes (configured in `.wrangler.toml`). Calls `handleTrigger()`, which mirrors GAS's `onTrigger()`.
- **`fetch()`** — handles Habitica webhook POSTs (mirrors GAS's `doPost()`) and authenticated admin GET endpoints. Each admin route requires `?token=<API_TOKEN>`:
  - `/setup` removes this Worker's existing webhooks, clears queue/application state, seeds and processes initial automation work, creates the required webhooks, and sends a Habitica confirmation PM.
  - `/uninstall` removes only this Worker's Habitica webhooks.
  - `/verify` sends a deployment-confirmation PM; `npm run redeploy` calls it after a successful deployment.
  - `/status` reports the last scheduled invocation and whether it ran within the past 20 minutes.

Webhook HTTP requests respond with `200` before work runs; actual webhook processing is passed to `ExecutionContext.waitUntil()` so Habitica does not disable a slow webhook. The scheduled handler runs trigger processing, a queue pass, any due quest invite, state flushing, and optional healthcheck ping in sequence.

### Task queue

Same conceptual design as the GAS version, backed by Cloudflare KV instead of `ScriptProperties`. `processTrigger()` and `processWebhook()` write flags into one JSON blob (`QueueState`, key `__queue__`, read/written by `readQueue`/`writeQueue` in `state.ts`). `processQueue()` reads that blob, dispatches automation in priority order, and uses a KV-based advisory lock (`tryAcquireLock`/`releaseLock`) with a 120-second TTL to avoid concurrent passes.

Webhook queue passes handle urgent items, while cron-only work (cron skill handling, excess-mana use, selling, hatching/feeding, healing, armoires, and reports) remains queued for the scheduled pass. Automations enqueue follow-up work in `ctx.queueBuffer`; `processQueue()` merges it before re-reading the queue so concurrent webhook updates are preserved. `hideAllNotifications` uses a `pending` marker to avoid losing retriggered notification work.

There's no `interruptLoop()`/script-timeout concept — Workers don't have GAS's 6-minute execution cap, so automations just run to completion.

### Context object (`AppCtx`)

GAS's module-level `let` caches (`user`, `party`, `members`, `content`, `tasks`, `dailies`) become fields on a per-invocation `AppCtx` object (see `types.ts`), created fresh by `makeCtx()` for each `fetch`/`scheduled` call and threaded explicitly through every function call (instead of relying on shared global state). Getters (`getUser`, `getParty`, etc. in `api.ts`) accept an optional `force` boolean to re-fetch, same as GAS's `updated` parameter.

`ctx.queueBuffer` lets an automation enqueue follow-up work (e.g. `pauseResumeDamage`) mid-run; it's merged into the queue at the end of `processQueue()`'s pass, replacing GAS's direct `scriptProperties.setProperty()` calls from within automations.

### Persistent state

Long-lived values (last scheduled invocation, last-cron timestamp, party ID, quest-invite schedule, notification configuration snapshots, etc.) live in a single JSON blob (`AppState`, key `__state__`). It is lazily loaded and dirty-tracked on `ctx.appState`/`ctx.appStateDirty`, then flushed once with `flushState()` at the end of each invocation. This replaces GAS's individual `scriptProperties.getProperty()`/`setProperty()` calls.

`runSetup()` clears legacy lowercase KV keys and `__state__`, but preserves the KV namespace itself. `disable` deletes the Worker and associated Habitica webhooks, while retaining the namespace and local configuration. The scheduled handler re-enables disabled webhooks and requeues their enabled event types.

### Configuration and secrets

`defaults.ts` is the versioned source of default settings. `config.ts` merges those defaults with the ignored `config.local.ts`, which contains an `export default` object of personal overrides. `npm run setup` creates `config.local.ts` from `config.local.example.ts` when absent.

`USER_ID`, `API_TOKEN`, and `WORKER_URL` are Cloudflare Worker secrets, uploaded atomically by `scripts/manage.ts` through `wrangler secret bulk`; never add them to TypeScript configuration. `HEALTHCHECK_URL` is an optional additional secret. Local `.env` is ignored and stores the deployment manager's credentials/URL; its reader supports both standard unquoted dotenv values and the JSON-quoted form it writes.

### Files

| File                              | Purpose                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaults.ts` / `config.local.ts` | Versioned defaults and ignored personal overrides. `config.ts` merges and exports the final configuration. Secrets are not TypeScript configuration.                                                                                                                                                                   |
| `worker.ts`                       | Core orchestration: `fetch`/`scheduled` entry points, queue processor, skill dispatchers, webhook (de)registration, `/setup` and `/uninstall`.                                                                                                                                                                         |
| `api.ts`                          | Habitica API wrapper (`habFetch`/`apiGet`/`apiPost`/etc. with retry + rate-limit spacing), cached data accessors (`getUser`, `getParty`, `getMembers`, `getContent`, `getTasks`/`getDailies`), stat helpers, `getQuestCompletionData()`, `getEggPotionNeeds()`, `countEggsPotionsOwnedUsed()`, `hasActiveBossQuest()`. |
| `constants.ts`                    | Read-only game constants (mana costs, damage formulas, thresholds). Not user-editable.                                                                                                                                                                                                                                 |
| `types.ts`                        | `Env` (Workers bindings/secrets), Habitica API response shapes, `AppCtx`, `QueueState`, `AppState`.                                                                                                                                                                                                                    |
| `state.ts`                        | KV-backed queue/state/lock helpers. Queue: `__queue__`; application state: `__state__`; lock: `__lock__` with a 120-second TTL.                                                                                                                                                                                        |
| `scripts/manage.ts`               | Interactive setup, deployment, cron status/repair, and disable lifecycle. Owns local `.env`, `.wrangler.toml`, Worker secrets, and setup/verification requests.                                                                                                                                                        |
| `automations/*.ts`                | One file per automation feature, mirroring `automate-habitica/automations/*.gs`.                                                                                                                                                                                                                                       |

## Deployment workflow

Use the lifecycle commands rather than manually creating secrets or calling the admin routes:

```
npm install
npm run setup       # deploy, initialize, then attach and recreate the cron trigger
npm run redeploy    # deploy and call /verify without clearing state
npm run status      # report the last scheduled invocation; fail if older than 20 minutes
npm run repair-cron # recreate the cron trigger; verify later with npm run status
npm run disable     # call /uninstall, then delete the Worker; KV remains
```

`npm run dev` starts local Wrangler development using `.wrangler.toml`. `npm run list-locks` reads `__lock__` remotely, and `npm run unlock` deletes it for recovery after confirming no execution is active. All commands requiring a deployed configuration use the ignored `.wrangler.toml`.

Use the named `npm run` scripts for project operations instead of running their underlying `wrangler`, `tsx`, `tsc`, or Prettier commands directly. The scripts select the repository's local dependency versions and supply required arguments such as `.wrangler.toml`. Use `npx` only for a narrow, file-scoped command with no matching script, such as formatting files that were edited.

Useful scripts: `npm run type-check` (tsc, no emit), `npm run format:check` (Prettier validation), and `npm run format` (writes formatting).

> Do not run `npm run format` / `prettier --write .` across the whole repo when only a few files changed — it also reformats `tmp/quest-fetch/*.json`, `package-lock.json`, etc. Format only the files you touched, e.g. `npx prettier --write api.ts worker.ts`.

There is no automated test suite. Validate logic changes with `npm run type-check`, formatting for edited files, and `wrangler tail` after deployment. The current dependency combination can produce pre-existing duplicate global-declaration errors between `@types/node` and `@cloudflare/workers-types`; distinguish those from errors in touched project files.

## Adding a new automation

1. Create `automations/myFeature.ts` implementing the automation function(s), taking `ctx: AppCtx` as the first parameter.
2. Add a feature flag constant to `config.ts` (follow existing naming conventions).
3. In `worker.ts`, add queue flag writes in `processTrigger()` and/or `processWebhook()`, and register any new `QueueState` field in `types.ts`.
4. In `processQueue()`, add a dispatch block in priority order, following the existing `if (q.xxx !== undefined) { ...; delete q.xxx; anyProcessed = true }` pattern. Decide explicitly whether webhook context may process it; cron-only work must be guarded with `!isWebhook`.
5. Register any required Habitica webhook type/options in `createWebhooks()`. Include any persistent values in `AppState` and use the `getKVState`/`setKVState` helpers.

## Porting changes from `automate-habitica` (the GAS original)

This repo is a manual, from-scratch port — there's no shared code or automated sync with `automate-habitica`. When the GAS project gets updates that should flow into this repo:

1. In the `automate-habitica` repo, find what changed since the last port:
   ```
   git log --oneline <LAST_PORTED_COMMIT>^..HEAD
   git diff <LAST_PORTED_COMMIT>^..HEAD -- constants.gs setup.gs global.gs automations/
   ```
2. Read each changed `.gs` file's new behavior in full (not just the diff) — GAS's global mutable state (`user`, `party`, `content`, `scriptProperties`, etc.) often means a small diff hides a larger behavioral change once you trace how it's used.
3. Re-implement the _behavior_, not the literal code, in the equivalent TS file(s) — translate:
   - `scriptProperties.setProperty("flag", "true")` → a `QueueState`/`AppState` field + `set('flag', true)` in `worker.ts`, or `getKVState`/`setKVState` in `state.ts`.
   - Direct global reads (`user.stats.mp`) → `await getUser(ctx)` (or the cached variable already in scope).
   - `ScriptApp.newTrigger(...).after(ms)` (delayed trigger) → `scheduleQuestInvite`-style KV-scheduled entry, checked on the next `scheduled()` run (see `runScheduledQuestInviteIfDue` in `automations/inviteQuest.ts` for the existing pattern).
   - New shared helpers added to `global.gs` → add them to `api.ts` (if they need cached API data) so multiple automations can reuse them, same as the GAS version consolidating duplicate logic.
4. Update `config.ts`/`constants.ts` to match renamed/added/removed settings, and update `types.ts` (`QueueState`, `AppState`) for any new persistent fields.
5. Run `npm run type-check` and fix errors in files you touched. (Pre-existing `@types/node` vs `@cloudflare/workers-types` global-lib duplicate-identifier errors in `node_modules` are unrelated environment noise — ignore them.)
6. Update this file's `<!-- LAST_PORTED_COMMIT -->` marker below to the new `automate-habitica` HEAD hash you ported through.

<!-- LAST_PORTED_COMMIT: 2f156dff098cb86d6cec292cc4534997b699a97e -->
