/**
 * Pure headless 2D/2.5D physics, collision resolution, and driving dynamics
 * for GTA VI: Cali (La Sucursal del Cielo).
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
} from '../types/game';

export interface CollisionResult {
  readonly x: number;
  readonly z: number;
  readonly collided: boolean;
  readonly impactStrength: number;
  readonly inRiverHazard: boolean;
  readonly hitColliderId: string | null;
}

export interface VehicleMotionState {
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

const BASE_MAX_SPEED_MPS = 40;
const BOOST_MAX_SPEED_MPS = 54;
const MAX_REVERSE_SPEED_MPS = -14;
const ACCEL_MPS2 = 22;
const BOOST_ACCEL_MPS2 = 34;
const BRAKE_DECEL_MPS2 = 34;
const REVERSE_ACCEL_MPS2 = 14;
const COAST_DRAG_MPS2 = 7.5;
const OVERBOOST_DECAY_MPS2 = 12;
const HANDBRAKE_DECEL_MPS2 = 14;

const NITRO_DRAIN_PER_SEC = 28;
const NITRO_RECHARGE_PER_SEC = 14;
const MAX_STEER_ANGLE = 0.52;
const BASE_TURN_RATE = 2.35;
const DRIFT_TURN_MULTIPLIER = 1.48;
const DRIFT_SLIP_ANGLE = 0.22;
const DRIFT_MIN_SPEED_MPS = 6.5;

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

export function stepPlayerVehicle(
  state: VehicleMotionState,
  input: InputState,
  dt: number,
  map: CaliMapConfig = CALI_MAP,
): VehicleStepResult {
  const safeDt = clamp(dt, 0, 0.1);
  if (safeDt <= 0) {
    return {
      x: state.x,
      y: getTerrainElevation(state.x, state.z),
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
    };
  }

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
    speed = Math.min(BOOST_MAX_SPEED_MPS, speed + BOOST_ACCEL_MPS2 * safeDt);
  } else if (input.forward && !input.backward) {
    if (speed < 0) {
      speed = Math.min(0, speed + BRAKE_DECEL_MPS2 * safeDt);
    } else if (speed < BASE_MAX_SPEED_MPS) {
      speed = Math.min(BASE_MAX_SPEED_MPS, speed + ACCEL_MPS2 * safeDt);
    } else {
      speed = Math.max(
        BASE_MAX_SPEED_MPS,
        speed - OVERBOOST_DECAY_MPS2 * safeDt,
      );
    }
  } else if (input.backward && !input.forward) {
    if (speed > 0) {
      speed = Math.max(0, speed - BRAKE_DECEL_MPS2 * safeDt);
    } else {
      speed = Math.max(MAX_REVERSE_SPEED_MPS, speed - REVERSE_ACCEL_MPS2 * safeDt);
    }
  } else {
    speed = approachZero(speed, COAST_DRAG_MPS2 * safeDt);
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

  const targetSteerAngle = steerInput * MAX_STEER_ANGLE;
  const steerLerp = clamp(safeDt * 10, 0, 1);
  const nextSteerAngle =
    state.steerAngle + (targetSteerAngle - state.steerAngle) * steerLerp;

  const absSpeed = Math.abs(speed);
  const lowSpeedRamp = clamp(absSpeed / 6, 0, 1);
  const highSpeedDamp = 1 - 0.35 * clamp((absSpeed - 15) / 40, 0, 1);
  const driftMultiplier = isDrifting ? DRIFT_TURN_MULTIPLIER : 1;
  const directionSign = speed >= 0 ? 1 : -1;
  const turnRate =
    BASE_TURN_RATE * lowSpeedRamp * highSpeedDamp * driftMultiplier;
  const nextHeading = normalizeAngle(
    state.heading + steerInput * directionSign * turnRate * safeDt,
  );

  const travelHeading = isDrifting
    ? normalizeAngle(nextHeading - steerInput * DRIFT_SLIP_ANGLE)
    : nextHeading;

  const intendedX = state.x + Math.sin(travelHeading) * speed * safeDt;
  const intendedZ = state.z + Math.cos(travelHeading) * speed * safeDt;
  const collisionRadius = Math.max(state.halfWidth, 1.35);
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

  const nextY = getTerrainElevation(collision.x, collision.z);

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
