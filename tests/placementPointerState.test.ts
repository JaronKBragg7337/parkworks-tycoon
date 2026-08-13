import { describe, expect, it } from 'vitest';
import {
  INITIAL_PLACEMENT_POINTER_STATE,
  reducePlacementPointer,
  type PlacementPointerState,
} from '../src/game/placementPointerState';

function begin(): PlacementPointerState {
  return reducePlacementPointer(INITIAL_PLACEMENT_POINTER_STATE, { type: 'begin' }).state;
}

describe('placement pointer state', () => {
  it('ignores pointer input while placement is inactive', () => {
    const move = reducePlacementPointer(INITIAL_PLACEMENT_POINTER_STATE, {
      type: 'pointer-move',
      pointerType: 'mouse',
    });
    const press = reducePlacementPointer(INITIAL_PLACEMENT_POINTER_STATE, {
      type: 'primary-canvas-press',
      pointerType: 'mouse',
    });
    expect(move).toEqual({ state: { phase: 'inactive' }, updatePreview: false });
    expect(press).toEqual({ state: { phase: 'inactive' }, updatePreview: false });
  });

  it('tracks mouse hover until a primary canvas press pins the preview', () => {
    const tracking = begin();
    const hover = reducePlacementPointer(tracking, { type: 'pointer-move', pointerType: 'mouse' });
    const pin = reducePlacementPointer(hover.state, { type: 'primary-canvas-press', pointerType: 'mouse' });
    const moveAfterPin = reducePlacementPointer(pin.state, { type: 'pointer-move', pointerType: 'mouse' });

    expect(hover).toEqual({ state: { phase: 'tracking' }, updatePreview: true });
    expect(pin).toEqual({ state: { phase: 'pinned' }, updatePreview: true });
    expect(moveAfterPin).toEqual({ state: { phase: 'pinned' }, updatePreview: false });
  });

  it('repositions an existing desktop pin on each primary canvas press', () => {
    const pinned = reducePlacementPointer(begin(), {
      type: 'primary-canvas-press',
      pointerType: 'mouse',
    }).state;
    const reposition = reducePlacementPointer(pinned, {
      type: 'primary-canvas-press',
      pointerType: 'mouse',
    });
    expect(reposition).toEqual({ state: { phase: 'pinned' }, updatePreview: true });
  });

  it('preserves a desktop pin through rotation', () => {
    const pinned = reducePlacementPointer(begin(), {
      type: 'primary-canvas-press',
      pointerType: 'mouse',
    }).state;
    const rotated = reducePlacementPointer(pinned, { type: 'rotate' });
    expect(rotated).toEqual({ state: { phase: 'pinned' }, updatePreview: false });
  });

  it('resets on begin, cancel, and confirm', () => {
    const pinned: PlacementPointerState = { phase: 'pinned' };
    expect(reducePlacementPointer(pinned, { type: 'begin' }).state.phase).toBe('tracking');
    expect(reducePlacementPointer(pinned, { type: 'cancel' }).state.phase).toBe('inactive');
    expect(reducePlacementPointer(pinned, { type: 'confirm' }).state.phase).toBe('inactive');
  });

  it('keeps touch and pen placement direct instead of pinning', () => {
    const touchPress = reducePlacementPointer(begin(), {
      type: 'primary-canvas-press',
      pointerType: 'touch',
    });
    const touchMove = reducePlacementPointer(touchPress.state, {
      type: 'pointer-move',
      pointerType: 'touch',
    });
    const penPress = reducePlacementPointer({ phase: 'pinned' }, {
      type: 'primary-canvas-press',
      pointerType: 'pen',
    });

    expect(touchPress).toEqual({ state: { phase: 'pinned' }, updatePreview: true });
    expect(touchMove).toEqual({ state: { phase: 'pinned' }, updatePreview: true });
    expect(penPress).toEqual({ state: { phase: 'pinned' }, updatePreview: true });
  });
});
