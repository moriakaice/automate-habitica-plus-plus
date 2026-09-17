import type { AppCtx } from '../types.js'
import { apiPost, getContent, getMembers, getParty } from '../api.js'
import { MS_PER_HOUR } from '../constants.js'
import { FORCE_START_QUESTS_AFTER_HOURS, NOTIFY_MEMBERS_EXCLUDED_FROM_QUEST } from '../config.js'
import { getKVState, setKVState, deleteKVState } from '../state.js'

/**
 * Forces pending quests to start after FORCE_START_QUESTS_AFTER_HOURS.
 * Only works if the player ran the quest or is the party leader.
 * Run on questInvited/questStarted webhooks and every 10 mins.
 */
export async function forceStartQuest(ctx: AppCtx): Promise<void> {
  const party = await getParty(ctx, true)

  if (party !== null && party.quest.key && !party.quest.active) {
    const content = await getContent(ctx)
    const questKey = party.quest.key
    const questName = content.quests[questKey]?.text ?? questKey

    const storedKey = await getKVState(ctx, 'PENDING_QUEST_KEY')
    const invitationDiscovered = await getKVState(ctx, 'INVITATION_DISCOVERED')

    if (storedKey === questKey && invitationDiscovered != null) {
      console.log(`Quest "${questName}" already discovered ${invitationDiscovered}`)

      const hoursPassed = (Date.now() - new Date(invitationDiscovered).getTime()) / MS_PER_HOUR

      if (hoursPassed >= FORCE_START_QUESTS_AFTER_HOURS) {
        console.log(`${FORCE_START_QUESTS_AFTER_HOURS} hours have passed, force starting quest`)

        try {
          await apiPost('https://habitica.com/api/v3/groups/party/quests/force-start', ctx)
        } catch (err: unknown) {
          if (!(err instanceof Error) || !err.message.includes('Only the quest leader or group leader can force start the quest')) {
            throw err
          }
        }

        if (NOTIFY_MEMBERS_EXCLUDED_FROM_QUEST) {
          const members = await getMembers(ctx)
          if (members !== null) {
            const membersMissingQuest: string[] = []
            for (const [id, joined] of Object.entries(party.quest.members)) {
              if (!joined) {
                const member = members.find((m) => m._id === id)
                if (member) {
                  membersMissingQuest.push(member.auth.local.username)
                }
              }
            }
            if (membersMissingQuest.length > 0) {
              await apiPost('https://habitica.com/api/v3/members/send-private-message', ctx, {
                message: `The following party members failed to join the quest ${questName}: ${membersMissingQuest.join(', ')}`,
                toUserId: ctx.env.USER_ID,
              })
            }
          }
        }

        console.log('Deleting quest info')
        await deleteKVState(ctx, 'PENDING_QUEST_KEY')
        await deleteKVState(ctx, 'INVITATION_DISCOVERED')
      } else {
        console.log(`${FORCE_START_QUESTS_AFTER_HOURS} hours have not passed, waiting`)
      }
    } else {
      console.log(`New quest "${questName}", saving quest info`)
      await setKVState(ctx, 'PENDING_QUEST_KEY', questKey)
      await setKVState(ctx, 'INVITATION_DISCOVERED', new Date().toString())
    }
  } else {
    console.log('No pending quest, deleting quest info')
    await deleteKVState(ctx, 'PENDING_QUEST_KEY')
    await deleteKVState(ctx, 'INVITATION_DISCOVERED')
  }
}
