import type { AppCtx, HabiticaContent, HabiticaMember, HabiticaParty, HabiticaTask, HabiticaUser, QuestCompletionEntry } from './types.js'
import {
  BASE_MANA,
  EGGS_FOR_COMPLETE_SPECIES,
  HTTP_RATE_LIMITED,
  HTTP_SERVER_ERROR_MIN,
  HTTP_SUCCESS_MAX,
  MAX_LEVEL_STAT_BONUS,
  POTIONS_FOR_COMPLETE_PREMIUM,
  POTIONS_FOR_COMPLETE_WACKY,
  RESOURCES_PER_NON_WACKY,
  RESOURCES_PER_WACKY,
  SERVER_RETRY_DELAY_MS,
} from './constants.js'
import { getKVState, setKVState } from './state.js'

export const HABITICA_CLIENT_ID = '7658e840-f2e1-42d5-8b8b-1d8ad65fd517-AutomateHabitica++'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Core fetch wrapper ────────────────────────────────────────────────────────

/**
 * Fetches the Habitica API with retry logic and rate-limit spacing.
 * Mirrors the original `fetch()` function from global.gs.
 */
export async function habFetch(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body: object | undefined, ctx: AppCtx): Promise<unknown> {
  const headers: Record<string, string> = {
    'x-api-user': ctx.env.USER_ID,
    'x-api-key': ctx.env.API_TOKEN,
    'x-client': HABITICA_CLIENT_ID,
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    // Rate-limit spacing: spread calls evenly across the remaining window
    if (ctx.rateLimitRemaining !== undefined && ctx.rateLimitReset !== undefined) {
      const waitUntil = new Date(ctx.rateLimitReset)
      waitUntil.setSeconds(waitUntil.getSeconds() + 1)
      const delayMs = Math.max((waitUntil.getTime() - Date.now()) / (ctx.rateLimitRemaining + 1) - (ctx.apiResponseTime ?? 0), 0)
      if (delayMs > 0) await sleep(delayMs)
    }

    let response: Response
    const before = Date.now()
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Address unavailable') || msg.includes('Failed to fetch')) {
        await sleep(SERVER_RETRY_DELAY_MS)
        continue
      }
      throw err
    }

    ctx.apiResponseTime = Date.now() - before
    const remaining = response.headers.get('x-ratelimit-remaining')
    const reset = response.headers.get('x-ratelimit-reset')
    if (remaining !== null) ctx.rateLimitRemaining = Number(remaining)
    if (reset !== null) ctx.rateLimitReset = reset

    // 2xx or allowed 404 (party endpoint)
    if (response.status < HTTP_SUCCESS_MAX || (response.status === 404 && url.includes('/api/v3/groups/party') && !url.includes('/members/'))) {
      return response.json()
    }

    // Rate limited – decrement attempt counter and retry
    if (response.status === HTTP_RATE_LIMITED) {
      attempt--
      continue
    }

    // Server errors: retry up to 3 times
    if (response.status >= HTTP_SERVER_ERROR_MIN && attempt < 2) {
      continue
    }

    const text = await response.text()
    throw new Error(`Request failed for ${url} returned code ${response.status}. ` + `Server response: ${text.slice(0, 500)}`)
  }

  throw new Error(`Request failed for ${url} after 3 attempts`)
}

// ─── Helper: typed API call shortcuts ─────────────────────────────────────────

export const apiGet = (url: string, ctx: AppCtx) => habFetch(url, 'GET', undefined, ctx)

export const apiPost = (url: string, ctx: AppCtx, body?: object) => habFetch(url, 'POST', body, ctx)

export const apiPut = (url: string, ctx: AppCtx, body?: object) => habFetch(url, 'PUT', body, ctx)

export const apiDelete = (url: string, ctx: AppCtx) => habFetch(url, 'DELETE', undefined, ctx)

export const buyHealthPotion = (ctx: AppCtx) => apiPost('https://habitica.com/api/v3/user/buy-health-potion', ctx)

// ─── Cached data accessors ─────────────────────────────────────────────────────

