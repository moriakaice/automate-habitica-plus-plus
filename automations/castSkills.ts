/**
 * All class skill-casting automations.
 * Covers Healer, Mage, Warrior, and Rogue classes.
 */

import type { AppCtx } from '../types.js'
import { apiPost, calculatePerfectDayBuff, getDailies, getMembers, getParty, getTasks, getTotalStat, getUser, hasActiveBossQuest } from '../api.js'
import {
  BLESSING_HEAL_MULTIPLIER,
  BLESSING_STAT_BONUS,
  BRUTAL_SMASH_BASE_DAMAGE,
  BRUTAL_SMASH_STR_DIVISOR,
  BURST_OF_FLAMES_INT_DIVISOR,
  DEFAULT_BOSS_HP,
  HEALING_LIGHT_MULTIPLIER,
  HEALING_RESERVE_HOURS,
  LEVEL_CAP_FOR_BONUSES,
  MANA_COST_BACKSTAB,
  MANA_COST_BLESSING,
  MANA_COST_BRUTAL_SMASH,
  MANA_COST_BURST_OF_FLAMES,
  MANA_COST_CHILLING_FROST,
  MANA_COST_DEFENSIVE_STANCE,
  MANA_COST_EARTHQUAKE,
  MANA_COST_ETHEREAL_SURGE,
  MANA_COST_HEALING_LIGHT,
  MANA_COST_PICKPOCKET,
  MANA_COST_PROTECTIVE_AURA,
  MANA_COST_STEALTH,
  MANA_COST_TOOLS_OF_TRADE,
  MANA_COST_VALOROUS_PRESENCE,
  MAX_HP,
  SKILL_1_LEVEL,
  SKILL_2_LEVEL,
  SKILL_3_LEVEL,
  SKILL_4_LEVEL,
  STEALTH_BASE_RATE,
  STEALTH_PER_DIVISOR,
} from '../constants.js'
import { AUTO_PAUSE_RESUME_DAMAGE } from '../config.js'

// ─── Healer ────────────────────────────────────────────────────────────────────

/**
 * Casts Protective Aura until excess mana is used up.
 * Reserves mana for party healing.
 */
