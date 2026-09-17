/**
 * Hatch and feed pets – both conservative and priority strategies.
 */

import type { AppCtx } from '../types.js'
import { apiPost, getBasicColors, getContent, getEggPotionNeeds, getOwnedMounts, getOwnedPets, getPetLists, getUser } from '../api.js'
import {
  FEED_PRIORITY,
  FEEDINGS_TO_MOUNT_FAVORITE,
  FOOD_POINTS_FAVORITE,
  FOOD_POINTS_NON_FAVORITE,
  HATCH_PRIORITY,
  MOUNT_THRESHOLD,
  NEWLY_HATCHED_FED,
  NON_FAVORITE_TO_FAVORITE_RATIO,
} from '../constants.js'
import { ONLY_USE_DROP_FOOD } from '../config.js'

// ─── Conservative strategy ─────────────────────────────────────────────────────

/**
 * Conservative strategy: only hatches/feeds when all-or-nothing resource
 * requirements are fully satisfied.
 */
export async function hatchFeedPets(ctx: AppCtx): Promise<void> {
  const petLists = await getPetLists(ctx)
  const basicColors = await getBasicColors(ctx)
  const contentData = await getContent(ctx)

  // refresh user data and compute egg/potion needs
  const userData = await getUser(ctx, true)
  const needs = await getEggPotionNeeds(ctx)
  const numEachEggNeededTotal = needs.eggsNeeded
  const numEachPotionNeededTotal = needs.potionsNeeded
  const numEachEggOwnedUsed = needs.eggsOwnedUsed
  const numEachPotionOwnedUsed = needs.potionsOwnedUsed

  // get owned pets and mounts
  const petsOwned = getOwnedPets(userData, petLists.allNonSpecialPets)
  const mountsOwned = getOwnedMounts(userData, petLists.allNonSpecialPets)

  const numEachFoodTypeNeededTotal = Object.keys(numEachEggNeededTotal).length * FEEDINGS_TO_MOUNT_FAVORITE
  const numEachFoodTypeNeeded: Record<string, number> = {}
  for (const color of basicColors) {
    numEachFoodTypeNeeded[color] = numEachFoodTypeNeededTotal
  }

  let foodNeededForMagicPets = Object.keys(contentData.premiumHatchingPotions).length * Object.keys(contentData.dropEggs).length * FEEDINGS_TO_MOUNT_FAVORITE

  // process owned mounts: reduce food needs
  for (const mount of Object.keys(mountsOwned)) {
    const [, color] = mount.split('-')
    if (basicColors.includes(color)) {
      numEachFoodTypeNeeded[color] -= FEEDINGS_TO_MOUNT_FAVORITE
    } else {
      foodNeededForMagicPets -= FEEDINGS_TO_MOUNT_FAVORITE
    }
  }

  const { foodOwned, foodByType } = getUsableFoodWithTypes(userData, contentData)

  let surplusFoodAvailable = 0
  let favoriteFoodDeficit = 0
  for (const [color, amount] of Object.entries(foodByType)) {
    const surplus = amount - (numEachFoodTypeNeeded[color] ?? 0)
    if (surplus > 0) surplusFoodAvailable += surplus
    else if (surplus < 0) favoriteFoodDeficit += Math.abs(surplus)
  }
  const fallbackFoodNeeded = favoriteFoodDeficit * NON_FAVORITE_TO_FAVORITE_RATIO
  const fallbackFoodAvailable = Math.max(0, surplusFoodAvailable - foodNeededForMagicPets)

  for (const pet of petLists.allNonSpecialPets) {
    const [species, color] = pet.split('-')
    const speciesReadable = makeReadable(species)
    const colorReadable = makeReadable(color)
    let hunger = MOUNT_THRESHOLD

    const hasEnoughEggs = (numEachEggOwnedUsed[species] ?? 0) - (numEachEggNeededTotal[species] ?? 0) >= 0
    const hasEnoughPotions = (numEachPotionOwnedUsed[color] ?? 0) - (numEachPotionNeededTotal[color] ?? 0) >= 0

    if (hasEnoughEggs && hasEnoughPotions) {
      if (!petsOwned[pet]) {
        await hatchPetApi(species, color, ctx)
        hunger = MOUNT_THRESHOLD - NEWLY_HATCHED_FED
      }

      if (!petLists.wackyPets.includes(pet) && !mountsOwned[pet]) {
        if (hunger === MOUNT_THRESHOLD) {
          const fed = petsOwned[pet]
          if (fed !== undefined && fed > 0) hunger -= fed
        }

        let grewToMount = false

        if (basicColors.includes(color)) {
          if ((foodByType[color] ?? 0) >= (numEachFoodTypeNeeded[color] ?? 0)) {
            let feedingsNeeded = Math.ceil(hunger / FOOD_POINTS_FAVORITE)
            const favoriteFoods = getFavoriteFoods(color, contentData)
            for (const food of favoriteFoods) {
              const amount = foodOwned[food] ?? 0
              if (amount <= 0) continue
              const feedings = Math.min(feedingsNeeded, amount)
              await feedPetApi(pet, food, feedings, speciesReadable, colorReadable, ctx)
              feedingsNeeded -= feedings
              foodOwned[food] = (foodOwned[food] ?? 0) - feedings
              if ((foodOwned[food] ?? 0) <= 0) delete foodOwned[food]
              foodByType[color] = (foodByType[color] ?? 0) - feedings
              numEachFoodTypeNeeded[color] = (numEachFoodTypeNeeded[color] ?? 0) - feedings
              if (feedingsNeeded <= 0) {
                grewToMount = true
                break
              }
            }
          } else if (fallbackFoodAvailable >= fallbackFoodNeeded) {
            const feedingsNeeded = Math.ceil(hunger / FOOD_POINTS_NON_FAVORITE)
            grewToMount = await feedExtraFoodConservative(
              pet,
              feedingsNeeded,
              speciesReadable,
              colorReadable,
              foodOwned,
              foodByType,
              numEachFoodTypeNeeded,
              contentData,
              ctx,
            )
          } else {
            console.log(
              `Cannot feed ${colorReadable} ${speciesReadable}: not enough preferred food (need ${numEachFoodTypeNeeded[color]}, have ${foodByType[color] ?? 0})`,
            )
          }
        } else {
          if (surplusFoodAvailable >= foodNeededForMagicPets) {
            const feedingsNeeded = Math.ceil(hunger / FOOD_POINTS_FAVORITE)
            grewToMount = await feedExtraFoodConservative(
              pet,
              feedingsNeeded,
              speciesReadable,
              colorReadable,
              foodOwned,
              foodByType,
              numEachFoodTypeNeeded,
              contentData,
              ctx,
            )
          } else {
            console.log(`Cannot feed ${colorReadable} ${speciesReadable}: not enough surplus food`)
          }
        }

        if (grewToMount) await hatchPetApi(species, color, ctx)
      }
    } else if (!petsOwned[pet] || (!petLists.wackyPets.includes(pet) && !mountsOwned[pet])) {
      let message = `Cannot hatch or feed ${colorReadable} ${speciesReadable}: not enough `
      if (!hasEnoughEggs) {
        message += `${speciesReadable} eggs (need ${(numEachEggNeededTotal[species] ?? 0) - (numEachEggOwnedUsed[species] ?? 0) + (userData.items.eggs[species] ?? 0)}, have ${userData.items.eggs[species] ?? 0})`
      }
      if (!hasEnoughPotions) {
        if (message.endsWith(')')) message += ' or '
        message += `${colorReadable} hatching potions (need ${(numEachPotionNeededTotal[color] ?? 0) - (numEachPotionOwnedUsed[color] ?? 0) + (userData.items.hatchingPotions[color] ?? 0)}, have ${userData.items.hatchingPotions[color] ?? 0})`
      }
      console.log(message)
    }
  }
}

