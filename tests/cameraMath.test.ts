import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { ParcelSnapshot } from '../src/core/ParkGrid';
import {
  OVERVIEW_CAMERA_FAR,
  OVERVIEW_SUBJECT_HEIGHT_METERS,
  overviewCameraPose,
  ownedParcelBounds,
} from '../src/game/cameraMath';

function parcel(
  bounds: ParcelSnapshot['bounds'],
  owned = true,
): Pick<ParcelSnapshot, 'owned' | 'bounds'> {
  return { bounds, owned };
}

describe('ownedParcelBounds', () => {
  it('unions owned parcels without framing locked land', () => {
    expect(ownedParcelBounds([
      parcel({ minX: -4, maxX: 3, minZ: -5, maxZ: 4 }),
      parcel({ minX: 4, maxX: 12, minZ: -2, maxZ: 8 }),
      parcel({ minX: -20, maxX: -10, minZ: -20, maxZ: -10 }, false),
    ])).toEqual({ minX: -4, maxX: 12, minZ: -5, maxZ: 8 });
  });

  it('returns null when no land is owned', () => {
    expect(ownedParcelBounds([
      parcel({ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }, false),
    ])).toBeNull();
  });
});

describe('overviewCameraPose', () => {
  const starter = parcel({ minX: -12, maxX: 11, minZ: -20, maxZ: 32 });

  it('centres the view on the owned land', () => {
    const pose = overviewCameraPose([starter], 16 / 9);
    expect(pose.target.x).toBeCloseTo(-0.5);
    expect(pose.target.z).toBeCloseTo(6);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    expect(pose.distance).toBeGreaterThanOrEqual(28);
  });

  it('widens automatically when the park buys more land', () => {
    const initial = overviewCameraPose([starter], 16 / 9);
    const expanded = overviewCameraPose([
      starter,
      parcel({ minX: -32, maxX: -13, minZ: -20, maxZ: 32 }),
      parcel({ minX: 12, maxX: 31, minZ: -20, maxZ: 32 }),
    ], 16 / 9);
    expect(expanded.distance).toBeGreaterThan(initial.distance);
    expect(expanded.bounds).toEqual({ minX: -32, maxX: 31, minZ: -20, maxZ: 32 });
  });

  it('uses a phone-friendly gate-on angle on narrow screens', () => {
    const phone = overviewCameraPose([starter], 390 / 844);
    const desktop = overviewCameraPose([starter], 16 / 9);
    expect(phone.azimuth).toBeLessThan(desktop.azimuth);
    expect(phone.distance).toBeGreaterThan(desktop.distance);
  });

  it('keeps a fully expanded park inside the phone camera far plane', () => {
    const pose = overviewCameraPose([
      parcel({ minX: -32, maxX: 31, minZ: -33, maxZ: 32 }),
    ], 320 / 844);
    let farthestCorner = 0;
    for (const x of [pose.bounds.minX - 0.5, pose.bounds.maxX + 0.5]) {
      for (const z of [pose.bounds.minZ - 0.5, pose.bounds.maxZ + 0.5]) {
        for (const y of [0, OVERVIEW_SUBJECT_HEIGHT_METERS]) {
          farthestCorner = Math.max(farthestCorner, Math.hypot(
            x - pose.position.x,
            y - pose.position.y,
            z - pose.position.z,
          ));
        }
      }
    }
    expect(farthestCorner).toBeLessThan(OVERVIEW_CAMERA_FAR);
  });

  it('projects the fully expanded park inside a portrait phone viewport', () => {
    const aspect = 390 / 844;
    const pose = overviewCameraPose([
      parcel({ minX: -32, maxX: 31, minZ: -33, maxZ: 32 }),
    ], aspect);
    const camera = new PerspectiveCamera(54, aspect, 0.1, OVERVIEW_CAMERA_FAR);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld(true);

    for (const x of [pose.bounds.minX - 0.5, pose.bounds.maxX + 0.5]) {
      for (const z of [pose.bounds.minZ - 0.5, pose.bounds.maxZ + 0.5]) {
        for (const y of [0, OVERVIEW_SUBJECT_HEIGHT_METERS]) {
          const projected = new Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(1);
          expect(projected.z).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('keeps a finite fallback pose for invalid or empty input', () => {
    const pose = overviewCameraPose([], Number.NaN);
    expect(pose.bounds).toEqual({ minX: -8, maxX: 8, minZ: -8, maxZ: 8 });
    expect(Number.isFinite(pose.distance)).toBe(true);
    expect(Object.values(pose.position).every(Number.isFinite)).toBe(true);
  });
});