export async function castProtectiveAura(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  if (user.stats.lvl < SKILL_3_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, cannot cast Protective Aura`)
    return
  }

  console.log(`Mana: ${user.stats.mp}`)

  const int = await getTotalStat('int', ctx)
  const con = await getTotalStat('con', ctx)
  const healPartyMana = Math.ceil(MAX_HP / ((con + int + BLESSING_STAT_BONUS) * BLESSING_HEAL_MULTIPLIER)) * MANA_COST_BLESSING * HEALING_RESERVE_HOURS
  const numAuras = Math.max(Math.floor((user.stats.mp - healPartyMana) / MANA_COST_PROTECTIVE_AURA), 0)

  console.log(`Reserving ${healPartyMana} mana for healing the party`)
  console.log(`Casting Protective Aura ${numAuras} time(s)`)

  for (let i = 0; i < numAuras; i++) {
    await apiPost('https://habitica.com/api/v3/user/class/cast/protectAura', ctx)
  }

  if (AUTO_PAUSE_RESUME_DAMAGE && user.preferences.sleep) {
    ctx.queueBuffer.pauseResumeDamage = true
  }
}

/**
 * Casts Blessing to heal party members, then Healing Light for self.
 * Run every 10 mins.
 */
export async function healParty(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)

  if (user.stats.lvl < SKILL_1_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, cannot cast healing skills`)
    return
  }

  const con = await getTotalStat('con', ctx)
  const int = await getTotalStat('int', ctx)
  let numBlessings = 0

  if (user.stats.lvl >= SKILL_4_LEVEL && (await getMembers(ctx)) !== null && (await getMembers(ctx))!.length > 1) {
    const members = (await getMembers(ctx))!
    let lowestMemberHealth = MAX_HP
    for (const member of members) {
      if (member._id !== user._id && member.stats.hp < lowestMemberHealth) {
        lowestMemberHealth = member.stats.hp
      }
    }

    const healthPerBlessing = (con + int + BLESSING_STAT_BONUS) * BLESSING_HEAL_MULTIPLIER
    numBlessings = Math.min(Math.ceil((MAX_HP - lowestMemberHealth) / healthPerBlessing), Math.floor(user.stats.mp / MANA_COST_BLESSING))

    if (numBlessings > 0) {
      console.log(`Mana: ${user.stats.mp}`)
      console.log(`Lowest party member health: ${lowestMemberHealth}`)
      console.log(`Casting Blessing ${numBlessings} time(s)`)

      for (let i = 0; i < numBlessings; i++) {
        await apiPost('https://habitica.com/api/v3/user/class/cast/healAll', ctx)
        user.stats.mp -= MANA_COST_BLESSING
        user.stats.hp = Math.min(user.stats.hp + healthPerBlessing, MAX_HP)
      }
    }
  } else if (user.stats.lvl < SKILL_4_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, cannot cast Blessing`)
  }

  const numLights = Math.min(
    Math.max(Math.ceil((MAX_HP - user.stats.hp) / ((con + int + BLESSING_STAT_BONUS) * HEALING_LIGHT_MULTIPLIER)), 0),
    Math.floor(user.stats.mp / MANA_COST_HEALING_LIGHT),
  )

  if (numLights > 0) {
    console.log(`Mana: ${user.stats.mp}`)
    console.log(`Player health: ${user.stats.hp}`)
    console.log(`Casting Healing Light ${numLights} time(s)`)

    for (let i = 0; i < numLights; i++) {
      try {
        await apiPost('https://habitica.com/api/v3/user/class/cast/heal', ctx)
      } catch (err: unknown) {
        if (!(err instanceof Error) || !err.message.includes('You already have maximum health')) {
          throw err
        }
      }
    }
  }

  if (AUTO_PAUSE_RESUME_DAMAGE && user.preferences.sleep && (numBlessings > 0 || numLights > 0)) {
    ctx.queueBuffer.pauseResumeDamage = true
  }
}

// ─── Mage ──────────────────────────────────────────────────────────────────────

/**
 * Casts Earthquake (or Ethereal Surge at level 12) until mana is used up.
 * If saveMana, reserves mana for Chilling Frost and finishing an active boss.
 */
export async function castEarthquake(ctx: AppCtx, saveMana: boolean): Promise<void> {
  const user = await getUser(ctx, true)
  const party = await getParty(ctx)

  if (user.stats.lvl < SKILL_2_LEVEL || (user.stats.lvl === SKILL_2_LEVEL && (party === null || party.memberCount <= 1))) {
    console.log(`Player level ${user.stats.lvl}, cannot cast buffs`)
    return
  }

  console.log(`Mana: ${user.stats.mp}`)

  let numEarthquakes: number
  let numSurges: number

  if (saveMana) {
    const int = await getTotalStat('int', ctx)
    const chillingFrostMana = user.stats.lvl >= SKILL_4_LEVEL && (await calculatePerfectDayBuff(ctx)) === 0 ? MANA_COST_CHILLING_FROST : 0
    let finishBossMana = 0
    if (await hasActiveBossQuest(ctx)) {
      const bossParty = await getParty(ctx, true)
      const bossHP = bossParty?.quest.progress.hp || DEFAULT_BOSS_HP
      finishBossMana = Math.max(
        Math.ceil((bossHP - user.party.quest.progress.up) / Math.ceil(int / BURST_OF_FLAMES_INT_DIVISOR)) * MANA_COST_BURST_OF_FLAMES,
        0,
      )
    }
    const reserve = chillingFrostMana + finishBossMana

    console.log(`Reserving ${chillingFrostMana} (chillingFrostMana) + ${finishBossMana} (finishBossMana) = ${reserve} mana`)

    numEarthquakes = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_EARTHQUAKE), 0)
    numSurges = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_ETHEREAL_SURGE), 0)
  } else {
    numEarthquakes = Math.floor(user.stats.mp / MANA_COST_EARTHQUAKE)
    numSurges = Math.floor(user.stats.mp / MANA_COST_ETHEREAL_SURGE)
  }

  if (user.stats.lvl > SKILL_2_LEVEL) {
    console.log(`Casting Earthquake ${numEarthquakes} time(s)`)
    for (let i = 0; i < numEarthquakes; i++) {
      await apiPost('https://habitica.com/api/v3/user/class/cast/earth', ctx)
    }
  } else {
    console.log(`Player level ${SKILL_2_LEVEL}, casting Ethereal Surge ${numSurges} time(s)`)
    for (let i = 0; i < numSurges; i++) {
      await apiPost('https://habitica.com/api/v3/user/class/cast/mpheal', ctx)
    }
  }
}

/**
 * Casts Chilling Frost, Burst of Flames to finish an active boss, then Ethereal Surge
 * with whatever mana is left over (if in a party of more than one). Doesn't cast
 * Earthquake here since it's a self-buff that would be wiped by cron seconds later;
 * that mana is left for afterCronSkills() to spend once it'll last the full day.
 * Run just before cron.
 */
export async function burnBossAndDumpMana(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  if (user.stats.lvl < SKILL_1_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, no skills to cast`)
    return
  }

  const int = await getTotalStat('int', ctx)
  const perfectDayBuff = await calculatePerfectDayBuff(ctx)
  console.log(`Mana: ${user.stats.mp}`)

  if (perfectDayBuff === 0 && user.stats.mp >= MANA_COST_CHILLING_FROST && !user.stats.buffs.streaks && user.stats.lvl >= SKILL_4_LEVEL) {
    console.log('Imperfect day, casting Chilling Frost')
    await apiPost('https://habitica.com/api/v3/user/class/cast/frost', ctx)
    user.stats.mp -= MANA_COST_CHILLING_FROST
  }

  if (user.party._id !== undefined) {
    const tasks = await getTasks(ctx)

    // if there's an active boss quest and user has non-challenge tasks
    if ((await hasActiveBossQuest(ctx)) && tasks.length > 0) {
      const party = await getParty(ctx, true)
      const bossHP = party?.quest.progress.hp || DEFAULT_BOSS_HP
      console.log(`Boss HP: ${bossHP}`)
      console.log(`Pending damage: ${user.party.quest.progress.up}`)

      const numBursts = Math.min(
        Math.max(Math.ceil((bossHP - user.party.quest.progress.up) / Math.ceil(int / BURST_OF_FLAMES_INT_DIVISOR)), 0),
        Math.floor(user.stats.mp / MANA_COST_BURST_OF_FLAMES),
      )

      if (numBursts > 0) {
        const bluestTask = tasks.reduce((best, t) => (t.value > best.value ? t : best))
        console.log(`Casting Burst of Flames ${numBursts} time(s) on bluest task "${bluestTask.text}"`)
        for (let i = 0; i < numBursts; i++) {
          await apiPost(`https://habitica.com/api/v3/user/class/cast/fireball?targetId=${bluestTask._id}`, ctx)
          user.stats.mp -= MANA_COST_BURST_OF_FLAMES
        }
      }
    } else {
      console.log('No boss fight or user has no non-challenge tasks')
    }

    // if no time limit & lvl >= SKILL_2_LEVEL & party has other players
    const currentParty = await getParty(ctx)
    if (user.stats.lvl >= SKILL_2_LEVEL && currentParty && currentParty.memberCount > 1) {
      // Ethereal Surge isn't a self-buff (grants MP to party members) so it isn't
      // wiped at cron - spend whatever's left after Chilling Frost/Burst of Flames
      const numSurges = Math.max(Math.floor(user.stats.mp / MANA_COST_ETHEREAL_SURGE), 0)
      console.log(`Casting Ethereal Surge ${numSurges} time(s)`)
      for (let i = 0; i < numSurges; i++) {
        await apiPost('https://habitica.com/api/v3/user/class/cast/mpheal', ctx)
      }
    } else if (user.stats.lvl < SKILL_2_LEVEL) {
      console.log(`Player level ${user.stats.lvl}, cannot cast Ethereal Surge`)
    }
  }
}

