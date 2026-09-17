// ─── Time constants ────────────────────────────────────────────────────────────

export const MS_PER_SECOND = 1000
export const MS_PER_MINUTE = MS_PER_SECOND * 60
export const MS_PER_HOUR = MS_PER_MINUTE * 60
export const MS_PER_DAY = MS_PER_HOUR * 24

// ─── Game mechanics ────────────────────────────────────────────────────────────

/** Maximum health points for any player. @see https://habitica.fandom.com/wiki/Health_Points */
export const MAX_HP = 50

/** Base mana points all players start with (before INT bonus). @see https://habitica.fandom.com/wiki/Mana_Points */
export const BASE_MANA = 30

/** Maximum stat bonus from level (caps at level 100). @see https://habitica.fandom.com/wiki/Stats */
export const MAX_LEVEL_STAT_BONUS = 50

/** Level at which stat point allocation becomes available. */
export const STAT_ALLOCATION_MIN_LEVEL = 10

/** Level at which first class skill is unlocked. */
export const SKILL_1_LEVEL = 11

/** Level at which second class skill is unlocked. */
export const SKILL_2_LEVEL = 12

/** Level at which third class skill is unlocked. */
export const SKILL_3_LEVEL = 13

/** Level at which fourth class skill is unlocked. */
export const SKILL_4_LEVEL = 14

/** Level at which perfect day buff and CON scaling max out. */
export const LEVEL_CAP_FOR_BONUSES = 100

/** Gold cost to purchase one gem (subscribers only). */
export const GOLD_PER_GEM = 20

/** Gold cost to purchase one Enchanted Armoire. */
export const ARMOIRE_COST = 100

/** HTTP status code for rate limiting */
export const HTTP_RATE_LIMITED = 429

/** HTTP status code threshold for success responses */
export const HTTP_SUCCESS_MAX = 300

/** HTTP status code threshold for server errors */
export const HTTP_SERVER_ERROR_MIN = 500

/** Base delay before the quest invite trigger fires, before rival party members are factored in, in ms (10 seconds) */
export const QUEST_INVITE_BASE_DELAY_MS = 10_000

/** Additional delay added per rival party member (one who owns an eligible scroll for a strictly more urgent quest) in ms (15 seconds) */
export const QUEST_INVITE_RIVAL_INCREMENT_MS = 15_000

/** Number of quests to list in the quest report (lowest completion % first) */
export const QUEST_REPORT_COUNT = 10

/** Retry delay when server address is unavailable in ms */
export const SERVER_RETRY_DELAY_MS = 5000

/** Number of eggs needed per species to have all basic color pets/mounts. */
export const EGGS_FOR_COMPLETE_SPECIES = 20

/** Number of potions needed per premium/magic potion color. */
export const POTIONS_FOR_COMPLETE_PREMIUM = 18

/** Number of potions needed per wacky potion color (no mounts). */
export const POTIONS_FOR_COMPLETE_WACKY = 9

/** Default boss HP estimate when no boss data is available. */
export const DEFAULT_BOSS_HP = 3000

// ─── Healer skill constants ────────────────────────────────────────────────────

export const MANA_COST_HEALING_LIGHT = 15
export const MANA_COST_BLESSING = 25
export const MANA_COST_PROTECTIVE_AURA = 30

// ─── Healing Potion constants ──────────────────────────────────────────────────

/** Gold cost of one Healing Potion. */
export const HEAL_POTION_COST = 25

/** HP restored by one Healing Potion. */
export const HEAL_POTION_HP = 15
export const HEALING_RESERVE_HOURS = 16
export const BLESSING_HEAL_MULTIPLIER = 0.04
export const BLESSING_STAT_BONUS = 5
export const HEALING_LIGHT_MULTIPLIER = 0.075

// ─── Rogue skill constants ─────────────────────────────────────────────────────

