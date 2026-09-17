import type { AppCtx } from '../types.js'
import { apiPost, getContent, getDailies, getMembers, getParty, getTotalStat, getUser } from '../api.js'
import { CON_DAMAGE_DIVISOR, DAMAGE_CALC_EXPONENT, DAMAGE_ROUNDING_PRECISION, DEFAULT_BOSS_STR, MAX_HP } from '../constants.js'
import { MIN_CON_REDUCTION, PLAYER_DAMAGE_MULTIPLIER, TASK_VALUE_MAX, TASK_VALUE_MIN } from '../constants.js'
import { MAX_PARTY_DAMAGE, MAX_PLAYER_DAMAGE } from '../config.js'

/**
 * Calculates pending damage and auto-pauses/resumes damage.
 * Checks player into inn if damage exceeds MAX_PLAYER_DAMAGE or MAX_PARTY_DAMAGE.
 * Checks player out of inn when damage is safe.
 */
export async function pauseResumeDamage(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  const dailies = await getDailies(ctx)
  const content = await getContent(ctx)

  let damageToPlayer = 0
  let damageToParty = 0
  let stealth = user.stats.buffs.stealth
  // Always use freshly-fetched quest key; a caller-supplied hint (e.g. webhook-time
  // questKey) can be stale by the time this runs from the queue.
  const quest = user.party.quest.key
  const boss = quest ? content.quests[quest]?.boss : undefined
  const bossStr = boss?.str ?? DEFAULT_BOSS_STR
  const con = await getTotalStat('con', ctx)

  for (const daily of dailies) {
    if (!daily.isDue || daily.completed) continue

    if (stealth > 0) {
      stealth--
      continue
    }

    const taskValue = Math.min(Math.max(daily.value, TASK_VALUE_MIN), TASK_VALUE_MAX)
    let delta = Math.abs(Math.pow(DAMAGE_CALC_EXPONENT, taskValue))

    if (daily.checklist.length > 0) {
      const subtasksDone = daily.checklist.filter((s) => s.completed).length
      delta *= 1 - subtasksDone / daily.checklist.length
    }

    if (user.party._id !== undefined && (boss !== undefined || !quest)) {
      let bossDelta = delta
      if (daily.priority < 1) bossDelta *= daily.priority
      damageToParty += bossDelta * bossStr
    }

    damageToPlayer +=
      Math.round(delta * daily.priority * PLAYER_DAMAGE_MULTIPLIER * Math.max(MIN_CON_REDUCTION, 1 - con / CON_DAMAGE_DIVISOR) * DAMAGE_ROUNDING_PRECISION) /
      DAMAGE_ROUNDING_PRECISION
  }

  const damageTotal = Math.ceil((damageToPlayer + damageToParty) * DAMAGE_ROUNDING_PRECISION) / DAMAGE_ROUNDING_PRECISION
  const damageToPlayerRounded = Math.ceil(damageToPlayer * DAMAGE_ROUNDING_PRECISION) / DAMAGE_ROUNDING_PRECISION

  const members = await getMembers(ctx, true)
  const damageToPartyRounded = members !== null && members.length > 1 ? Math.ceil(damageToParty * DAMAGE_ROUNDING_PRECISION) / DAMAGE_ROUNDING_PRECISION : 0

  console.log(`Pending damage to player: ${damageTotal}`)
  console.log(`Pending damage to party: ${damageToPartyRounded}`)

  const hp = user.stats.hp

  if (boss !== undefined) {
    let lowestHealth = MAX_HP
    for (const member of members ?? []) {
      if (member.stats.hp < lowestHealth) lowestHealth = member.stats.hp
    }

    if (damageToPartyRounded > MAX_PARTY_DAMAGE || damageToPartyRounded >= lowestHealth || damageTotal > MAX_PLAYER_DAMAGE || damageTotal >= hp) {
      await sleep_(ctx, user)
    } else {
      await wakeUp_(ctx, user)
    }
  } else {
    if (damageToPlayerRounded > Math.min(MAX_PLAYER_DAMAGE, hp)) {
      await sleep_(ctx, user)
    } else {
      await wakeUp_(ctx, user)
    }
  }
}

async function sleep_(ctx: AppCtx, user: Awaited<ReturnType<typeof getUser>>): Promise<void> {
  if (!user.preferences.sleep) {
    console.log('Going to sleep')
    await apiPost('https://habitica.com/api/v3/user/sleep', ctx)
    user.preferences.sleep = true
  } else {
    console.log('Staying asleep')
  }
}

async function wakeUp_(ctx: AppCtx, user: Awaited<ReturnType<typeof getUser>>): Promise<void> {
  if (user.preferences.sleep) {
    console.log('Waking up')
    await apiPost('https://habitica.com/api/v3/user/sleep', ctx)
    user.preferences.sleep = false
  } else {
    console.log('Staying awake')
  }
}
