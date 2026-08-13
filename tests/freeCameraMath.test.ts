import { describe, expect, it } from 'vitest';
import {
  createFreeCameraState,
  getFreeCameraPose,
  stepFreeCamera,
  type FreeCameraInput,
} from '../src/game/freeCameraMath';

const noInput: FreeCameraInput = {
  panRight: 0,
  panForward: 0,
  lookDeltaX: 0,
  lookDeltaY: 0,
  zoomDelta: 0,
};

describe('free overview camera math', () => {
  it('pans on the ground plane relative to yaw', () => {
    const atDefaultYaw = createFreeCameraState({ yaw: 0, distance: 28 });
    const right = stepFreeCamera(atDefaultYaw, { ...noInput, panRight: 1 }, 0.1);
    const forward = stepFreeCamera(atDefaultYaw, { ...noInput, panForward: 1 }, 0.1);
    expect(right.focusX).toBeCloseTo(1.7);
    expect(right.focusZ).toBeCloseTo(0);
    expect(forward.focusX).toBeCloseTo(0);
    expect(forward.focusZ).toBeCloseTo(-1.7);

    const quarterTurn = createFreeCameraState({ yaw: Math.PI / 2, distance: 28 });
    const rotatedForward = stepFreeCamera(quarterTurn, { ...noInput, panForward: 1 }, 0.1);
    expect(rotatedForward.focusX).toBeCloseTo(-1.7);
    expect(rotatedForward.focusZ).toBeCloseTo(0);
  });

  it('applies orbit deltas independently of frame duration', () => {
    const initial = createFreeCameraState({ yaw: 0.4, pitch: 0.6 });
    const input = { ...noInput, lookDeltaX: 25, lookDeltaY: 20 };
    const shortFrame = stepFreeCamera(initial, input, 1 / 120);
    const longFrame = stepFreeCamera(initial, input, 1 / 30);
    expect(shortFrame.yaw).toBeCloseTo(0.3);
    expect(shortFrame.pitch).toBeCloseTo(0.66);
    expect(longFrame.yaw).toBeCloseTo(shortFrame.yaw);
    expect(longFrame.pitch).toBeCloseTo(shortFrame.pitch);
  });

  it('zooms exponentially and treats positive delta as zooming out', () => {
    const initial = createFreeCameraState({ distance: 30 });
    const out = stepFreeCamera(initial, { ...noInput, zoomDelta: 1 }, 0);
    const backIn = stepFreeCamera(out, { ...noInput, zoomDelta: -1 }, 0);
    expect(out.distance).toBeGreaterThan(initial.distance);
    expect(backIn.distance).toBeCloseTo(initial.distance);
  });

  it('clamps focus, pitch, distance, time, and invalid persisted values safely', () => {
    const initial = createFreeCameraState({
      focusX: Number.NaN,
      focusZ: Number.POSITIVE_INFINITY,
      pitch: -100,
      distance: 10_000,
    });
    expect(initial).toMatchObject({ focusX: 0, focusZ: 0, pitch: 0.3, distance: 320 });

    const stepped = stepFreeCamera(
      { focusX: 1, focusZ: -1, yaw: 0, pitch: 0.5, distance: 20 },
      { ...noInput, panRight: 10, panForward: -10, lookDeltaY: 100_000, zoomDelta: -100_000 },
      10,
      {
        limits: { minFocusX: -1, maxFocusX: 1, minFocusZ: -1, maxFocusZ: 1 },
        tuning: { panSpeed: 1_000 },
      },
    );
    expect(stepped.focusX).toBe(1);
    expect(stepped.focusZ).toBe(1);
    expect(stepped.pitch).toBe(1.18);
    expect(stepped.distance).toBe(9);
  });

  it('derives a deterministic isometric pose around the focus', () => {
    const state = createFreeCameraState({ focusX: 3, focusZ: -4, yaw: 0, pitch: Math.PI / 6, distance: 20 });
    const pose = getFreeCameraPose(state, 1);
    expect(pose.target).toEqual({ x: 3, y: 1, z: -4 });
    expect(pose.position.x).toBeCloseTo(3);
    expect(pose.position.y).toBeCloseTo(11);
    expect(pose.position.z).toBeCloseTo(-4 + Math.sqrt(3) * 10);
  });
});
