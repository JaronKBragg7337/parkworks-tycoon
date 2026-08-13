import { normalizeJoystickVector, type Axis2D } from './joystickMath';
import {
  normalizeWheelZoomDelta,
  pinchZoomDelta,
  pointerDistance,
} from './inputZoomMath';

export interface MovementAxes {
  x: number;
  y: number;
  magnitude: number;
}

export interface LookDelta {
  x: number;
  y: number;
}

export class InputController {
  private readonly element: HTMLElement;
  private readonly joystick: HTMLElement;
  private readonly pressedKeys = new Set<string>();
  private readonly move: MovementAxes = { x: 0, y: 0, magnitude: 0 };
  private readonly lookDelta: LookDelta = { x: 0, y: 0 };
  private readonly joystickOrigin: Axis2D = { x: 0, y: 0 };
  private readonly touchPointers = new Map<number, Axis2D>();
  private movementPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private pinchDistance: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;
  private zoomDelta = 0;
  private enabled = true;
  private zoomEnabled = false;
  private maxJoystickRadius = 56;

  constructor(element: HTMLElement, joystick: HTMLElement) {
    this.element = element;
    this.joystick = joystick;
    this.bindEvents();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  setZoomEnabled(enabled: boolean): void {
    if (this.zoomEnabled === enabled) return;
    this.zoomEnabled = enabled;
    this.releaseMovement();
    this.lookPointerId = null;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.touchPointers.clear();
    this.pinchDistance = null;
    this.zoomDelta = 0;
  }

  getMovement(): MovementAxes {
    if (!this.enabled) return { x: 0, y: 0, magnitude: 0 };
    const keyboardX =
      Number(this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) -
      Number(this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft'));
    const keyboardY =
      Number(this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) -
      Number(this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown'));

    if (keyboardX !== 0 || keyboardY !== 0) {
      const length = Math.hypot(keyboardX, keyboardY);
      return { x: keyboardX / length, y: keyboardY / length, magnitude: 1 };
    }
    return { ...this.move };
  }

  consumeLookDelta(): LookDelta {
    const sample = { ...this.lookDelta };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return sample;
  }

  /** Positive values zoom out; negative values zoom in. */
  consumeZoomDelta(): number {
    if (!this.enabled || !this.zoomEnabled) return 0;
    const sample = this.zoomDelta;
    this.zoomDelta = 0;
    return sample;
  }

  isSprinting(): boolean {
    return this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onResetEvent);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('orientationchange', this.onResetEvent);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onResetEvent);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('orientationchange', this.onResetEvent);
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerUp);
    this.element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || this.isUiTarget(event.target)) return;
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
    this.pressedKeys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || this.isUiTarget(event.target)) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches || event.pointerType === 'touch';
    const movementSide = coarse && event.clientX < window.innerWidth * 0.5;

    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events and a few embedded browsers do not expose a pointer handle.
    }

    if (this.zoomEnabled && event.pointerType === 'touch') {
      this.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPointers.size >= 2) {
        event.preventDefault();
        this.beginPinch();
        return;
      }
    }

    if (movementSide && this.movementPointerId === null) {
      event.preventDefault();
      this.movementPointerId = event.pointerId;
      this.joystickOrigin.x = event.clientX;
      this.joystickOrigin.y = event.clientY;
      this.maxJoystickRadius = Math.max(48, Math.min(64, window.innerWidth * 0.11));
      this.joystick.style.left = `${event.clientX}px`;
      this.joystick.style.top = `${event.clientY}px`;
      this.joystick.style.setProperty('--knob-x', '0px');
      this.joystick.style.setProperty('--knob-y', '0px');
      this.joystick.classList.add('is-active');
      this.joystick.setAttribute('aria-hidden', 'false');
      return;
    }

    if (this.lookPointerId === null) {
      this.lookPointerId = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.zoomEnabled && event.pointerType === 'touch' && this.touchPointers.has(event.pointerId)) {
      this.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinchDistance !== null) {
        event.preventDefault();
        const distance = this.currentPinchDistance();
        if (distance !== null) {
          this.zoomDelta += pinchZoomDelta(this.pinchDistance, distance);
          this.pinchDistance = distance;
        }
        return;
      }
    }

    if (event.pointerId === this.movementPointerId) {
      event.preventDefault();
      const sample = normalizeJoystickVector(
        this.joystickOrigin,
        { x: event.clientX, y: event.clientY },
        this.maxJoystickRadius,
        0.1,
      );
      this.move.x = sample.x;
      this.move.y = -sample.y;
      this.move.magnitude = sample.distance;

      const rawX = event.clientX - this.joystickOrigin.x;
      const rawY = event.clientY - this.joystickOrigin.y;
      const rawLength = Math.hypot(rawX, rawY);
      const ratio = rawLength > this.maxJoystickRadius ? this.maxJoystickRadius / rawLength : 1;
      this.joystick.style.setProperty('--knob-x', `${rawX * ratio}px`);
      this.joystick.style.setProperty('--knob-y', `${rawY * ratio}px`);
      return;
    }

    if (event.pointerId === this.lookPointerId) {
      this.lookDelta.x += event.clientX - this.lastLookX;
      this.lookDelta.y += event.clientY - this.lastLookY;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.zoomEnabled && event.pointerType === 'touch') {
      this.touchPointers.delete(event.pointerId);
      if (this.pinchDistance !== null) {
        const distance = this.currentPinchDistance();
        this.pinchDistance = distance;
        if (distance === null) {
          this.releaseMovement();
          this.lookPointerId = null;
        }
        return;
      }
    }
    if (event.pointerId === this.movementPointerId) this.releaseMovement();
    if (event.pointerId === this.lookPointerId) this.lookPointerId = null;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.zoomEnabled || this.isUiTarget(event.target)) return;
    event.preventDefault();
    this.zoomDelta += normalizeWheelZoomDelta(event.deltaY, event.deltaMode, window.innerHeight);
  };

  private onResetEvent = (): void => this.reset();

  private onVisibilityChange = (): void => {
    if (document.hidden) this.reset();
  };

  private reset(): void {
    this.pressedKeys.clear();
    this.releaseMovement();
    this.lookPointerId = null;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.touchPointers.clear();
    this.pinchDistance = null;
    this.zoomDelta = 0;
  }

  private beginPinch(): void {
    this.releaseMovement();
    this.lookPointerId = null;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.pinchDistance = this.currentPinchDistance();
  }

  private currentPinchDistance(): number | null {
    const pointers = [...this.touchPointers.values()];
    const first = pointers[0];
    const second = pointers[1];
    return first && second ? pointerDistance(first, second) : null;
  }

  private releaseMovement(): void {
    this.movementPointerId = null;
    this.move.x = 0;
    this.move.y = 0;
    this.move.magnitude = 0;
    this.joystick.classList.remove('is-active');
    this.joystick.setAttribute('aria-hidden', 'true');
    this.joystick.style.setProperty('--knob-x', '0px');
    this.joystick.style.setProperty('--knob-y', '0px');
  }

  private isUiTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('[data-ui]') !== null;
  }
}
