// Every number the plan marks *(tunable)* lives here (plan §0). Logic never hard-codes these.
export const TUNABLES = {
  /** §7.3 day/night: a full cycle in real seconds and the phase lengths (must sum to dayLengthSeconds). */
  clock: {
    dayLengthSeconds: 24 * 60,
    dawnSeconds: 2 * 60,
    daySeconds: 12 * 60,
    duskSeconds: 2 * 60,
    nightSeconds: 8 * 60,
    /** Time of day a new game starts at (fraction of the cycle; 0 = start of dawn). */
    startTimeOfDay: 0.12,
  },
  /** §9.1 casting. */
  cast: {
    chargeSeconds: 1.5,
    minDistance: 3,
    maxDistance: 25,
    /** Launch elevation in radians and gravity used for the bobber arc. */
    launchAngle: 0.55,
    gravity: 9.81,
    /** Extra reach when casting from an elevated spot (bridge), as a fraction per metre of height. */
    heightBonusPerMetre: 0.04,
  },
  /** §9.2 waiting and biting. */
  bite: {
    delayMinSeconds: 10,
    delayMaxSeconds: 40,
    delayModeSeconds: 20,
    lowPopulationThreshold: 0.5,
    lowPopulationDelayMultiplier: 1.5,
    nibblesMax: 2,
    nibbleGapMinSeconds: 1.5,
    nibbleGapMaxSeconds: 4,
    windowSeconds: { common: 3.0, uncommon: 3.0, rare: 2.0, veryRare: 2.0, legendary: 1.5 },
    reelSeconds: 1.5,
    /** After a missed bite, the next delay is scaled by this (a little quicker so it isn't punishing). */
    missedDelayMultiplier: 0.7,
  },
  /** §9.3 line rules. */
  line: {
    autoReelDistance: 30,
    catchPopulationDrop: 0.03,
    populationRegrowPerHour: 0.1,
    trashRecoveryPerHour: 0.5 / 48, // ~2 in-game days without cleanup
    cleanupTrashPerCan: 0.05,
    trashBagMultiplier: 2,
  },
  /** §8.4 catch shares. */
  catch: {
    shares: { fish: 0.72, junk: 0.18, clothing: 0.06, weapon: 0.04 },
    weaponShares: { knife: 0.4, pistolAmmo: 0.25, rifleAmmo: 0.15, handgun: 0.14, rifle: 0.06 },
    /** Population below this pushes fish share toward junk linearly. */
    lowPopulationShift: 0.5,
    luckyLureRareMultiplier: 1.25,
    /** Rarity weights before zone/time filtering. The legend only becomes eligible after the calm window (§9.4), so once it is, it dominates. */
    rarityWeights: { common: 60, uncommon: 26, rare: 10, veryRare: 3, legendary: 400 },
  },
  /** §9.4 Old Gus. */
  legend: {
    serenityRequired: 1.0,
    calmSecondsRequired: 180,
  },
  /** §7.2 water. */
  water: {
    wadeMaxDepth: 0.8,
    wadeSpeedFactor: 0.55,
    boatMinDepth: 0.5,
    pushBackStrength: 1.6,
  },
  /** §6 / §5 movement. */
  movement: {
    walkSpeed: 2.2,
    sprintSpeed: 4.6,
    jogThreshold: 3.2,
    jumpSpeed: 4.4,
    gravity: -18,
    /** Metres the kinematic controller can step up (roots, planks). */
    stepHeight: 0.35,
    maxSlopeDegrees: 55,
    /** Boundary soft push-back (§7.1 #10). */
    boundaryPush: 3,
    acceleration: 14,
    turnRate: 10,
  },
  camera: {
    distances: [2.6, 4.2, 6.5],
    height: 1.5,
    sensitivity: 0.0022,
    minPitch: -0.55,
    maxPitch: 1.05,
    smoothing: 12,
  },
  /** §12.4 health. */
  health: {
    maxHearts: 5,
    /** Half a heart every 30 s after 10 s without damage. */
    regenDelaySeconds: 10,
    regenHalfHeartSeconds: 30,
    respawnSerenity: 0.5,
  },
  /** §14.3 saving. */
  save: {
    autosaveSeconds: 60,
    graceSecondsAfterLoad: 90,
    maxBytes: 5 * 1024 * 1024,
  },
  /** §11.1 serenity (0..1 here; the HUD shows 0–100). */
  serenity: {
    start: 0.6,
    /** +1 point every 3 s while no NPC or animal is within `quietRadius` and no event is active. */
    regenPerSecond: 1 / 300,
    quietRadius: 30,
    dropMinor: 0.15,
    dropMajor: 0.4,
    dropHurt: 0.1,
  },
  /** §11.2 the Annoyance Director. */
  director: {
    graceSecondsNewGame: 240,
    graceSecondsAfterLoad: 90,
    /** Mean gap between events ramps from `gapMeanStart` to `gapMeanEnd` over `rampSeconds` of session time. */
    gapMeanStart: 150,
    gapMeanEnd: 45,
    rampSeconds: 30 * 60,
    gapJitter: 0.4,
    minGapAfterMinor: 25,
    minGapAfterMajor: 60,
    fishingOddsMultiplier: 1.3,
    /** Roughly one lull per in-game day (none on day 1), 5–9 real minutes, unannounced. */
    lullsPerDay: 1,
    firstLullDay: 2,
    lullMinSeconds: 300,
    lullMaxSeconds: 540,
    /** NPCs seen within this many in-game days are less likely to be picked again. */
    recentNpcDays: 1,
    returningStoryChance: 0.25,
    /** Ambient passersby (wave/bark only) alongside an active event. */
    ambientPasserbyChance: 0.15,
    /** Wanted decay per in-game day and the ranger threshold (§12.3). */
    wantedDecayPerDay: 1,
    rangerWantedThreshold: 2,
  },
  /** §11.4 event behaviour. */
  events: {
    visitLingerMinSeconds: 60,
    visitLingerMaxSeconds: 90,
    visitGroupMax: 2,
    thiefRummageSeconds: 3,
    thiefGetawaySeconds: 40,
    thiefItemsMin: 1,
    thiefItemsMax: 4,
    thiefSneakChance: 0.7,
    partySeconds: 30,
    partyRadius: 35,
    partyCansMin: 15,
    partyCansMax: 30,
    partyGroupMin: 4,
    partyGroupMax: 6,
    bearWarningSeconds: 5,
    bearSniffSeconds: 2.5,
    gatorApproachMinSeconds: 3,
    gatorApproachMaxSeconds: 4,
    gatorLungeRange: 2.5,
    gatorHeartsBank: 2,
    gatorHeartsBoat: 1,
    gatorKnockback: 3.5,
    gatorMarshNightMultiplier: 2,
    ufoOmenSeconds: 4,
    ufoDescentSeconds: 5,
    ufoBeamSeconds: 4,
    ufoMissingHoursMin: 1,
    ufoMissingHoursMax: 3,
    ufoReturnSeconds: 3,
    /** Glowing perch can bite for this many in-game days after an abduction. */
    ufoGlowDays: 1,
    /** Odd outfit pieces get this weight multiplier in the replacement roll. */
    ufoOddPieceWeight: 4,
    waterWalkerEmergeSeconds: 4,
    grudgeReturnDays: 1,
    /** How long a poofed NPC stays out of the pool (in-game days). */
    poofReturnDays: 1,
  },
  /** §10 NPCs. */
  npc: {
    walkSpeed: 1.5,
    jogSpeed: 3.0,
    fleeSpeed: 3.6,
    turnRate: 8,
    talkDistance: 2.3,
    /** People never share a spot: the manager keeps characters at least this far apart (metres). */
    minSeparation: 0.9,
    interactRange: 3,
    lookAtRange: 7,
    maxActive: 12,
    /** Animation update throttling beyond this distance (metres). */
    farAnimDistance: 45,
    despawnDistance: 140,
  },
  /** §10.3 trading. */
  trade: {
    wantMultiplier: 2,
    favoriteMultiplier: 3,
    dislikeMultiplier: 0.25,
    /** Relationship bonus: value discount per relationship point. */
    relationshipBonusPerPoint: 0.02,
    relationshipPerTrade: 5,
  },
  /** §8.1 inventory. */
  inventory: {
    hotbarSlots: 9,
    backpackSlots: 27,
  },
  /** §16 UI. */
  ui: {
    toastSeconds: 4,
    typewriterCharsPerSecond: 40,
    /** Voice blip every N typed characters. */
    voiceBlipEveryChars: 3,
  },
} as const;

export type Tunables = typeof TUNABLES;
