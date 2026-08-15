import { describe, expect, it } from 'vitest';
import { ParkSimulation } from '../src/core/ParkSimulation';
import { getPlaceableSpec } from '../src/core/catalog';
import { startingWallet, typicalWallet } from '../src/core/pricing';
import { computeAwayProgress, createEmptyAwayProfile } from '../src/core/awayReport';
import type { FacilitySnapshot, ParkStats, PlaceableKind } from '../src/core/types';

function facility(id: string, kind: PlaceableKind, x: number, z: number): FacilitySnapshot {
  return { id, kind, position: { x, z }, rotation: 0, queueLength: 0, activeUsers: 0, enabled: true };
}

const CAROUSEL = getPlaceableSpec('carousel').revenue;

describe('what a guest brings', () => {
  it('gives richer wallets to a better-regarded park', () => {
    expect(startingWallet(100, 0.5)).toBeGreaterThan(startingWallet(0, 0.5));
    // Reputation is worth a quarter either side, so the swing is real but never
    // large enough to replace the spread between individual guests.
    expect(startingWallet(0, 0.5) / startingWallet(100, 0.5)).toBeCloseTo(0.75 / 1.25, 2);
  });

  it('spreads money across the crowd rather than handing everyone the same', () => {
    const poorest = startingWallet(50, 0);
    const richest = startingWallet(50, 1);
    expect(richest).toBeGreaterThan(poorest * 2);
    expect(typicalWallet(50)).toBeGreaterThan(poorest);
    expect(typicalWallet(50)).toBeLessThan(richest);
  });

  it('survives nonsense input rather than producing a NaN wallet', () => {
    expect(Number.isFinite(startingWallet(Number.NaN, 0.5))).toBe(true);
    expect(Number.isFinite(startingWallet(50, Number.NaN))).toBe(true);
    expect(startingWallet(999, 5)).toBeGreaterThan(0);
  });
});

describe('spending in the park', () => {
  const layout = [
    facility('ride', 'carousel', 6, -3),
    facility('food', 'burger-kiosk', -4, 4),
    facility('toilet', 'restroom', -9, 3),
  ];

  function run(price: number | null, seconds = 300) {
    const simulation = new ParkSimulation(4242);
    simulation.setFacilities(layout);
    if (price !== null) simulation.setPrice('carousel', price);
    simulation.setRunning(true);
    for (let tick = 0; tick < seconds * 10; tick += 1) {
      simulation.update(0.1, { x: 300, z: 300 });
    }
    return simulation;
  }

  it('takes money off a guest when they are served', () => {
    const simulation = run(null, 200);
    const guests = simulation.getGuests();
    expect(guests.length).toBeGreaterThan(0);
    // Somebody in the park has spent something by now.
    expect(guests.some((guest) => guest.wallet < typicalWallet(38))).toBe(true);
    // And nobody has been pushed into debt.
    expect(guests.every((guest) => guest.wallet >= 0)).toBe(true);
  });

  it('never lets the park take more than a guest is carrying', () => {
    const simulation = run(CAROUSEL * 3, 300);
    expect(simulation.getGuests().every((guest) => guest.wallet >= 0)).toBe(true);
  });

  it('keeps free facilities reachable for a guest with nothing left', () => {
    // A restroom charges nothing, so an empty wallet must never stand between a
    // guest and one. This is checked through the public price surface because
    // the affordability test itself is private to the simulation.
    const simulation = run(null, 60);
    expect(simulation.getPrice('restroom')).toBe(0);
    expect(simulation.getAcceptanceRate('restroom')).toBe(1);
  });
});

describe('offline earnings respect the wallets that walked in', () => {
  const stats: ParkStats = {
    cash: 0, reputation: 50, cleanliness: 1, guestCount: 0, guestsServed: 0,
    guestsVisited: 0, litterCleaned: 0, revenue: 0, expenses: 0, day: 1, minuteOfDay: 540,
  };

  function profileWith(walletPerGuest?: number) {
    const profile = createEmptyAwayProfile();
    profile.appeal = 300;
    profile.walletPerGuest = walletPerGuest;
    // Deliberately more throughput than the crowd could ever pay for.
    profile.needs.fun = { throughput: 40, revenuePerService: 500, acceptance: 1 };
    return profile;
  }

  it('caps takings at the money that came through the gate', () => {
    const uncapped = computeAwayProgress(stats, profileWith(undefined), 3600, 0);
    const capped = computeAwayProgress(stats, profileWith(120), 3600, 0);
    expect(uncapped).not.toBeNull();
    expect(capped).not.toBeNull();
    expect(capped!.revenue).toBeLessThan(uncapped!.revenue);
    // The bound is guests through the gate times what each one carried.
    // The reported guest count is rounded for display, so the takings can sit a
    // fraction of one guest's wallet above it. Compare with a guest's slack
    // rather than to the penny.
    expect(capped!.revenue).toBeLessThanOrEqual((capped!.guestsVisited + 1) * 120);
  });

  it('scales the served count down with the money, not just the revenue', () => {
    const uncapped = computeAwayProgress(stats, profileWith(undefined), 3600, 0);
    const capped = computeAwayProgress(stats, profileWith(120), 3600, 0);
    // Claiming the same number of rides for a fraction of the takings would be
    // the report contradicting itself.
    expect(capped!.guestsServed).toBeLessThan(uncapped!.guestsServed);
  });

  it('leaves a park that never set a price exactly as it was', () => {
    const modest = createEmptyAwayProfile();
    modest.appeal = 300;
    modest.needs.fun = { throughput: 0.2, revenuePerService: 24, acceptance: 1 };
    const withCap = computeAwayProgress(stats, { ...modest, walletPerGuest: typicalWallet(50) }, 3600, 0);
    const withoutCap = computeAwayProgress(stats, modest, 3600, 0);
    // A sanely priced park never reaches the ceiling, so the cap is invisible.
    expect(withCap!.revenue).toBe(withoutCap!.revenue);
  });
});
