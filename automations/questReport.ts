import type { AppCtx } from '../types.js'
import { apiPost, getContent, getMembers, getParty, getQuestCompletionData } from '../api.js'
import { MAX_SCROLL_OWNERS_DISPLAY, MS_PER_DAY, QUEST_REPORT_COUNT, REPORT_EMOJIS } from '../constants.js'
import {
  AUTO_INVITE_GOLD_QUESTS,
  AUTO_INVITE_HOURGLASS_QUESTS,
  AUTO_INVITE_PET_QUESTS,
  AUTO_INVITE_UNLOCKABLE_QUESTS,
  QUEST_REPORT_FREQUENCY_DAYS,
} from '../config.js'
import { getKVState, setKVState } from '../state.js'
import { selectPriorityQuest } from './inviteQuest.js'

/**
 * Sends yourself a PM with quest completion data and who has scrolls to invite for each.
 * Respects QUEST_REPORT_FREQUENCY_DAYS between reports.
 */
export async function sendQuestReport(ctx: AppCtx): Promise<void> {
  const lastReportRaw = await getKVState(ctx, 'LAST_QUEST_REPORT')
  if (lastReportRaw !== undefined) {
    const daysSince = (Date.now() - new Date(lastReportRaw).getTime()) / MS_PER_DAY
    if (daysSince < QUEST_REPORT_FREQUENCY_DAYS) {
      console.log(`Quest report sent ${daysSince.toFixed(1)} days ago, skipping (frequency: ${QUEST_REPORT_FREQUENCY_DAYS} days)`)
      return
    }
  }

  if ((await getParty(ctx, true)) === null) {
    console.log('No party found, skipping quest report.')
    return
  }

  console.log('Generating quest report...')
  const message = await generateQuestReportMessage(ctx)

  console.log(`Sending quest report PM (${message.length} chars)...`)
  await apiPost('https://habitica.com/api/v3/members/send-private-message', ctx, { message, toUserId: ctx.env.USER_ID })

  await setKVState(ctx, 'LAST_QUEST_REPORT', new Date().toISOString())
  console.log('Quest report sent successfully!')
}

/**
 * Builds the quest report message: the quests with the lowest completion %, a sample of
 * party members who own a scroll for each, and (if any AUTO_INVITE_* setting is on)
 * which quest would currently be auto-invited next.
 */
async function generateQuestReportMessage(ctx: AppCtx): Promise<string> {
  const contentData = await getContent(ctx)
  const partyMembers = (await getMembers(ctx)) ?? []
  const questCompletionData = await getQuestCompletionData(ctx)

  const recommendedQuests = questCompletionData
    .filter((q) => contentData.quests[q.questKey]?.category !== 'world')
    .sort((a, b) => a.completionPercentage - b.completionPercentage)
    .slice(0, QUEST_REPORT_COUNT)

  // build a map of quest -> members who have scrolls
  const questScrollOwners: Record<string, string[]> = {}
  for (const quest of recommendedQuests) questScrollOwners[quest.questKey] = []

  for (const member of partyMembers) {
    const displayName = member.profile.name || member.auth.local.username || 'Unknown'
    for (const [questKey, count] of Object.entries(member.items.quests ?? {})) {
      if (count > 0 && questScrollOwners[questKey] !== undefined) {
        questScrollOwners[questKey].push(displayName)
      }
    }
  }

  const autoInviteEnabled = AUTO_INVITE_GOLD_QUESTS || AUTO_INVITE_UNLOCKABLE_QUESTS || AUTO_INVITE_PET_QUESTS || AUTO_INVITE_HOURGLASS_QUESTS
  const nextPick = autoInviteEnabled ? await selectPriorityQuest(ctx) : null

  const randomEmoji = REPORT_EMOJIS[Math.floor(Math.random() * REPORT_EMOJIS.length)]
  const lines: string[] = [`${randomEmoji} **Quest Report — Lowest Completion %**`, '']

  if (autoInviteEnabled) {
    if (nextPick !== null) {
      lines.push(`Next auto-invite pick: **${Math.floor(nextPick.completionPercentage)}%** — ${nextPick.questName}`)
    } else {
      lines.push('Next auto-invite pick: none — no eligible quest scrolls in your inventory right now.')
    }
    lines.push('')
  }

  lines.push(`Names = up to ${MAX_SCROLL_OWNERS_DISPLAY} random party members who own that scroll.`, '')

  for (const quest of recommendedQuests) {
    const percentage = `${Math.floor(quest.completionPercentage)}%`
    const owners = questScrollOwners[quest.questKey] ?? []
    const shuffled = owners.slice().sort(() => Math.random() - 0.5)
    const displayOwners = shuffled.slice(0, MAX_SCROLL_OWNERS_DISPLAY)
    const extraCount = owners.length - displayOwners.length
    const ownersPart = displayOwners.length > 0 ? ` (${displayOwners.join(', ')}${extraCount > 0 ? ` +${extraCount} more` : ''})` : ''
    lines.push(`- **${percentage}** ${quest.questName}${ownersPart}`)
  }

  return lines.join('\n')
}