// ─── Warrior ───────────────────────────────────────────────────────────────────

/**
 * Casts Valorous Presence (or Defensive Stance at level 12) until mana is used up.
 * If saveMana, reserves mana to finish off an active boss with Brutal Smash.
 */
export async function castValorousPresence(ctx: AppCtx, saveMana: boolean): Promise<void> {
  const user = await getUser(ctx, true)

  if (user.stats.lvl < SKILL_2_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, cannot cast buffs`)
    return
  }

  console.log(`Mana: ${user.stats.mp}`)

  let numPresences: number
  let numStances: number

  if (saveMana) {
    let reserve = 0
    if (await hasActiveBossQuest(ctx)) {
      const str = await getTotalStat('str', ctx)
      const party = await getParty(ctx, true)
      const bossHP = party?.quest.progress.hp || DEFAULT_BOSS_HP
      reserve = Math.max(
        Math.ceil((bossHP - user.party.quest.progress.up) / ((BRUTAL_SMASH_BASE_DAMAGE * str) / (str + BRUTAL_SMASH_STR_DIVISOR))) * MANA_COST_BRUTAL_SMASH,
        0,
      )
    }
    console.log(`Reserving ${reserve} mana (finishBossMana)`)
    numPresences = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_VALOROUS_PRESENCE), 0)
    numStances = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_DEFENSIVE_STANCE), 0)
  } else {
    numPresences = Math.floor(user.stats.mp / MANA_COST_VALOROUS_PRESENCE)
    numStances = Math.floor(user.stats.mp / MANA_COST_DEFENSIVE_STANCE)
  }

  if (user.stats.lvl > SKILL_2_LEVEL) {
    console.log(`Casting Valorous Presence ${numPresences} time(s)`)
    for (let i = 0; i < numPresences; i++) {
      await apiPost('https://habitica.com/api/v3/user/class/cast/valorousPresence', ctx)
    }
  } else {
    console.log(`Player level ${SKILL_2_LEVEL}, casting Defensive Stance ${numStances} time(s)`)
    for (let i = 0; i < numStances; i++) {
      await apiPost('https://habitica.com/api/v3/user/class/cast/defensiveStance', ctx)
    }
  }
}

/**
 * Casts Brutal Smash to finish off an active boss.
 * Run just before cron.
 */
export async function smashBossAndDumpMana(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  if (user.stats.lvl < SKILL_1_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, no skills to cast`)
    return
  }

  console.log(`Mana: ${user.stats.mp}`)

  if (user.party._id !== undefined) {
    const tasks = await getTasks(ctx)

    // if there's an active boss quest and user has non-challenge tasks
    if ((await hasActiveBossQuest(ctx)) && tasks.length > 0) {
      const party = await getParty(ctx, true)
      const bossHP = party?.quest.progress.hp || DEFAULT_BOSS_HP
      console.log(`Boss HP: ${bossHP}`)
      console.log(`Pending damage: ${user.party.quest.progress.up}`)

      const str = await getTotalStat('str', ctx)
      const numSmashes = Math.min(
        Math.max(Math.ceil((bossHP - user.party.quest.progress.up) / ((BRUTAL_SMASH_BASE_DAMAGE * str) / (str + BRUTAL_SMASH_STR_DIVISOR))), 0),
        Math.floor(user.stats.mp / MANA_COST_BRUTAL_SMASH),
      )

      if (numSmashes > 0) {
        const bluestTask = tasks.reduce((best, t) => (t.value > best.value ? t : best))
        console.log(`Casting Brutal Smash ${numSmashes} time(s) on bluest task "${bluestTask.text}"`)
        for (let i = 0; i < numSmashes; i++) {
          await apiPost(`https://habitica.com/api/v3/user/class/cast/smash?targetId=${bluestTask._id}`, ctx)
          user.stats.mp -= MANA_COST_BRUTAL_SMASH
        }
        console.log(`Mana remaining: ${user.stats.mp}`)
      }
    } else {
      console.log('No boss fight or user has no non-challenge tasks')
    }
  } else {
    console.log('Player not in a party, cannot cast Brutal Smash')
  }
}

