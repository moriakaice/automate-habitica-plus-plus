import type { AppCtx } from '../types.js'
import { apiPost, getUser } from '../api.js'
import { BASE_GEM_CAP, GOLD_PER_GEM } from '../constants.js'

/**
 * Buys gems with gold (subscribers only).
 * Purchases up to the monthly cap or however many the player can afford.
 */
export async function purchaseGems(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  const plan = user.purchased.plan

  const isActive = plan.dateTerminated === null || new Date(plan.dateTerminated).getTime() > Date.now()

  if (!isActive) return

  const gemsToBuy = Math.min(BASE_GEM_CAP + plan.consecutive.gemCapExtra - plan.gemsBought, Math.floor(user.stats.gp / GOLD_PER_GEM))

  if (gemsToBuy > 0) {
    console.log(`Buying ${gemsToBuy} gems`)
    await apiPost('https://habitica.com/api/v3/user/purchase/gems/gem', ctx, { quantity: gemsToBuy })
  }
}
