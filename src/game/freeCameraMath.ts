/**
 * Pure, renderer-independent controls for the detached park overview camera.
 *
 * `yaw = 0` places the camera south of its focus (+Z), looking north (-Z).
 * Pan axes are screen-relative: positive `panRight` moves toward screen-right
 * and positive `panForward` moves away from the camera. Positive `zoomDelta`
 * zooms out. Look and zoom deltas are intentionally not multiplied by time;
 * they represent accumulated pointer/wheel deltas for the current frame.
 */

export interface FreeCameraState {
  focusX: number;
  focusZ: number;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface FreeCameraInput {
  panRight: number;
  panForward: number;
  lookDeltaX: number;
  lookDeltaY: number;
  zoomDelta: number;
}

export interface FreeCameraLimits {
  minFocusX: number;
  maxFocusX: number;
  minFocusZ: number;
  maxFocusZ: number;
  minPitch: number;
  maxPitch: number;
  minDistance: number;
  maxDistance: number;
}

export interface FreeCameraTuning {
  /** Ground-plane metres per second at the reference distance. */
  panSpeed: number;
  /** Distance at which `panSpeed` is used without scaling. */
  panReferenceDistance: number;
  yawSensitivity: number;
  pitchSensitivity: number;
  /** Exponential zoom strength per normalized zoom unit. */
  zoomSensitivity: number;
}

export interface FreeCameraStepOptions {
  limits?: Partial<FreeCameraLimits>;
  tuning?: Partial<FreeCameraTuning>;
}

export interface FreeCameraPoint3 {
  x: number;
  y: number;
  z: number;
}

export interface FreeCameraPose {
  position: FreeCameraPoint3;
  target: FreeCameraPoint3;
}

export const DEFAULT_FREE_CAMERA_LIMITS: Readonly<FreeCameraLimits> = Object.freeze({
  minFocusX: -512,
  maxFocusX: 512,
  minFocusZ: -512,
  maxFocusZ: 512,
  minPitch: 0.3,
  maxPitch: 1.18,
  minDistance: 9,
  maxDistance: 320,
});

export const DEFAULT_FREE_CAMERA_TUNING: Readonly<FreeCameraTuning> = Object.freeze({
  panSpeed: 17,
  panReferenceDistance: 28,
  yawSensitivity: 0.004,
  pitchSensitivity: 0.003,
  zoomSensitivity: 0.16,
});

export const ZERO_FREE_CAMERA_INPUT: Readonly<FreeCameraInput> = Object.freeze({
  panRight: 0,
  panForward: 0,
  lookDeltaX: 0,
  lookDeltaY: 0,
  zoomDelta: 0,
});

export const DEFAULT_FREE_CAMERA_STATE: Readonly<FreeCameraState> = Object.freeze({
  focusX: 0,
  focusZ: 0,
  yaw: Math.PI / 4,
  pitch: 0.78,
  distance: 42,
});

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeYaw(yaw: number): number {
  const tau = Math.PI * 2;
  return ((yaw + Math.PI) % tau + tau) % tau - Math.PI;
}

function resolveLimits(overrides: Partial<FreeCameraLimits> | undefined): FreeCameraLimits {
  const defaults = DEFAULT_FREE_CAMERA_LIMITS;
  const limits: FreeCameraLimits = {
    minFocusX: finiteOr(overrides?.minFocusX, defaults.minFocusX),
    maxFocusX: finiteOr(overrides?.maxFocusX, defaults.maxFocusX),
    minFocusZ: finiteOr(overrides?.minFocusZ, defaults.minFocusZ),
    maxFocusZ: finiteOr(overrides?.maxFocusZ, defaults.maxFocusZ),
    minPitch: finiteOr(overrides?.minPitch, defaults.minPitch),
    maxPitch: finiteOr(overrides?.maxPitch, defaults.maxPitch),
    minDistance: finiteOr(overrides?.minDistance, defaults.minDistance),
    maxDistance: finiteOr(overrides?.maxDistance, defaults.maxDistance),
  };

  // A reversed caller-supplied range should remain safe and deterministic.
  if (limits.minFocusX > limits.maxFocusX) [limits.minFocusX, limits.maxFocusX] = [limits.maxFocusX, limits.minFocusX];
  if (limits.minFocusZ > limits.maxFocusZ) [limits.minFocusZ, limits.maxFocusZ] = [limits.maxFocusZ, limits.minFocusZ];
  if (limits.minPitch > limits.maxPitch) [limits.minPitch, limits.maxPitch] = [limits.maxPitch, limits.minPitch];
  if (limits.minDistance > limits.maxDistance) {
    [limits.minDistance, limits.maxDistance] = [limits.maxDistance, limits.minDistance];
  }
  return limits;
}

function resolveTuning(overrides: Partial<FreeCameraTuning> | undefined): FreeCameraTuning {
  const defaults = DEFAULT_FREE_CAMERA_TUNING;
  return {
    panSpeed: Math.max(0, finiteOr(overrides?.panSpeed, defaults.panSpeed)),
    panReferenceDistance: Math.max(0.001, finiteOr(overrides?.panReferenceDistance, defaults.panReferenceDistance)),
    yawSensitivity: finiteOr(overrides?.yawSensitivity, defaults.yawSensitivity),
    pitchSensitivity: finiteOr(overrides?.pitchSensitivity, defaults.pitchSensitivity),
    zoomSensitivity: Math.max(0, finiteOr(overrides?.zoomSensitivity, defaults.zoomSensitivity)),
  };
}

/** Creates a finite, clamped state from optional persisted/partial values. */
export function createFreeCameraState(
  initial: Partial<FreeCameraState> = {},
  limitOverrides?: Partial<FreeCameraLimits>,
): FreeCameraState {
  const limits = resolveLimits(limitOverrides);
  return {
    focusX: clamp(finiteOr(initial.focusX, DEFAULT_FREE_CAMERA_STATE.focusX), limits.minFocusX, limits.maxFocusX),
    focusZ: clamp(finiteOr(initial.focusZ, DEFAULT_FREE_CAMERA_STATE.focusZ), limits.minFocusZ, limits.maxFocusZ),
    yaw: normalizeYaw(finiteOr(initial.yaw, DEFAULT_FREE_CAMERA_STATE.yaw)),
    pitch: clamp(finiteOr(initial.pitch, DEFAULT_FREE_CAMERA_STATE.pitch), limits.minPitch, limits.maxPitch),
    distance: clamp(
      finiteOr(initial.distance, DEFAULT_FREE_CAMERA_STATE.distance),
      limits.minDistance,
      limits.maxDistance,
    ),
  };
}

/**
 * Advances one frame of free-camera input without mutating `state`.
 * Pan axes are normalized so diagonal movement is not faster.
 */
export function stepFreeCamera(
  state: Readonly<FreeCameraState>,
  input: Readonly<FreeCameraInput>,
  deltaSeconds: number,
  options: FreeCameraStepOptions = {},
): FreeCameraState {
  const limits = resolveLimits(options.limits);
  const tuning = resolveTuning(options.tuning);
  const current = createFreeCameraState(state, limits);
  const dt = clamp(finiteOr(deltaSeconds, 0), 0, 0.1);

  const lookX = finiteOr(input.lookDeltaX, 0);
  const lookY = finiteOr(input.lookDeltaY, 0);
  const yaw = normalizeYaw(current.yaw - lookX * tuning.yawSensitivity);
  const pitch = clamp(current.pitch + lookY * tuning.pitchSensitivity, limits.minPitch, limits.maxPitch);
  const zoomDelta = clamp(finiteOr(input.zoomDelta, 0), -8, 8);
  const distance = clamp(
    current.distance * Math.exp(zoomDelta * tuning.zoomSensitivity),
    limits.minDistance,
    limits.maxDistance,
  );

  let panRight = finiteOr(input.panRight, 0);
  let panForward = finiteOr(input.panForward, 0);
  const magnitude = Math.hypot(panRight, panForward);
  if (magnitude > 1) {
    panRight /= magnitude;
    panForward /= magnitude;
  }

  const panScale = clamp(distance / tuning.panReferenceDistance, 0.5, 3);
  const movement = tuning.panSpeed * panScale * dt;
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const focusX = clamp(
    current.focusX + (rightX * panRight + forwardX * panForward) * movement,
    limits.minFocusX,
    limits.maxFocusX,
  );
  const focusZ = clamp(
    current.focusZ + (rightZ * panRight + forwardZ * panForward) * movement,
    limits.minFocusZ,
    limits.maxFocusZ,
  );

  return { focusX, focusZ, yaw, pitch, distance };
}

/** Converts control state to a perspective-camera position and look-at target. */
export function getFreeCameraPose(state: Readonly<FreeCameraState>, targetHeight = 0): FreeCameraPose {
  const safe = createFreeCameraState(state);
  const safeHeight = finiteOr(targetHeight, 0);
  const horizontalDistance = Math.cos(safe.pitch) * safe.distance;
  return {
    position: {
      x: safe.focusX + Math.sin(safe.yaw) * horizontalDistance,
      y: safeHeight + Math.sin(safe.pitch) * safe.distance,
      z: safe.focusZ + Math.cos(safe.yaw) * horizontalDistance,
    },
    target: { x: safe.focusX, y: safeHeight, z: safe.focusZ },
  };
}
