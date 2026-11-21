/**
 * Headless Cali traffic and Police pursuit AI for GTA VI: Cali.
 * Zero Three.js or DOM dependencies.
 */

import { CALI_MAP, getTerrainElevation } from '../config/caliMap';
import type {
  BridgeSpan,
  CaliMapConfig,
  TrafficRoute,
  Vec2,
  VehicleKind,
  VehicleRole,
  VehicleSnapshot,
} from '../types/game';
import {
  clamp,
  normalizeAngle,
  resolveCircleWorldCollision,
} from './physics';

export interface SimVehicle {
  id: string;
  kind: VehicleKind;
  role: VehicleRole;
  x: number;
  y: number;
  z: number;
  heading: number;
  speedMps: number;
  steerAngle: number;
  isDrifting: boolean;
  isBoosting: boolean;
  nitro: number;
  sirenActive: boolean;
  colorHex: number;
  accentHex?: number;
  halfWidth: number;
  halfLength: number;
  routeId: string | null;
  waypointIndex: number;
  baseSpeedMps: number;
  patrolCenterX: number;
  patrolCenterZ: number;
  patrolAxisX: number;
  patrolAxisZ: number;
  patrolDirection: 1 | -1;
}

interface VehicleDimensions {
  readonly halfWidth: number;
  readonly halfLength: number;
}

const VEHICLE_DIMENSIONS: Readonly<Record<VehicleKind, VehicleDimensions>> = {
  banshee: { halfWidth: 1.05, halfLength: 2.35 },
  taxi: { halfWidth: 0.95, halfLength: 2.15 },
  mio_bus: { halfWidth: 1.3, halfLength: 4.4 },
  chiva: { halfWidth: 1.25, halfLength: 3.8 },
  police: { halfWidth: 1.0, halfLength: 2.3 },
};

const PLAYER_BANSHEE_COLOR = 0xff2e93;
const PLAYER_BANSHEE_ACCENT = 0xffb800;
const POLICE_BODY_COLOR = 0xf4f7fb;
const POLICE_STRIPE_COLOR = 0x16a34a;

const TRAFFIC_TURN_RATE = 3.2;
const TRAFFIC_ACCEL_MPS2 = 12;
const TRAFFIC_ARRIVAL_RADIUS = 3.2;

const POLICE_PATROL_SPEED_MPS = 9.5;
const POLICE_PATROL_HALF_SPAN = 18;
const POLICE_PURSUIT_SPEED_MPS = 31;
const POLICE_PURSUIT_ACCEL_MPS2 = 24;
const POLICE_PURSUIT_TURN_RATE = 3.5;

export function toVehicleSnapshot(vehicle: SimVehicle): VehicleSnapshot {
  return {
    id: vehicle.id,
    kind: vehicle.kind,
    role: vehicle.role,
    x: vehicle.x,
    y: vehicle.y,
    z: vehicle.z,
    heading: vehicle.heading,
    speedMps: vehicle.speedMps,
    speedKmh: Math.abs(vehicle.speedMps) * 3.6,
    steerAngle: vehicle.steerAngle,
    isDrifting: vehicle.isDrifting,
    isBoosting: vehicle.isBoosting,
    nitro: vehicle.nitro,
    sirenActive: vehicle.sirenActive,
    colorHex: vehicle.colorHex,
    accentHex: vehicle.accentHex,
    halfWidth: vehicle.halfWidth,
    halfLength: vehicle.halfLength,
  };
}

