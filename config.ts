import * as defaults from './defaults.js'
import overrides from './config.local.js'

type OverrideValue<T> = T extends number ? number : T extends boolean ? boolean : T

export type Config = { [Key in keyof typeof defaults]: OverrideValue<(typeof defaults)[Key]> }

const config: Config = { ...defaults, ...overrides }

export const PROJECT_NAME = config.PROJECT_NAME
export const AUTO_CRON = config.AUTO_CRON
export const AUTO_ACCEPT_QUEST_INVITES = config.AUTO_ACCEPT_QUEST_INVITES
export const FORCE_START_QUESTS = config.FORCE_START_QUESTS
export const FORCE_START_QUESTS_AFTER_HOURS = config.FORCE_START_QUESTS_AFTER_HOURS
export const NOTIFY_MEMBERS_EXCLUDED_FROM_QUEST = config.NOTIFY_MEMBERS_EXCLUDED_FROM_QUEST
export const AUTO_INVITE_GOLD_QUESTS = config.AUTO_INVITE_GOLD_QUESTS
export const AUTO_INVITE_UNLOCKABLE_QUESTS = config.AUTO_INVITE_UNLOCKABLE_QUESTS
export const AUTO_INVITE_PET_QUESTS = config.AUTO_INVITE_PET_QUESTS
export const AUTO_INVITE_HOURGLASS_QUESTS = config.AUTO_INVITE_HOURGLASS_QUESTS
export const AUTO_INVITE_FULLY_COMPLETED_QUESTS = config.AUTO_INVITE_FULLY_COMPLETED_QUESTS
export const PM_WHEN_OUT_OF_QUEST_SCROLLS = config.PM_WHEN_OUT_OF_QUEST_SCROLLS
export const AUTO_QUEST_REPORT = config.AUTO_QUEST_REPORT
export const QUEST_REPORT_FREQUENCY_DAYS = config.QUEST_REPORT_FREQUENCY_DAYS
export const AUTO_CAST_SKILLS = config.AUTO_CAST_SKILLS
export const AUTO_PAUSE_RESUME_DAMAGE = config.AUTO_PAUSE_RESUME_DAMAGE
export const MAX_PLAYER_DAMAGE = config.MAX_PLAYER_DAMAGE
export const MAX_PARTY_DAMAGE = config.MAX_PARTY_DAMAGE
export const AUTO_HEAL = config.AUTO_HEAL
export const AUTO_ALLOCATE_STAT_POINTS = config.AUTO_ALLOCATE_STAT_POINTS
export const STAT_TO_ALLOCATE = config.STAT_TO_ALLOCATE
export const AUTO_PURCHASE_GEMS = config.AUTO_PURCHASE_GEMS
export const AUTO_PURCHASE_ARMOIRES = config.AUTO_PURCHASE_ARMOIRES
export const RESERVE_GOLD = config.RESERVE_GOLD
export const AUTO_SELL_EGGS = config.AUTO_SELL_EGGS
export const AUTO_SELL_HATCHING_POTIONS = config.AUTO_SELL_HATCHING_POTIONS
export const AUTO_SELL_FOOD = config.AUTO_SELL_FOOD
export const RESERVE_FOOD = config.RESERVE_FOOD
export const AUTO_HATCH_FEED_PETS = config.AUTO_HATCH_FEED_PETS
export const HATCH_FEED_MODE = config.HATCH_FEED_MODE
export const ONLY_USE_DROP_FOOD = config.ONLY_USE_DROP_FOOD
export const HIDE_PARTY_NOTIFICATIONS = config.HIDE_PARTY_NOTIFICATIONS
export const HIDE_ALL_GUILD_NOTIFICATIONS = config.HIDE_ALL_GUILD_NOTIFICATIONS
export const HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS = config.HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS
export const BANNED_SCROLLS = config.BANNED_SCROLLS
