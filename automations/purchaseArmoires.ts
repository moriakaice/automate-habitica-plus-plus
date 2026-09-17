import type { AppCtx } from '../types.js'
import { apiPost, getUser } from '../api.js'
import { ARMOIRE_COST } from '../constants.js'
import { RESERVE_GOLD } from '../config.js'
import { AUTO_SELL_FOOD } from '../config.js'

/**
 * Spends excess gold on Enchanted Armoires, reserving RESERVE_GOLD.
 */
export async function purchaseArmoires(ctx: AppCtx): Promise<void> {
  // Always use freshly-fetched gold; a caller-supplied hint (e.g. webhook-time gp)
  // can be stale by the time this runs from the queue.
  const user = await getUser(ctx, true)
  const currentGold = user.stats.gp
  const numArmoires = Math.max(Math.floor((currentGold - RESERVE_GOLD) / ARMOIRE_COST), 0)

  console.log(`Player gold: ${currentGold}`)
  console.log(`Gold reserve: ${RESERVE_GOLD}`)
  console.log(`Buying ${numArmoires} armoire(s)`)

  if (numArmoires > 0) {
    for (let i = 0; i < numArmoires; i++) {
      await apiPost('https://habitica.com/api/v3/user/buy-armoire', ctx)
    }
    if (AUTO_SELL_FOOD) {
      ctx.queueBuffer.sellExtraFood = true
    }
  }
}