// ─── Priority strategy ─────────────────────────────────────────────────────────

/**
 * Priority-based strategy: hatches/feeds in priority order without
 * strict all-or-nothing requirements.
 */
export async function hatchFeedPetsPriority(ctx: AppCtx): Promise<void> {
  const petLists = await getPetLists(ctx)
  const basicColors = await getBasicColors(ctx)
  const { standardPetSet, questPetSet, premiumPetSet } = await getPetCategorySets(ctx)

  const userData = await getUser(ctx, true)
  const eggsOwned: Record<string, number> = { ...userData.items.eggs }
  const potionsOwned: Record<string, number> = { ...userData.items.hatchingPotions }
  const petsOwned = getOwnedPets(userData, petLists.allNonSpecialPets)
  const mountsOwned = getOwnedMounts(userData, petLists.allNonSpecialPets)
  const foodOwned = getUsableFood(userData, await getContent(ctx))

  // ─── Hatching ────────────────────────────────────────────────────────────────
  const petsToHatch: Array<{
    pet: string
    species: string
    color: string
    priorityGroup: number
  }> = []

  for (const pet of petLists.allNonSpecialPets) {
    if (petsOwned[pet] !== undefined) continue
    const [species, color] = pet.split('-')
    if (!hasEnoughResources(species, color, eggsOwned, potionsOwned)) continue

    let priorityGroup: number
    if (standardPetSet.has(pet)) priorityGroup = HATCH_PRIORITY.STANDARD_BASIC
    else if (premiumPetSet.has(pet)) priorityGroup = HATCH_PRIORITY.PREMIUM
    else if (questPetSet.has(pet)) priorityGroup = HATCH_PRIORITY.QUEST
    else priorityGroup = HATCH_PRIORITY.WACKY

    petsToHatch.push({ pet, species, color, priorityGroup })
  }

  petsToHatch.sort((a, b) => (a.priorityGroup !== b.priorityGroup ? a.priorityGroup - b.priorityGroup : a.species.localeCompare(b.species)))

  const priorityGroupNames: Record<number, string> = {
    [HATCH_PRIORITY.STANDARD_BASIC]: 'standard pets (basic colors)',
    [HATCH_PRIORITY.PREMIUM]: 'premium + quest pets',
    [HATCH_PRIORITY.WACKY]: 'wacky pets',
  }
  let currentPriorityGroup = 0

  for (const { pet, species, color, priorityGroup } of petsToHatch) {
    if (!hasEnoughResources(species, color, eggsOwned, potionsOwned)) continue
    if (priorityGroup !== currentPriorityGroup) {
      currentPriorityGroup = priorityGroup
      console.log(`Hatching ${priorityGroupNames[priorityGroup]}...`)
    }
    await hatchPetApi(species, color, ctx)
    eggsOwned[species] = (eggsOwned[species] ?? 0) - 1
    potionsOwned[color] = (potionsOwned[color] ?? 0) - 1
    petsOwned[pet] = NEWLY_HATCHED_FED
  }

  // ─── Feeding ─────────────────────────────────────────────────────────────────
  const petsToFeed: Array<{
    pet: string
    species: string
    color: string
    hunger: number
    feedPriority: number
    isBasicColor: boolean
  }> = []

  for (const [pet, fedAmount] of Object.entries(petsOwned)) {
    if (petLists.wackyPets.includes(pet)) continue
    if (mountsOwned[pet] !== undefined) continue
    const [species, color] = pet.split('-')
    const hunger = MOUNT_THRESHOLD - fedAmount
    if (hunger <= 0) continue

    let fp: number
    if (standardPetSet.has(pet)) fp = FEED_PRIORITY.STANDARD
    else if (premiumPetSet.has(pet)) fp = FEED_PRIORITY.PREMIUM
    else if (questPetSet.has(pet)) fp = FEED_PRIORITY.QUEST
    else continue

    petsToFeed.push({
      pet,
      species,
      color,
      hunger,
      feedPriority: fp,
      isBasicColor: basicColors.includes(color),
    })
  }

  petsToFeed.sort((a, b) => (a.feedPriority !== b.feedPriority ? a.feedPriority - b.feedPriority : a.hunger - b.hunger))

  console.log('Feeding pets...')
  const contentData = await getContent(ctx)

  for (let { pet, species, color, hunger, isBasicColor } of petsToFeed) {
    const speciesReadable = makeReadable(species)
    const colorReadable = makeReadable(color)

    const foods = isBasicColor ? getFavoriteFoods(color, contentData) : Object.keys(foodOwned).sort((a, b) => (foodOwned[b] ?? 0) - (foodOwned[a] ?? 0))

    for (const food of foods) {
      const amount = foodOwned[food] ?? 0
      if (amount <= 0 || hunger <= 0) continue
      const feedings = Math.min(Math.ceil(hunger / FOOD_POINTS_FAVORITE), amount)
      await feedPetApi(pet, food, feedings, speciesReadable, colorReadable, ctx)
      foodOwned[food] = (foodOwned[food] ?? 0) - feedings
      if ((foodOwned[food] ?? 0) <= 0) delete foodOwned[food]
      hunger -= feedings * FOOD_POINTS_FAVORITE
    }

    if (hunger <= 0) {
      await tryHatchReplacement(species, color, eggsOwned, potionsOwned, ctx)
    }
  }
}

