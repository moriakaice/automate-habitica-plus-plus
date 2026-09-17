/**
 * Automate Habitica+ – Cloudflare Workers port
 *
 * Entry points:
 *   fetch()     – handles Habitica webhook POSTs and admin endpoints
 *   scheduled() – runs every 10 minutes (configured in .wrangler.toml)
 *
 * Admin endpoints (GET):
 *   /setup      – create Habitica webhooks, validate credentials, seed queue
 *   /uninstall  – remove Habitica webhooks
 *   /verify     – send a deployment confirmation private message
 *   Authentication: pass ?token=<API_TOKEN> query parameter
 */

import type { AppCtx, Env, QueueState, WebhookData } from './types.js'
import { apiDelete, apiGet, apiPost, apiPut, getUser, getParty, getMembers, getTotalStat, calculatePerfectDayBuff, getDailies } from './api.js'
import {
  AUTO_ACCEPT_QUEST_INVITES,
  AUTO_ALLOCATE_STAT_POINTS,
  AUTO_CAST_SKILLS,
  AUTO_CRON,
  AUTO_HEAL,
  AUTO_HATCH_FEED_PETS,
  AUTO_INVITE_GOLD_QUESTS,
  AUTO_INVITE_HOURGLASS_QUESTS,
  AUTO_INVITE_PET_QUESTS,
  AUTO_INVITE_UNLOCKABLE_QUESTS,
  AUTO_PAUSE_RESUME_DAMAGE,
  AUTO_PURCHASE_ARMOIRES,
  AUTO_PURCHASE_GEMS,
  AUTO_QUEST_REPORT,
  AUTO_SELL_EGGS,
  AUTO_SELL_FOOD,
  AUTO_SELL_HATCHING_POTIONS,
  FORCE_START_QUESTS,
  HATCH_FEED_MODE,
  HIDE_ALL_GUILD_NOTIFICATIONS,
  HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS,
  HIDE_PARTY_NOTIFICATIONS,
  PROJECT_NAME,
} from './config.js'
import {
  ARMOIRE_COST,
  GOLD_PER_GEM,
  HEAL_POTION_COST,
  LEVEL_CAP_FOR_BONUSES,
  MS_PER_MINUTE,
  QUEST_INVITE_BASE_DELAY_MS,
  QUEST_INVITE_RIVAL_INCREMENT_MS,
  SKILL_1_LEVEL,
  SKILL_2_LEVEL,
  SKILL_3_LEVEL,
  SKILL_4_LEVEL,
  STAT_ALLOCATION_MIN_LEVEL,
} from './constants.js'
import { tryAcquireLock, releaseLock, readQueue, writeQueue, getKVState, setKVState, flushState } from './state.js'

// ─── Automations ───────────────────────────────────────────────────────────────
import { acceptQuestInvite } from './automations/acceptQuestInvite.js'
import { allocateStatPoints } from './automations/allocateStatPoints.js'
import {
  burnBossAndDumpMana,
  castEarthquake,
  castProtectiveAura,
  castStealthAndDumpMana,
  castToolsOfTheTrade,
  castValorousPresence,
  healParty,
  numStealthsNeeded,
  smashBossAndDumpMana,
} from './automations/castSkills.js'
import { forceStartQuest } from './automations/forceStartQuest.js'
import { healPlayer } from './automations/healPlayer.js'
import { hatchFeedPets, hatchFeedPetsPriority } from './automations/hatchFeedPets.js'
import { hideAllNotifications, hidePartyNotification } from './automations/hideNotifications.js'
import { invitePriorityQuest, runScheduledQuestInviteIfDue, scheduleQuestInvite, selectPriorityQuest } from './automations/inviteQuest.js'
import { pauseResumeDamage } from './automations/pauseResumeDamage.js'
import { purchaseArmoires } from './automations/purchaseArmoires.js'
import { purchaseGems } from './automations/purchaseGems.js'
import { sendQuestReport } from './automations/questReport.js'
import { runCron } from './automations/runCron.js'
import { sellExtraEggs, sellExtraFood, sellExtraHatchingPotions } from './automations/sellExtraItems.js'

// ─── Context factory ───────────────────────────────────────────────────────────

function makeCtx(env: Env): AppCtx {
  return { env, queueBuffer: {} }
}

// ─── Main Worker export ────────────────────────────────────────────────────────

