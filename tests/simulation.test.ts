import { describe, expect, it } from 'vitest';
import { ParkSimulation } from '../src/core/ParkSimulation';
import { ParkGrid } from '../src/core/ParkGrid';
import type { FacilitySnapshot, PlaceableKind } from '../src/core/types';

function facility(id: string, kind: PlaceableKind, x: number, z: number): FacilitySnapshot {
  return {
    id,
    kind,
    position: { x, z },
    rotation: 0,
    queueLength: 0,
    activeUsers: 0,
    enabled: true,
  };
}

function runScenario(seed: number, facilities: FacilitySnapshot[], seconds: number) {
  const simulation = new ParkSimulation(seed);
  simulation.setFacilities(facilities);
  simulation.setRunning(true);
  for (let tick = 0; tick < seconds * 10; tick += 1) {
    simulation.update(0.1, { x: 100, z: 100 });
  }
  return {
    stats: { ...simulation.getStats() },
    guests: simulation.getGuests(),
    litter: simulation.getLitter(),
  };
}

describe('ParkSimulation', () => {
  it('is deterministic for a seed and facility layout', () => {
    const layout = [
      facility('food', 'burger-kiosk', -5, 2),
      facility('ride', 'carousel', 7, -4),
      facility('toilet', 'restroom', -8, -7),
      facility('bin', 'trash-bin', -2, 1),
    ];
    expect(runScenario(739, layout, 90)).toEqual(runScenario(739, layout, 90));
  });

  it('serves guests and earns revenue when useful facilities exist', () => {
    const result = runScenario(
      42,
      [
        facility('food', 'burger-kiosk', -3, 3),
        facility('ride', 'carousel', 5, -2),
        facility('toilet', 'restroom', -6, -5),
        facility('bin', 'trash-bin', -1, 2),
      ],
      130,
    );
    expect(result.stats.guestsVisited).toBeGreaterThan(3);
    expect(result.stats.guestsServed).toBeGreaterThan(0);
    expect(result.stats.revenue).toBeGreaterThan(0);
  });

  it('creates less litter when bins are available', () => {
    const base = [
      facility('food', 'burger-kiosk', 0, 8),
      facility('ride', 'carousel', 6, 0),
      facility('toilet', 'restroom', -6, 0),
    ];
    const withoutBins = runScenario(919, base, 175);
    const withBins = runScenario(
      919,
      [...base, facility('bin-a', 'trash-bin', 1, 7), facility('bin-b', 'trash-bin', 2, -1)],
      175,
    );
    expect(withBins.litter.length).toBeLessThanOrEqual(withoutBins.litter.length);
    expect(withBins.stats.cleanliness).toBeGreaterThanOrEqual(withoutBins.stats.cleanliness);
  });

  it('charges and refunds construction without inventing cash', () => {
    const simulation = new ParkSimulation(1);
    const initial = simulation.getStats().cash;
    const reputation = simulation.getStats().reputation;
    expect(simulation.purchase('sky-wheel')).toBe(true);
    expect(simulation.getStats().cash).toBe(initial - 3200);
    simulation.refund('sky-wheel');
    expect(simulation.getStats().cash).toBe(initial);
    expect(simulation.getStats().reputation).toBe(reputation);
  });

  it('never serves guests or earns attraction revenue from a disconnected facility', () => {
    const disconnected = facility('isolated', 'carousel', 18, -18);
    disconnected.enabled = false;
    const result = runScenario(74, [disconnected], 175);
    expect(result.stats.guestsVisited).toBeGreaterThan(0);
    expect(result.stats.guestsServed).toBe(0);
    expect(result.stats.revenue).toBe(0);
  });

  it('keeps moving guests on the connected path network', () => {
    const grid = new ParkGrid();
    const simulation = new ParkSimulation(922);
    const accessPoint = { x: 3, z: 2 };
    simulation.setNavigationNetwork({
      destinations: grid.getReachableCells(),
      findPath: (start, destination) => {
        const startCell = grid.worldToCell(start.x, start.z);
        const destinationCell = grid.worldToCell(destination.x, destination.z);
        return startCell && destinationCell ? grid.findRoute(startCell, destinationCell) : null;
      },
    });
    simulation.setFacilities([
      { ...facility('ride', 'carousel', 7, 7), accessPoint },
    ]);
    simulation.setRunning(true);

    for (let tick = 0; tick < 1_250; tick += 1) {
      simulation.update(0.1, { x: 100, z: 100 });
      for (const route of Object.values(simulation.getGuestRoutes())) {
        for (const waypoint of route) {
          const cell = grid.worldToCell(waypoint.x, waypoint.z);
          expect(cell && grid.isWalkable(cell)).toBe(true);
        }
      }
    }
    expect(simulation.getStats().guestsServed).toBeGreaterThan(0);
  });

  it('charges arbitrary land and path costs atomically', () => {
    const simulation = new ParkSimulation(2);
    const initial = simulation.getStats().cash;
    expect(simulation.spend(950)).toBe(true);
    expect(simulation.getStats().cash).toBe(initial - 950);
    expect(simulation.spend(initial)).toBe(false);
    expect(simulation.getStats().cash).toBe(initial - 950);
    simulation.refundExpense(950);
    expect(simulation.getStats().cash).toBe(initial);
  });
});
