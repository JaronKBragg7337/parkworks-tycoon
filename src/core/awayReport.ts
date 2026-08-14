/**
 * Closed-form projection of a park left running while the player was away.
 *
 * This is an estimate, and it is built from the same constants the live
 * simulation uses rather than invented rates, so a park that earns $40/minute
 * on screen earns about $40/minute offline. Every constant below is sourced
 * from ParkSimulation; if that file changes, these must change with it.
 *
 * What it models: guests arriving up to the appeal-derived population cap,
 * needs growing at the live rates, facilities serving them up to their real
 * throughput, revenue and upkeep accruing, and food waste becoming litter that
 * nobody was there to clean.
 *
 * What it does not model: walking time, queue geometry, path layout, or which
 * specific guest went where. Offline earnings are therefore an upper bound on a
 * well-connected park and are capped in time so idling is never the best move.
 */
import {
  GUEST_LIFETIME_SECONDS,
  NEED_GROWTH_PER_SECOND,
  NEED_RELIEF_PER_SERVICE,
  SERVICED_NEEDS,
  type ServicedNeed,
} from './needRates';
import type { ParkStats } from './types';

export { SERVICED_NEEDS };
export type { ServicedNeed };

/** ParkSimulation.processSpawning — an economic ceiling, not a render one. */
const MAX_GUESTS = 600;
const BASE_GUESTS = 5;
const APPEAL_PER_GUEST = 3;

/** ParkSimulation.processUpkeep charges the full upkeep total this often. */
const UPKEEP_INTERVAL_SECONDS = 45;

/** ParkSimulation.advanceClock: 3.5 sim-minutes per second, 9:00 to 21:00. */
const SIM_MINUTES_PER_SECOND = 3.5;
const SIM_MINUTES_PER_DAY = 12 * 60;
export const REAL_SECONDS_PER_PARK_DAY = SIM_MINUTES_PER_DAY / SIM_MINUTES_PER_SECOND;

/** ParkSimulation.recalculateCleanliness. */
const CLEANLINESS_LOST_PER_LITTER = 0.045;

/** ParkSimulation.removeGuest: weight of one departure in the running average. */
const REPUTATION_SMOOTHING = 0.012;

/**
 * Live guests spawn at 0.72-0.92 happiness and gain it slowly, so even a
 * flawless park sends people home a little short of perfect. Without this the
 * projection would hand out a perfect score no live park could earn.
 */
const MAX_EXPECTED_HAPPINESS = 0.96;

/**
 * Offline time is credited up to this much. Beyond it the park is described as
 * having sat idle, so leaving the game closed for a week is never a strategy.
 */
export const AWAY_CREDIT_CAP_SECONDS = 8 * 60 * 60;

/** Away time below this is treated as a normal reload, not an absence. */
export const AWAY_MINIMUM_SECONDS = 60;

export interface AwayNeedCapacity {
  /** Completed services per second at full utilisation: sum of capacity / serviceSeconds. */
  throughput: number;
  /** Throughput-weighted average revenue per completed service, at today's prices. */
  revenuePerService: number;
  /**
   * Share of guests willing to pay what this need's facilities charge, 0 to 1.
   * A park left overpriced earns less while nobody is watching, exactly as it
   * would have on screen. Omitted means 1: nobody is refusing anything.
   */
  acceptance?: number;
}

export interface AwayParkProfile {
  /** Total appeal of connected buildings — drives the guest population cap. */
  appeal: number;
  /** Total upkeep charged every UPKEEP_INTERVAL_SECONDS. */
  upkeepPerCycle: number;
  needs: Record<ServicedNeed, AwayNeedCapacity>;
  /** Bins and food outlets, used to estimate how much waste became litter. */
  binCount: number;
  foodCount: number;
}

export interface AwayReport {
  /** Real seconds since the save was written. */
  awaySeconds: number;
  /** Seconds actually simulated, after the cap. */
  creditedSeconds: number;
  capped: boolean;
  guestsVisited: number;
  guestsServed: number;
  revenue: number;
  upkeep: number;
  netCash: number;
  litterCreated: number;
  daysPassed: number;
  /** Absolute values after the absence, ready to write back onto stats. */
  cleanliness: number;
  reputation: number;
}