/** Fetches (and caches) the current user's data. */
export async function getUser(ctx: AppCtx, force = false): Promise<HabiticaUser> {
  if (force || ctx.user === undefined) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = (await apiGet('https://habitica.com/api/v3/user', ctx)) as {
          data: HabiticaUser
        }
        ctx.user = resp.data
        break
      } catch (err: unknown) {
        if (i < 2 && isJsonParseError(err)) continue
        throw err
      }
    }
    if (ctx.user === undefined) throw new Error('Failed to fetch user after 3 attempts')

    // persist party ID for webhook comparisons
    if (ctx.user.party._id && (await getKVState(ctx, 'PARTY_ID')) !== ctx.user.party._id) {
      await setKVState(ctx, 'PARTY_ID', ctx.user.party._id)
    }
  }
  return ctx.user!
}

/** Fetches (and caches) party data. Returns null when player has no party. */
export async function getParty(ctx: AppCtx, force = false): Promise<HabiticaParty | null> {
  if (force || ctx.party === undefined) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = (await apiGet('https://habitica.com/api/v3/groups/party', ctx)) as { data: HabiticaParty | null }
        ctx.party = resp.data ?? null
        break
      } catch (err: unknown) {
        if (i < 2 && isJsonParseError(err)) continue
        throw err
      }
    }
    if (ctx.party === undefined) ctx.party = null
  }
  return ctx.party!
}

/** Fetches (and caches) party members. Returns null when player has no party. */
export async function getMembers(ctx: AppCtx, force = false): Promise<HabiticaMember[] | null> {
  if (force || ctx.members === undefined) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = (await apiGet('https://habitica.com/api/v3/groups/party/members?includeAllPublicFields=true', ctx)) as { data: HabiticaMember[] | null }
        ctx.members = resp.data ?? null
        break
      } catch (err: unknown) {
        if (i < 2 && isJsonParseError(err)) continue
        throw err
      }
    }
    if (ctx.members === undefined) ctx.members = null
  }
  return ctx.members!
}

/**
 * Fetches (and caches) user tasks.
 * Strips rewards, challenge tasks, and group tasks – same as original.
 */
export async function getTasks(ctx: AppCtx): Promise<HabiticaTask[]> {
  if (ctx.tasks === undefined) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = (await apiGet('https://habitica.com/api/v3/tasks/user', ctx)) as { data: HabiticaTask[] }
        ctx.tasks = resp.data
        break
      } catch (err: unknown) {
        if (i < 2 && isJsonParseError(err)) continue
        throw err
      }
    }
    if (ctx.tasks === undefined) throw new Error('Failed to fetch tasks')

    ctx.dailies = []
    ctx.tasks = ctx.tasks.filter((task) => {
      if (task.type === 'reward') return false
      if (task.type === 'daily') ctx.dailies!.push(task)
      if (task.challenge.id !== undefined || task.group.id !== undefined) return false
      return true
    })
  }
  return ctx.tasks!
}

/** Returns daily tasks (fetches via getTasks if not cached). */
export async function getDailies(ctx: AppCtx): Promise<HabiticaTask[]> {
  if (ctx.dailies === undefined) await getTasks(ctx)
  return ctx.dailies!
}

/** Fetches (and caches) Habitica game content. */
export async function getContent(ctx: AppCtx, force = false): Promise<HabiticaContent> {
  if (force || ctx.content === undefined) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = (await apiGet('https://habitica.com/api/v3/content', ctx)) as { data: HabiticaContent }
        ctx.content = resp.data
        break
      } catch (err: unknown) {
        if (i < 2 && isJsonParseError(err)) continue
        throw err
      }
    }
    if (ctx.content === undefined) throw new Error('Failed to fetch content')
  }
  return ctx.content!
}

// ─── Stat helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the total value of a stat including level, buffs, allocated, and gear.
 * @param stat One of "int" | "con" | "per" | "str"
 */
