import { describe, expect, it } from 'vitest';
import {
  AWAY_CREDIT_CAP_SECONDS,
  AWAY_MINIMUM_SECONDS,
  computeAwayProgress,
  createEmptyAwayProfile,
  type AwayParkProfile,
} from '../src/core/awayReport';
import { ParkSimulation } from '../src/core/ParkSimulation';

function statsWith(overrides: Partial<ReturnType<ParkSimulation['getStats']>> = {}) {
  return { ...new ParkSimulation().getStats(), ...overrides };
}

function workingPark(): AwayParkProfile {
  const profile = createEmptyAwayProfile();
  profile.appeal = 120;
  profile.upkeepPerCycle = 60;
  profile.foodCount = 2;
  profile.binCount = 2;
  profile.needs.hunger = { throughput: 1, revenuePerService: 30 };
  profile.needs.fun = { throughput: 1, revenuePerService: 28 };
  profile.needs.bladder = { throughput: 1, revenuePerService: 0 };
  profile.needs.rest = { throughput: 1, revenuePerService: 0 };
  return profile;
}

describe('away report', () => {
  it('ignores absences shorter than a minute', () => {
    expect(computeAwayProgress(statsWith(), workingPark(), AWAY_MINIMUM_SECONDS - 1, 0)).toBeNull();
    expect(computeAwayProgress(statsWith(), workingPark(), Number.NaN, 0)).toBeNull();
  });

  it('earns nothing in an empty park but still charges nothing', () => {
    const report = computeAwayProgress(statsWith(), createEmptyAwayProfile(), 3_600, 0);
    expect(report?.revenue).toBe(0);
    expect(report?.upkeep).toBe(0);
    expect(report?.guestsServed).toBe(0);
  });

  it('scales earnings with time and charges upkeep', () => {
    const hour = computeAwayProgress(statsWith(), workingPark(), 3_600, 0);
    const twoHours = computeAwayProgress(statsWith(), workingPark(), 7_200, 0);
    expect(hour).not.toBeNull();
    expect(twoHours!.revenue).toBeGreaterThan(hour!.revenue);
    expect(twoHours!.revenue / hour!.revenue).toBeCloseTo(2, 1);
    expect(hour!.upkeep).toBe(Math.round((3_600 / 45) * 60));
    expect(hour!.netCash).toBe(hour!.revenue - hour!.upkeep);
  });

  it('caps credited time so leaving the game closed is not a strategy', () => {
    const capped = computeAwayProgress(statsWith(), workingPark(), AWAY_CREDIT_CAP_SECONDS * 4, 0);
    const atCap = computeAwayProgress(statsWith(), workingPark(), AWAY_CREDIT_CAP_SECONDS, 0);
    expect(capped?.capped).toBe(true);
    expect(capped?.creditedSeconds).toBe(AWAY_CREDIT_CAP_SECONDS);
    expect(capped?.revenue).toBe(atCap?.revenue);
    expect(capped?.awaySeconds).toBe(AWAY_CREDIT_CAP_SECONDS * 4);
  });

  it('limits service to the throughput a park actually has', () => {
    const starved = workingPark();
    starved.needs.hunger = { throughput: 0.001, revenuePerService: 30 };
    const generous = workingPark();

    // A short window: reputation gain is fast enough in the live rules that an
    // hour saturates both parks at 100 and hides the difference.
    const starvedReport = computeAwayProgress(statsWith(), starved, 120, 0)!;
    const generousReport = computeAwayProgress(statsWith(), generous, 120, 0)!;
    expect(starvedReport.revenue).toBeLessThan(generousReport.revenue);
    expect(starvedReport.reputation).toBeLessThan(generousReport.reputation);
  });

  it('mirrors the live rules closely enough that reputation saturates', () => {
    // Documents current balance rather than endorsing it: ParkSimulation grants
    // +0.08 reputation per service and +0.2 per happy departure, which a full
    // park earns fast enough to reach 100 in roughly nine minutes. If the live
    // rates are ever rebalanced, this expectation should move with them.
    const report = computeAwayProgress(statsWith(), workingPark(), 3_600, 0)!;
    expect(report.reputation).toBe(100);
  });

  it('turns unbinned food waste into litter and dirties the park', () => {
    const noBins = workingPark();
    noBins.binCount = 0;

    const dirty = computeAwayProgress(statsWith(), noBins, 3_600, 0)!;
    const clean = computeAwayProgress(statsWith(), workingPark(), 3_600, 0)!;
    expect(dirty.litterCreated).toBeGreaterThan(0);
    expect(clean.litterCreated).toBe(0);
    expect(dirty.cleanliness).toBeLessThan(clean.cleanliness);
  });

  it('counts existing litter against cleanliness on return', () => {
    const report = computeAwayProgress(statsWith(), workingPark(), 3_600, 10)!;
    expect(report.cleanliness).toBeCloseTo(1 - 10 * 0.045, 5);
  });

  it('keeps reputation inside its bounds', () => {
    const collapsing = createEmptyAwayProfile();
    collapsing.appeal = 120;
    const report = computeAwayProgress(statsWith({ reputation: 5 }), collapsing, 3_600, 40)!;
    expect(report.reputation).toBeGreaterThanOrEqual(0);
    expect(report.reputation).toBeLessThanOrEqual(100);
  });

  it('advances the park calendar', () => {
    const report = computeAwayProgress(statsWith(), workingPark(), 3_600, 0)!;
    expect(report.daysPassed).toBeGreaterThan(0);
  });
});
