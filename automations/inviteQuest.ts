/**
 * Quest invite automation – always invites the quest scroll with the lowest
 * party completion percentage ("priority" strategy).
 */

import type { AppCtx, QuestCompletionEntry } from '../types.js'
import { apiPost, getContent, getMembers, getParty, getQuestCompletionData, getUser } from '../api.js'
import {
  AUTO_INVITE_FULLY_COMPLETED_QUESTS,
  AUTO_INVITE_GOLD_QUESTS,
  AUTO_INVITE_HOURGLASS_QUESTS,
  AUTO_INVITE_PET_QUESTS,
  AUTO_INVITE_UNLOCKABLE_QUESTS,
  BANNED_SCROLLS,
  PM_WHEN_OUT_OF_QUEST_SCROLLS,
} from '../config.js'
import { getKVState, setKVState, deleteKVState } from '../state.js'

// ─── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Determines whether a quest scroll would be eligible for auto-invite selection under
 * the current AUTO_INVITE_* settings and BANNED_SCROLLS list -- regardless of who owns it.
 * Used both to filter the player's own scrolls and to check other party members' scrolls
 * when counting rivals, so "eligible" always means "this script would actually invite it."
 */
function canInviteQuest(questKey: string, content: Awaited<ReturnType<typeof getContent>>, questCompletionData: QuestCompletionEntry[]): boolean {
  const quest = content.quests[questKey]
  if (!quest) return false

  if (BANNED_SCROLLS.includes(quest.text)) return false

  const category = quest.category
  const eligible =
    (AUTO_INVITE_HOURGLASS_QUESTS && category === 'timeTravelers') ||
    (category !== 'timeTravelers' &&
      ((AUTO_INVITE_GOLD_QUESTS && quest.goldValue !== undefined) ||
        (AUTO_INVITE_UNLOCKABLE_QUESTS && category === 'unlockable') ||
        (AUTO_INVITE_PET_QUESTS && ['pet', 'hatchingPotion'].includes(category))))

  if (!eligible) return false

  if (!AUTO_INVITE_FULLY_COMPLETED_QUESTS) {
    const entry = questCompletionData.find((q) => q.questKey === questKey)
    if (entry && entry.completionPercentage >= 100) return false
  }

  return true
}

/**
 * Counts other party members who own at least one auto-invite-eligible quest scroll for
 * a quest with a strictly lower completion percentage than the selected quest. Counts
 * members, not scrolls: a member with several qualifying scrolls counts once.
 */
async function countQuestRivals(ctx: AppCtx, selectedQuest: { completionPercentage: number }, questCompletionData: QuestCompletionEntry[]): Promise<number> {
  const partyMembers = await getMembers(ctx) // already cached via getQuestCompletionData(), no extra fetch
  if (partyMembers === null) return 0

  const content = await getContent(ctx)
  let rivals = 0

  for (const member of partyMembers) {
    if (member._id === ctx.env.USER_ID) continue

    const isRival = Object.entries(member.items.quests ?? {}).some(([questKey, numScrolls]) => {
      if (numScrolls <= 0 || !canInviteQuest(questKey, content, questCompletionData)) return false
      const entry = questCompletionData.find((q) => q.questKey === questKey)
      const completionPercentage = entry ? entry.completionPercentage : 0
      return completionPercentage < selectedQuest.completionPercentage
    })

    if (isRival) rivals++
  }

  return rivals
}

// ─── Priority selection ────────────────────────────────────────────────────────

/**
 * Selects the quest with the lowest party completion percentage, and counts how many
 * other party members hold an eligible scroll for a strictly more urgent quest.
 * Returns null if no eligible quest is found.
 */
export async function selectPriorityQuest(ctx: AppCtx): Promise<{
  questKey: string
  questName: string
  completionPercentage: number
  numScrolls: number
  rivals: number
} | null> {
  const user = await getUser(ctx)
  const content = await getContent(ctx)
  const questCompletionData = await getQuestCompletionData(ctx)

  const available: Array<{
    questKey: string
    numScrolls: number
    completionPercentage: number
    questName: string
  }> = []

  for (const [questKey, numScrolls] of Object.entries(user.items.quests)) {
    if (numScrolls <= 0) continue
    if (!canInviteQuest(questKey, content, questCompletionData)) continue

    const entry = questCompletionData.find((q) => q.questKey === questKey)
    available.push({
      questKey,
      numScrolls,
      completionPercentage: entry?.completionPercentage ?? 0,
      questName: content.quests[questKey]?.text ?? questKey,
    })
  }

  if (available.length === 0) return null

  available.sort((a, b) => a.completionPercentage - b.completionPercentage)
  const selected = available[0]
  const rivals = await countQuestRivals(ctx, selected, questCompletionData)

  return { ...selected, rivals }
}

/**
 * Invites party to the quest with the lowest completion percentage.
 * Called from the queue when the scheduled invite time arrives.
 */
export async function invitePriorityQuest(ctx: AppCtx): Promise<void> {
  const party = await getParty(ctx, true)
  if (party === null || party.quest.key !== undefined) return

  const selectedQuest = await selectPriorityQuest(ctx)

  if (selectedQuest !== null) {
    console.log(`Selected: ${selectedQuest.questName} (completion: ${Math.floor(selectedQuest.completionPercentage)}%)`)
    await apiPost(`https://habitica.com/api/v3/groups/party/quests/invite/${selectedQuest.questKey}`, ctx)
    await deleteKVState(ctx, 'QUEST_SCROLL_PM_SENT')
  }

  if (PM_WHEN_OUT_OF_QUEST_SCROLLS && selectedQuest === null && (await getKVState(ctx, 'QUEST_SCROLL_PM_SENT')) === undefined) {
    console.log('No more usable quest scrolls, sending PM to player')
    await apiPost('https://habitica.com/api/v3/members/send-private-message', ctx, {
      message: 'You have no more usable quest scrolls!',
      toUserId: ctx.env.USER_ID,
    })
    await setKVState(ctx, 'QUEST_SCROLL_PM_SENT', 'true')
  }
}

// ─── Schedule quest invite ─────────────────────────────────────────────────────

/**
 * Schedules a quest invite after `afterMs` milliseconds from now.
 * Stored in KV so the next cron run can pick it up.
 */
export async function scheduleQuestInvite(ctx: AppCtx, afterMs: number): Promise<void> {
  const scheduledAt = Date.now() + afterMs
  await setKVState(ctx, 'questInviteScheduled', String(scheduledAt))
}

/** Checks if a scheduled quest invite is due and runs it. Returns true if invite was sent. */
export async function runScheduledQuestInviteIfDue(ctx: AppCtx): Promise<boolean> {
  const raw = await getKVState(ctx, 'questInviteScheduled')
  if (raw === undefined) return false

  const scheduledAt = Number(raw)
  if (!Number.isFinite(scheduledAt)) {
    await deleteKVState(ctx, 'questInviteScheduled')
    return false
  }

  if (Date.now() < scheduledAt) return false

  await deleteKVState(ctx, 'questInviteScheduled')
  await invitePriorityQuest(ctx)
  return true
}
