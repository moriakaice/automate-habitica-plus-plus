import type { AppCtx } from '../types.js'
import { apiPost, getUser } from '../api.js'
import { STAT_ALLOCATION_MIN_LEVEL } from '../constants.js'
import { AUTO_PAUSE_RESUME_DAMAGE, STAT_TO_ALLOCATE } from '../config.js'

/**
 * Allocates all unallocated stat points to STAT_TO_ALLOCATE.
 * Run on leveledUp webhook and when the player's class changes.
 */
export async function allocateStatPoints(ctx: AppCtx): Promise<void> {
  // Always use freshly-fetched stats; a caller-supplied hint (e.g. webhook-time
  // statPoints/lvl) can be stale by the time this runs from the queue.
  const user = await getUser(ctx, true)
  const points = user.stats.points
  const level = user.stats.lvl

  if (points > 0 && level >= STAT_ALLOCATION_MIN_LEVEL && !user.preferences.disableClasses && user.flags.classSelected) {
    console.log(`Allocating ${points} unused stat points to ${STAT_TO_ALLOCATE}`)

    await apiPost('https://habitica.com/api/v3/user/allocate-bulk', ctx, { stats: { [STAT_TO_ALLOCATE]: points } })

    // If allocated to CON and player is asleep, recalculate pause/resume
    if (AUTO_PAUSE_RESUME_DAMAGE && user.preferences.sleep && STAT_TO_ALLOCATE === 'con') {
      ctx.queueBuffer.pauseResumeDamage = true
    }
  }
}