// ─── Shared helper functions ───────────────────────────────────────────────────

async function feedExtraFoodConservative(
  pet: string,
  feedingsNeeded: number,
  speciesReadable: string,
  colorReadable: string,
  foodOwned: Record<string, number>,
  foodByType: Record<string, number>,
  numEachFoodTypeNeeded: Record<string, number>,
  contentData: Awaited<ReturnType<typeof getContent>>,
  ctx: AppCtx,
): Promise<boolean> {
  const foodsSorted = Object.entries(foodOwned).sort((a, b) => b[1] - a[1])
  for (const [food, amount] of foodsSorted) {
    const target = contentData.food[food]?.target
    if (!target) continue
    const extra = (foodByType[target] ?? 0) - (numEachFoodTypeNeeded[target] ?? 0)
    if (extra > 0) {
      const feedings = Math.min(feedingsNeeded, amount, extra)
      await feedPetApi(pet, food, feedings, speciesReadable, colorReadable, ctx)
      feedingsNeeded -= feedings
      foodOwned[food] = (foodOwned[food] ?? 0) - feedings
      if ((foodOwned[food] ?? 0) <= 0) delete foodOwned[food]
      foodByType[target] = (foodByType[target] ?? 0) - feedings
      if (feedingsNeeded <= 0) return true
    }
  }
  return false
}