function createVehicleRecord(params: {
  id: string;
  kind: VehicleKind;
  role: VehicleRole;
  x: number;
  z: number;
  heading: number;
  colorHex: number;
  accentHex?: number;
  routeId?: string | null;
  waypointIndex?: number;
  baseSpeedMps?: number;
  nitro?: number;
}): SimVehicle {
  const dims = VEHICLE_DIMENSIONS[params.kind];
  return {
    id: params.id,
    kind: params.kind,
    role: params.role,
    x: params.x,
    y: getTerrainElevation(params.x, params.z),
    z: params.z,
    heading: normalizeAngle(params.heading),
    speedMps: 0,
    steerAngle: 0,
    isDrifting: false,
    isBoosting: false,
    nitro: params.nitro ?? 100,
    sirenActive: false,
    colorHex: params.colorHex,
    accentHex: params.accentHex,
    halfWidth: dims.halfWidth,
    halfLength: dims.halfLength,
    routeId: params.routeId ?? null,
    waypointIndex: params.waypointIndex ?? 0,
    baseSpeedMps: params.baseSpeedMps ?? 0,
    patrolCenterX: params.x,
    patrolCenterZ: params.z,
    patrolAxisX: Math.sin(params.heading),
    patrolAxisZ: Math.cos(params.heading),
    patrolDirection: 1,
  };
}

export function createInitialVehicles(
  map: CaliMapConfig = CALI_MAP,
): SimVehicle[] {
  const vehicles: SimVehicle[] = [];

  vehicles.push(
    createVehicleRecord({
      id: 'player_banshee',
      kind: 'banshee',
      role: 'player',
      x: map.playerCarSpawn.x,
      z: map.playerCarSpawn.z,
      heading: map.playerCarSpawn.heading,
      colorHex: PLAYER_BANSHEE_COLOR,
      accentHex: PLAYER_BANSHEE_ACCENT,
      nitro: 100,
    }),
  );

  for (const route of map.trafficRoutes) {
    const count = route.waypoints.length;
    if (count === 0) {
      continue;
    }

    const startIndices = [0, Math.floor(count / 2)];
    for (const [slot, rawStartIndex] of startIndices.entries()) {
      const startIndex = rawStartIndex % count;
      const nextIndex = (startIndex + 1) % count;
      const startPoint = route.waypoints[startIndex];
      const nextPoint = route.waypoints[nextIndex];
      if (!startPoint || !nextPoint) {
        continue;
      }
      const heading = Math.atan2(
        nextPoint.x - startPoint.x,
        nextPoint.z - startPoint.z,
      );

      const trafficVehicle = createVehicleRecord({
        id: `traffic_${route.id}_${slot}`,
        kind: route.vehicleKind,
        role: 'traffic',
        x: startPoint.x,
        z: startPoint.z,
        heading,
        colorHex: route.colorHex,
        accentHex: route.accentHex,
        routeId: route.id,
        waypointIndex: nextIndex,
        baseSpeedMps: route.speedMps,
        nitro: 0,
      });
      trafficVehicle.speedMps = route.speedMps * 0.7;
      vehicles.push(trafficVehicle);
    }
  }

  for (const [i, spawn] of map.policeSpawns.entries()) {
    vehicles.push(
      createVehicleRecord({
        id: `police_${i}`,
        kind: 'police',
        role: 'police',
        x: spawn.x,
        z: spawn.z,
        heading: spawn.heading,
        colorHex: POLICE_BODY_COLOR,
        accentHex: POLICE_STRIPE_COLOR,
        baseSpeedMps: POLICE_PURSUIT_SPEED_MPS,
        nitro: 100,
      }),
    );
  }

  return vehicles;
}

function getBridgeCenterZ(bridge: BridgeSpan): number {
  if (bridge.id === 'puente_ermita') {
    return -24;
  }
  return (bridge.minZ + bridge.maxZ) * 0.5;
}

