/**
 * Automate Habitica++ – Cloudflare Workers port
 * Original by @bumbleshoot / @tetamusha
 *
 * Committed default settings. Personal overrides belong in config.local.ts.
 *
 * Secrets (credentials) are NOT stored here – set them via:
 *   wrangler secret put USER_ID
 *   wrangler secret put API_TOKEN
 *   wrangler secret put WORKER_URL   ← your deployed worker URL
 */

export const PROJECT_NAME = 'Automate Habitica++'

// ─── Core automations ──────────────────────────────────────────────────────────

export const AUTO_CRON = true

export const AUTO_ACCEPT_QUEST_INVITES = true

export const FORCE_START_QUESTS = false // party leaders only
export const FORCE_START_QUESTS_AFTER_HOURS = 1
export const NOTIFY_MEMBERS_EXCLUDED_FROM_QUEST = false

export const AUTO_INVITE_GOLD_QUESTS = true
export const AUTO_INVITE_UNLOCKABLE_QUESTS = true
export const AUTO_INVITE_PET_QUESTS = true
export const AUTO_INVITE_HOURGLASS_QUESTS = true
export const AUTO_INVITE_FULLY_COMPLETED_QUESTS = true
export const PM_WHEN_OUT_OF_QUEST_SCROLLS = false

export const AUTO_QUEST_REPORT = true // send yourself a periodic PM with quest completion data & who has scrolls to invite
export const QUEST_REPORT_FREQUENCY_DAYS = 7 // how often to send the quest report (in days)

export const AUTO_CAST_SKILLS = true

export const AUTO_PAUSE_RESUME_DAMAGE = true
export const MAX_PLAYER_DAMAGE = 20
export const MAX_PARTY_DAMAGE = 5

export const AUTO_HEAL = true

export const AUTO_ALLOCATE_STAT_POINTS = false
export const STAT_TO_ALLOCATE: 'str' | 'int' | 'con' | 'per' = 'int'

export const AUTO_PURCHASE_GEMS = false // subscribers only

export const AUTO_PURCHASE_ARMOIRES = false
export const RESERVE_GOLD = 1_000

export const AUTO_SELL_EGGS = false

export const AUTO_SELL_HATCHING_POTIONS = false

export const AUTO_SELL_FOOD = false
export const RESERVE_FOOD = 999

export const AUTO_HATCH_FEED_PETS = true
export const HATCH_FEED_MODE: 'conservative' | 'priority' = 'conservative'
export const ONLY_USE_DROP_FOOD = true

export const HIDE_PARTY_NOTIFICATIONS = false
export const HIDE_ALL_GUILD_NOTIFICATIONS = false
/** Only used when HIDE_ALL_GUILD_NOTIFICATIONS is false. Add guild UUIDs here. */
export const HIDE_NOTIFICATIONS_FROM_SPECIFIC_GUILDS: string[] = [
  // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
]

// ─── Banned quest scrolls ──────────────────────────────────────────────────────
// Quests you do NOT want auto-invite for. Remove the leading // to ban.