// ─── Rogue ─────────────────────────────────────────────────────────────────────

/**
 * Calculates how many Stealth casts are needed to dodge all incomplete dailies.
 */
export async function numStealthsNeeded(ctx: AppCtx): Promise<number> {
  const user = await getUser(ctx)
  let stealth = user.stats.buffs.stealth
  let numDamagingDailies = 0

  for (const daily of await getDailies(ctx)) {
    if (daily.isDue && !daily.completed) {
      if (stealth > 0) {
        stealth--
        continue
      }
      numDamagingDailies++
    }
  }

  console.log(`Damaging dailies: ${numDamagingDailies}`)

  if (numDamagingDailies > 0) {
    const totalPer = await getTotalStat('per', ctx)
    const dailies = await getDailies(ctx)
    const numDodged = Math.ceil((STEALTH_BASE_RATE * dailies.length * totalPer) / (totalPer + STEALTH_PER_DIVISOR))
    return Math.ceil(numDamagingDailies / numDodged)
  }
  return 0
}

/**
 * Casts Tools of the Trade (or lower tier skills) until mana is used up.
 * If saveMana, reserves mana for Stealth casts still pending this run.
 * If beforeCron, skips Tools of the Trade specifically (a buff that would be wiped by
 * cron seconds later) while still allowing Backstab/Pickpocket, whose effects persist
 * through cron.
 */