function computePolicePursuitGoal(
  police: SimVehicle,
  targetX: number,
  targetZ: number,
  map: CaliMapConfig,
): Vec2 {
  const { river } = map;
  const riverMidX = (river.minX + river.maxX) * 0.5;
  const needsEastCrossing = police.x < riverMidX && targetX > river.maxX;
  const needsWestCrossing = police.x > riverMidX && targetX < river.minX;

  if (!needsEastCrossing && !needsWestCrossing) {
    return { x: targetX, z: targetZ };
  }

  if (river.bridges.length === 0) {
    return { x: targetX, z: targetZ };
  }

  let bestBridge: BridgeSpan | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const bridge of river.bridges) {
    const bridgeZ = getBridgeCenterZ(bridge);
    const score =
      Math.abs(police.z - bridgeZ) + Math.abs(targetZ - bridgeZ) * 0.4;
    if (score < bestScore) {
      bestScore = score;
      bestBridge = bridge;
    }
  }

  if (!bestBridge) {
    return { x: targetX, z: targetZ };
  }

  const bridgeZ = getBridgeCenterZ(bestBridge);
  if (Math.abs(police.z - bridgeZ) > 6) {
    const approachX = needsEastCrossing ? river.minX - 6 : river.maxX + 6;
    return { x: approachX, z: bridgeZ };
  }

  const exitX = needsEastCrossing ? river.maxX + 8 : river.minX - 8;
  return { x: exitX, z: bridgeZ };
}

function steerAroundObstacles(
  vehicle: SimVehicle,
  desiredHeading: number,
  collisionRadius: number,
  map: CaliMapConfig,
): number {
  const probeDist = 5.5;
  const aheadX = vehicle.x + Math.sin(desiredHeading) * probeDist;
  const aheadZ = vehicle.z + Math.cos(desiredHeading) * probeDist;
  const directCheck = resolveCircleWorldCollision(
    aheadX,
    aheadZ,
    collisionRadius,
    map,
  );
  if (!directCheck.collided) {
    return desiredHeading;
  }

  const feelerOffset = 0.65;
  const leftHeading = normalizeAngle(desiredHeading + feelerOffset);
  const rightHeading = normalizeAngle(desiredHeading - feelerOffset);

  const leftCheck = resolveCircleWorldCollision(
    vehicle.x + Math.sin(leftHeading) * probeDist,
    vehicle.z + Math.cos(leftHeading) * probeDist,
    collisionRadius,
    map,
  );
  const rightCheck = resolveCircleWorldCollision(
    vehicle.x + Math.sin(rightHeading) * probeDist,
    vehicle.z + Math.cos(rightHeading) * probeDist,
    collisionRadius,
    map,
  );

  if (!leftCheck.collided && rightCheck.collided) {
    return leftHeading;
  }
  if (!rightCheck.collided && leftCheck.collided) {
    return rightHeading;
  }

  const leftClear = leftCheck.impactStrength <= rightCheck.impactStrength;
  return leftClear ? leftHeading : rightHeading;
}

function advanceAiVehicle(
  vehicle: SimVehicle,
  goalX: number,
  goalZ: number,
  desiredSpeedMps: number,
  accelMps2: number,
  turnRate: number,
  avoidObstacles: boolean,
  dt: number,
  map: CaliMapConfig,
): void {
  const collisionRadius = Math.max(vehicle.halfWidth, 1.25);
  const dx = goalX - vehicle.x;
  const dz = goalZ - vehicle.z;
  const rawHeading = Math.atan2(dx, dz);
  const targetHeading = avoidObstacles
    ? steerAroundObstacles(vehicle, rawHeading, collisionRadius, map)
    : rawHeading;

  const headingDiff = normalizeAngle(targetHeading - vehicle.heading);
  const maxTurn = turnRate * dt;
  const turnStep = clamp(headingDiff, -maxTurn, maxTurn);
  vehicle.heading = normalizeAngle(vehicle.heading + turnStep);
  vehicle.steerAngle = clamp(headingDiff * 0.7, -0.45, 0.45);

  const cornerSlowdown = Math.abs(headingDiff) > 0.75 ? 0.65 : 1.0;
  const targetSpeed = desiredSpeedMps * cornerSlowdown;
  const speedDelta = targetSpeed - vehicle.speedMps;
  const maxSpeedChange = accelMps2 * dt;
  vehicle.speedMps += clamp(speedDelta, -maxSpeedChange, maxSpeedChange);

  const nextX = vehicle.x + Math.sin(vehicle.heading) * vehicle.speedMps * dt;
  const nextZ = vehicle.z + Math.cos(vehicle.heading) * vehicle.speedMps * dt;
  const collision = resolveCircleWorldCollision(
    nextX,
    nextZ,
    collisionRadius,
    map,
  );

  vehicle.x = collision.x;
  vehicle.z = collision.z;
  vehicle.y = getTerrainElevation(collision.x, collision.z);
  if (collision.collided) {
    vehicle.speedMps *= 0.65;
  }
}