export const MANA_COST_PICKPOCKET = 10
export const MANA_COST_BACKSTAB = 15
export const MANA_COST_TOOLS_OF_TRADE = 25
export const MANA_COST_STEALTH = 45
export const STEALTH_BASE_RATE = 0.64
export const STEALTH_PER_DIVISOR = 55

// ─── Warrior skill constants ───────────────────────────────────────────────────

export const MANA_COST_BRUTAL_SMASH = 10
export const MANA_COST_DEFENSIVE_STANCE = 25
export const MANA_COST_VALOROUS_PRESENCE = 20
export const BRUTAL_SMASH_BASE_DAMAGE = 55
export const BRUTAL_SMASH_STR_DIVISOR = 70

// ─── Mage skill constants ──────────────────────────────────────────────────────

export const MANA_COST_BURST_OF_FLAMES = 10
export const MANA_COST_ETHEREAL_SURGE = 30
export const MANA_COST_EARTHQUAKE = 35
export const MANA_COST_CHILLING_FROST = 40
export const BURST_OF_FLAMES_INT_DIVISOR = 10

// ─── Quest report constants ────────────────────────────────────────────────────

export const MAX_SCROLL_OWNERS_DISPLAY = 3
export const REPORT_EMOJIS = ['🎯', '⚔️', '🗡️', '🐉', '🏰', '🧙', '🦄', '🔮', '✨', '🌟', '💎', '🏆', '📜', '🎲', '🧭']

// ─── Pause/resume damage constants ────────────────────────────────────────────

export const DEFAULT_BOSS_STR = 4
export const TASK_VALUE_MIN = -47.27
export const TASK_VALUE_MAX = 21.27
export const DAMAGE_CALC_EXPONENT = 0.9747
export const PLAYER_DAMAGE_MULTIPLIER = 2
export const MIN_CON_REDUCTION = 0.1
export const CON_DAMAGE_DIVISOR = 250
export const DAMAGE_ROUNDING_PRECISION = 10

// ─── Purchase gems constants ───────────────────────────────────────────────────

export const BASE_GEM_CAP = 24

// ─── Hatch/feed pets constants ─────────────────────────────────────────────────

/** Points when feeding a basic color pet its favorite food. */
export const FOOD_POINTS_FAVORITE = 5

/** Points when feeding a basic color pet non-favorite food. */
export const FOOD_POINTS_NON_FAVORITE = 2

/** Points when feeding magic potion pets any food. */
export const FOOD_POINTS_MAGIC_POTION_PET = 5

/** Total food points needed for a pet to become a mount. */
export const MOUNT_THRESHOLD = 50

/** Starting fed amount when a pet is first hatched. */
export const NEWLY_HATCHED_FED = 5

export const HUNGER_AFTER_HATCH = MOUNT_THRESHOLD - NEWLY_HATCHED_FED
export const FEEDINGS_TO_MOUNT_FAVORITE = Math.ceil(HUNGER_AFTER_HATCH / FOOD_POINTS_FAVORITE)
export const FEEDINGS_TO_MOUNT_NON_FAVORITE = Math.ceil(HUNGER_AFTER_HATCH / FOOD_POINTS_NON_FAVORITE)
export const NON_FAVORITE_TO_FAVORITE_RATIO = FEEDINGS_TO_MOUNT_NON_FAVORITE / FEEDINGS_TO_MOUNT_FAVORITE

/** Eggs/potions needed per non-wacky pet (1 for pet + 1 for mount = 2). */
export const RESOURCES_PER_NON_WACKY = 2

/** Eggs/potions needed per wacky pet (1 for pet only, can't become mount). */
export const RESOURCES_PER_WACKY = 1

// ─── Hatch/feed priority groups ───────────────────────────────────────────────

export const HATCH_PRIORITY = {
  STANDARD_BASIC: 1,
  PREMIUM: 2,
  QUEST: 2,
  WACKY: 3,
} as const

export const FEED_PRIORITY = {
  STANDARD: 1,
  QUEST: 2,
  PREMIUM: 3,
} as const
