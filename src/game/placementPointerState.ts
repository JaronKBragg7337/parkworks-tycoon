/**
 * Pure pointer-state reducer for object placement.
 *
 * Mouse placement starts in hover-tracking mode. A primary canvas press tells
 * the caller to update the preview at that press and pins it there. Further
 * mouse movement is ignored until another primary canvas press repositions the
 * pin. Touch and pen pointers always update directly and never require a pin.
 */

export type PlacementPointerPhase = 'inactive' | 'tracking' | 'pinned';

export interface PlacementPointerState {
  phase: PlacementPointerPhase;
}

export type PlacementPointerEvent =
  | { type: 'begin' }
  | { type: 'cancel' }
  | { type: 'confirm' }
  | { type: 'rotate' }
  | { type: 'pointer-move'; pointerType: string }
  | { type: 'primary-canvas-press'; pointerType: string };

export interface PlacementPointerTransition {
  state: PlacementPointerState;
  /** When true, update the placement preview using this pointer event's coordinates. */
  updatePreview: boolean;
}

export const INITIAL_PLACEMENT_POINTER_STATE: Readonly<PlacementPointerState> = Object.freeze({
  phase: 'inactive',
});

function transition(phase: PlacementPointerPhase, updatePreview = false): PlacementPointerTransition {
  return { state: { phase }, updatePreview };
}

/**
 * Advances placement pointer state without mutating the previous state.
 * Dispatch `primary-canvas-press` only for a primary-button canvas event.
 */
export function reducePlacementPointer(
  state: Readonly<PlacementPointerState>,
  event: PlacementPointerEvent,
): PlacementPointerTransition {
  switch (event.type) {
    case 'begin':
      return transition('tracking');
    case 'cancel':
    case 'confirm':
      return transition('inactive');
    case 'rotate':
      return transition(state.phase);
    case 'pointer-move': {
      if (state.phase === 'inactive') return transition('inactive');
      if (event.pointerType === 'mouse') {
        return transition(state.phase, state.phase === 'tracking');
      }
      return transition(state.phase, true);
    }
    case 'primary-canvas-press': {
      if (state.phase === 'inactive') return transition('inactive');
      return transition('pinned', true);
    }
  }
}
