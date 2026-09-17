import type { AppCtx } from '../types.js'
import { apiPost } from '../api.js'
import { setKVState } from '../state.js'

/**
 * Forces the user to cron if they haven't already cronned today.
 * Run just after the user's day start time.
 */
export async function runCron(ctx: AppCtx): Promise<void> {
  console.log('Running cron')
  await apiPost('https://habitica.com/api/v3/cron', ctx)
  await setKVState(ctx, 'LAST_AFTER_CRON', new Date().toISOString())
}
