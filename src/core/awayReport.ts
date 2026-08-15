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

/**
 * ParkSimulation.processSpawning sets the next spawn to
 * `max(2.2, 6.8 * (1 - reputation/180) + random(0.5, 2.8))`. The jitter averages
 * 1.65, which is what the projection uses — over hours of absence the mean is
 * the only part that survives.
 */
const SPAWN_MINIMUM_SECONDS = 2.2;
const SPAWN_BASE_SECONDS = 6.8;
const SPAWN_JITTER_MEAN_SECONDS = 1.65;
const SPAWN_REPUTATION_DIVISOR = 180;

/**
 * Time a departing guest spends walking to the gate after their visit ends.
 * They still count as attendance while they do, and leaving it out made the
 * projection's crowd noticeably smaller than the one on screen.
 */
const DEPARTURE_WALK_SECONDS = 22;

function spawnIntervalSeconds(reputation: number): number {
  const rating = Math.max(0, Math.min(100, reputation));
  return Math.max(
    SPAWN_MINIMUM_SECONDS,
    SPAWN_BASE_SECONDS * (1 - rating / SPAWN_REPUTATION_DIVISOR) + SPAWN_JITTER_MEAN_SECONDS,
  );
}

/**
 * How many guests are actually in the park, which is **not** the same as how
 * many it could hold.
 *
 * This was the bug behind an hour's absence paying out a quarter of a million.
 * The projection used the appeal-derived *ceiling* as its population, but a park
 * only reaches that ceiling if guests arrive faster than they leave. They do
 * not: one arrives every few seconds and each stays about two and a half
 * minutes, so attendance settles at arrivals × visit length — roughly half the
 * ceiling for a mid-sized park. Paying out on the ceiling meant paying for
 * guests who were never there, at 2.4 times the rate the same park earned on
 * screen.
 */
function steadyStateAttendance(appeal: number, reputation: number): number {
  const ceiling = Math.min(MAX_GUESTS, Math.max(0, BASE_GUESTS + Math.floor(appeal / APPEAL_PER_GUEST)));
  const arrivalsDriven =
    (GUEST_LIFETIME_SECONDS + DEPARTURE_WALK_SECONDS) / spawnIntervalSeconds(reputation);
  return Math.min(ceiling, arrivalsDriven);
}

/**
 * Share of a facility's theoretical throughput a real park actually achieves.
 *
 * The projection has no idea where anything is. It assumes every seat refills
 * the instant it empties, when in truth guests spend a good part of their visit
 * walking between things, and the further apart they are the less of the day is
 * spent riding. Measured against the live simulation on the same park at two
 * spacings: the projection ran 1.23x the live rate packed together and 1.52x
 * spread out.
 *
 * One number cannot be right for both, because layout is exactly what this file
 * cannot see. So it takes the pessimistic end. A park left running must never
 * out-earn the same park played, or the best strategy becomes closing the tab —
 * and being a little stingy to someone who was away is a far smaller sin than
 * paying them better for not playing.
 */
const OFFLINE_UTILISATION = 0.65;

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
  /**
   * What one guest arrives carrying. Offline earnings are capped by the money
   * that walked through the gate, exactly as they are on screen — otherwise a
   * park left at triple prices would mint revenue overnight that the same park
   * could never take while anyone was watching. Omitted means unlimited, which
   * is how the projection behaved before wallets existed.
   */
  walletPerGuest?: number;
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

  const population = steadyStateAttendance(profile.appeal, stats.reputation);

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
    // Utilisation is applied to what is earned, not to what is judged. A guest
    // who wanted a ride and could have had one counts as satisfied even if the
    // walk meant they never reached it, so reputation stays honest; but the
    // park only banks the fares it would really have taken.
    const services = servedPerSecond * OFFLINE_UTILISATION * creditedSeconds;

    demandTotal += demandPerSecond;
    metTotal += servedPerSecond;
    servicesTotal += services;
    revenue += services * capacity.revenuePerService;
    if (need === 'hunger') hungerServices = services;
  }

  // Guests cannot spend what they did not bring. Departures over the credited
  // window set how many wallets came through the gate, and that total is the
  // ceiling on takings no matter how much throughput the park has.
  const departuresForSpending = (population * creditedSeconds) / GUEST_LIFETIME_SECONDS;
  const wallet = profile.walletPerGuest;
  if (typeof wallet === 'number' && Number.isFinite(wallet) && wallet >= 0) {
    const moneyAvailable = departuresForSpending * wallet;
    if (revenue > moneyAvailable) {
      // Scale the served count with the revenue, so the report does not claim
      // more completed services than the money could actually have paid for.
      const affordableShare = moneyAvailable / revenue;
      servicesTotal *= affordableShare;
      hungerServices *= affordableShare;
      revenue = moneyAvailable;
    }
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

  const departures = departuresForSpending;
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
