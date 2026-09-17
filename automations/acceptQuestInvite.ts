import type { AppCtx } from '../types.js'
import { apiPost, getContent, getParty, getUser } from '../api.js'

/**
 * Accepts a pending quest invite if there is one.
 * Run on questInvited webhook and every 10 mins as backup.
 */
export async function acceptQuestInvite(ctx: AppCtx): Promise<void> {
  const party = await getParty(ctx, true)
  const user = await getUser(ctx)

  if (party !== null && party.quest.key !== undefined && !party.quest.active && party.quest.members[user._id] === null) {
    const content = await getContent(ctx)
    console.log(`Accepting invite to pending quest "${content.quests[party.quest.key]?.text}"`)
    await apiPost('https://habitica.com/api/v3/groups/party/quests/accept', ctx)
  } else {
    console.log('No quest invite to accept')
  }
}
