import type { AppCtx } from '../types.js'
import { buyHealthPotion, getUser } from '../api.js'
import { HEAL_POTION_COST, HEAL_POTION_HP, MAX_HP } from '../constants.js'

/**
 * Buys Healing Potions to fully restore the player's HP. Healing ignores the
 * general gold reserve; each potion costs 25 gold and restores 15 HP.
 */
export async function healPlayer(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  const missingHp = MAX_HP - user.stats.hp

  if (missingHp <= 0) {
    console.log('Player is already at full health, skipping heal')
    return
  }

  if (user.stats.gp < HEAL_POTION_COST) {
    console.log(`Cannot afford a Healing Potion (gold: ${user.stats.gp.toFixed(2)})`)
    return
  }

  const potionsNeeded = Math.ceil(missingHp / HEAL_POTION_HP)
  const potionsAffordable = Math.floor(user.stats.gp / HEAL_POTION_COST)
  const potionsToBuy = Math.min(potionsNeeded, potionsAffordable)

  console.log(`Player HP: ${user.stats.hp.toFixed(2)} / ${MAX_HP} (missing ${missingHp.toFixed(2)})`)
  console.log(`Buying ${potionsToBuy} Healing Potion(s) (needed: ${potionsNeeded}, affordable: ${potionsAffordable})`)

  for (let i = 0; i < potionsToBuy; i++) {
    await buyHealthPotion(ctx)
  }
}
