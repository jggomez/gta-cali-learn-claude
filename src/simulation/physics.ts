/**
 * Pure headless 2D/2.5D physics, collision resolution, and driving dynamics
 * for GTA I - Cali - Colombia (La Sucursal del Cielo).
 * Zero Three.js or DOM dependencies.
 */

import {
  CALI_MAP,
  getTerrainElevation,
  isPointInRiver,
  isPointOnBridge,
} from '../config/caliMap';
import type {
  BridgeSpan,
  CaliMapConfig,
  InputState,
  LandmarkId,
  MotorcycleKind,
  StuntJumpDef,
  VehicleKind,
} from '../types/game';

export interface VehicleHandlingProfile {
  readonly baseMaxSpeedMps: number;
  readonly boostMaxSpeedMps: number;
  readonly maxReverseSpeedMps: number;
  readonly accelMps2: number;
  readonly boostAccelMps2: number;
  readonly brakeDecelMps2: number;
  readonly reverseAccelMps2: number;
  readonly coastDragMps2: number;
  readonly baseTurnRate: number;
  readonly driftTurnMultiplier: number;
  readonly maxSteerAngle: number;
  /** Two-wheeler (moto) dynamics: lean-driven turning, wheelies, and a slim collision radius. */
  readonly isTwoWheeler?: boolean;
  /** Maximum body lean (radians) reached at full steer and speed. */
  readonly maxLeanRad?: number;
  /** Exponential lean response rate (1/s). */
  readonly leanRatePerSec?: number;
  /** Maximum nose-up wheelie pitch (radians). */
  readonly wheelieMaxRad?: number;
  /** Throttle wheelies only pop below this speed (nitro extends it by NITRO_WHEELIE_SPEED_FACTOR). */
  readonly wheelieMaxSpeedMps?: number;
  /** Explicit world collision radius; falls back to max(halfWidth, car minimum). */
  readonly collisionRadius?: number;
}

export interface CollisionResult {
  readonly x: number;
  readonly z: number;
  readonly collided: boolean;
  readonly impactStrength: number;
  readonly inRiverHazard: boolean;
  readonly hitColliderId: string | null;
}

export interface VehicleMotionState {
  readonly kind?: VehicleKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly steerAngle: number;
  readonly nitro: number;
  readonly isDrifting: boolean;
  readonly isBoosting: boolean;
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly airborneHeight?: number;
  readonly verticalVelocity?: number;
  readonly leanAngle?: number;
  readonly wheelieAngle?: number;
}

export interface VehicleStepResult {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  readonly steerAngle: number;
  readonly nitro: number;
  readonly isDrifting: boolean;
  readonly isBoosting: boolean;
  readonly collided: boolean;
  readonly collisionImpact: number;
  readonly inRiverHazard: boolean;
  readonly airborneHeight: number;
  readonly verticalVelocity: number;
  readonly leanAngle: number;
  readonly wheelieAngle: number;
}

export interface VerticalMotionResult {
  readonly airborneHeight: number;
  readonly verticalVelocity: number;
  readonly isAirborne: boolean;
}

export interface OnFootState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
}

export interface OnFootStepResult {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  readonly isSprinting: boolean;
  readonly collided: boolean;
  readonly collisionImpact: number;
  readonly inRiverHazard: boolean;
}

const WORLD_BOUNDARY_MARGIN = 6;
const DRIVABLE_LANDMARK_IDS: ReadonlySet<LandmarkId> = new Set([
  'bulevar_del_rio',
  'san_antonio',
]);

const VEHICLE_HANDLING_PROFILES: Readonly<
  Record<VehicleKind, VehicleHandlingProfile>
