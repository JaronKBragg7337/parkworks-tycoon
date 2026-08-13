import type { CellBounds, ParcelSnapshot } from '../core/ParkGrid';

export interface CameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface OverviewCameraPose {
  bounds: CellBounds;
  target: CameraPoint;
  position: CameraPoint;
  distance: number;
  azimuth: number;
  elevation: number;
}

const FALLBACK_BOUNDS: Readonly<CellBounds> = Object.freeze({
  minX: -8,
  maxX: 8,
  minZ: -8,
  maxZ: 8,
});

const VERTICAL_FOV = 54 * Math.PI / 180;
export const OVERVIEW_CAMERA_FAR = 420;
export const OVERVIEW_SUBJECT_HEIGHT_METERS = 20;
const TARGET_HEIGHT = 4.5;
const FRAME_PADDING = 1.12;

/** Returns the inclusive union of owned land, ignoring locked parcels. */
export function ownedParcelBounds(
  parcels: readonly Pick<ParcelSnapshot, 'owned' | 'bounds'>[],
): CellBounds | null {
  const owned = parcels.filter((parcel) => parcel.owned);
  if (owned.length === 0) return null;
  return owned.reduce<CellBounds>((union, parcel) => ({
    minX: Math.min(union.minX, parcel.bounds.minX),
    maxX: Math.max(union.maxX, parcel.bounds.maxX),
    minZ: Math.min(union.minZ, parcel.bounds.minZ),
    maxZ: Math.max(union.maxZ, parcel.bounds.maxZ),
  }), { ...owned[0].bounds });
}

/**
 * Builds a stable three-quarter camera pose that fits every owned parcel.
 * Portrait screens look almost straight through the gate so narrow phone
 * viewports spend their pixels on the park rather than its diagonal.
 */
export function overviewCameraPose(
  parcels: readonly Pick<ParcelSnapshot, 'owned' | 'bounds'>[],
  viewportAspect: number,
): OverviewCameraPose {
  const bounds = ownedParcelBounds(parcels) ?? { ...FALLBACK_BOUNDS };
  const aspect = Number.isFinite(viewportAspect) && viewportAspect > 0
    ? Math.max(0.35, viewportAspect)
    : 1;
  const azimuth = aspect < 0.75 ? 0.08 : 0.68;
  const elevation = aspect < 0.75 ? 0.91 : 0.82;
  const target: CameraPoint = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: TARGET_HEIGHT,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };

  // Inclusive grid bounds describe cell centres, so add half a cell to frame
  // the actual outside edges of the purchased land.
  const halfX = (bounds.maxX - bounds.minX + 1) / 2 + 1.5;
  const halfZ = (bounds.maxZ - bounds.minZ + 1) / 2 + 1.5;
  const tanVertical = Math.tan(VERTICAL_FOV / 2);
  const tanHorizontal = tanVertical * aspect;
  const sinAzimuth = Math.sin(azimuth);
  const cosAzimuth = Math.cos(azimuth);
  const sinElevation = Math.sin(elevation);
  const cosElevation = Math.cos(elevation);

  // Evaluate the eight corners of a ground-to-ride-height subject box. This
  // accounts for perspective depth, not just its flat projected rectangle.
  let distance = 0;
  for (const x of [-halfX, halfX]) {
    for (const z of [-halfZ, halfZ]) {
      for (const y of [-TARGET_HEIGHT, OVERVIEW_SUBJECT_HEIGHT_METERS - TARGET_HEIGHT]) {
        const right = x * cosAzimuth - z * sinAzimuth;
        const up = -x * sinAzimuth * sinElevation
          + y * cosElevation
          - z * cosAzimuth * sinElevation;
        const forwardOffset = -x * sinAzimuth * cosElevation
          - y * sinElevation
          - z * cosAzimuth * cosElevation;
        distance = Math.max(
          distance,
          Math.abs(right) / tanHorizontal - forwardOffset,
          Math.abs(up) / tanVertical - forwardOffset,
        );
      }
    }
  }

  distance = Math.max(28, distance * FRAME_PADDING);
  const horizontal = Math.cos(elevation) * distance;
  const position: CameraPoint = {
    x: target.x + Math.sin(azimuth) * horizontal,
    y: target.y + Math.sin(elevation) * distance,
    z: target.z + Math.cos(azimuth) * horizontal,
  };

  return { bounds, target, position, distance, azimuth, elevation };
}
