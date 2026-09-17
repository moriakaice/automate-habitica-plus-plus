// ─── Cloudflare Workers environment bindings ─────────────────────────────────

export interface Env {
  KV: KVNamespace
  /** Habitica User ID – set via: wrangler secret put USER_ID */
  USER_ID: string
  /** Habitica API Token – set via: wrangler secret put API_TOKEN */
  API_TOKEN: string
  /** Deployed Worker URL (used as Habitica webhook target) – set via: wrangler secret put WORKER_URL */
  WORKER_URL: string
  /** Optional healthchecks.io (or compatible) ping URL – set via: wrangler secret put HEALTHCHECK_URL */
  HEALTHCHECK_URL?: string
}

// ─── Habitica API types ───────────────────────────────────────────────────────

export interface HabiticaStatBuffs {
  int: number
  con: number
  str: number
  per: number
  stealth: number
  streaks: boolean
}

export interface HabiticaStats {
  class: 'warrior' | 'wizard' | 'healer' | 'rogue'
  lvl: number
  hp: number
  mp: number
  gp: number
  int: number
  con: number
  str: number
  per: number
  points: number
  maxMP: number
  buffs: HabiticaStatBuffs
}

export interface HabiticaUser {
  _id: string
  stats: HabiticaStats
  party: {
    _id?: string
    quest: {
      key?: string
      active: boolean
      members: Record<string, boolean | null>
      progress: { hp: number; up: number }
    }
  }
  auth: {
    timestamps: { loggedin: string }
    local: { username: string }
  }
  preferences: {
    sleep: boolean
    timezoneOffset: number
    dayStart: number
    disableClasses: boolean
  }
  flags: { classSelected: boolean }
  guilds: string[]
  items: {
    eggs: Record<string, number>
    hatchingPotions: Record<string, number>
    food: Record<string, number>
    pets: Record<string, number>
    mounts: Record<string, boolean | null>
    quests: Record<string, number>
    gear: {
      equipped: Record<string, string>
      flat: Record<string, GearItem>
    }
  }
  purchased: {
    plan: {
      dateTerminated: string | null
      gemsBought: number
      consecutive: { gemCapExtra: number }
      planId?: string
    }
  }
  notifications: Array<{
    id: string
    type: string
    data: { group: { id: string; name: string } }
  }>
  needsCron: boolean
  achievements: { quests: Record<string, number> }
}

export interface GearItem {
  key: string
  str: number
  int: number
  con: number
  per: number
  klass: string
  specialClass?: string
}

export interface HabiticaParty {
  _id: string
  leader: { id: string }
  memberCount: number
  quest: {
    key?: string
    active: boolean
    members: Record<string, boolean | null>
    progress: { hp: number; up: number }
    leader?: string
  }
}

export interface HabiticaMember {
  _id: string
  profile: { name: string }
  auth: { local: { username: string } }
  stats: {
    hp: number
    class: string
    buffs: Record<string, number | boolean>
    con?: number
    int?: number
  }
  items: {
    eggs: Record<string, number>
    hatchingPotions: Record<string, number>
    food: Record<string, number>
    pets: Record<string, number>
    mounts: Record<string, boolean | null>
    quests: Record<string, number>
  }
  achievements: { quests: Record<string, number> }
  // computed fields – not from API
  numEachEggOwnedUsed?: Record<string, number>
  numEachPotionOwnedUsed?: Record<string, number>
}

export interface HabiticaTask {
  _id: string
  type: 'habit' | 'daily' | 'todo' | 'reward'
  text: string
  value: number
  priority: number
  isDue?: boolean
  completed?: boolean
  checklist: Array<{ completed: boolean }>
  challenge: { id?: string }
  group: { id?: string }
}

export interface QuestDrop {
  type: 'eggs' | 'hatchingPotions' | 'mounts' | 'pets' | 'gear' | string
  key: string
  text: string
}

export interface HabiticaQuest {
  key: string
  text: string
  category: string
  goldValue?: number
  drop: { items: QuestDrop[] }
  boss?: { str: number; hp: number }
}

export interface HabiticaFood {
  target: string
  canDrop: boolean
}

export interface HabiticaContent {
  quests: Record<string, HabiticaQuest>
  eggs: Record<string, { key: string; text: string }>
  dropEggs: Record<string, { key: string; text: string }>
  questEggs: Record<string, { key: string; text: string }>
  hatchingPotions: Record<string, unknown>
  dropHatchingPotions: Record<string, unknown>
  premiumHatchingPotions: Record<string, unknown>
  wackyHatchingPotions: Record<string, unknown>
  food: Record<string, HabiticaFood>
  pets: Record<string, unknown>
  questPets: Record<string, unknown>
  premiumPets: Record<string, unknown>
  wackyPets: Record<string, unknown>
  gear: { flat: Record<string, GearItem> }
}

// ─── Application context ──────────────────────────────────────────────────────

/** Mutable context object threaded through all function calls in one invocation. */
export interface AppCtx {
  env: Env
  // cached API data (populated lazily)
  user?: HabiticaUser
  party?: HabiticaParty | null
  members?: HabiticaMember[] | null
  tasks?: HabiticaTask[]
  dailies?: HabiticaTask[]
  content?: HabiticaContent
  // rate-limiting state
  rateLimitRemaining?: number
  rateLimitReset?: string
  apiResponseTime?: number
  // pending queue items to be merged before the next writeQueue call
  queueBuffer: Partial<QueueState>
  // persistent KV state – lazy-loaded once, flushed once at end of execution
  appState?: AppState
  appStateDirty?: boolean
}

// ─── Webhook payload ──────────────────────────────────────────────────────────

export interface WebhookData {
  webhookType: string
  taskType?: string
  isDue?: boolean
  gp?: number
  dropType?: string | null
  lvl?: number
  statPoints?: number
  questKey?: string
  groupId?: string
}

// ─── Persistent KV state ─────────────────────────────────────────────────────

/**
 * Long-lived state values stored as a single JSON blob under "__state__".
 * All reads and writes go through AppCtx.appState (lazy-loaded, dirty-tracked).
 */
export interface AppState {
  LAST_SCHEDULED_RUN?: string
  LAST_SCHEDULED_CRON?: string
  LAST_AFTER_CRON?: string
  PARTY_ID?: string
  PENDING_QUEST_KEY?: string
  INVITATION_DISCOVERED?: string
  QUEST_SCROLL_PM_SENT?: string
  questInviteScheduled?: string
  LAST_QUEST_REPORT?: string
  HIDE_NOTIFICATIONS_PARTY?: string
  HIDE_NOTIFICATIONS_GUILDS?: string
}

// ─── KV queue state ───────────────────────────────────────────────────────────

/** All pending automation tasks, stored as a single JSON value under "__queue__". */
export interface QueueState {
  hideAllNotifications?: true | 'pending'
  allocateStatPoints?: true
  pauseResumeDamage?: true
  acceptQuestInvite?: true
  healParty?: true
  runCron?: true
  beforeCronSkills?: true
  afterCronSkills?: true
  purchaseGems?: true
  useExcessMana?: true
  sellExtraFood?: true
  sellExtraHatchingPotions?: true
  sellExtraEggs?: true
  hatchFeedPets?: true
  healPlayer?: true
  purchaseArmoires?: true
  sendQuestReport?: true
  forceStartQuest?: true
}

// ─── Quest completion helper ──────────────────────────────────────────────────

export interface QuestCompletionEntry {
  questKey: string
  questName: string
  completionPercentage: number
}