> = {
  renault4_turbo: {
    baseMaxSpeedMps: 41,
    boostMaxSpeedMps: 56,
    maxReverseSpeedMps: -14.5,
    accelMps2: 24,
    boostAccelMps2: 36,
    brakeDecelMps2: 36,
    reverseAccelMps2: 14.5,
    coastDragMps2: 7.4,
    baseTurnRate: 2.55,
    driftTurnMultiplier: 1.56,
    maxSteerAngle: 0.54,
  },
  spark_gt_turbo: {
    baseMaxSpeedMps: 40,
    boostMaxSpeedMps: 54.5,
    maxReverseSpeedMps: -14,
    accelMps2: 23.5,
    boostAccelMps2: 35,
    brakeDecelMps2: 35,
    reverseAccelMps2: 14,
    coastDragMps2: 7.4,
    baseTurnRate: 2.5,
    driftTurnMultiplier: 1.54,
    maxSteerAngle: 0.53,
  },
  willys_v8: {
    baseMaxSpeedMps: 38.5,
    boostMaxSpeedMps: 53,
    maxReverseSpeedMps: -13.5,
    accelMps2: 23,
    boostAccelMps2: 34,
    brakeDecelMps2: 33,
    reverseAccelMps2: 13.5,
    coastDragMps2: 7.2,
    baseTurnRate: 2.3,
    driftTurnMultiplier: 1.44,
    maxSteerAngle: 0.5,
  },
  banshee: {
    baseMaxSpeedMps: 40,
    boostMaxSpeedMps: 54,
    maxReverseSpeedMps: -14,
    accelMps2: 22,
    boostAccelMps2: 34,
    brakeDecelMps2: 34,
    reverseAccelMps2: 14,
    coastDragMps2: 7.5,
    baseTurnRate: 2.35,
    driftTurnMultiplier: 1.48,
    maxSteerAngle: 0.52,
  },
  mazda_323_coupe: {
    baseMaxSpeedMps: 40.5,
    boostMaxSpeedMps: 55,
    maxReverseSpeedMps: -14,
    accelMps2: 23.5,
    boostAccelMps2: 35,
    brakeDecelMps2: 35,
    reverseAccelMps2: 14,
    coastDragMps2: 7.4,
    baseTurnRate: 2.5,
    driftTurnMultiplier: 1.52,
    maxSteerAngle: 0.53,
  },
  renault_18_gtx: {
    baseMaxSpeedMps: 39,
    boostMaxSpeedMps: 52,
    maxReverseSpeedMps: -13.5,
    accelMps2: 21.5,
    boostAccelMps2: 33,
    brakeDecelMps2: 33,
    reverseAccelMps2: 13.5,
    coastDragMps2: 7.2,
    baseTurnRate: 2.3,
    driftTurnMultiplier: 1.42,
    maxSteerAngle: 0.5,
  },
  chevrolet_sprint_turbo: {
    baseMaxSpeedMps: 40,
    boostMaxSpeedMps: 55.5,
    maxReverseSpeedMps: -14.5,
    accelMps2: 25,
    boostAccelMps2: 37,
    brakeDecelMps2: 35,
    reverseAccelMps2: 14.5,
    coastDragMps2: 7.6,
    baseTurnRate: 2.62,
    driftTurnMultiplier: 1.5,
    maxSteerAngle: 0.55,
  },
  chevrolet_monza: {
    baseMaxSpeedMps: 38.5,
    boostMaxSpeedMps: 51,
    maxReverseSpeedMps: -13.5,
    accelMps2: 21,
    boostAccelMps2: 32,
    brakeDecelMps2: 32,
    reverseAccelMps2: 13.5,
    coastDragMps2: 7.1,
    baseTurnRate: 2.25,
    driftTurnMultiplier: 1.4,
    maxSteerAngle: 0.5,
  },
  nissan_sentra_b13: {
    baseMaxSpeedMps: 41,
    boostMaxSpeedMps: 56.9,
    maxReverseSpeedMps: -14,
    accelMps2: 23,
    boostAccelMps2: 35.5,
    brakeDecelMps2: 35,
    reverseAccelMps2: 14,
    coastDragMps2: 7.3,
    baseTurnRate: 2.45,
    driftTurnMultiplier: 1.48,
    maxSteerAngle: 0.52,
  },
  chevette_turbo: {
    baseMaxSpeedMps: 38,
    boostMaxSpeedMps: 52.5,
    maxReverseSpeedMps: -13.5,
    accelMps2: 22,
    boostAccelMps2: 34,
    brakeDecelMps2: 33,
    reverseAccelMps2: 13.5,
    coastDragMps2: 7.2,
    baseTurnRate: 2.35,
    driftTurnMultiplier: 1.64,
    maxSteerAngle: 0.52,
  },
  renault_twingo: {
    baseMaxSpeedMps: 36,
    boostMaxSpeedMps: 49,
    maxReverseSpeedMps: -13,
    accelMps2: 22.5,
    boostAccelMps2: 33,
    brakeDecelMps2: 34,
    reverseAccelMps2: 13,
    coastDragMps2: 7.5,
    baseTurnRate: 2.7,
    driftTurnMultiplier: 1.46,
    maxSteerAngle: 0.56,
  },
  yamaha_rx115: {
    baseMaxSpeedMps: 34,
    boostMaxSpeedMps: 45,
    maxReverseSpeedMps: -4,
    accelMps2: 26,
    boostAccelMps2: 36,
    brakeDecelMps2: 30,
    reverseAccelMps2: 4,
    coastDragMps2: 6.4,
    baseTurnRate: 2.9,
    driftTurnMultiplier: 1.35,
    maxSteerAngle: 0.42,
    isTwoWheeler: true,
    maxLeanRad: 0.75,
    leanRatePerSec: 6.5,
    wheelieMaxRad: 0.5,
    wheelieMaxSpeedMps: 12,
    collisionRadius: 0.55,
  },
  yamaha_dt125: {
    baseMaxSpeedMps: 32,
    boostMaxSpeedMps: 43,
    maxReverseSpeedMps: -4,
    accelMps2: 24,
    boostAccelMps2: 34,
    brakeDecelMps2: 28,
    reverseAccelMps2: 4,
    coastDragMps2: 6.8,
    baseTurnRate: 2.8,
    driftTurnMultiplier: 1.4,
    maxSteerAngle: 0.46,
    isTwoWheeler: true,
    maxLeanRad: 0.68,
    leanRatePerSec: 5.5,
    wheelieMaxRad: 0.6,
    wheelieMaxSpeedMps: 13,
    collisionRadius: 0.55,
  },
  police: {
    baseMaxSpeedMps: 37,
    boostMaxSpeedMps: 49,
    maxReverseSpeedMps: -13,
    accelMps2: 20,
    boostAccelMps2: 30,
    brakeDecelMps2: 32,
    reverseAccelMps2: 13,
    coastDragMps2: 7.5,
    baseTurnRate: 2.25,
    driftTurnMultiplier: 1.4,
    maxSteerAngle: 0.5,
  },
  taxi: {
    baseMaxSpeedMps: 33,
    boostMaxSpeedMps: 46,
    maxReverseSpeedMps: -11,
    accelMps2: 17,
    boostAccelMps2: 24,
    brakeDecelMps2: 28,
    reverseAccelMps2: 11,
    coastDragMps2: 7.2,
    baseTurnRate: 2.2,
    driftTurnMultiplier: 1.35,
    maxSteerAngle: 0.5,
  },
  chiva: {
    baseMaxSpeedMps: 22,
    boostMaxSpeedMps: 28,
    maxReverseSpeedMps: -8,
    accelMps2: 11.5,
    boostAccelMps2: 16,
    brakeDecelMps2: 21,
    reverseAccelMps2: 8,
    coastDragMps2: 6.5,
    baseTurnRate: 1.65,
    driftTurnMultiplier: 1.15,
    maxSteerAngle: 0.42,
  },
  mio_bus: {
    baseMaxSpeedMps: 21,
    boostMaxSpeedMps: 26,
    maxReverseSpeedMps: -7.5,
    accelMps2: 10.5,
    boostAccelMps2: 14.5,
    brakeDecelMps2: 19,
    reverseAccelMps2: 7.5,
    coastDragMps2: 6.0,
    baseTurnRate: 1.45,
    driftTurnMultiplier: 1.1,
    maxSteerAngle: 0.38,
  },
};

