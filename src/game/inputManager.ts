/**
 * Keyboard and canvas mouse/pointer input manager translating browser events into
 * frame-ready InputState and CameraLookInput snapshots plus edge-triggered action callbacks.
 */

import type { CameraLookInput, InputState } from '../types/game';

export interface InputActionCallbacks {
  readonly onCycleRadio?: () => void;
  readonly onCycleCamera?: () => void;
  readonly onToggleMute?: () => void;
  readonly onTogglePause?: () => void;
  readonly onToggleTimeOfDay?: () => void;
  readonly onAnyUserGesture?: () => void;
  readonly isPlaying?: () => boolean;
}

export interface InputTargetLike {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface CanvasInputTargetLike extends InputTargetLike {
  requestPointerLock?(): Promise<void> | void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

const SCROLL_PREVENT_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

const PRIMARY_MOUSE_BUTTON = 0;
const SECONDARY_MOUSE_BUTTON = 2;
const MOUSE_LOOK_YAW_SENSITIVITY = 0.005;
const MOUSE_LOOK_PITCH_SENSITIVITY = 0.004;
const WHEEL_ZOOM_SENSITIVITY = 0.004;
const WHEEL_LINE_TO_PX = 16;
const WHEEL_PAGE_TO_PX = 400;
const MAX_PENDING_LOOK_DELTA = Math.PI;
const MAX_WHEEL_STEP_DELTA = 1.5;
const MAX_PENDING_ZOOM_DELTA = 4;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  return (
    candidate.tagName === 'INPUT' ||
    candidate.tagName === 'TEXTAREA' ||
    candidate.tagName === 'SELECT' ||
    candidate.isContentEditable === true
  );
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasFiniteClientCoords(event: PointerEvent): boolean {
  return (
    typeof event.clientX === 'number' &&
    Number.isFinite(event.clientX) &&
    typeof event.clientY === 'number' &&
    Number.isFinite(event.clientY)
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export class InputManager {
  private readonly callbacks: InputActionCallbacks;
  private readonly target: InputTargetLike;
  private readonly canvas: CanvasInputTargetLike | null;
  private readonly pressedKeys = new Set<string>();
  private interactQueued = false;
  private disposed = false;

  private isDragging = false;
  private activePointerId: number | null = null;
  private capturedPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private hasLastPointerPos = false;
  private pendingYawDelta = 0;
  private pendingPitchDelta = 0;
  private pendingZoomDelta = 0;

  private readonly handleKeyDownListener: EventListener;
  private readonly handleKeyUpListener: EventListener;
  private readonly handleBlurListener: EventListener;
  private readonly handlePointerDownListener: EventListener;
  private readonly handlePointerMoveListener: EventListener;
  private readonly handlePointerEndListener: EventListener;
  private readonly handleWheelListener: EventListener;
  private readonly handleDoubleClickListener: EventListener;
  private readonly handleContextMenuListener: EventListener;

  public constructor(
    callbacks: InputActionCallbacks = {},
    target: InputTargetLike = window,
    canvas: CanvasInputTargetLike | null = null,
  ) {
    this.callbacks = callbacks;
    this.target = target;
    this.canvas = canvas;

    this.handleKeyDownListener = (event) => {
      this.onKeyDown(event as KeyboardEvent);
    };
    this.handleKeyUpListener = (event) => {
      this.onKeyUp(event as KeyboardEvent);
    };
    this.handleBlurListener = () => {
      this.clearKeys();
    };
    this.handlePointerDownListener = (event) => {
      this.onPointerDown(event as PointerEvent);
    };
    this.handlePointerMoveListener = (event) => {
      this.onPointerMove(event as PointerEvent);
    };
    this.handlePointerEndListener = (event) => {
      this.onPointerEnd(event as PointerEvent);
    };
    this.handleWheelListener = (event) => {
      this.onWheel(event as WheelEvent);
    };
    this.handleDoubleClickListener = () => {
      this.onCanvasDoubleClick();
    };
    this.handleContextMenuListener = (event) => {
      this.onContextMenu(event);
    };

    this.target.addEventListener('keydown', this.handleKeyDownListener);
    this.target.addEventListener('keyup', this.handleKeyUpListener);
    this.target.addEventListener('blur', this.handleBlurListener);
    this.attachCanvasListeners();
  }

  public consumeInputState(): InputState {
    const interactPressed = this.interactQueued;
    this.interactQueued = false;

    return {
      forward: this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp'),
      backward: this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown'),
      left: this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft'),
      right: this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight'),
      handbrake: this.pressedKeys.has('Space'),
      boost: this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight'),
      interactPressed,
      hornPressed: this.pressedKeys.has('KeyH'),
    };
  }

  public consumeCameraLook(): CameraLookInput {
    const yawDelta = this.pendingYawDelta || 0;
    const pitchDelta = this.pendingPitchDelta || 0;
    const zoomDelta = this.pendingZoomDelta || 0;

    this.pendingYawDelta = 0;
    this.pendingPitchDelta = 0;
    this.pendingZoomDelta = 0;

    return { yawDelta, pitchDelta, zoomDelta };
  }

  public clearKeys(): void {
    this.pressedKeys.clear();
    this.interactQueued = false;
    this.clearCameraLook();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.target.removeEventListener('keydown', this.handleKeyDownListener);
    this.target.removeEventListener('keyup', this.handleKeyUpListener);
    this.target.removeEventListener('blur', this.handleBlurListener);
    this.detachCanvasListeners();
    this.clearKeys();
  }

  private attachCanvasListeners(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.addEventListener('pointerdown', this.handlePointerDownListener);
    this.canvas.addEventListener('pointermove', this.handlePointerMoveListener);
    this.canvas.addEventListener('pointerup', this.handlePointerEndListener);
    this.canvas.addEventListener('pointercancel', this.handlePointerEndListener);
    this.canvas.addEventListener('wheel', this.handleWheelListener, { passive: false });
    this.canvas.addEventListener('dblclick', this.handleDoubleClickListener);
    this.canvas.addEventListener('contextmenu', this.handleContextMenuListener);

    if (this.target !== this.canvas) {
      this.target.addEventListener('pointerup', this.handlePointerEndListener);
      this.target.addEventListener('pointercancel', this.handlePointerEndListener);
    }
  }

  private detachCanvasListeners(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.removeEventListener('pointerdown', this.handlePointerDownListener);
    this.canvas.removeEventListener('pointermove', this.handlePointerMoveListener);
    this.canvas.removeEventListener('pointerup', this.handlePointerEndListener);
    this.canvas.removeEventListener('pointercancel', this.handlePointerEndListener);
    this.canvas.removeEventListener('wheel', this.handleWheelListener);
    this.canvas.removeEventListener('dblclick', this.handleDoubleClickListener);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenuListener);

    if (this.target !== this.canvas) {
      this.target.removeEventListener('pointerup', this.handlePointerEndListener);
      this.target.removeEventListener('pointercancel', this.handlePointerEndListener);
    }
  }

  private isMismatchedPointer(event: PointerEvent): boolean {
    return (
      this.activePointerId !== null &&
      typeof event.pointerId === 'number' &&
      event.pointerId !== this.activePointerId
    );
  }

  private isGameplayActive(): boolean {
    return this.callbacks.isPlaying ? this.callbacks.isPlaying() : true;
  }

  private isCanvasPointerLocked(): boolean {
    if (!this.canvas || typeof document === 'undefined') {
      return false;
    }
    return document.pointerLockElement === (this.canvas as unknown);
  }

  private clearCameraLook(): void {
    this.resetPointerDrag();
    this.pendingYawDelta = 0;
    this.pendingPitchDelta = 0;
    this.pendingZoomDelta = 0;
  }

  private resetPointerDrag(): void {
    if (
      this.capturedPointerId !== null &&
      typeof this.canvas?.releasePointerCapture === 'function'
    ) {
      try {
        this.canvas.releasePointerCapture(this.capturedPointerId);
      } catch {
        this.capturedPointerId = null;
      }
    }
    this.isDragging = false;
    this.activePointerId = null;
    this.capturedPointerId = null;
    this.hasLastPointerPos = false;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.disposed || isEditableTarget(event.target)) {
      return;
    }

    const code = event.code;
    const isPlaying = this.isGameplayActive();

    if (isPlaying && SCROLL_PREVENT_CODES.has(code)) {
      event.preventDefault();
    }

    const isFreshPress = !event.repeat && !this.pressedKeys.has(code);
    this.pressedKeys.add(code);

    if (!isFreshPress) {
      return;
    }

    this.callbacks.onAnyUserGesture?.();

    switch (code) {
      case 'KeyF':
      case 'KeyE':
        this.interactQueued = true;
        break;
      case 'KeyR':
        this.callbacks.onCycleRadio?.();
        break;
      case 'KeyC':
        this.callbacks.onCycleCamera?.();
        break;
      case 'KeyM':
        this.callbacks.onToggleMute?.();
        break;
      case 'KeyT':
        if (isPlaying) {
          this.callbacks.onToggleTimeOfDay?.();
        }
        break;
      case 'Escape':
      case 'KeyP':
        this.callbacks.onTogglePause?.();
        break;
      default:
        break;
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (this.disposed) {
      return;
    }
    this.pressedKeys.delete(event.code);
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.disposed || !this.isGameplayActive() || event.isPrimary === false) {
      return;
    }
    if (event.button !== PRIMARY_MOUSE_BUTTON && event.button !== SECONDARY_MOUSE_BUTTON) {
      return;
    }

    this.callbacks.onAnyUserGesture?.();
    this.isDragging = true;
    this.activePointerId = typeof event.pointerId === 'number' ? event.pointerId : null;

    if (hasFiniteClientCoords(event)) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.hasLastPointerPos = true;
    } else {
      this.hasLastPointerPos = false;
    }

    if (this.activePointerId !== null && typeof this.canvas?.setPointerCapture === 'function') {
      try {
        this.canvas.setPointerCapture(this.activePointerId);
        this.capturedPointerId = this.activePointerId;
      } catch {
        this.capturedPointerId = null;
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.disposed || !this.isGameplayActive()) {
      return;
    }

    const pointerLocked = this.isCanvasPointerLocked();
    if (!pointerLocked && (!this.isDragging || this.isMismatchedPointer(event))) {
      return;
    }

    const { dx, dy } = this.resolvePointerDelta(event, pointerLocked);
    if (dx !== 0) {
      this.pendingYawDelta = clamp(
        this.pendingYawDelta - dx * MOUSE_LOOK_YAW_SENSITIVITY,
        -MAX_PENDING_LOOK_DELTA,
        MAX_PENDING_LOOK_DELTA,
      );
    }
    if (dy !== 0) {
      this.pendingPitchDelta = clamp(
        this.pendingPitchDelta + dy * MOUSE_LOOK_PITCH_SENSITIVITY,
        -MAX_PENDING_LOOK_DELTA,
        MAX_PENDING_LOOK_DELTA,
      );
    }
  }

  private resolvePointerDelta(
    event: PointerEvent,
    pointerLocked: boolean,
  ): { readonly dx: number; readonly dy: number } {
    if (pointerLocked) {
      return {
        dx: finiteOrZero(event.movementX),
        dy: finiteOrZero(event.movementY),
      };
    }

    const hasClientCoords = hasFiniteClientCoords(event);

    if (this.hasLastPointerPos && hasClientCoords) {
      const dx = event.clientX - this.lastPointerX;
      const dy = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      return { dx, dy };
    }

    if (hasClientCoords) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.hasLastPointerPos = true;
    }

    return {
      dx: finiteOrZero(event.movementX),
      dy: finiteOrZero(event.movementY),
    };
  }

