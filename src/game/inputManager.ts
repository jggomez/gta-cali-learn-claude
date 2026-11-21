/**
 * Keyboard input manager translating browser events into frame-ready InputState snapshots
 * and edge-triggered gameplay/UI action callbacks.
 */

import type { InputState } from '../types/game';

export interface InputActionCallbacks {
  readonly onCycleRadio?: () => void;
  readonly onCycleCamera?: () => void;
  readonly onToggleMute?: () => void;
  readonly onTogglePause?: () => void;
  readonly onAnyUserGesture?: () => void;
  readonly isPlaying?: () => boolean;
}

export interface InputTargetLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

const SCROLL_PREVENT_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }
  const tagName = (target as { tagName?: unknown }).tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export class InputManager {
  private readonly callbacks: InputActionCallbacks;
  private readonly target: InputTargetLike;
  private readonly pressedKeys = new Set<string>();
  private interactQueued = false;
  private disposed = false;

  private readonly handleKeyDownListener: EventListener;
  private readonly handleKeyUpListener: EventListener;
  private readonly handleBlurListener: EventListener;

  public constructor(
    callbacks: InputActionCallbacks = {},
    target: InputTargetLike = window,
  ) {
    this.callbacks = callbacks;
    this.target = target;

    this.handleKeyDownListener = (event) => {
      this.onKeyDown(event as KeyboardEvent);
    };
    this.handleKeyUpListener = (event) => {
      this.onKeyUp(event as KeyboardEvent);
    };
    this.handleBlurListener = () => {
      this.clearKeys();
    };

    this.target.addEventListener('keydown', this.handleKeyDownListener);
    this.target.addEventListener('keyup', this.handleKeyUpListener);
    this.target.addEventListener('blur', this.handleBlurListener);
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

  public clearKeys(): void {
    this.pressedKeys.clear();
    this.interactQueued = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.target.removeEventListener('keydown', this.handleKeyDownListener);
    this.target.removeEventListener('keyup', this.handleKeyUpListener);
    this.target.removeEventListener('blur', this.handleBlurListener);
    this.clearKeys();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.disposed || isEditableTarget(event.target)) {
      return;
    }

    const code = event.code;
    const isPlaying = this.callbacks.isPlaying ? this.callbacks.isPlaying() : true;

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
}