const OVERBOOST_DECAY_MPS2 = 12;
const HANDBRAKE_DECEL_MPS2 = 14;

const NITRO_DRAIN_PER_SEC = 28;
const NITRO_RECHARGE_PER_SEC = 14;
const DRIFT_SLIP_ANGLE = 0.22;
const DRIFT_MIN_SPEED_MPS = 6.5;
export const STUNT_GRAVITY_MPS2 = 19;
const STUNT_HEADING_MIN_COS = 0.35;

const CAR_COLLISION_RADIUS_MIN = 1.35;
const LEAN_FULL_SPEED_MPS = 14;
const WHEELIE_RISE_RATE_PER_SEC = 2.6;
const WHEELIE_FALL_RATE_PER_SEC = 3.4;
const THROTTLE_WHEELIE_FRACTION = 0.6;
const NITRO_WHEELIE_SPEED_FACTOR = 1.8;
const WHEELIE_STEER_PENALTY = 0.7;

export function getVehicleHandlingProfile(
  kind: VehicleKind,
): VehicleHandlingProfile {
  return VEHICLE_HANDLING_PROFILES[kind];
}

export function isTwoWheelerKind(kind: VehicleKind): kind is MotorcycleKind {
  return VEHICLE_HANDLING_PROFILES[kind].isTwoWheeler === true;
}

