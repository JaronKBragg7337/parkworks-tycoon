export interface Axis2D {
  x: number;
  y: number;
}

export interface JoystickSample extends Axis2D {
  distance: number;
}

export function normalizeJoystickVector(
  origin: Axis2D,
  current: Axis2D,
  maxRadius: number,
  deadZone = 0.1,
): JoystickSample {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const rawDistance = Math.hypot(dx, dy);
  const normalizedDistance = Math.min(1, rawDistance / Math.max(1, maxRadius));

  if (normalizedDistance <= deadZone || rawDistance === 0) {
    return { x: 0, y: 0, distance: 0 };
  }

  const remappedDistance = (normalizedDistance - deadZone) / (1 - deadZone);
  return {
    x: (dx / rawDistance) * remappedDistance,
    y: (dy / rawDistance) * remappedDistance,
    distance: remappedDistance,
  };
}
