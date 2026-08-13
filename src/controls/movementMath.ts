export interface WorldMovement {
  x: number;
  z: number;
}

/**
 * Converts local stick/keyboard axes into a world-space direction relative to
 * the orbit camera. Positive local X is always the player's screen-right.
 */
export function cameraRelativeMovement(
  localX: number,
  localForward: number,
  cameraYaw: number,
): WorldMovement {
  const forwardX = -Math.sin(cameraYaw);
  const forwardZ = -Math.cos(cameraYaw);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const worldX = rightX * localX + forwardX * localForward;
  const worldZ = rightZ * localX + forwardZ * localForward;
  const length = Math.hypot(worldX, worldZ);
  if (length === 0) return { x: 0, z: 0 };
  return { x: worldX / length, z: worldZ / length };
}