export async function getTotalStat(stat: 'int' | 'con' | 'per' | 'str', ctx: AppCtx): Promise<number> {
  const user = await getUser(ctx)

  if (stat === 'int') {
    // Derived from maxMP: maxMP = (int_total * 2) + BASE_MANA
    return (user.stats.maxMP - BASE_MANA) / 2
  }

  const levelStat = Math.min(Math.floor(user.stats.lvl / 2), MAX_LEVEL_STAT_BONUS)
  const buffsStat = (user.stats.buffs as unknown as Record<string, number>)[stat] ?? 0
  const allocatedStat = (user.stats as unknown as Record<string, number>)[stat] ?? 0

  const content = await getContent(ctx)
  let equipmentStat = 0
  for (const equippedKey of Object.values(user.items.gear.equipped)) {
    const gear = content.gear.flat[equippedKey] ?? user.items.gear.flat[equippedKey]
    if (gear) {
      const gearVal = (gear as unknown as Record<string, number>)[stat] ?? 0
      equipmentStat += gearVal
      if (gear.klass === user.stats.class || (gear.klass === 'special' && gear.specialClass === user.stats.class)) {
        equipmentStat += gearVal / 2
      }
    }
  }

  return levelStat + equipmentStat + allocatedStat + buffsStat
}

/** Calculates the player's perfect-day buff (0 if any daily is incomplete). */
export async function calculatePerfectDayBuff(ctx: AppCtx): Promise<number> {
  const user = await getUser(ctx)
  const dailies = await getDailies(ctx)
  for (const daily of dailies) {
    if (daily.isDue && !daily.completed) return 0
  }
  return Math.min(Math.ceil(user.stats.lvl / 2), MAX_LEVEL_STAT_BONUS)
}

/**
 * Checks whether the party is currently on an active boss quest.
 * Distinguishes a real boss fight from no quest or a non-boss (e.g. collection) quest,
 * so boss-damage reserves and casts don't fire against a nonexistent boss.
 */
export async function hasActiveBossQuest(ctx: AppCtx): Promise<boolean> {
  const user = await getUser(ctx)
  const quest = user.party.quest
  if (!quest.active || !quest.key) return false
  const content = await getContent(ctx)
  return content.quests[quest.key]?.boss !== undefined
}

// ─── Quest completion data ─────────────────────────────────────────────────────

/**
 * Calculates quest completion percentages for each quest in the party.
 * Adapted from Quest Tracker by @bumbleshoot.
 */
