import type { AppCtx } from '../types.js'
import { apiPost, getUser } from '../api.js'
import { HIDE_ALL_GUILD_NOTIFICATIONS, HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS, HIDE_PARTY_NOTIFICATIONS } from '../config.js'

/**
 * Hides notifications from all guilds/parties enabled in settings.
 */
export async function hideAllNotifications(ctx: AppCtx, noLogging = false): Promise<void> {
  const user = await getUser(ctx, true)
  let message = 'Hiding notifications from '
  const notificationIds: string[] = []

  for (const notification of user.notifications) {
    if (notification.type !== 'NEW_CHAT_MESSAGE') continue
    const groupId = notification.data.group.id
    const isParty = groupId === user.party._id

    if ((HIDE_PARTY_NOTIFICATIONS && isParty) || (HIDE_ALL_GUILD_NOTIFICATIONS && !isParty) || HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS.includes(groupId)) {
      message += notification.data.group.name + ', '
      notificationIds.push(notification.id)
    }
  }

  if (notificationIds.length > 0) {
    try {
      if (!noLogging) console.log(message.slice(0, -2))
      await apiPost('https://habitica.com/api/v3/notifications/read', ctx, { notificationIds })
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Notification not found')) {
        if (notificationIds.length > 1) {
          await hideAllNotifications(ctx, true)
        }
      } else {
        throw err
      }
    }
  }
}

/**
 * Hides the most recent party chat notification.
 * Called immediately when a groupChatReceived webhook fires for the party.
 */
export async function hidePartyNotification(ctx: AppCtx): Promise<void> {
  const user = await getUser(ctx, true)

  for (const notification of user.notifications) {
    if (notification.type === 'NEW_CHAT_MESSAGE' && notification.data.group.id === user.party._id) {
      console.log(`Hiding notification from ${notification.data.group.name}`)
      try {
        await apiPost(`https://habitica.com/api/v3/notifications/${notification.id}/read`, ctx)
      } catch (err: unknown) {
        if (!(err instanceof Error) || !err.message.includes('Notification not found')) {
          throw err
        }
      }
      break
    }
  }
}
