import type { AppCtx } from '../types.js'
import { apiPost, getEggPotionNeeds, getUser } from '../api.js'
import { AUTO_PURCHASE_ARMOIRES, RESERVE_FOOD } from '../config.js'

/**
 * Sells extra eggs beyond the amount needed for all non-special pet and mount
 * combinations. Computes the exact need from the player's inventory, hatched
 * pets, and mounts – no manual reserve configuration required.
 */
export async function sellExtraEggs(ctx: AppCtx): Promise<void> {
  const needs = await getEggPotionNeeds(ctx)
  const user = await getUser(ctx)
  let logged = false

  for (const [egg, amount] of Object.entries(user.items.eggs)) {
    // skip egg types that are not part of any standard/quest pet combo
    if (!(egg in needs.eggsNeeded)) continue

    const ownedUsed = needs.eggsOwnedUsed[egg] ?? amount
    const nonInventoryUsed = ownedUsed - amount
    const stillNeeded = Math.max(0, needs.eggsNeeded[egg] - nonInventoryUsed)
    const sellAmount = amount - stillNeeded

    if (sellAmount > 0) {
      if (!logged) {
        console.log('Selling extra eggs')
        logged = true
      }
      await apiPost(`https://habitica.com/api/v3/user/sell/eggs/${egg}?amount=${sellAmount}`, ctx)
    }
  }

  if (AUTO_PURCHASE_ARMOIRES) {
    ctx.queueBuffer.purchaseArmoires = true
  }
}

/**
 * Sells extra hatching potions beyond the amount needed for all non-special
 * pet and mount combinations. Computes the exact need from the player's
 * inventory, hatched pets, and mounts – no manual reserve configuration required.
 */
export async function sellExtraHatchingPotions(ctx: AppCtx): Promise<void> {
  const needs = await getEggPotionNeeds(ctx)
  const user = await getUser(ctx)
  let logged = false

  for (const [potion, amount] of Object.entries(user.items.hatchingPotions)) {
    // skip potion types that are not part of any standard/quest pet combo
    if (!(potion in needs.potionsNeeded)) continue

    const ownedUsed = needs.potionsOwnedUsed[potion] ?? amount
    const nonInventoryUsed = ownedUsed - amount
    const stillNeeded = Math.max(0, needs.potionsNeeded[potion] - nonInventoryUsed)
    const sellAmount = amount - stillNeeded

    if (sellAmount > 0) {
      if (!logged) {
        console.log('Selling extra hatching potions')
        logged = true
      }
      await apiPost(`https://habitica.com/api/v3/user/sell/hatchingPotions/${potion}?amount=${sellAmount}`, ctx)
    }
  }

  if (AUTO_PURCHASE_ARMOIRES) {
    ctx.queueBuffer.purchaseArmoires = true
  }
}

/**
 * Sells extra food, reserving RESERVE_FOOD of each type.
 */
export async function sellExtraFood(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  let logged = false

  for (const [food, amount] of Object.entries(user.items.food)) {
    if (food !== 'Saddle' && amount > RESERVE_FOOD) {
      if (!logged) {
        console.log('Selling extra food')
        logged = true
      }
      await apiPost(`https://habitica.com/api/v3/user/sell/food/${food}?amount=${amount - RESERVE_FOOD}`, ctx)
    }
  }

  if (AUTO_PURCHASE_ARMOIRES) {
    ctx.queueBuffer.purchaseArmoires = true
  }
}
