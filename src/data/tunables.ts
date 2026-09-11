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
    /** Rarity weights before zone/time filtering. */
    rarityWeights: { common: 60, uncommon: 26, rare: 10, veryRare: 3, legendary: 1 },
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
  },
  /** §14.3 saving. */
  save: {
    autosaveSeconds: 60,
    graceSecondsAfterLoad: 90,
    maxBytes: 5 * 1024 * 1024,
  },
  /** §11 serenity (M1: passive regen only). */
  serenity: {
    regenPerMinute: 0.04,
    start: 0.7,
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
  },
} as const;

export type Tunables = typeof TUNABLES;
