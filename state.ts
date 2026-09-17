import type { AppCtx, AppState, Env, QueueState } from './types.js'

/**
 * Thin wrapper around Cloudflare KV that mirrors the scriptProperties API
 * from Google Apps Script.
 */
export class State {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key)
  }

  async set(key: string, value: string): Promise<void> {
    await this.kv.put(key, value)
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key)
  }

  async has(key: string): Promise<boolean> {
    return (await this.kv.get(key)) !== null
  }

  /** Returns all keys that start with a lowercase letter (queue entries). */
  async getQueueKeys(): Promise<string[]> {
    const list = await this.kv.list()
    return list.keys.map((k) => k.name).filter((k) => /^[a-z]/.test(k))
  }

  /** Returns all key-value pairs. */
  async getAll(): Promise<Record<string, string>> {
    const list = await this.kv.list()
    const result: Record<string, string> = {}
    await Promise.all(
      list.keys.map(async ({ name }) => {
        const val = await this.kv.get(name)
        if (val !== null) result[name] = val
      }),
    )
    return result
  }
}

// ─── KV-based distributed lock ────────────────────────────────────────────────

const LOCK_KEY = '__lock__'
const LOCK_TTL_SECONDS = 120 // 2-minute lock TTL

/**
 * Attempts to acquire a KV-based advisory lock.
 * Returns true if the lock was acquired, false if already held.
 */
export async function tryAcquireLock(kv: KVNamespace): Promise<boolean> {
  const existing = await kv.get(LOCK_KEY)
  if (existing !== null) return false
  // Store lock with TTL so it auto-expires if the worker crashes
  await kv.put(LOCK_KEY, Date.now().toString(), { expirationTtl: LOCK_TTL_SECONDS })
  return true
}

export async function releaseLock(kv: KVNamespace): Promise<void> {
  await kv.delete(LOCK_KEY)
}

// ─── JSON queue ───────────────────────────────────────────────────────────────

const QUEUE_KEY = '__queue__'

/** Reads the pending automation queue from KV. Returns an empty object if unset or unparseable. */
export async function readQueue(kv: KVNamespace): Promise<QueueState> {
  const raw = await kv.get(QUEUE_KEY)
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as QueueState
  } catch {
    return {}
  }
}

/** Persists the queue back to KV. Deletes the key when the queue is empty. */
export async function writeQueue(kv: KVNamespace, queue: QueueState): Promise<void> {
  if (Object.keys(queue).length === 0) {
    await kv.delete(QUEUE_KEY)
  } else {
    await kv.put(QUEUE_KEY, JSON.stringify(queue))
  }
}

/** Creates a State instance from a CF Worker Env binding. */
export function createState(env: Env): State {
  return new State(env.KV)
}

// ─── Persistent KV state helpers ─────────────────────────────────────────────

const STATE_KEY = '__state__'

async function readState(kv: KVNamespace): Promise<AppState> {
  const raw = await kv.get(STATE_KEY)
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as AppState
  } catch {
    return {}
  }
}

async function ensureStateLoaded(ctx: AppCtx): Promise<void> {
  if (!ctx.appState) ctx.appState = await readState(ctx.env.KV)
}

/** Reads a persistent state value. Lazy-loads the __state__ blob on first access. */
export async function getKVState<K extends keyof AppState>(ctx: AppCtx, key: K): Promise<AppState[K]> {
  await ensureStateLoaded(ctx)
  return ctx.appState![key]
}

/** Writes a persistent state value into the in-memory cache (flushed at end of execution). */
export async function setKVState<K extends keyof AppState>(ctx: AppCtx, key: K, value: NonNullable<AppState[K]>): Promise<void> {
  await ensureStateLoaded(ctx)
  ctx.appState![key] = value
  ctx.appStateDirty = true
}

/** Deletes a persistent state value from the in-memory cache (flushed at end of execution). */
export async function deleteKVState<K extends keyof AppState>(ctx: AppCtx, key: K): Promise<void> {
  await ensureStateLoaded(ctx)
  delete ctx.appState![key]
  ctx.appStateDirty = true
}

/** Flushes the __state__ blob to KV if anything was changed. Called once at end of execution. */
export async function flushState(ctx: AppCtx): Promise<void> {
  if (!ctx.appStateDirty || !ctx.appState) return
  await ctx.env.KV.put(STATE_KEY, JSON.stringify(ctx.appState))
  ctx.appStateDirty = false
}