async function tryHatchReplacement(
  species: string,
  color: string,
  eggsOwned: Record<string, number>,
  potionsOwned: Record<string, number>,
  ctx: AppCtx,
): Promise<void> {
  if (hasEnoughResources(species, color, eggsOwned, potionsOwned)) {
    console.log(`Hatching replacement ${makeReadable(color)} ${makeReadable(species)}`)
    await hatchPetApi(species, color, ctx)
    eggsOwned[species] = (eggsOwned[species] ?? 0) - 1
    potionsOwned[color] = (potionsOwned[color] ?? 0) - 1
  }
}

function hasEnoughResources(species: string, color: string, eggsOwned: Record<string, number>, potionsOwned: Record<string, number>): boolean {
  return (eggsOwned[species] ?? 0) > 0 && (potionsOwned[color] ?? 0) > 0
}

async function getPetCategorySets(ctx: AppCtx) {
  const contentData = await getContent(ctx)
  return {
    standardPetSet: new Set(Object.keys(contentData.pets)),
    questPetSet: new Set(Object.keys(contentData.questPets)),
    premiumPetSet: new Set(Object.keys(contentData.premiumPets)),
  }
}

function getUsableFood(userData: Awaited<ReturnType<typeof getUser>>, contentData: Awaited<ReturnType<typeof getContent>>): Record<string, number> {
  const foodOwned: Record<string, number> = {}
  for (const [food, amount] of Object.entries(userData.items.food)) {
    if (food !== 'Saddle' && amount > 0) {
      if (!ONLY_USE_DROP_FOOD || contentData.food[food]?.canDrop) {
        foodOwned[food] = amount
      }
    }
  }
  return foodOwned
}

function getUsableFoodWithTypes(
  userData: Awaited<ReturnType<typeof getUser>>,
  contentData: Awaited<ReturnType<typeof getContent>>,
): { foodOwned: Record<string, number>; foodByType: Record<string, number> } {
  const foodOwned: Record<string, number> = {}
  const foodByType: Record<string, number> = {}
  for (const [food, amount] of Object.entries(userData.items.food)) {
    if (food !== 'Saddle' && (!ONLY_USE_DROP_FOOD || contentData.food[food]?.canDrop)) {
      if (amount > 0) foodOwned[food] = amount
      const target = contentData.food[food]?.target
      if (target) foodByType[target] = (foodByType[target] ?? 0) + amount
    }
  }
  return { foodOwned, foodByType }
}

function makeReadable(name: string): string {
  return name.replace(/(?<!^)([A-Z])/g, ' $1')
}

function getFavoriteFoods(color: string, contentData: Awaited<ReturnType<typeof getContent>>): string[] {
  return Object.entries(contentData.food)
    .filter(([key, data]) => key !== 'Saddle' && data.target === color)
    .map(([key]) => key)
}

async function hatchPetApi(species: string, color: string, ctx: AppCtx): Promise<unknown> {
  console.log(`Hatching ${makeReadable(color)} ${makeReadable(species)}`)
  return apiPost(`https://habitica.com/api/v3/user/hatch/${species}/${color}`, ctx)
}

async function feedPetApi(pet: string, food: string, amount: number, speciesReadable: string, colorReadable: string, ctx: AppCtx): Promise<unknown> {
  console.log(`Feeding ${colorReadable} ${speciesReadable} ${amount} ${food}`)
  return apiPost(`https://habitica.com/api/v3/user/feed/${pet}/${food}?amount=${amount}`, ctx)
}