  private onPointerEnd(event: PointerEvent): void {
    if (!this.isDragging || this.isMismatchedPointer(event)) {
      return;
    }
    this.resetPointerDrag();
  }

  private onWheel(event: WheelEvent): void {
    if (this.disposed || !this.isGameplayActive()) {
      return;
    }

    event.preventDefault();
    const rawDelta = finiteOrZero(event.deltaY);
    if (rawDelta === 0) {
      return;
    }

    const modeMultiplier =
      event.deltaMode === 1
        ? WHEEL_LINE_TO_PX
        : event.deltaMode === 2
          ? WHEEL_PAGE_TO_PX
          : 1;
    const step = clamp(
      rawDelta * modeMultiplier * WHEEL_ZOOM_SENSITIVITY,
      -MAX_WHEEL_STEP_DELTA,
      MAX_WHEEL_STEP_DELTA,
    );
    this.pendingZoomDelta = clamp(
      this.pendingZoomDelta + step,
      -MAX_PENDING_ZOOM_DELTA,
      MAX_PENDING_ZOOM_DELTA,
    );
  }

  private onCanvasDoubleClick(): void {
    if (this.disposed || !this.canvas || !this.isGameplayActive()) {
      return;
    }
    this.callbacks.onAnyUserGesture?.();
    if (typeof this.canvas.requestPointerLock !== 'function') {
      return;
    }
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        void result.catch(() => {
          this.resetPointerDrag();
        });
      }
    } catch {
      this.resetPointerDrag();
    }
  }

  private onContextMenu(event: Event): void {
    if (this.disposed || !this.isGameplayActive()) {
      return;
    }
    event.preventDefault();
  }
}