/**
 * World/vehicle collision radius: bikes use their slim profile radius, cars keep a minimum
 * footprint (`carMinimum`) so wide bodies never clip building corners.
 */
export function resolveVehicleCollisionRadius(
  kind: VehicleKind | undefined,
  halfWidth: number,
  carMinimum: number = CAR_COLLISION_RADIUS_MIN,
): number {
  const explicitRadius = kind
    ? VEHICLE_HANDLING_PROFILES[kind].collisionRadius
    : undefined;
  return explicitRadius ?? Math.max(halfWidth, carMinimum);
}

function approachValue(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maxDelta;
}

interface TwoWheelerAttitude {
  readonly leanAngle: number;
  readonly wheelieAngle: number;
  /** Effective steer (-1..1) after lean-derived turning and wheelie steering loss. */
  readonly turnInput: number;
}

const UPRIGHT_ATTITUDE_ZERO = { leanAngle: 0, wheelieAngle: 0 } as const;

/**
 * Lean follows steer x speed (exponential response, bounded by maxLean) and the yaw input is
 * derived from the current lean at speed, blending to direct steer at walking pace. Throttle
 * wheelies only pop at low speed (nitro extends the window) and cut steering authority.
 */
function stepTwoWheelerAttitude(
  profile: VehicleHandlingProfile,
  state: VehicleMotionState,
  input: InputState,
  steerInput: number,
  speed: number,
  isBoosting: boolean,
  dt: number,
): TwoWheelerAttitude {
  const maxLean = profile.maxLeanRad ?? 0;
  const speedBlend = clamp(Math.abs(speed) / LEAN_FULL_SPEED_MPS, 0, 1);
  const targetLean = steerInput * maxLean * speedBlend;
  const leanAlpha = clamp(dt * (profile.leanRatePerSec ?? 0), 0, 1);
  const currentLean = state.leanAngle ?? 0;
  const leanAngle = clamp(
    currentLean + (targetLean - currentLean) * leanAlpha,
    -maxLean,
    maxLean,
  );

  const wheelieMax = profile.wheelieMaxRad ?? 0;
  const wheelieSpeedLimit =
    (profile.wheelieMaxSpeedMps ?? 0) * (isBoosting ? NITRO_WHEELIE_SPEED_FACTOR : 1);
  const wantsWheelie =
    input.forward &&
    !input.backward &&
    !input.handbrake &&
    speed >= 0 &&
    speed < wheelieSpeedLimit;
  const targetWheelie = wantsWheelie
    ? wheelieMax * (isBoosting ? 1 : THROTTLE_WHEELIE_FRACTION)
    : 0;
  const currentWheelie = state.wheelieAngle ?? 0;
  const wheelieRate =
    targetWheelie > currentWheelie ? WHEELIE_RISE_RATE_PER_SEC : WHEELIE_FALL_RATE_PER_SEC;
  const wheelieAngle = clamp(
    approachValue(currentWheelie, targetWheelie, wheelieRate * dt),
    0,
    wheelieMax,
  );

  const leanSteer = maxLean > 0 ? leanAngle / maxLean : 0;
  const blendedSteer = clamp(steerInput * (1 - speedBlend) + leanSteer, -1, 1);
  const wheelieLoss =
    wheelieMax > 0 ? 1 - WHEELIE_STEER_PENALTY * (wheelieAngle / wheelieMax) : 1;

  return { leanAngle, wheelieAngle, turnInput: blendedSteer * wheelieLoss };
}

