import { describe, expect, it } from 'vitest';
import {
  MAX_PRICE_MULTIPLE,
  acceptanceRate,
  clampPrice,
  expectedRevenuePerGuest,
  isPriceable,
  priceFor,
  priceTolerance,
  sanitizePriceBook,
} from '../src/core/pricing';
import { getPlaceableSpec } from '../src/core/catalog';
import { ParkSimulation } from '../src/core/ParkSimulation';
import type { FacilitySnapshot, PlaceableKind } from '../src/core/types';

const CAROUSEL = getPlaceableSpec('carousel').revenue;

function facility(id: string, kind: PlaceableKind, x: number, z: number): FacilitySnapshot {
  return { id, kind, position: { x, z }, rotation: 0, queueLength: 0, activeUsers: 0, enabled: true };
}

describe('pricing', () => {
  it('charges the designed price until the player says otherwise', () => {
    expect(priceFor('carousel', undefined)).toBe(CAROUSEL);
    expect(priceFor('carousel', {})).toBe(CAROUSEL);
  });

  it('keeps free facilities free', () => {
    expect(isPriceable('restroom')).toBe(false);
    expect(priceFor('restroom', { restroom: 50 })).toBe(0);
    expect(acceptanceRate('restroom', { restroom: 50 }, 0)).toBe(1);
  });

  it('will not accept a price below zero or above the cap', () => {
    expect(clampPrice('carousel', -100)).toBe(0);
    expect(clampPrice('carousel', 10_000)).toBe(CAROUSEL * MAX_PRICE_MULTIPLE);
  });

  it('lets a better-regarded park charge more', () => {
    expect(priceTolerance(0)).toBeLessThan(priceTolerance(50));
    expect(priceTolerance(50)).toBeLessThan(priceTolerance(100));
    // The headline promise of the lever: a perfect reputation charges double.
    expect(priceTolerance(100)).toBeCloseTo(2, 5);
  });

  it('turns guests away when the price outruns the reputation', () => {
    const double = { carousel: CAROUSEL * 2 };
    // A park everyone loves can charge double and lose nobody.
    expect(acceptanceRate('carousel', double, 100)).toBe(1);
    // The same price at the reputation a new park starts with loses most of them.
    expect(acceptanceRate('carousel', double, 38)).toBeLessThan(0.5);
    // And a park with no standing at all loses everyone.
    expect(acceptanceRate('carousel', double, 0)).toBe(0);
  });

  it('shows raising a price past tolerance earning less, not more', () => {
    const atTolerance = expectedRevenuePerGuest('carousel', { carousel: CAROUSEL }, 38);
    const wayOver = expectedRevenuePerGuest('carousel', { carousel: CAROUSEL * 3 }, 38);
    expect(wayOver).toBeLessThan(atTolerance);
  });

  it('ignores nonsense in a loaded price book', () => {
    const book = sanitizePriceBook({
      carousel: CAROUSEL * 2,
      restroom: 40,
      'not-a-real-thing': 12,
      'sky-wheel': Number.NaN,
    });
    expect(book.carousel).toBe(CAROUSEL * 2);
    expect(book.restroom).toBeUndefined();
    expect(book['sky-wheel']).toBeUndefined();
    expect(Object.keys(book)).toEqual(['carousel']);
  });
});

describe('pricing inside the simulation', () => {
  const layout = [
    facility('ride', 'carousel', 6, -3),
    facility('food', 'burger-kiosk', -4, 4),
    facility('toilet', 'restroom', -9, 3),
  ];

  function run(seed: number, price: number | null, seconds = 300) {
    const simulation = new ParkSimulation(seed);
    simulation.setFacilities(layout);
    if (price !== null) simulation.setPrice('carousel', price);
    simulation.setRunning(true);
    for (let tick = 0; tick < seconds * 10; tick += 1) {
      simulation.update(0.1, { x: 300, z: 300 });
    }
    return simulation;
  }

  it('survives a save and reload', () => {
    const simulation = run(7, CAROUSEL * 2, 5);
    const restored = new ParkSimulation(7);
    restored.loadSaveState(simulation.getSaveState());
    expect(restored.getPrice('carousel')).toBe(CAROUSEL * 2);
  });

  it('treats a save written before pricing existed as standard prices', () => {
    const simulation = new ParkSimulation(7);
    const state = simulation.getSaveState();
    delete (state as { prices?: unknown }).prices;
    simulation.loadSaveState(state);
    expect(simulation.getPrice('carousel')).toBe(CAROUSEL);
  });

  it('earns less overall when the price is set past what guests will bear', () => {
    // Tripling the price of the only ride in a park with a starting reputation
    // does not triple the takings — it empties the queue.
    const standard = run(2024, null);
    const gouging = run(2024, CAROUSEL * 3);
    expect(gouging.getAcceptanceRate('carousel')).toBe(0);
    expect(gouging.getStats().revenue).toBeLessThan(standard.getStats().revenue);
  });

  it('earns more when a modest rise stays inside tolerance', () => {
    const standard = run(2024, null);
    // Reputation starts at 38, so tolerance is about 1.22x — a 15% rise is safe.
    const raised = run(2024, Math.round(CAROUSEL * 1.15));
    expect(raised.getAcceptanceRate('carousel')).toBe(1);
    expect(raised.getStats().revenue).toBeGreaterThan(standard.getStats().revenue);
  });
});
