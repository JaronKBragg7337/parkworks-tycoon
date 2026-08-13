import { describe, expect, it } from 'vitest';
import {
  normalizeWheelZoomDelta,
  pinchZoomDelta,
  pointerDistance,
} from '../src/controls/inputZoomMath';

describe('input zoom math', () => {
  it('keeps wheel direction and normalizes line deltas', () => {
    expect(normalizeWheelZoomDelta(2, 1, 800)).toBeCloseTo(32 / 300);
    expect(normalizeWheelZoomDelta(-2, 1, 800)).toBeCloseTo(-32 / 300);
  });

  it('bounds unusually large wheel events', () => {
    expect(normalizeWheelZoomDelta(1, 2, 900)).toBe(2);
    expect(normalizeWheelZoomDelta(-1, 2, 900)).toBe(-2);
  });

  it('maps spreading fingers to zoom in and pinching together to zoom out', () => {
    expect(pinchZoomDelta(80, 105)).toBeCloseTo(Math.log(80 / 105) * 3);
    expect(pinchZoomDelta(105, 80)).toBeCloseTo(Math.log(105 / 80) * 3);
  });

  it('makes accumulated pinch deltas independent of move-event segmentation', () => {
    const direct = pinchZoomDelta(80, 120);
    const segmented = pinchZoomDelta(80, 100) + pinchZoomDelta(100, 120);
    expect(segmented).toBeCloseTo(direct);
  });

  it('measures pinch distance independently of pointer order', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 40, y: 60 };
    expect(pointerDistance(a, b)).toBe(50);
    expect(pointerDistance(b, a)).toBe(50);
  });
});