export async function getQuestCompletionData(ctx: AppCtx): Promise<QuestCompletionEntry[]> {
  const user = await getUser(ctx)
  const membersRaw = await getMembers(ctx)
  const partyMembers: (typeof user | HabiticaMember)[] = membersRaw ?? [user]

  const content = await getContent(ctx)

  // count eggs & hatching potions owned/used for each member
  for (const member of partyMembers as HabiticaMember[]) {
    const counts = countEggsPotionsOwnedUsed(member.items)
    member.numEachEggOwnedUsed = counts.eggsOwnedUsed
    member.numEachPotionOwnedUsed = counts.potionsOwnedUsed
  }

  const premiumEggs = Object.values(content.questEggs).map((e) => e.key)
  const premiumPotions = Object.values(content.premiumHatchingPotions).map((p) => (p as { key: string }).key)
  const wackyPotions = Object.values(content.wackyHatchingPotions).map((p) => (p as { key: string }).key)

  const questCompletionData: QuestCompletionEntry[] = []

  for (const quest of Object.values(content.quests)) {
    if (quest.category === 'world') continue

    const rewards: Array<{
      key: string
      name: string
      type: string
      qty: number
    }> = []

    for (const drop of quest.drop.items ?? []) {
      let rewardType = ''
      let rewardName = drop.text
      if (drop.type === 'eggs' && premiumEggs.includes(drop.key)) {
        rewardName = (content.eggs[drop.key]?.text ?? drop.key) + ' Egg'
        rewardType = 'egg'
      } else if (drop.type === 'hatchingPotions' && premiumPotions.includes(drop.key)) {
        rewardType = 'hatchingPotion'
      } else if (drop.type === 'hatchingPotions' && wackyPotions.includes(drop.key)) {
        rewardType = 'wackyPotion'
      } else if (drop.type === 'mounts') {
        rewardType = 'mount'
      } else if (drop.type === 'pets') {
        rewardType = 'pet'
      } else if (drop.type === 'gear') {
        rewardType = 'gear'
      }
      if (rewardType) {
        const idx = rewards.findIndex((r) => r.name === rewardName)
        if (idx === -1) {
          rewards.push({ key: drop.key, name: rewardName, type: rewardType, qty: 1 })
        } else {
          rewards[idx].qty++
        }
      }
    }

    let neededIndividual = 1
    let totalCompletions = 0
    let totalNeeded = 0

    if (rewards.length > 0 && rewards[0].type === 'egg') {
      neededIndividual = EGGS_FOR_COMPLETE_SPECIES / rewards[0].qty
      for (const member of partyMembers as HabiticaMember[]) {
        member.numEachEggOwnedUsed![rewards[0].key] ??= 0
        const timesCompleted = Math.min(member.numEachEggOwnedUsed![rewards[0].key] / rewards[0].qty, neededIndividual)
        totalCompletions += Math.floor((Math.ceil(neededIndividual) * timesCompleted) / neededIndividual)
        totalNeeded += Math.ceil(neededIndividual)
      }
    } else if (rewards.length > 0 && (rewards[0].type === 'hatchingPotion' || rewards[0].type === 'wackyPotion')) {
      neededIndividual = rewards[0].type === 'hatchingPotion' ? POTIONS_FOR_COMPLETE_PREMIUM / rewards[0].qty : POTIONS_FOR_COMPLETE_WACKY / rewards[0].qty
      for (const member of partyMembers as HabiticaMember[]) {
        member.numEachPotionOwnedUsed![rewards[0].key] ??= 0
        const timesCompleted = Math.min(member.numEachPotionOwnedUsed![rewards[0].key] / rewards[0].qty, neededIndividual)
        totalCompletions += Math.floor((Math.ceil(neededIndividual) * timesCompleted) / neededIndividual)
        totalNeeded += Math.ceil(neededIndividual)
      }
    } else {
      neededIndividual = 1
      for (const member of partyMembers as HabiticaMember[]) {
        const timesCompleted = Math.min(member.achievements.quests[quest.key] ?? 0, neededIndividual)
        totalCompletions += timesCompleted
        totalNeeded += Math.ceil(neededIndividual)
      }
    }

    questCompletionData.push({
      questKey: quest.key,
      questName: quest.text,
      completionPercentage: totalNeeded > 0 ? (totalCompletions / totalNeeded) * 100 : 0,
    })
  }

  return questCompletionData
}

// ─── Egg / hatching potion needs ───────────────────────────────────────────────

/**
 * Counts eggs and hatching potions owned/used by a member, starting from their
 * inventory and adding consumed resources from hatched pets and mounts.
 *
 * @param petFilter Optional list of pet keys to include. If omitted, all pets and mounts are counted.
 */
export function countEggsPotionsOwnedUsed(
  items: { eggs: Record<string, number>; hatchingPotions: Record<string, number>; pets: Record<string, number>; mounts: Record<string, boolean | null> },
  petFilter?: string[],
): { eggsOwnedUsed: Record<string, number>; potionsOwnedUsed: Record<string, number> } {
  const eggsOwnedUsed: Record<string, number> = { ...items.eggs }
  const potionsOwnedUsed: Record<string, number> = { ...items.hatchingPotions }

  for (const [petKey, amount] of Object.entries(items.pets ?? {})) {
    if (amount > 0 && (!petFilter || petFilter.includes(petKey))) {
      const [species, color] = petKey.split('-')
      eggsOwnedUsed[species] = (eggsOwnedUsed[species] ?? 0) + 1
      potionsOwnedUsed[color] = (potionsOwnedUsed[color] ?? 0) + 1
    }
  }
  for (const [mountKey, owned] of Object.entries(items.mounts ?? {})) {
    if (owned && (!petFilter || petFilter.includes(mountKey))) {
      const [species, color] = mountKey.split('-')
      eggsOwnedUsed[species] = (eggsOwnedUsed[species] ?? 0) + 1
      potionsOwnedUsed[color] = (potionsOwnedUsed[color] ?? 0) + 1
    }
  }

  return { eggsOwnedUsed, potionsOwnedUsed }
}