export default {
  /**
   * HTTP handler – receives Habitica webhook POSTs and admin GET requests.
   */
  async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Admin endpoints – require ?token= matching API_TOKEN
    if (request.method === 'GET') {
      const token = url.searchParams.get('token')
      if (token !== env.API_TOKEN) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (url.pathname === '/setup') {
        try {
          await runSetup(env)
          return new Response('Setup complete.')
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`${PROJECT_NAME} setup failed:`, err instanceof Error ? err.stack : err)
          return new Response(`Setup failed: ${message.slice(0, 1000)}`, { status: 500 })
        }
      }
      if (url.pathname === '/uninstall') {
        try {
          await runUninstall(env)
          return new Response('Uninstall complete.')
        } catch (err) {
          console.error(`${PROJECT_NAME} uninstall failed:`, err instanceof Error ? err.stack : err)
          return new Response('Uninstall failed.', { status: 500 })
        }
      }
      if (url.pathname === '/verify') {
        executionCtx.waitUntil(sendDeploymentConfirmation(env))
        return new Response('Confirmation message started.', { status: 202 })
      }
      if (url.pathname === '/ready') {
        try {
          if (!env.USER_ID || !env.API_TOKEN || env.WORKER_URL !== url.origin) {
            return new Response('Not ready.', { status: 503 })
          }
          await getUser(makeCtx(env), true)
          return new Response('Ready.')
        } catch (err) {
          console.error(`${PROJECT_NAME} readiness check failed:`, err instanceof Error ? err.stack : err)
          return new Response('Not ready.', { status: 503 })
        }
      }
      if (url.pathname === '/status') {
        const ctx = makeCtx(env)
        const lastScheduledRun = await getKVState(ctx, 'LAST_SCHEDULED_RUN')
        const lastScheduledCron = await getKVState(ctx, 'LAST_SCHEDULED_CRON')
        const ageMs = lastScheduledRun ? Date.now() - Date.parse(lastScheduledRun) : null
        return Response.json({
          cron: {
            healthy: ageMs !== null && ageMs <= 20 * MS_PER_MINUTE,
            lastRun: lastScheduledRun ?? null,
            expression: lastScheduledCron ?? null,
            ageMinutes: ageMs === null ? null : Math.floor(ageMs / MS_PER_MINUTE),
          },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    // Habitica webhook POST
    if (request.method === 'POST') {
      let postData: Record<string, unknown>
      try {
        postData = (await request.json()) as Record<string, unknown>
      } catch {
        return new Response('Bad Request', { status: 400 })
      }

      // Return 200 immediately so Habitica doesn't disable the webhook.
      // All actual processing happens in the background via waitUntil.
      executionCtx.waitUntil(handleWebhookAsync(postData, env))
      return new Response('OK', { status: 200 })
    }

    return new Response('Method Not Allowed', { status: 405 })
  },

  /**
   * Cron trigger – runs every 10 minutes (configured in .wrangler.toml).
   */
  async scheduled(event: ScheduledEvent, env: Env, _executionCtx: ExecutionContext): Promise<void> {
    await handleTrigger(env, event.cron)
  },
}

// ─── Scheduled trigger handler ─────────────────────────────────────────────────

async function handleTrigger(env: Env, cron: string): Promise<void> {
  const ctx = makeCtx(env)
  try {
    await setKVState(ctx, 'LAST_SCHEDULED_RUN', new Date().toISOString())
    await setKVState(ctx, 'LAST_SCHEDULED_CRON', cron)
    await flushState(ctx)
    await reenableWebhooks(ctx)
    await processTrigger(ctx)
    await processQueue(ctx, false)
    await runScheduledQuestInviteIfDue(ctx)
    await flushState(ctx)
    if (env.HEALTHCHECK_URL) {
      await fetch(env.HEALTHCHECK_URL).catch(() => {}) // fire-and-forget; never block the worker
    }
  } catch (err) {
    console.error(`${PROJECT_NAME} trigger failed:`, err instanceof Error ? err.stack : err)
    if (env.HEALTHCHECK_URL) {
      await fetch(`${env.HEALTHCHECK_URL}/fail`).catch(() => {})
    }
  }
}

// ─── Webhook handler ───────────────────────────────────────────────────────────

async function handleWebhookAsync(postData: Record<string, unknown>, env: Env): Promise<void> {
  try {
    const ctx = makeCtx(env)

    const rawType = (postData['type'] as string | undefined) ?? (postData['webhookType'] as string | undefined) ?? ''
    const webhookData: WebhookData = { webhookType: rawType }

    if (rawType === 'scored') {
      const userData = postData['user'] as Record<string, unknown> | undefined
      const taskData = postData['task'] as Record<string, unknown> | undefined
      const tmp = (userData?.['_tmp'] as Record<string, unknown>) ?? {}

      if (tmp['leveledUp'] !== undefined) {
        const leveledUpData = tmp['leveledUp'] as Record<string, unknown>
        const stats = (userData?.['stats'] as Record<string, unknown>) ?? {}
        await processWebhook(
          {
            webhookType: 'leveledUp',
            statPoints: stats['points'] as number | undefined,
            lvl: leveledUpData['newLvl'] as number | undefined,
          },
          ctx,
          true,
        )
      }

      const stats = (userData?.['stats'] as Record<string, unknown>) ?? {}
      const dropTmp = tmp['drop'] as Record<string, unknown> | undefined
      Object.assign(webhookData, {
        taskType: taskData?.['type'],
        isDue: taskData?.['isDue'],
        gp: stats['gp'],
        dropType: dropTmp?.['type'] ?? null,
      })
    } else if (rawType === 'leveledUp') {
      webhookData.lvl = postData['finalLvl'] as number | undefined
    } else if (rawType === 'questInvited' || rawType === 'questFinished') {
      const quest = postData['quest'] as Record<string, unknown> | undefined
      webhookData.questKey = quest?.['key'] as string | undefined
    } else if (rawType === 'groupChatReceived') {
      const group = postData['group'] as Record<string, unknown> | undefined
      webhookData.groupId = group?.['id'] as string | undefined
    }

    await processWebhook(webhookData, ctx, true)
    await processQueue(ctx, true)
    await flushState(ctx)
  } catch (err) {
    console.error(`${PROJECT_NAME} webhook failed:`, err instanceof Error ? err.stack : err)
  }
}

// ─── Process trigger ───────────────────────────────────────────────────────────

async function processTrigger(ctx: AppCtx): Promise<void> {
  const now = new Date()
  const user = await getUser(ctx)
  const prefs = user.preferences
  const timezoneOffset = now.getTimezoneOffset() * MS_PER_MINUTE - prefs.timezoneOffset * MS_PER_MINUTE
  const nowAdjusted = new Date(now.getTime() + timezoneOffset)
  const dayStart = prefs.dayStart
  const dayStartAdjusted = dayStart === 0 ? 24 : dayStart
  const needsCron = user.needsCron
  const lastCron = new Date(user.auth.timestamps.loggedin)
  const lastAfterCronRaw = await getKVState(ctx, 'LAST_AFTER_CRON')
  const lastAfterCron = new Date(lastAfterCronRaw ?? 0)

  // Read the queue JSON once, update fields in-memory, write once at the end.
  // This collapses up to N individual puts into a single KV write.
  const q = await readQueue(ctx.env.KV)
  const queued: string[] = []

  /** Sets a queue flag only if not already pending; always overwrites data-carrying values. */
  const set = <K extends keyof QueueState>(key: K, val: QueueState[K]): void => {
    if (q[key] === undefined) {
      q[key] = val
      queued.push(String(key))
    } else if (val !== true) {
      // Data-carrying field (gold amount, quest key, etc.): always use the latest value.
      q[key] = val
    }
  }

  // Just before day start (skill dump before cron)
  if (
    AUTO_CAST_SKILLS &&
    ((nowAdjusted.getHours() === dayStartAdjusted - 1 && 39 <= nowAdjusted.getMinutes() && nowAdjusted.getMinutes() < 54) || (!AUTO_CRON && needsCron))
  ) {
    set('beforeCronSkills', true)
  } else if (AUTO_CRON && needsCron) {
    set('runCron', true)
    if (AUTO_CAST_SKILLS) {
      delete q.beforeCronSkills
      set('afterCronSkills', true)
    }
    if (AUTO_PURCHASE_GEMS) set('purchaseGems', true)
  } else if ((AUTO_CAST_SKILLS || AUTO_PURCHASE_GEMS) && !needsCron && lastCron.getTime() - lastAfterCron.getTime() > 0) {
    if (AUTO_CAST_SKILLS) {
      delete q.beforeCronSkills
      set('afterCronSkills', true)
    }
    if (AUTO_PURCHASE_GEMS) set('purchaseGems', true)
    await setKVState(ctx, 'LAST_AFTER_CRON', now.toISOString()) // always update timestamp
  } else if (AUTO_CAST_SKILLS) {
    set('useExcessMana', true)
  }

  // Refresh groupChatReceived webhooks if notification config changed
  const storedHideParty = await getKVState(ctx, 'HIDE_NOTIFICATIONS_PARTY')
  const storedHideGuilds = await getKVState(ctx, 'HIDE_NOTIFICATIONS_GUILDS')
  if ((HIDE_PARTY_NOTIFICATIONS && user.party._id !== storedHideParty) || (HIDE_ALL_GUILD_NOTIFICATIONS && user.guilds.join() !== storedHideGuilds)) {
    await deleteWebhooks(ctx, true)
    await createWebhooks(ctx, true)
  }

  if (AUTO_CAST_SKILLS && user.stats.class === 'healer') set('healParty', true)
  if (AUTO_PAUSE_RESUME_DAMAGE) set('pauseResumeDamage', true)
  if (AUTO_ACCEPT_QUEST_INVITES) set('acceptQuestInvite', true)
  if (FORCE_START_QUESTS) set('forceStartQuest', true)
  if (AUTO_QUEST_REPORT) set('sendQuestReport', true)
  if (AUTO_PURCHASE_ARMOIRES) set('purchaseArmoires', true)
  if (AUTO_HEAL) set('healPlayer', true)
  if (queued.length > 0) {
    await writeQueue(ctx.env.KV, q)
    console.log(`Trigger queued: ${queued.join(', ')}`)
  }
}

// ─── Process webhook ───────────────────────────────────────────────────────────

async function processWebhook(webhookData: WebhookData, ctx: AppCtx, logType = false): Promise<void> {
  const q = await readQueue(ctx.env.KV)
  const queued: string[] = []

  const set = <K extends keyof QueueState>(key: K, val: QueueState[K]): void => {
    if (q[key] === undefined) {
      q[key] = val
      queued.push(String(key))
    } else if (val !== true) {
      q[key] = val
    }
  }

  if (webhookData.webhookType === 'scored') {
    if (AUTO_PAUSE_RESUME_DAMAGE && (webhookData.taskType === undefined || (webhookData.taskType === 'daily' && webhookData.isDue === true))) {
      set('pauseResumeDamage', true)
    }
    if (AUTO_PURCHASE_GEMS && (webhookData.gp === undefined || webhookData.gp >= GOLD_PER_GEM)) {
      set('purchaseGems', true)
    }
    if (AUTO_CAST_SKILLS) {
      set('useExcessMana', true)
    }
    if (AUTO_PURCHASE_ARMOIRES && (webhookData.gp === undefined || webhookData.gp >= ARMOIRE_COST)) {
      set('purchaseArmoires', true)
    }
    const dropType = webhookData.dropType
    if (AUTO_SELL_EGGS && (dropType === undefined || dropType === 'Egg' || dropType === 'All')) {
      set('sellExtraEggs', true)
    }
    if (AUTO_SELL_HATCHING_POTIONS && (dropType === undefined || dropType === 'HatchingPotion' || dropType === 'All')) {
      set('sellExtraHatchingPotions', true)
    }
    if (AUTO_SELL_FOOD && (dropType === undefined || dropType === 'Food' || dropType === 'All')) {
      set('sellExtraFood', true)
    }
    if (AUTO_HATCH_FEED_PETS && (dropType === undefined || ['Egg', 'HatchingPotion', 'Food', 'All'].includes(dropType ?? ''))) {
      set('hatchFeedPets', true)
    }
  } else if (webhookData.webhookType === 'leveledUp') {
    if (
      AUTO_ALLOCATE_STAT_POINTS &&
      (webhookData.lvl === undefined || ((webhookData.statPoints === undefined || webhookData.statPoints > 0) && webhookData.lvl >= STAT_ALLOCATION_MIN_LEVEL))
    ) {
      set('allocateStatPoints', true)
    }
    if (AUTO_PAUSE_RESUME_DAMAGE && (webhookData.lvl === undefined || webhookData.lvl <= LEVEL_CAP_FOR_BONUSES)) {
      set('pauseResumeDamage', true)
    }
  } else if (webhookData.webhookType === 'questInvited') {
    if (AUTO_PAUSE_RESUME_DAMAGE) set('pauseResumeDamage', true)
    if (AUTO_ACCEPT_QUEST_INVITES) set('acceptQuestInvite', true)
    if (FORCE_START_QUESTS) set('forceStartQuest', true)
  } else if (webhookData.webhookType === 'questStarted') {
    if (FORCE_START_QUESTS) set('forceStartQuest', true)
  } else if (webhookData.webhookType === 'questFinished') {
    if (AUTO_PAUSE_RESUME_DAMAGE) set('pauseResumeDamage', true)
    if (AUTO_PURCHASE_GEMS) set('purchaseGems', true)
    if (AUTO_INVITE_GOLD_QUESTS || AUTO_INVITE_UNLOCKABLE_QUESTS || AUTO_INVITE_PET_QUESTS || AUTO_INVITE_HOURGLASS_QUESTS) {
      const selected = await selectPriorityQuest(ctx)
      let afterMs: number
      if (selected !== null) {
        console.log(
          `Quest scroll with lowest completion: ${selected.questName} (${selected.completionPercentage.toFixed(2)}%, ${selected.rivals} rival${selected.rivals === 1 ? '' : 's'})`,
        )
        afterMs = QUEST_INVITE_BASE_DELAY_MS + QUEST_INVITE_RIVAL_INCREMENT_MS * selected.rivals
      } else {
        console.log('No priority quest found')
        const partyMembers = await getMembers(ctx) // already cached, no extra fetch
        const partySize = partyMembers ? partyMembers.length : 1
        afterMs = QUEST_INVITE_BASE_DELAY_MS + QUEST_INVITE_RIVAL_INCREMENT_MS * Math.max(partySize - 1, 0)
      }
      console.log(`Waiting ${(afterMs / 1000 / 60).toFixed(3)} minutes before inviting quest`)
      await scheduleQuestInvite(ctx, afterMs)
    }
    if (AUTO_PURCHASE_ARMOIRES) set('purchaseArmoires', true)
    if (AUTO_SELL_EGGS) set('sellExtraEggs', true)
    if (AUTO_SELL_HATCHING_POTIONS) set('sellExtraHatchingPotions', true)
    if (AUTO_SELL_FOOD) set('sellExtraFood', true)
    if (AUTO_HATCH_FEED_PETS) set('hatchFeedPets', true)
  } else if (webhookData.webhookType === 'groupChatReceived') {
    const partyId = await getKVState(ctx, 'PARTY_ID')
    if (webhookData.groupId === partyId) {
      if (HIDE_PARTY_NOTIFICATIONS) {
        // Run immediately in webhook context (response already sent to Habitica)
        await hidePartyNotification(ctx)
      }
    } else {
      set('hideAllNotifications', true)
    }
  }
  if (queued.length > 0) await writeQueue(ctx.env.KV, q)
  if (logType) console.log(`Webhook ${webhookData.webhookType}${queued.length > 0 ? ` queued: ${queued.join(', ')}` : ''}`)
}

// ─── Process queue ─────────────────────────────────────────────────────────────

async function processQueue(ctx: AppCtx, isWebhook: boolean): Promise<void> {
  const acquired = await tryAcquireLock(ctx.env.KV)
  if (!acquired) {
    console.log('Could not acquire lock – another invocation is running')
    return
  }

  try {
    while (true) {
      const q = await readQueue(ctx.env.KV)

      // High-priority: mark as "pending" before processing so a concurrent
      // webhook can detect if it was re-triggered while we were working.
      if (q.hideAllNotifications === true) {
        await writeQueue(ctx.env.KV, { ...q, hideAllNotifications: 'pending' })
        await hideAllNotifications(ctx)
        const fresh = await readQueue(ctx.env.KV)
        if (fresh.hideAllNotifications === 'pending') delete fresh.hideAllNotifications
        // If it was re-set to `true` by a concurrent webhook, the loop will pick it up.
        await writeQueue(ctx.env.KV, fresh)
        continue
      }

      // Process all remaining items in one pass; write the updated queue once.
      let anyProcessed = false

      if (q.allocateStatPoints !== undefined) {
        await allocateStatPoints(ctx)
        delete q.allocateStatPoints
        anyProcessed = true
      }
      if (q.pauseResumeDamage !== undefined) {
        await pauseResumeDamage(ctx)
        delete q.pauseResumeDamage
        anyProcessed = true
      }
      if (q.acceptQuestInvite !== undefined) {
        await acceptQuestInvite(ctx)
        delete q.acceptQuestInvite
        anyProcessed = true
      }
      if (q.healParty !== undefined) {
        await healParty(ctx)
        delete q.healParty
        anyProcessed = true
      }
      if (q.runCron !== undefined) {
        await runCron(ctx)
        delete q.runCron
        anyProcessed = true
      }
      if (!isWebhook && q.beforeCronSkills !== undefined) {
        await beforeCronSkills(ctx)
        delete q.beforeCronSkills
        anyProcessed = true
      }
      if (!isWebhook && q.afterCronSkills !== undefined) {
        await afterCronSkills(ctx)
        delete q.afterCronSkills
        anyProcessed = true
      }
      if (q.purchaseGems !== undefined) {
        await purchaseGems(ctx)
        delete q.purchaseGems
        anyProcessed = true
      }
      if (q.forceStartQuest !== undefined) {
        await forceStartQuest(ctx)
        delete q.forceStartQuest
        anyProcessed = true
      }
      if (!isWebhook && q.useExcessMana !== undefined) {
        await useExcessMana(ctx)
        delete q.useExcessMana
        anyProcessed = true
      }
      if (!isWebhook && q.sellExtraFood !== undefined) {
        await sellExtraFood(ctx)
        delete q.sellExtraFood
        anyProcessed = true
      }
      if (!isWebhook && q.sellExtraHatchingPotions !== undefined) {
        await sellExtraHatchingPotions(ctx)
        delete q.sellExtraHatchingPotions
        anyProcessed = true
      }
      if (!isWebhook && q.sellExtraEggs !== undefined) {
        await sellExtraEggs(ctx)
        delete q.sellExtraEggs
        anyProcessed = true
      }
      if (!isWebhook && q.hatchFeedPets !== undefined) {
        if (HATCH_FEED_MODE === 'priority') {
          await hatchFeedPetsPriority(ctx)
        } else {
          await hatchFeedPets(ctx)
        }
        delete q.hatchFeedPets
        anyProcessed = true
      }
      if (!isWebhook && q.healPlayer !== undefined) {
        await healPlayer(ctx)
        delete q.healPlayer
        anyProcessed = true
      }
      if (!isWebhook && q.purchaseArmoires !== undefined) {
        await purchaseArmoires(ctx)
        delete q.purchaseArmoires
        anyProcessed = true
      }
      if (!isWebhook && q.sendQuestReport !== undefined) {
        await sendQuestReport(ctx)
        delete q.sendQuestReport
        anyProcessed = true
      }

      if (anyProcessed) {
        // Merge any queue items enqueued by automations during this pass
        // (e.g. pauseResumeDamage from castSkills, purchaseArmoires from sellExtraItems).
        for (const [k, v] of Object.entries(ctx.queueBuffer) as [keyof QueueState, QueueState[keyof QueueState]][]) {
          if (q[k] === undefined) {
            // @ts-expect-error – dynamic key assignment over a discriminated-union type
            q[k] = v
          } else if (v !== true) {
            // @ts-expect-error
            q[k] = v
          }
        }
        ctx.queueBuffer = {}

        await writeQueue(ctx.env.KV, q)
        continue // re-read to pick up any items added by concurrent webhooks
      }

      break
    }
  } finally {
    await releaseLock(ctx.env.KV)
  }
}

// ─── Skill orchestration helpers ───────────────────────────────────────────────

async function beforeCronSkills(ctx: AppCtx, retry = false): Promise<void> {
  try {
    const user = await getUser(ctx)
    const cls = user.stats.class
    if (cls === 'warrior') await smashBossAndDumpMana(ctx)
    else if (cls === 'wizard') await burnBossAndDumpMana(ctx)
    else if (cls === 'rogue') await castStealthAndDumpMana(ctx)
  } catch (err) {
    if (!retry && err instanceof Error && /Skill \\"[A-Za-z]+\\" not found/.test(err.message)) {
      ctx.user = undefined
      await beforeCronSkills(ctx, true)
    } else throw err
  }
}

async function afterCronSkills(ctx: AppCtx, retry = false): Promise<void> {
  try {
    const user = await getUser(ctx)
    const cls = user.stats.class
    if (cls === 'warrior') await castValorousPresence(ctx, false)
    else if (cls === 'wizard') await castEarthquake(ctx, false)
    else if (cls === 'healer') await castProtectiveAura(ctx)
    else if (cls === 'rogue') await castToolsOfTheTrade(ctx, false)
  } catch (err) {
    if (!retry && err instanceof Error && /Skill \\"[A-Za-z]+\\" not found/.test(err.message)) {
      ctx.user = undefined
      await afterCronSkills(ctx, true)
    } else throw err
  }
}

async function useExcessMana(ctx: AppCtx, retry = false): Promise<void> {
  try {
    const user = await getUser(ctx)
    const cls = user.stats.class
    if (cls === 'warrior') await castValorousPresence(ctx, true)
    else if (cls === 'wizard') await castEarthquake(ctx, true)
    else if (cls === 'healer') await castProtectiveAura(ctx)
    else if (cls === 'rogue') await castToolsOfTheTrade(ctx, true)
  } catch (err) {
    if (!retry && err instanceof Error && /Skill \\"[A-Za-z]+\\" not found/.test(err.message)) {
      ctx.user = undefined
      await useExcessMana(ctx, true)
    } else throw err
  }
}

// ─── Re-enable disabled webhooks ──────────────────────────────────────────────

async function reenableWebhooks(ctx: AppCtx): Promise<void> {
  const resp = (await apiGet('https://habitica.com/api/v3/user/webhook', ctx)) as {
    data: Array<{ id: string; url: string; enabled: boolean; type: string; options?: Record<string, boolean> }>
  }

  for (const wh of resp.data) {
    if (wh.url !== ctx.env.WORKER_URL) continue
    if (wh.enabled) continue

    console.log(`${wh.type} webhook disabled, re-enabling...`)
    await apiPut(`https://habitica.com/api/v3/user/webhook/${wh.id}`, ctx, { enabled: true })

    const enabledTypes: string[] = []
    if (wh.options) {
      for (const [opt, enabled] of Object.entries(wh.options)) {
        if (enabled) enabledTypes.push(opt)
      }
    }
    if (enabledTypes.length === 0) enabledTypes.push(wh.type)
    if (enabledTypes.includes('scored') && !enabledTypes.includes('leveledUp')) {
      enabledTypes.push('leveledUp')
    }

    for (const type of enabledTypes) {
      console.log(`Adding ${type} webhook tasks to the queue...`)
      await processWebhook({ webhookType: type }, ctx)
    }
  }
}

// ─── Webhook management ────────────────────────────────────────────────────────

async function deleteWebhooks(ctx: AppCtx, groupChatOnly = false): Promise<void> {
  const resp = (await apiGet('https://habitica.com/api/v3/user/webhook', ctx)) as { data: Array<{ id: string; url: string; type: string }> }

  if (resp.data.length === 0) return
  console.log(groupChatOnly ? 'Deleting groupChatReceived webhooks' : 'Deleting webhooks')

  for (const wh of resp.data) {
    if (wh.url === ctx.env.WORKER_URL && (!groupChatOnly || wh.type === 'groupChatReceived')) {
      await apiDelete(`https://habitica.com/api/v3/user/webhook/${wh.id}`, ctx)
    }
  }
}

async function createWebhooks(ctx: AppCtx, groupChatOnly = false): Promise<void> {
  const user = await getUser(ctx)
  const webhooks: Array<{ type: string; options?: Record<string, boolean> }> = []

  if (!groupChatOnly) {
    // taskActivity (scored)
    if (
      AUTO_CAST_SKILLS ||
      AUTO_PAUSE_RESUME_DAMAGE ||
      AUTO_ALLOCATE_STAT_POINTS ||
      AUTO_PURCHASE_GEMS ||
      AUTO_PURCHASE_ARMOIRES ||
      AUTO_SELL_EGGS ||
      AUTO_SELL_HATCHING_POTIONS ||
      AUTO_SELL_FOOD ||
      AUTO_HATCH_FEED_PETS
    ) {
      webhooks.push({ type: 'taskActivity', options: { scored: true } })
    }

    // userActivity (leveledUp)
    if (AUTO_PAUSE_RESUME_DAMAGE || AUTO_ALLOCATE_STAT_POINTS) {
      webhooks.push({ type: 'userActivity', options: { leveledUp: true } })
    }

    // questActivity
    const questOpts: Record<string, boolean> = {}
    if (AUTO_ACCEPT_QUEST_INVITES || FORCE_START_QUESTS || AUTO_PAUSE_RESUME_DAMAGE) {
      questOpts['questInvited'] = true
    }
    if (FORCE_START_QUESTS) questOpts['questStarted'] = true
    if (
      AUTO_INVITE_GOLD_QUESTS ||
      AUTO_INVITE_UNLOCKABLE_QUESTS ||
      AUTO_INVITE_PET_QUESTS ||
      AUTO_INVITE_HOURGLASS_QUESTS ||
      AUTO_PURCHASE_GEMS ||
      AUTO_PURCHASE_ARMOIRES ||
      AUTO_SELL_EGGS ||
      AUTO_SELL_HATCHING_POTIONS ||
      AUTO_SELL_FOOD ||
      AUTO_HATCH_FEED_PETS
    ) {
      questOpts['questFinished'] = true
    }
    if (Object.keys(questOpts).length > 0) {
      webhooks.push({ type: 'questActivity', options: questOpts })
    }
  }

  // groupChatReceived
  if (HIDE_PARTY_NOTIFICATIONS && user.party._id) {
    await setKVState(ctx, 'HIDE_NOTIFICATIONS_PARTY', user.party._id)
    webhooks.push({ type: 'groupChatReceived', options: { groupId: user.party._id } as unknown as Record<string, boolean> })
  }
  if (HIDE_ALL_GUILD_NOTIFICATIONS) {
    await setKVState(ctx, 'HIDE_NOTIFICATIONS_GUILDS', user.guilds.join())
    for (const guild of user.guilds) {
      webhooks.push({ type: 'groupChatReceived', options: { groupId: guild } as unknown as Record<string, boolean> })
    }
  } else {
    for (const guild of HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS) {
      if (guild !== 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx') {
        webhooks.push({ type: 'groupChatReceived', options: { groupId: guild } as unknown as Record<string, boolean> })
      }
    }
  }

  if (webhooks.length === 0) return
  console.log(groupChatOnly ? 'Creating groupChatReceived webhooks' : 'Creating webhooks')

  for (const wh of webhooks) {
    await apiPost('https://habitica.com/api/v3/user/webhook', ctx, { url: ctx.env.WORKER_URL, label: PROJECT_NAME, ...wh })
  }
}

// ─── Setup / Uninstall ─────────────────────────────────────────────────────────

async function runSetup(env: Env): Promise<void> {
  console.log(`${PROJECT_NAME} setup starting...`)
  const ctx = makeCtx(env)

  await deleteWebhooks(ctx)

  // Clear queue and persistent state
  const list = await env.KV.list()
  for (const { name } of list.keys) {
    if (/^[a-z]/.test(name) || name === '__state__') await env.KV.delete(name)
  }

  const user = await getUser(ctx, true)

  // Seed queue with initial state
  await processTrigger(ctx)
  await processWebhook({ webhookType: 'scored', taskType: 'daily', isDue: true, gp: user.stats.gp, dropType: 'All' }, ctx)
  await processWebhook({ webhookType: 'leveledUp', statPoints: user.stats.points, lvl: user.stats.lvl }, ctx)
  await processWebhook({ webhookType: 'questInvited', questKey: user.party.quest.key }, ctx)
  await processWebhook({ webhookType: 'questStarted' }, ctx)
  await processWebhook({ webhookType: 'questFinished' }, ctx)
  if (HIDE_PARTY_NOTIFICATIONS && user.party._id !== undefined) {
    await hidePartyNotification(ctx)
  }
  await processWebhook({ webhookType: 'groupChatReceived' }, ctx)

  await createWebhooks(ctx)
  await processQueue(ctx, false)
  await flushState(ctx)

  await sendPrivateMessage(ctx, `${PROJECT_NAME} setup complete. Your Cloudflare Worker is connected and running.`)

  console.log(`${PROJECT_NAME} setup complete!`)
}

async function sendDeploymentConfirmation(env: Env): Promise<void> {
  try {
    const ctx = makeCtx(env)
    await sendPrivateMessage(ctx, `${PROJECT_NAME} redeployed successfully. Your Cloudflare Worker is responding.`)
  } catch (err) {
    console.error(`${PROJECT_NAME} deployment confirmation failed:`, err instanceof Error ? err.stack : err)
  }
}

async function sendPrivateMessage(ctx: AppCtx, message: string): Promise<void> {
  await apiPost('https://habitica.com/api/v3/members/send-private-message', ctx, { message, toUserId: ctx.env.USER_ID })
}

async function runUninstall(env: Env): Promise<void> {
  console.log(`${PROJECT_NAME} uninstall starting...`)
  const ctx = makeCtx(env)
  await deleteWebhooks(ctx)
  console.log(`${PROJECT_NAME} uninstall complete!`)
}