export function stepTrafficVehicle(
  vehicle: SimVehicle,
  route: TrafficRoute,
  dt: number,
  map: CaliMapConfig = CALI_MAP,
): void {
  const safeDt = clamp(dt, 0, 0.1);
  if (safeDt <= 0 || route.waypoints.length === 0) {
    return;
  }

  let target = route.waypoints[vehicle.waypointIndex % route.waypoints.length];
  if (!target) {
    return;
  }
  if (
    Math.hypot(target.x - vehicle.x, target.z - vehicle.z) <
    TRAFFIC_ARRIVAL_RADIUS
  ) {
    vehicle.waypointIndex = (vehicle.waypointIndex + 1) % route.waypoints.length;
    target = route.waypoints[vehicle.waypointIndex];
    if (!target) {
      return;
    }
  }

  vehicle.isDrifting = false;
  vehicle.isBoosting = false;
  vehicle.sirenActive = false;

  advanceAiVehicle(
    vehicle,
    target.x,
    target.z,
    route.speedMps,
    TRAFFIC_ACCEL_MPS2,
    TRAFFIC_TURN_RATE,
    false,
    safeDt,
    map,
  );
}

export function stepPoliceVehicle(
  police: SimVehicle,
  targetX: number,
  targetZ: number,
  active: boolean,
  dt: number,
  map: CaliMapConfig = CALI_MAP,
): void {
  const safeDt = clamp(dt, 0, 0.1);
  police.sirenActive = active;
  police.isDrifting = false;
  police.isBoosting = false;

  if (safeDt <= 0) {
    return;
  }

  if (!active) {
    const goalX =
      police.patrolCenterX +
      police.patrolAxisX * POLICE_PATROL_HALF_SPAN * police.patrolDirection;
    const goalZ =
      police.patrolCenterZ +
      police.patrolAxisZ * POLICE_PATROL_HALF_SPAN * police.patrolDirection;

    if (Math.hypot(goalX - police.x, goalZ - police.z) < 3.0) {
      police.patrolDirection = police.patrolDirection === 1 ? -1 : 1;
    }

    const updatedGoalX =
      police.patrolCenterX +
      police.patrolAxisX * POLICE_PATROL_HALF_SPAN * police.patrolDirection;
    const updatedGoalZ =
      police.patrolCenterZ +
      police.patrolAxisZ * POLICE_PATROL_HALF_SPAN * police.patrolDirection;

    advanceAiVehicle(
      police,
      updatedGoalX,
      updatedGoalZ,
      POLICE_PATROL_SPEED_MPS,
      TRAFFIC_ACCEL_MPS2,
      TRAFFIC_TURN_RATE,
      true,
      safeDt,
      map,
    );
    return;
  }

  const goal = computePolicePursuitGoal(police, targetX, targetZ, map);
  const distToPlayer = Math.hypot(targetX - police.x, targetZ - police.z);
  let pursuitSpeed = police.baseSpeedMps || POLICE_PURSUIT_SPEED_MPS;
  if (distToPlayer < 3.0) {
    pursuitSpeed = 0;
  } else if (distToPlayer < 5.0) {
    pursuitSpeed = 5.5;
  } else if (distToPlayer < 12) {
    pursuitSpeed = 19;
  }

  advanceAiVehicle(
    police,
    goal.x,
    goal.z,
    pursuitSpeed,
    POLICE_PURSUIT_ACCEL_MPS2,
    POLICE_PURSUIT_TURN_RATE,
    true,
    safeDt,
    map,
  );
}
