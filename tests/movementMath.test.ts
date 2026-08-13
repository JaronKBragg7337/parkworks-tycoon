import { describe, expect, it } from 'vitest';
import { cameraRelativeMovement } from '../src/controls/movementMath';

describe('cameraRelativeMovement', () => {
  it('maps right input to screen-right at the default camera yaw', () => {
    const movement = cameraRelativeMovement(1, 0, 0);
    expect(movement.x).toBeCloseTo(1);
    expect(movement.z).toBeCloseTo(0);
  });

  it('maps left input to screen-left at the default camera yaw', () => {
    const movement = cameraRelativeMovement(-1, 0, 0);
    expect(movement.x).toBeCloseTo(-1);
    expect(movement.z).toBeCloseTo(0);
  });

  it('rotates both movement axes with the orbit camera', () => {
    const right = cameraRelativeMovement(1, 0, Math.PI / 2);
    const forward = cameraRelativeMovement(0, 1, Math.PI / 2);
    expect(right.x).toBeCloseTo(0);
    expect(right.z).toBeCloseTo(-1);
    expect(forward.x).toBeCloseTo(-1);
    expect(forward.z).toBeCloseTo(0);
  });
});