const WALK_SPEED_MPS = 6.5;
const SPRINT_SPEED_MPS = 10.5;
const BACK_WALK_SPEED_MPS = 4.5;
const ON_FOOT_TURN_RATE = 3.0;
export const PLAYER_COLLISION_RADIUS = 0.65;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = (((angle + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
  if (wrapped <= -Math.PI) {
    wrapped += twoPi;
  }
  return wrapped;
}

interface AabbPush {
  readonly x: number;
  readonly z: number;
  readonly pushed: boolean;
}

function resolveCircleVsAabb(
  x: number,
  z: number,
  radius: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): AabbPush {
  const closestX = clamp(x, minX, maxX);
  const closestZ = clamp(z, minZ, maxZ);
  const dx = x - closestX;
  const dz = z - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq >= radius * radius) {
    return { x, z, pushed: false };
  }

  if (distSq > 1e-10) {
    const dist = Math.sqrt(distSq);
    const overlap = radius - dist;
    return {
      x: x + (dx / dist) * overlap,
      z: z + (dz / dist) * overlap,
      pushed: true,
    };
  }

  const penLeft = x - minX;
  const penRight = maxX - x;
  const penTop = z - minZ;
  const penBottom = maxZ - z;
  const minPen = Math.min(penLeft, penRight, penTop, penBottom);

  if (minPen === penLeft) {
    return { x: minX - radius, z, pushed: true };
  }
  if (minPen === penRight) {
    return { x: maxX + radius, z, pushed: true };
  }
  if (minPen === penTop) {
    return { x, z: minZ - radius, pushed: true };
  }
  return { x, z: maxZ + radius, pushed: true };
}

function findBridgeContaining(
  x: number,
  z: number,
  map: CaliMapConfig,
): BridgeSpan | null {
  for (const bridge of map.river.bridges) {
    if (
      x >= bridge.minX &&
      x <= bridge.maxX &&
      z >= bridge.minZ &&
      z <= bridge.maxZ
    ) {
      return bridge;
    }
  }
  return null;
}

function isInsideMapRiver(x: number, z: number, map: CaliMapConfig): boolean {
  if (map.river === CALI_MAP.river) {
    return isPointInRiver(x, z);
  }
  const { river } = map;
  const inCorridor =
    x >= river.minX &&
    x <= river.maxX &&
    z >= river.minZ &&
    z <= river.maxZ;
  return inCorridor && findBridgeContaining(x, z, map) === null;
}

function isOnMapBridge(x: number, z: number, map: CaliMapConfig): boolean {
  if (map.river === CALI_MAP.river) {
    return isPointOnBridge(x, z);
  }
  return findBridgeContaining(x, z, map) !== null;
}

export function resolveCircleWorldCollision(
  x: number,
  z: number,
  radius: number,
  map: CaliMapConfig = CALI_MAP,
): CollisionResult {
  let rx = x;
  let rz = z;
  let collided = false;
  let inRiverHazard = false;
  let hitColliderId: string | null = null;

  for (let pass = 0; pass < 2; pass += 1) {
    for (const building of map.buildingColliders) {
      const push = resolveCircleVsAabb(
        rx,
        rz,
        radius,
        building.minX,
        building.maxX,
        building.minZ,
        building.maxZ,
      );
      if (push.pushed) {
        rx = push.x;
        rz = push.z;
        collided = true;
        hitColliderId ??= building.id;
      }
    }

    for (const landmark of map.landmarks) {
      if (DRIVABLE_LANDMARK_IDS.has(landmark.id)) {
        continue;
      }
      const push = resolveCircleVsAabb(
        rx,
        rz,
        radius,
        landmark.position.x - landmark.footprintHalfX,
        landmark.position.x + landmark.footprintHalfX,
        landmark.position.z - landmark.footprintHalfZ,
        landmark.position.z + landmark.footprintHalfZ,
      );
      if (push.pushed) {
        rx = push.x;
        rz = push.z;
        collided = true;
        hitColliderId ??= landmark.id;
      }
    }
  }

  const { river } = map;
  const touchesRiverSpan =
    rx + radius > river.minX &&
    rx - radius < river.maxX &&
    rz + radius > river.minZ &&
    rz - radius < river.maxZ;

  if (touchesRiverSpan) {
    if (isOnMapBridge(rx, rz, map)) {
      const bridge = findBridgeContaining(rx, rz, map);
      if (bridge) {
        const safeMinZ = bridge.minZ + radius;
        const safeMaxZ = bridge.maxZ - radius;
        if (safeMinZ <= safeMaxZ) {
          const guardedZ = clamp(rz, safeMinZ, safeMaxZ);
          if (guardedZ !== rz) {
            rz = guardedZ;
            collided = true;
            hitColliderId ??= bridge.id;
          }
        }
      }
    } else if (isInsideMapRiver(rx, rz, map) || findBridgeContaining(rx, rz, map) === null) {
      const riverMidX = (river.minX + river.maxX) * 0.5;
      rx = rx <= riverMidX ? river.minX - radius : river.maxX + radius;
      collided = true;
      inRiverHazard = true;
      hitColliderId ??= river.id;
    }
  }

  const bound = map.worldHalfSize - WORLD_BOUNDARY_MARGIN;
  const clampedX = clamp(rx, -bound, bound);
  const clampedZ = clamp(rz, -bound, bound);
  if (clampedX !== rx || clampedZ !== rz) {
    rx = clampedX;
    rz = clampedZ;
    collided = true;
    hitColliderId ??= 'world_boundary';
  }

  const pushDistance = Math.hypot(rx - x, rz - z);
  const impactStrength = collided
    ? clamp(pushDistance / Math.max(radius, 0.5), 0.15, 1)
    : 0;

  return {
    x: rx,
    z: rz,
    collided,
    impactStrength,
    inRiverHazard,
    hitColliderId,
  };
}

function approachZero(value: number, delta: number): number {
  if (Math.abs(value) <= delta) {
    return 0;
  }
  return value - Math.sign(value) * delta;
}

export function stepVerticalMotion(
  airborneHeight: number,
  verticalVelocity: number,
  dt: number,
  gravityMps2: number = STUNT_GRAVITY_MPS2,
): VerticalMotionResult {
  const safeDt = clamp(dt, 0, 0.1);
  const currentHeight = Math.max(0, airborneHeight);
  if (safeDt <= 0 || (currentHeight <= 0 && verticalVelocity <= 0)) {
    return {
      airborneHeight: currentHeight,
      verticalVelocity: currentHeight <= 0 && verticalVelocity <= 0 ? 0 : verticalVelocity,
      isAirborne: currentHeight > 0 || verticalVelocity > 0,
    };
  }

  const nextHeight =
    currentHeight + verticalVelocity * safeDt - 0.5 * gravityMps2 * safeDt * safeDt;
  if (nextHeight <= 0) {
    return {
      airborneHeight: 0,
      verticalVelocity: 0,
      isAirborne: false,
    };
  }

  return {
    airborneHeight: nextHeight,
    verticalVelocity: verticalVelocity - gravityMps2 * safeDt,
    isAirborne: true,
  };
}

export function isVehicleOnStuntRamp(
  x: number,
  z: number,
  heading: number,
  speedMps: number,
  jump: StuntJumpDef,
): boolean {
  if (speedMps < jump.minSpeedMps) {
    return false;
  }
  const headingDiff = normalizeAngle(heading - jump.heading);
  if (Math.cos(headingDiff) < STUNT_HEADING_MIN_COS) {
    return false;
  }

  const dx = x - jump.x;
  const dz = z - jump.z;
  const fwdX = Math.sin(jump.heading);
  const fwdZ = Math.cos(jump.heading);
  const rightX = -fwdZ;
  const rightZ = fwdX;
  const localFwd = dx * fwdX + dz * fwdZ;
  const localRight = dx * rightX + dz * rightZ;

  return (
    Math.abs(localFwd) <= jump.length * 0.5 &&
    Math.abs(localRight) <= jump.width * 0.5
  );
}

export function stepPlayerVehicle(
  state: VehicleMotionState,
  input: InputState,
  dt: number,
  map: CaliMapConfig = CALI_MAP,
  kind?: VehicleKind,
): VehicleStepResult {
  const safeDt = clamp(dt, 0, 0.1);
  const initialAirborneHeight = Math.max(0, state.airborneHeight ?? 0);
  const initialVerticalVelocity = state.verticalVelocity ?? 0;

  if (safeDt <= 0) {
    return {
      x: state.x,
      y: getTerrainElevation(state.x, state.z) + initialAirborneHeight,
      z: state.z,
      heading: state.heading,
      speedMps: state.speedMps,
      speedKmh: Math.abs(state.speedMps) * 3.6,
      steerAngle: state.steerAngle,
      nitro: state.nitro,
      isDrifting: false,
      isBoosting: false,
      collided: false,
      collisionImpact: 0,
      inRiverHazard: false,
      airborneHeight: initialAirborneHeight,
      verticalVelocity: initialVerticalVelocity,
      leanAngle: state.leanAngle ?? 0,
      wheelieAngle: state.wheelieAngle ?? 0,
    };
  }

  const resolvedKind = kind ?? state.kind ?? 'banshee';
  const profile = getVehicleHandlingProfile(resolvedKind);
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const isBoosting =
    input.boost && (input.forward || state.speedMps > 2) && state.nitro > 0;

  let nextNitro = state.nitro;
  if (isBoosting) {
    nextNitro = clamp(state.nitro - NITRO_DRAIN_PER_SEC * safeDt, 0, 100);
  } else if (!input.boost) {
    nextNitro = clamp(state.nitro + NITRO_RECHARGE_PER_SEC * safeDt, 0, 100);
  }

  let speed = state.speedMps;
  if (isBoosting) {
    speed = Math.min(
      profile.boostMaxSpeedMps,
      speed + profile.boostAccelMps2 * safeDt,
    );
  } else if (input.forward && !input.backward) {
    if (speed < 0) {
      speed = Math.min(0, speed + profile.brakeDecelMps2 * safeDt);
    } else if (speed < profile.baseMaxSpeedMps) {
      speed = Math.min(
        profile.baseMaxSpeedMps,
        speed + profile.accelMps2 * safeDt,
      );
    } else {
      speed = Math.max(
        profile.baseMaxSpeedMps,
        speed - OVERBOOST_DECAY_MPS2 * safeDt,
      );
    }
  } else if (input.backward && !input.forward) {
    if (speed > 0) {
      speed = Math.max(0, speed - profile.brakeDecelMps2 * safeDt);
    } else {
      speed = Math.max(
        profile.maxReverseSpeedMps,
        speed - profile.reverseAccelMps2 * safeDt,
      );
    }
  } else {
    speed = approachZero(speed, profile.coastDragMps2 * safeDt);
  }

  const isDrifting =
    input.handbrake &&
    Math.abs(speed) >= DRIFT_MIN_SPEED_MPS &&
    steerInput !== 0;

  if (input.handbrake) {
    const handbrakeDecel = isDrifting
      ? HANDBRAKE_DECEL_MPS2 * 0.45
      : HANDBRAKE_DECEL_MPS2 * 1.6;
    speed = approachZero(speed, handbrakeDecel * safeDt);
  }

  const targetSteerAngle = steerInput * profile.maxSteerAngle;
  const steerLerp = clamp(safeDt * 10, 0, 1);
  const nextSteerAngle =
    state.steerAngle + (targetSteerAngle - state.steerAngle) * steerLerp;

  const absSpeed = Math.abs(speed);
  const attitude: TwoWheelerAttitude = profile.isTwoWheeler
    ? stepTwoWheelerAttitude(profile, state, input, steerInput, speed, isBoosting, safeDt)
    : { ...UPRIGHT_ATTITUDE_ZERO, turnInput: steerInput };
  const lowSpeedRamp = clamp(absSpeed / 6, 0, 1);
  const highSpeedDamp = 1 - 0.35 * clamp((absSpeed - 15) / 40, 0, 1);
  const driftMultiplier = isDrifting ? profile.driftTurnMultiplier : 1;
  const directionSign = speed >= 0 ? 1 : -1;
  const turnRate =
    profile.baseTurnRate * lowSpeedRamp * highSpeedDamp * driftMultiplier;
  const nextHeading = normalizeAngle(
    state.heading + attitude.turnInput * directionSign * turnRate * safeDt,
  );

  const travelHeading = isDrifting
    ? normalizeAngle(nextHeading - steerInput * DRIFT_SLIP_ANGLE)
    : nextHeading;

  const intendedX = state.x + Math.sin(travelHeading) * speed * safeDt;
  const intendedZ = state.z + Math.cos(travelHeading) * speed * safeDt;
  const collisionRadius = resolveVehicleCollisionRadius(resolvedKind, state.halfWidth);
  const collision = resolveCircleWorldCollision(
    intendedX,
    intendedZ,
    collisionRadius,
    map,
  );

  let finalSpeed = speed;
  let collisionImpact = 0;

  if (collision.collided) {
    const intendedDx = intendedX - state.x;
    const intendedDz = intendedZ - state.z;
    const intendedDistSq = intendedDx * intendedDx + intendedDz * intendedDz;

    if (collision.inRiverHazard) {
      finalSpeed = Math.sign(speed) * Math.min(Math.abs(speed) * 0.2, 4);
      collisionImpact = clamp(Math.max(collision.impactStrength, 0.55), 0, 1);
    } else if (intendedDistSq > 1e-8) {
      const actualDx = collision.x - state.x;
      const actualDz = collision.z - state.z;
      const retention = clamp(
        (actualDx * intendedDx + actualDz * intendedDz) / intendedDistSq,
        0,
        1,
      );
      finalSpeed = speed * (0.25 + 0.72 * retention);
      collisionImpact = clamp(
        (1 - retention * 0.7) * clamp(absSpeed / 32, 0.2, 1),
        0,
        1,
      );
    } else {
      finalSpeed = speed * 0.4;
      collisionImpact = collision.impactStrength;
    }
  }

  const vertical = stepVerticalMotion(
    initialAirborneHeight,
    initialVerticalVelocity,
    safeDt,
    STUNT_GRAVITY_MPS2,
  );
  const nextY = getTerrainElevation(collision.x, collision.z) + vertical.airborneHeight;

  return {
    x: collision.x,
    y: nextY,
    z: collision.z,
    heading: nextHeading,
    speedMps: finalSpeed,
    speedKmh: Math.abs(finalSpeed) * 3.6,
    steerAngle: nextSteerAngle,
    nitro: nextNitro,
    isDrifting: isDrifting && !collision.collided,
    isBoosting,
    collided: collision.collided,
    collisionImpact,
    inRiverHazard: collision.inRiverHazard,
    airborneHeight: vertical.airborneHeight,
    verticalVelocity: vertical.verticalVelocity,
    leanAngle: attitude.leanAngle,
    wheelieAngle: attitude.wheelieAngle,
  };
}

export function stepOnFoot(
  state: OnFootState,
  input: InputState,
  dt: number,
  map: CaliMapConfig = CALI_MAP,
): OnFootStepResult {
  const safeDt = clamp(dt, 0, 0.1);
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const moveInput = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const nextHeading = normalizeAngle(
    state.heading + steerInput * ON_FOOT_TURN_RATE * safeDt,
  );

  const isSprinting = input.boost && moveInput > 0;
  let speedMps = 0;
  if (moveInput > 0) {
    speedMps = isSprinting ? SPRINT_SPEED_MPS : WALK_SPEED_MPS;
  } else if (moveInput < 0) {
    speedMps = -BACK_WALK_SPEED_MPS;
  }

  const intendedX = state.x + Math.sin(nextHeading) * speedMps * safeDt;
  const intendedZ = state.z + Math.cos(nextHeading) * speedMps * safeDt;
  const collision = resolveCircleWorldCollision(
    intendedX,
    intendedZ,
    PLAYER_COLLISION_RADIUS,
    map,
  );

  const nextY = getTerrainElevation(collision.x, collision.z);

  return {
    x: collision.x,
    y: nextY,
    z: collision.z,
    heading: nextHeading,
    speedMps,
    speedKmh: Math.abs(speedMps) * 3.6,
    isSprinting,
    collided: collision.collided,
    collisionImpact: collision.collided ? collision.impactStrength * 0.4 : 0,
    inRiverHazard: collision.inRiverHazard,
  };
}