export const BANNED_SCROLLS: string[] = [
  // "The Basi-List",
  // "The Feral Dust Bunnies",
  // "Dilatory Distress, Part 1: Message in a Bottle",
  // "Dilatory Distress, Part 2: Creatures of the Crevasse",
  // "Dilatory Distress, Part 3: Not a Mere Maid",
  // "Mayhem in Mistiflying, Part 1: In Which Mistiflying Experiences a Dreadful Bother",
  // "Mayhem in Mistiflying, Part 2: In Which the Wind Worsens",
  // "Mayhem in Mistiflying, Part 3: In Which a Mailman is Extremely Rude",
  // "Stoïkalm Calamity, Part 1: Earthen Enemies",
  // "Stoïkalm Calamity, Part 2: Seek the Icicle Caverns",
  // "Stoïkalm Calamity, Part 3: Icicle Drake Quake",
  // "Terror in the Taskwoods, Part 1: The Blaze in the Taskwoods",
  // "Terror in the Taskwoods, Part 2: Finding the Flourishing Fairies",
  // "Terror in the Taskwoods, Part 3: Jacko of the Lantern",
  // "The Mystery of the Masterclassers, Part 1: Read Between the Lines",
  // "The Mystery of the Masterclassers, Part 2: Assembling the a'Voidant",
  // "The Mystery of the Masterclassers, Part 3: City in the Sands",
  // "The Mystery of the Masterclassers, Part 4: The Lost Masterclasser",
  // "The Insta-Gator",
  // "The Overpacked Alpaca",
  // "The Indulgent Armadillo",
  // "The Magical Axolotl",
  // "Stop Badgering Me!",
  // "The CRITICAL BUG",
  // "The Killer Bunny",
  // "Bye, Bye, Butterfry",
  // "A Purrplexing Predicament",
  // "The Chaotic Chameleon",
  // "Such a Cheetah",
  // "The Mootant Cow",
  // "The Fiddling Crab",
  // "The Dilatory Derby",
  // "Triple Dog Dare!",
  // "The Dolphin of Doubt",
  // "The Birds of Preycrastination",
  // "The Nefarious Ferret",
  // "Swamp of the Clutter Frog",
  // "The Spirit of Spring",
  // "The Gear-affe",
  // "The Fiery Gryphon",
  // "The Guinea Pig Gang",
  // "Help! Harpy!",
  // "The Hedgebeast",
  // "What a Hippo-Crite",
  // "Ride the Night-Mare",
  // "Kangaroo Catastrophe",
  // "The Kraken of Inkomplete",
  // "Monstrous Mandrill and the Mischief Monkeys",
  // "Infestation of the NowDo Nudibranchs",
  // "The Call of Octothulu",
  // "The Perfidious Plotter!",
  // "The Night-Owl",
  // "The Push-and-Pull Peacock",
  // "The Fowl Frost",
  // "The Perfectionist Platypus",
  // "The Pterror-dactyl",
  // "Raccoon Tycoon",
  // "The Rat King",
  // "Escape the Cave Creature",
  // "Rooster Rampage",
  // "The Sabre Cat",
  // "Danger in the Depths: Sea Serpent Strike!",
  // "The Thunder Ram",
  // "The Jelly Regent",
  // "The Somnolent Sloth",
  // "The Snail of Drudgery Sludge",
  // "The Serpent of Distraction",
  // "The Icy Arachnid",
  // "The Sneaky Squirrel",
  // "The Tangle Tree",
  // "King of the Dinosaurs",
  // "The Dinosaur Unearthed",
  // "The Trampling Triceratops",
  // "Guide the Turtle",
  // "Convincing the Unicorn Queen",
  // "The Veloci-Rapper",
  // "Wail of the Whale",
  // "A Tangled Yarn",
  // "The Amber Alliance",
  // "A Startling Starry Idea",
  // "Brazen Beetle Battle",
  // "A Bright Fluorite Fright",
  // "The Onyx Odyssey",
  // "Calm the Corrupted Cupid",
  // "Ruby Rapport",
  // "The Silver Solution",
  // "A Maze of Moss",
  // "Turquoise Treasure Toil",
  // "A Jaded Jinx",
  // "The Legend of the Obscure Opals",
  // "Trapper Santa",
  // "Find the Cub",
  // "Egg Hunt",
  // "Waffling with the Fool: Disaster Breakfast!",
  // "Virtual Mayhem with the April Fool: The Beepening",
  // "The Moody Mushroom",
  // "Attack of the Mundane, Part 1: Dish Disaster!",
  // "Attack of the Mundane, Part 2: The SnackLess Monster",
  // "Attack of the Mundane, Part 3: The Laundromancer",
  // "The Golden Knight, Part 1: A Stern Talking-To",
  // "The Golden Knight, Part 2: Gold Knight",
  // "The Golden Knight, Part 3: The Iron Knight",
  // "Lunar Battle, Part 1: Find the Mysterious Shards",
  // "Lunar Battle, Part 2: Stop the Overshadowing Stress",
  // "Lunar Battle, Part 3: The Monstrous Moon",
  // "Recidivate, Part 1: The Moonstone Chain",
  // "Recidivate, Part 2: Recidivate the Necromancer",
  // "Recidivate, Part 3: Recidivate Transformed",
  // "Vice, Part 1: Free Yourself of the Dragon's Influence",
  // "Vice, Part 2: Find the Lair of the Wyrm",
  // "Vice, Part 3: Vice Awakens",
  // "Mysterious Mechanical Marvels!",
  // "A Voyage of Cosmic Concentration",
  // "A Whirl with a Wind-Up Warrior",
  // "The Be-Wilder",
  // "Burnout and the Exhaust Spirits",
  // "The Dread Drag'on of Dilatory",
  // "The Dysheartener",
  // "The Abominable Stressbeast of the Stoïkalm Steppes",
]