/** Lists of pet keys grouped by species/color needs (all pets/mounts excluding special event ones). */
export async function getPetLists(ctx: AppCtx): Promise<{ nonWackyNonSpecialPets: string[]; wackyPets: string[]; allNonSpecialPets: string[] }> {
  const contentData = await getContent(ctx)
  const nonWackyNonSpecialPets = [...Object.keys(contentData.pets), ...Object.keys(contentData.premiumPets), ...Object.keys(contentData.questPets)]
  const wackyPets = Object.keys(contentData.wackyPets)
  return {
    nonWackyNonSpecialPets,
    wackyPets,
    allNonSpecialPets: [...nonWackyNonSpecialPets, ...wackyPets],
  }
}

/** Basic hatching potion colors (the ones droppable from tasks). */
export async function getBasicColors(ctx: AppCtx): Promise<string[]> {
  return Object.keys((await getContent(ctx)).dropHatchingPotions)
}

export function getOwnedPets(userData: HabiticaUser, allNonSpecialPets: string[]): Record<string, number> {
  const owned: Record<string, number> = {}
  for (const [pet, amount] of Object.entries(userData.items.pets)) {
    if (amount > 0 && allNonSpecialPets.includes(pet)) owned[pet] = amount
  }
  return owned
}

export function getOwnedMounts(userData: HabiticaUser, allNonSpecialPets: string[]): Record<string, boolean> {
  const owned: Record<string, boolean> = {}
  for (const [mount, isOwned] of Object.entries(userData.items.mounts)) {
    if (isOwned && allNonSpecialPets.includes(mount)) owned[mount] = true
  }
  return owned
}

/**
 * Computes how many eggs and potions of each type the player needs to hatch all
 * non-special pets and mount replacements, and how many they currently own or have used.
 */
export async function getEggPotionNeeds(ctx: AppCtx): Promise<{
  eggsNeeded: Record<string, number>
  potionsNeeded: Record<string, number>
  eggsOwnedUsed: Record<string, number>
  potionsOwnedUsed: Record<string, number>
}> {
  const petLists = await getPetLists(ctx)

  const eggsNeeded: Record<string, number> = {}
  const potionsNeeded: Record<string, number> = {}
  for (const pet of petLists.nonWackyNonSpecialPets) {
    const [species, color] = pet.split('-')
    eggsNeeded[species] = (eggsNeeded[species] ?? 0) + RESOURCES_PER_NON_WACKY
    potionsNeeded[color] = (potionsNeeded[color] ?? 0) + RESOURCES_PER_NON_WACKY
  }
  for (const pet of petLists.wackyPets) {
    const [species, color] = pet.split('-')
    eggsNeeded[species] = (eggsNeeded[species] ?? 0) + RESOURCES_PER_WACKY
    potionsNeeded[color] = (potionsNeeded[color] ?? 0) + RESOURCES_PER_WACKY
  }

  const user = await getUser(ctx, true)
  const { eggsOwnedUsed, potionsOwnedUsed } = countEggsPotionsOwnedUsed(user.items, petLists.allNonSpecialPets)

  for (const egg of Object.keys(eggsNeeded)) {
    if (!(egg in eggsOwnedUsed)) eggsOwnedUsed[egg] = 0
  }
  for (const potion of Object.keys(potionsNeeded)) {
    if (!(potion in potionsOwnedUsed)) potionsOwnedUsed[potion] = 0
  }

  return { eggsNeeded, potionsNeeded, eggsOwnedUsed, potionsOwnedUsed }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function isJsonParseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('Unterminated string in JSON') ||
    err.message.includes("Expected ',' or '}'") ||
    err.message.includes('Expected double-quoted property name')
  )
}
