import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import type { AssetFactory } from '../src/world/AssetFactory';
import { PlacementSystem, createFacingArrowGeometry } from '../src/game/PlacementSystem';

function systemUnderTest(): PlacementSystem {
  // The constructor only builds preview meshes; the asset factory is not touched
  // until a placement begins, so a bare stub is enough for id bookkeeping.
  return new PlacementSystem(new Group(), {} as AssetFactory, {
    onPreviewChanged: () => {},
    onPlaced: () => {},
    onCancelled: () => {},
  });
}

describe('facing arrow', () => {
  it('points along +Z, the side guests approach from', () => {
    const positions = createFacingArrowGeometry().getAttribute('position');
    let furthest = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < positions.count; index += 1) {
      furthest = Math.max(furthest, positions.getZ(index));
    }
    // The tip is the furthest point and sits ahead of the building's centre.
    expect(furthest).toBeGreaterThan(1);
  });

  it('lies flat on the ground so it reads from any camera angle', () => {
    const positions = createFacingArrowGeometry().getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getY(index)).toBe(0);
    }
  });
});

describe('placement id reservation', () => {
  it('never reissues an id that a restored park already uses', () => {
    const placement = systemUnderTest();
    expect(placement.nextFacilityId).toBe('facility-1');
    placement.reserveIds(['facility-1', 'facility-7', 'facility-3']);
    expect(placement.nextFacilityId).toBe('facility-8');
  });

  it('never moves the counter backwards', () => {
    const placement = systemUnderTest();
    placement.reserveIds(['facility-9']);
    placement.reserveIds(['facility-2']);
    expect(placement.nextFacilityId).toBe('facility-10');
  });

  it('ignores ids that do not follow the generated pattern', () => {
    const placement = systemUnderTest();
    placement.reserveIds(['starter-bench-1', 'restored-2', '', 'facility-x', 'facility-']);
    expect(placement.nextFacilityId).toBe('facility-1');
  });
});
