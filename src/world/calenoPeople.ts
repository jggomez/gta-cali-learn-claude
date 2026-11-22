/**
 * Caleño people: pure, Three.js-free policies for on-foot animation playback, character
 * level-of-detail, diffuse-atlas recoloring, and ambient role NPC placement.
 */

export type LocomotionClipState = 'idle' | 'walk' | 'run';

/**
 * Ground speed (m/s) at which the retargeted Mixamo Walk/Run clips plant their feet without
 * sliding at timeScale 1, measured from the planted-foot velocity of the real GLB rigs
 * (verified by tests/unit/world/characterLocomotion.test.ts).
 */
export const LOCOMOTION_CLIP_GROUND_SPEED_MPS: Readonly<Record<'walk' | 'run', number>> = {
  walk: 1.65,
  run: 4.5,
};

const IDLE_SPEED_THRESHOLD_MPS = 0.35;
const WALK_TO_RUN_SPEED_MPS = 3.0;
const MIN_PLAYBACK_RATE = 0.5;
const MAX_PLAYBACK_RATE = 2.0;

export interface LocomotionPlayback {
  readonly state: LocomotionClipState;
  /** Signed mixer action time scale: negative plays the gait backwards when backing up. */
  readonly timeScale: number;
}

/**
 * Chooses the gait clip and its playback rate so the animated stride matches the simulated
 * on-foot ground speed (no foot sliding), reversing the gait for backwards movement.
 */
export function resolveLocomotionPlayback(
  speedMps: number,
  isSprinting: boolean,
): LocomotionPlayback {
  const absSpeed = Number.isFinite(speedMps) ? Math.abs(speedMps) : 0;
  if (absSpeed <= IDLE_SPEED_THRESHOLD_MPS) {
    return { state: 'idle', timeScale: 1 };
  }
  const state: 'walk' | 'run' =
    isSprinting || absSpeed > WALK_TO_RUN_SPEED_MPS ? 'run' : 'walk';
  const rate = Math.min(
    MAX_PLAYBACK_RATE,
    Math.max(MIN_PLAYBACK_RATE, absSpeed / LOCOMOTION_CLIP_GROUND_SPEED_MPS[state]),
  );
  return { state, timeScale: speedMps < 0 ? -rate : rate };
}