export function createEmptyAwayProfile(): AwayParkProfile {
  return {
    appeal: 0,
    upkeepPerCycle: 0,
    needs: {
      hunger: { throughput: 0, revenuePerService: 0, acceptance: 1 },
      fun: { throughput: 0, revenuePerService: 0, acceptance: 1 },
      bladder: { throughput: 0, revenuePerService: 0, acceptance: 1 },
      rest: { throughput: 0, revenuePerService: 0, acceptance: 1 },
    },
    binCount: 0,
    foodCount: 0,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Projects an absence forward. Returns null when too little time passed to be
 * worth reporting, so a quick refresh does not produce a popup.
 */
export function computeAwayProgress(
  stats: Readonly<ParkStats>,
  profile: AwayParkProfile,
  awaySeconds: number,
  litterCount: number,
): AwayReport | null {
  if (!Number.isFinite(awaySeconds) || awaySeconds < AWAY_MINIMUM_SECONDS) return null;

  const creditedSeconds = Math.min(awaySeconds, AWAY_CREDIT_CAP_SECONDS);
  const capped = awaySeconds > AWAY_CREDIT_CAP_SECONDS;

  const population = Math.min(
    MAX_GUESTS,
    Math.max(0, BASE_GUESTS + Math.floor(profile.appeal / APPEAL_PER_GUEST)),
  );

  let servicesTotal = 0;
  let revenue = 0;
  let hungerServices = 0;
  let demandTotal = 0;
  let metTotal = 0;

  for (const need of SERVICED_NEEDS) {
    const capacity = profile.needs[need];
    // Demand is how fast the population generates this need, expressed in
    // services per second: growth rate divided by what one service relieves.
    // Guests who refuse the price are demand the park never gets to meet, so
    // they are removed here rather than discounted from the revenue afterwards.
    const acceptance = clamp01(
      typeof capacity.acceptance === 'number' && Number.isFinite(capacity.acceptance)
        ? capacity.acceptance
        : 1,
    );
    const demandPerSecond =
      ((population * NEED_GROWTH_PER_SECOND[need]) / NEED_RELIEF_PER_SERVICE[need]) * acceptance;
    const servedPerSecond = Math.min(demandPerSecond, capacity.throughput);
    const services = servedPerSecond * creditedSeconds;

    demandTotal += demandPerSecond;
    metTotal += servedPerSecond;
    servicesTotal += services;
    revenue += services * capacity.revenuePerService;
    if (need === 'hunger') hungerServices = services;
  }

  const upkeep = (creditedSeconds / UPKEEP_INTERVAL_SECONDS) * profile.upkeepPerCycle;

  // Each food service hands a guest a wrapper. Guests only look for a bin
  // nearby, so bin coverage relative to food outlets estimates how much of that
  // waste reached one. With no food outlets there is no waste to place.
  const coverage = profile.foodCount > 0
    ? clamp01(profile.binCount / profile.foodCount)
    : 1;
  const litterCreated = Math.max(0, Math.round(hungerServices * (1 - coverage)));
  const cleanliness = clamp01(1 - (litterCount + litterCreated) * CLEANLINESS_LOST_PER_LITTER);

  const departures = (population * creditedSeconds) / GUEST_LIFETIME_SECONDS;
  // A guest leaves happy when the park could actually serve them and was clean.
  const satisfaction = demandTotal > 0 ? clamp01(metTotal / demandTotal) : 1;
  const expectedHappiness = Math.min(
    MAX_EXPECTED_HAPPINESS,
    clamp01(satisfaction * 0.65 + cleanliness * 0.35),
  );

  // Live reputation is an exponential average over departing guests. Applying
  // that same step `departures` times has a closed form, so an absence lands on
  // exactly the reputation the park would have earned had it been watched.
  const target = expectedHappiness * 100;
  const retained = Math.pow(1 - REPUTATION_SMOOTHING, departures);
  const reputationAfter = target + (stats.reputation - target) * retained;

  const roundedRevenue = Math.max(0, Math.round(revenue));
  const roundedUpkeep = Math.max(0, Math.round(upkeep));

  return {
    awaySeconds,
    creditedSeconds,
    capped,
    guestsVisited: Math.max(0, Math.round(departures)),
    guestsServed: Math.max(0, Math.round(servicesTotal)),
    revenue: roundedRevenue,
    upkeep: roundedUpkeep,
    netCash: roundedRevenue - roundedUpkeep,
    litterCreated,
    daysPassed: Math.floor(creditedSeconds / REAL_SECONDS_PER_PARK_DAY),
    cleanliness,
    reputation: Math.max(0, Math.min(100, reputationAfter)),
  };
}
