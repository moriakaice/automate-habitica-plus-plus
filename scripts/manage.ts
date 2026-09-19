import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { HABITICA_CLIENT_ID } from '../api.js'

const localWranglerConfig = '.wrangler.toml'
const envFile = '.env'

function runWrangler(args: string[], options: { input?: string; capture?: boolean } = {}): string {
  const result = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    input: options.input,
    stdio: options.capture ? ['pipe', 'pipe', 'inherit'] : options.input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit',
  })
  if (result.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed`)
  return result.stdout ?? ''
}

function readEnv(): Record<string, string> {
  if (!existsSync(envFile)) return {}
  const values: Record<string, string> = {}
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line
      .slice(0, separator)
      .trim()
      .replace(/^\uFEFF/, '')
    if (key !== 'USER_ID' && key !== 'API_TOKEN' && key !== 'WORKER_URL') continue
    const value = line.slice(separator + 1).trim()
    if (!value.startsWith('"')) {
      values[key] = value
      continue
    }
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'string') throw new Error(`Invalid ${key} value in ${envFile}.`)
    values[key] = parsed
  }
  return values
}

function writeEnv(values: Record<string, string>): void {
  writeFileSync(
    envFile,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
  )
  chmodSync(envFile, 0o600)
}

function putSecrets(values: Record<string, string>): void {
  const secrets = Object.fromEntries(['USER_ID', 'API_TOKEN', 'WORKER_URL'].map((key) => [key, values[key]]))
  runWrangler(['secret', 'bulk', '--config', localWranglerConfig], { input: JSON.stringify(secrets) })
}

function deploy(schedule?: string): string {
  const args = ['deploy', '--config', localWranglerConfig]
  if (schedule) args.push('--schedule', schedule)
  const result = runWrangler(args, { capture: true })
  const url = result.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0]
  if (!url) throw new Error('Wrangler did not return a Worker URL.')
  return url
}

function readConfiguredCron(): { workerName: string; cron: string } {
  const config = readFileSync(localWranglerConfig, 'utf8')
  const workerName = /^\s*name\s*=\s*["']([^"']+)["']\s*$/m.exec(config)?.[1]
  const cron = /^\s*crons\s*=\s*\[\s*["']([^"']+)["']\s*\]\s*$/m.exec(config)?.[1]
  if (!workerName || !cron) throw new Error(`Could not read Worker name and single cron schedule from ${localWranglerConfig}.`)
  return { workerName, cron }
}

function expiredCron(): string {
  const past = new Date(Date.now() - 2 * 60 * 1000)
  return `${past.getUTCMinutes()} ${past.getUTCHours()} ${past.getUTCDate()} ${past.getUTCMonth() + 1} *`
}

function deployConfiguredCron(): void {
  const { workerName, cron } = readConfiguredCron()
  runWrangler(['triggers', 'deploy', '--name', workerName, '--schedule', cron, '--config', localWranglerConfig])
}

function recreateCronTrigger(): void {
  const { workerName } = readConfiguredCron()
  runWrangler(['triggers', 'deploy', '--name', workerName, '--schedule', expiredCron(), '--config', localWranglerConfig])
  deployConfiguredCron()
}

async function waitForWorkerReady(workerUrl: string, apiToken: string): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(`${workerUrl}/ready?token=${encodeURIComponent(apiToken)}`)
    if (response.ok) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Worker secrets did not become ready within 30 seconds.')
}

async function setup(): Promise<void> {
  const existing = readEnv()
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    if (runWrangler(['whoami'], { capture: true }).trim() === '') {
      throw new Error('Cloudflare login could not be verified.')
    }
  } catch {
    console.log('Opening Cloudflare login...')
    runWrangler(['login'])
  }

  const userId = existing.USER_ID ?? (await rl.question('Habitica User ID: ')).trim()
  const apiToken = existing.API_TOKEN ?? (await rl.question('Habitica API token: ')).trim()
  if (!userId || !apiToken) throw new Error('Habitica User ID and API token are required.')
  rl.close()

  const response = await fetch('https://habitica.com/api/v3/user', {
    headers: { 'x-api-user': userId, 'x-api-key': apiToken, 'x-client': HABITICA_CLIENT_ID },
  })
  if (!response.ok) throw new Error('Habitica rejected the supplied User ID or API token.')

  if (!existsSync('config.local.ts')) writeFileSync('config.local.ts', readFileSync('config.local.example.ts'))
  if (!existsSync(localWranglerConfig)) writeFileSync(localWranglerConfig, readFileSync('.wrangler.toml.example'))
  if (!/^\s*binding\s*=\s*['"]KV['"]\s*$/m.test(readFileSync(localWranglerConfig, 'utf8'))) {
    const output = runWrangler(['kv', 'namespace', 'create', 'KV', '--binding', 'KV', '--config', localWranglerConfig], { capture: true })
    const namespaceId = /id = "([^"]+)"/.exec(output)?.[1]
    if (!namespaceId) throw new Error('Wrangler did not return a KV namespace ID.')
    writeFileSync(localWranglerConfig, `${readFileSync(localWranglerConfig, 'utf8').trimEnd()}\n\n[[kv_namespaces]]\nbinding = "KV"\nid = "${namespaceId}"\n`)
  }

  // Keep the real cron detached until code, secrets, and setup are stable.
  const workerUrl = deploy(expiredCron())
  const values = { USER_ID: userId, API_TOKEN: apiToken, WORKER_URL: workerUrl }
  putSecrets(values)
  writeEnv(values)
  await waitForWorkerReady(workerUrl, apiToken)
  const setupResponse = await fetch(`${workerUrl}/setup?token=${encodeURIComponent(apiToken)}`)
  if (!setupResponse.ok) throw new Error(`Worker setup request failed: ${setupResponse.status} ${await setupResponse.text()}`)
  deployConfiguredCron()
  recreateCronTrigger()
  console.log(`Setup complete. Worker deployed at ${workerUrl}. Run npm run status after the next scheduled time to verify execution.`)
}

interface CronStatus {
  cron: { healthy: boolean; lastRun: string | null; expression: string | null; ageMinutes: number | null }
}

async function fetchCronStatus(workerUrl: string, apiToken: string): Promise<CronStatus> {
  const response = await fetch(`${workerUrl}/status?token=${encodeURIComponent(apiToken)}`)
  if (!response.ok) throw new Error(`Worker status request failed: ${response.status}`)
  return (await response.json()) as CronStatus
}

async function status(): Promise<void> {
  const values = readEnv()
  if (!values.WORKER_URL || !values.API_TOKEN) throw new Error('Missing .env deployment details. Run npm run setup first.')
  const result = await fetchCronStatus(values.WORKER_URL, values.API_TOKEN)
  if (!result.cron.lastRun) throw new Error('Cron has not run since setup.')
  const { cron: expectedCron } = readConfiguredCron()
  console.log(`Last cron run: ${result.cron.lastRun} (${result.cron.ageMinutes} minute(s) ago, ${result.cron.expression ?? 'unknown schedule'})`)
  if (result.cron.expression !== expectedCron) {
    throw new Error(
      `Latest invocation used ${result.cron.expression ?? 'an unknown schedule'}, expected ${expectedCron}. Cloudflare may still be propagating a trigger change.`,
    )
  }
  if (!result.cron.healthy) throw new Error('Cron is stale. Run npm run repair-cron.')
}

async function repairCron(): Promise<void> {
  if (!existsSync(localWranglerConfig)) throw new Error('No local deployment found. Run npm run setup first.')
  recreateCronTrigger()
  console.log('Cron trigger recreated. Run npm run status after the next scheduled time to verify execution.')
}

async function redeploy(): Promise<void> {
  if (!existsSync(localWranglerConfig)) throw new Error('No local deployment found. Run npm run setup first.')
  const values = readEnv()
  if (!values.USER_ID || !values.API_TOKEN) throw new Error('Missing .env credentials. Run npm run setup again.')
  const workerUrl = deploy()
  values.WORKER_URL = workerUrl
  putSecrets(values)
  writeEnv(values)
  const verificationResponse = await fetch(`${workerUrl}/verify?token=${encodeURIComponent(values.API_TOKEN)}`)
  if (!verificationResponse.ok) throw new Error(`Worker verification request failed: ${verificationResponse.status}`)
  console.log(`Redeployed ${workerUrl}`)
}

async function disable(): Promise<void> {
  if (!existsSync(localWranglerConfig)) throw new Error('No local deployment found.')
  const values = readEnv()
  if (!values.WORKER_URL || !values.API_TOKEN) {
    throw new Error('Missing .env deployment URL or API token. Refusing to delete the Worker before its webhooks are removed.')
  }
  const uninstallResponse = await fetch(`${values.WORKER_URL}/uninstall?token=${encodeURIComponent(values.API_TOKEN)}`)
  if (!uninstallResponse.ok) throw new Error(`Worker uninstall request failed: ${uninstallResponse.status}`)
  runWrangler(['delete', '--force', '--config', localWranglerConfig])
  console.log('Worker deleted and Habitica webhooks removed. Your KV data and local settings were retained.')
}

const command = process.argv[2]
const actions: Record<string, () => Promise<void>> = { setup, redeploy, status, 'repair-cron': repairCron, disable }
if (!command || !actions[command]) throw new Error('Usage: manage.ts <setup|redeploy|status|repair-cron|disable>')
actions[command]().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