export async function castToolsOfTheTrade(ctx: AppCtx, saveMana: boolean, stealthsNeededOverride?: number, beforeCron = false): Promise<void> {
  const user = await getUser(ctx, true)
  if (user.stats.lvl < SKILL_1_LEVEL) {
    console.log(`Player level ${user.stats.lvl}, nothing to cast`)
    return
  }

  console.log(`Mana: ${user.stats.mp}`)

  let numTools: number
  let numBackstabs: number
  let numPickpockets: number

  if (saveMana) {
    const stealthsNeeded = stealthsNeededOverride ?? (await numStealthsNeeded(ctx))
    const reserve = stealthsNeeded * MANA_COST_STEALTH
    console.log(`Reserving ${reserve} mana for pending Stealth casts`)
    numTools = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_TOOLS_OF_TRADE), 0)
    numBackstabs = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_BACKSTAB), 0)
    numPickpockets = Math.max(Math.floor((user.stats.mp - reserve) / MANA_COST_PICKPOCKET), 0)
  } else {
    numTools = Math.floor(user.stats.mp / MANA_COST_TOOLS_OF_TRADE)
    numBackstabs = Math.floor(user.stats.mp / MANA_COST_BACKSTAB)
    numPickpockets = Math.floor(user.stats.mp / MANA_COST_PICKPOCKET)
  }

  if (user.stats.lvl >= SKILL_3_LEVEL) {
    if (beforeCron) {
      console.log('Skipping Tools of the Trade before cron, buff would be wiped immediately after')
      numTools = 0
    }
    console.log(`Casting Tools of the Trade ${numTools} time(s)`)
    for (let i = 0; i < numTools; i++) {
      await apiPost('https://habitica.com/api/v3/user/class/cast/toolsOfTrade', ctx)
    }
  } else if (user.stats.lvl === SKILL_2_LEVEL) {
    const tasks = await getTasks(ctx)
    if (tasks.length > 0) {
      const bluestTask = tasks.reduce((best, t) => (t.value > best.value ? t : best))
      console.log(`Player level ${SKILL_2_LEVEL}, casting Backstab ${numBackstabs} time(s) on bluest task "${bluestTask.text}"`)
      for (let i = 0; i < numBackstabs; i++) {
        await apiPost(`https://habitica.com/api/v3/user/class/cast/backStab?targetId=${bluestTask._id}`, ctx)
      }
    } else {
      console.log(`Player level ${SKILL_2_LEVEL} and player has no non-challenge tasks, no skills to cast`)
    }
  } else {
    const tasks = await getTasks(ctx)
    if (tasks.length > 0) {
      const bluestTask = tasks.reduce((best, t) => (t.value > best.value ? t : best))
      console.log(`Player level ${SKILL_1_LEVEL}, casting Pickpocket ${numPickpockets} time(s) on bluest task "${bluestTask.text}"`)
      for (let i = 0; i < numPickpockets; i++) {
        await apiPost(`https://habitica.com/api/v3/user/class/cast/pickPocket?targetId=${bluestTask._id}`, ctx)
      }
    } else {
      console.log(`Player level ${SKILL_1_LEVEL} and player has no non-challenge tasks, no skills to cast`)
    }
  }
}

/**
 * Casts Stealth to dodge incomplete dailies, then dumps remaining mana.
 * Run just before cron.
 */
export async function castStealthAndDumpMana(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)
  let stealthsNeeded = 0
  let numStealths = 0

  if (user.stats.lvl >= SKILL_4_LEVEL) {
    stealthsNeeded = await numStealthsNeeded(ctx)
    numStealths = Math.min(stealthsNeeded, Math.floor(user.stats.mp / MANA_COST_STEALTH))
    console.log(`Casting Stealth ${numStealths} time(s)`)
    for (let i = 0; i < numStealths; i++) {
      await apiPost('https://habitica.com/api/v3/user/class/cast/stealth', ctx)
      stealthsNeeded--
    }
  } else {
    console.log(`Player lvl ${user.stats.lvl}, cannot cast Stealth`)
  }

  if (AUTO_PAUSE_RESUME_DAMAGE && user.preferences.sleep && numStealths > 0) {
    ctx.queueBuffer.pauseResumeDamage = true
  }

  await castToolsOfTheTrade(ctx, true, stealthsNeeded, true)
}
