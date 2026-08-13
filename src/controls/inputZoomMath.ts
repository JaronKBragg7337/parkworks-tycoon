import type { Axis2D } from './joystickMath';

const LINE_HEIGHT_PIXELS = 16;
const WHEEL_PIXELS_PER_ZOOM_UNIT = 300;
const PINCH_ZOOM_SENSITIVITY = 3;
const MAX_ZOOM_DELTA = 2;

function clampZoomDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, delta));
}

/**
 * Converts WheelEvent delta units to a bounded normalized zoom delta.
 * Positive values zoom out; negative values zoom in.
 */
export function normalizeWheelZoomDelta(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  const multiplier = deltaMode === 1
    ? LINE_HEIGHT_PIXELS
    : deltaMode === 2
      ? Math.max(1, pageHeight)
      : 1;
  return clampZoomDelta((deltaY * multiplier) / WHEEL_PIXELS_PER_ZOOM_UNIT);
}

export function pointerDistance(a: Axis2D, b: Axis2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Converts a pinch-distance change to the same zoom direction as wheel input.
 * Spreading fingers zooms in (negative); pinching together zooms out (positive).
 */
export function pinchZoomDelta(previousDistance: number, currentDistance: number): number {
  if (previousDistance <= 0 || currentDistance <= 0) return 0;
  return clampZoomDelta(Math.log(previousDistance / currentDistance) * PINCH_ZOOM_SENSITIVITY);
}
