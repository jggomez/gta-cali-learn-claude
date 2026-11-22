/**
 * Headless Cali traffic and Police pursuit AI for GTA VI: Cali.
 * Zero Three.js or DOM dependencies.
 */

import {
  CALI_MAP,
  DEFAULT_GARAGE_CONFIG,
  getTerrainElevation,
} from '../config/caliMap';
import { computeGpsRoute } from '../config/roadGraph';
import type {
  BridgeSpan,
  CaliMapConfig,
  MissionWaypoint,
  PedestrianSnapshot,
  PlayerCarKind,
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
  neonHex?: number;
  airborneHeight: number;
  verticalVelocity: number;
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
  isHijackedByPlayer: boolean;
  racerSubWaypoints?: readonly Vec2[];
  racerSubIndex: number;
}

export interface SimPedestrian {
  id: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  speedMps: number;
  fleeing: boolean;
  fleeTimerSeconds: number;
  fleeHeading: number;
  shirtColorHex: number;
  pantsColorHex: number;
  patrolStartX: number;
  patrolStartZ: number;
  patrolEndX: number;
  patrolEndZ: number;
  patrolTargetEnd: boolean;
  walkSpeedMps: number;
}

export interface VehicleDimensions {
  readonly halfWidth: number;
  readonly halfLength: number;
}

export interface CreateInitialVehiclesOptions {
  readonly playerCarKind?: PlayerCarKind;
  readonly playerPaintHex?: number;
  readonly playerNeonHex?: number;
  readonly enableRivals?: boolean;
}

const VEHICLE_DIMENSIONS: Readonly<Record<VehicleKind, VehicleDimensions>> = {
  renault4_turbo: { halfWidth: 0.94, halfLength: 2.05 },
  spark_gt_turbo: { halfWidth: 0.92, halfLength: 1.98 },
  willys_v8: { halfWidth: 1.04, halfLength: 2.15 },
  banshee: { halfWidth: 1.05, halfLength: 2.35 },
  taxi: { halfWidth: 0.95, halfLength: 2.15 },
  mio_bus: { halfWidth: 1.3, halfLength: 4.4 },
  chiva: { halfWidth: 1.25, halfLength: 3.8 },
  police: { halfWidth: 1.0, halfLength: 2.3 },
};

export function getVehicleDimensions(kind: VehicleKind): VehicleDimensions {
  return VEHICLE_DIMENSIONS[kind];
}

const PLAYER_BANSHEE_ACCENT = 0xffb800;
const POLICE_BODY_COLOR = 0xf4f7fb;
const POLICE_STRIPE_COLOR = 0x16a34a;

const TRAFFIC_TURN_RATE = 3.2;
const TRAFFIC_ACCEL_MPS2 = 12;
const TRAFFIC_ARRIVAL_RADIUS = 3.2;

const RACER_ACCEL_MPS2 = 22;
const RACER_TURN_RATE = 3.8;
const RACER_SUBWAYPOINT_ARRIVAL_RADIUS = 6.5;
const RACER_FINISH_DECEL_MPS2 = 14;

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
    neonHex: vehicle.neonHex,
    airborneHeight: vehicle.airborneHeight,
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
  neonHex?: number;
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
    neonHex: params.neonHex,
    airborneHeight: 0,
    verticalVelocity: 0,
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
    isHijackedByPlayer: false,
    racerSubIndex: 0,
  };
}

export function createInitialVehicles(
  map: CaliMapConfig = CALI_MAP,
  options?: CreateInitialVehiclesOptions,
): SimVehicle[] {
  const vehicles: SimVehicle[] = [];
  const playerCarKind = options?.playerCarKind ?? DEFAULT_GARAGE_CONFIG.carKind;
  const playerPaintHex = options?.playerPaintHex ?? DEFAULT_GARAGE_CONFIG.paintHex;
  const playerNeonHex = options?.playerNeonHex ?? DEFAULT_GARAGE_CONFIG.neonHex;

  vehicles.push(
    createVehicleRecord({
      id: 'player_banshee',
      kind: playerCarKind,
      role: 'player',
      x: map.playerCarSpawn.x,
      z: map.playerCarSpawn.z,
      heading: map.playerCarSpawn.heading,
      colorHex: playerPaintHex,
      accentHex: PLAYER_BANSHEE_ACCENT,
      neonHex: playerNeonHex,
      nitro: 100,
    }),
  );

  if (options?.enableRivals) {
    vehicles.push(
      createVehicleRecord({
        id: 'rival_spark_gt',
        kind: 'spark_gt_turbo',
        role: 'racer',
        x: -7,
        z: 57,
        heading: Math.PI,
        colorHex: 0x00f0ff,
        accentHex: 0x111827,
        neonHex: 0xff2e93,
        waypointIndex: 0,
        baseSpeedMps: 27,
        nitro: 100,
      }),
      createVehicleRecord({
        id: 'rival_willys_v8',
        kind: 'willys_v8',
        role: 'racer',
        x: -1,
        z: 55,
        heading: Math.PI,
        colorHex: 0xf59e0b,
        accentHex: 0x1e293b,
        neonHex: 0x00e699,
        waypointIndex: 0,
        baseSpeedMps: 25.5,
        nitro: 100,
      }),
    );
  }

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
  if (safeDt <= 0 || vehicle.isHijackedByPlayer || route.waypoints.length === 0) {
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
  if (police.isHijackedByPlayer) {
    police.sirenActive = false;
    return;
  }
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

export function stepRacerVehicle(
  racer: SimVehicle,
  checkpoints: readonly MissionWaypoint[],
  dt: number,
  map: CaliMapConfig = CALI_MAP,
): void {
  const safeDt = clamp(dt, 0, 0.1);
  if (safeDt <= 0 || racer.isHijackedByPlayer || checkpoints.length === 0) {
    return;
  }

  racer.sirenActive = false;

  if (racer.waypointIndex >= checkpoints.length) {
    racer.isDrifting = false;
    racer.isBoosting = false;
    const decel = RACER_FINISH_DECEL_MPS2 * safeDt;
    racer.speedMps =
      Math.abs(racer.speedMps) <= decel
        ? 0
        : racer.speedMps - Math.sign(racer.speedMps) * decel;
    if (Math.abs(racer.speedMps) > 0.05) {
      const nextX = racer.x + Math.sin(racer.heading) * racer.speedMps * safeDt;
      const nextZ = racer.z + Math.cos(racer.heading) * racer.speedMps * safeDt;
      const col = resolveCircleWorldCollision(
        nextX,
        nextZ,
        Math.max(racer.halfWidth, 1.25),
        map,
      );
      racer.x = col.x;
      racer.z = col.z;
      racer.y = getTerrainElevation(col.x, col.z);
    }
    return;
  }

  let checkpoint = checkpoints[racer.waypointIndex];
  if (!checkpoint) {
    return;
  }

  const arrivalRadius = Math.max(checkpoint.radius * 0.75, 8);
  if (Math.hypot(checkpoint.x - racer.x, checkpoint.z - racer.z) <= arrivalRadius) {
    racer.waypointIndex += 1;
    racer.racerSubWaypoints = undefined;
    racer.racerSubIndex = 0;
    if (racer.waypointIndex >= checkpoints.length) {
      return;
    }
    checkpoint = checkpoints[racer.waypointIndex];
    if (!checkpoint) {
      return;
    }
  }

  if (!racer.racerSubWaypoints || racer.racerSubWaypoints.length === 0) {
    const route = computeGpsRoute(
      { x: racer.x, z: racer.z },
      { x: checkpoint.x, z: checkpoint.z },
      map,
    );
    racer.racerSubWaypoints =
      route.length > 1 ? route.slice(1) : [{ x: checkpoint.x, z: checkpoint.z }];
    racer.racerSubIndex = 0;
  }

  while (
    racer.racerSubIndex < racer.racerSubWaypoints.length - 1 &&
    Math.hypot(
      (racer.racerSubWaypoints[racer.racerSubIndex]?.x ?? checkpoint.x) - racer.x,
      (racer.racerSubWaypoints[racer.racerSubIndex]?.z ?? checkpoint.z) - racer.z,
    ) <= RACER_SUBWAYPOINT_ARRIVAL_RADIUS
  ) {
    racer.racerSubIndex += 1;
  }

  const goal =
    racer.racerSubWaypoints[racer.racerSubIndex] ?? {
      x: checkpoint.x,
      z: checkpoint.z,
    };

  const targetAngle = Math.atan2(goal.x - racer.x, goal.z - racer.z);
  const headingDiff = Math.abs(normalizeAngle(targetAngle - racer.heading));
  const isCornering = headingDiff > 0.65;
  racer.isDrifting = isCornering && Math.abs(racer.speedMps) > 12;
  racer.isBoosting = !isCornering && racer.speedMps > racer.baseSpeedMps * 0.85;

  advanceAiVehicle(
    racer,
    goal.x,
    goal.z,
    racer.baseSpeedMps || 26,
    RACER_ACCEL_MPS2,
    RACER_TURN_RATE,
    true,
    safeDt,
    map,
  );
}

interface PedestrianCorridorDef {
  readonly id: string;
  readonly startX: number;
  readonly startZ: number;
  readonly endX: number;
  readonly endZ: number;
  readonly initialFraction: number;
  readonly walkSpeedMps: number;
}

const PEDESTRIAN_COLLISION_RADIUS = 0.45;
const PEDESTRIAN_THREAT_SPEED_MPS = 8.0;
const PEDESTRIAN_THREAT_RADIUS_METERS = 9.5;
const PEDESTRIAN_HORN_SCARE_RADIUS_METERS = 18;
const PEDESTRIAN_HORN_FLEE_DURATION_SECONDS = 3.6;
const PEDESTRIAN_FLEE_SPEED_MPS = 4.6;
const PEDESTRIAN_FLEE_DURATION_SECONDS = 2.5;
const PEDESTRIAN_WAYPOINT_RADIUS = 1.1;
const PEDESTRIAN_PLAYER_AVOID_RADIUS = 1.25;

const CALI_SHIRT_PALETTE: readonly number[] = [
  0xff5e7e, // hibiscus coral
  0xffb800, // mango gold
  0x00d2d3, // tropical turquoise
  0xf8fafc, // crisp Cali linen
  0xe63946, // salsa red
  0x10b981, // palm emerald
  0xf97316, // sunset tangerine
  0x9b5de5, // vice violet
  0xff2e93, // neon pink
];

const CALI_PANTS_PALETTE: readonly number[] = [
  0x1e3a5f, // denim navy
  0x2b2d42, // charcoal
  0xd4a373, // khaki linen
  0x334155, // slate indigo
  0x3d2c2e, // espresso
  0x1d4e56, // deep teal
];

/**
 * 18 safe sidewalk patrol corridors across iconic Cali districts,
 * strictly outside all building colliders, solid landmarks, and Río Cali water.
 */
const PEDESTRIAN_CORRIDORS: readonly PedestrianCorridorDef[] = [
  // Barrio San Antonio sidewalks (z = 36 ± 8)
  { id: 'ped_san_antonio_0', startX: -86, startZ: 28, endX: -62, endZ: 28, initialFraction: 0.25, walkSpeedMps: 1.55 },
  { id: 'ped_san_antonio_1', startX: -56, startZ: 28, endX: -22, endZ: 28, initialFraction: 0.5, walkSpeedMps: 1.65 },
  { id: 'ped_san_antonio_2', startX: -84, startZ: 44, endX: -58, endZ: 44, initialFraction: 0.35, walkSpeedMps: 1.6 },
  { id: 'ped_san_antonio_3', startX: -52, startZ: 44, endX: -20, endZ: 44, initialFraction: 0.65, walkSpeedMps: 1.7 },

  // Bulevar del Río promenade (x = 12, x = -12)
  { id: 'ped_bulevar_0', startX: 12, startZ: -8, endX: 12, endZ: 24, initialFraction: 0.3, walkSpeedMps: 1.55 },
  { id: 'ped_bulevar_1', startX: 12, startZ: 28, endX: 12, endZ: 60, initialFraction: 0.6, walkSpeedMps: 1.65 },
  { id: 'ped_bulevar_2', startX: -12, startZ: -10, endX: -12, endZ: 24, initialFraction: 0.4, walkSpeedMps: 1.6 },
  { id: 'ped_bulevar_3', startX: -12, startZ: 42, endX: -12, endZ: 66, initialFraction: 0.5, walkSpeedMps: 1.55 },

  // Iglesia La Ermita / Carrera 1 sidewalks (x = 58 ± 8, clear of church footprint)
  { id: 'ped_ermita_0', startX: 50, startZ: -56, endX: 50, endZ: -36, initialFraction: 0.4, walkSpeedMps: 1.6 },
  { id: 'ped_ermita_1', startX: 50, startZ: -8, endX: 50, endZ: 16, initialFraction: 0.5, walkSpeedMps: 1.7 },
  { id: 'ped_ermita_2', startX: 66, startZ: -60, endX: 66, endZ: -39, initialFraction: 0.3, walkSpeedMps: 1.55 },
  { id: 'ped_ermita_3', startX: 66, startZ: -8, endX: 66, endZ: 18, initialFraction: 0.6, walkSpeedMps: 1.65 },

  // Avenida Colombia sidewalks (x = -4 ± 9)
  { id: 'ped_colombia_0', startX: -13, startZ: -96, endX: -13, endZ: -44, initialFraction: 0.35, walkSpeedMps: 1.65 },
  { id: 'ped_colombia_1', startX: 5, startZ: -94, endX: 5, endZ: -42, initialFraction: 0.6, walkSpeedMps: 1.6 },
  { id: 'ped_colombia_2', startX: -13, startZ: 94, endX: -13, endZ: 144, initialFraction: 0.45, walkSpeedMps: 1.55 },

  // Estadio Pascual Guerrero / Calle 5 sidewalks (z = 77 ± 9)
  { id: 'ped_estadio_0', startX: 106, startZ: 68, endX: 158, endZ: 68, initialFraction: 0.3, walkSpeedMps: 1.6 },
  { id: 'ped_estadio_1', startX: 104, startZ: 86, endX: 134, endZ: 86, initialFraction: 0.5, walkSpeedMps: 1.7 },
  { id: 'ped_estadio_2', startX: 138, startZ: 86, endX: 166, endZ: 86, initialFraction: 0.4, walkSpeedMps: 1.6 },
];

export function toPedestrianSnapshot(ped: SimPedestrian): PedestrianSnapshot {
  return {
    id: ped.id,
    x: ped.x,
    y: ped.y,
    z: ped.z,
    heading: ped.heading,
    speedMps: ped.speedMps,
    fleeing: ped.fleeing,
    shirtColorHex: ped.shirtColorHex,
    pantsColorHex: ped.pantsColorHex,
  };
}

export function createInitialPedestrians(
  map: CaliMapConfig = CALI_MAP,
): SimPedestrian[] {
  return PEDESTRIAN_CORRIDORS.map((corridor, index) => {
    const rawX =
      corridor.startX + (corridor.endX - corridor.startX) * corridor.initialFraction;
    const rawZ =
      corridor.startZ + (corridor.endZ - corridor.startZ) * corridor.initialFraction;
    const safePos = resolveCircleWorldCollision(
      rawX,
      rawZ,
      PEDESTRIAN_COLLISION_RADIUS,
      map,
    );
    const patrolTargetEnd = index % 2 === 0;
    const targetX = patrolTargetEnd ? corridor.endX : corridor.startX;
    const targetZ = patrolTargetEnd ? corridor.endZ : corridor.startZ;
    const heading = normalizeAngle(
      Math.atan2(targetX - safePos.x, targetZ - safePos.z),
    );
    const shirtColorHex =
      CALI_SHIRT_PALETTE[index % CALI_SHIRT_PALETTE.length] ?? 0xff5e7e;
    const pantsColorHex =
      CALI_PANTS_PALETTE[index % CALI_PANTS_PALETTE.length] ?? 0x1e3a5f;

    return {
      id: corridor.id,
      x: safePos.x,
      y: getTerrainElevation(safePos.x, safePos.z),
      z: safePos.z,
      heading,
      speedMps: corridor.walkSpeedMps,
      fleeing: false,
      fleeTimerSeconds: 0,
      fleeHeading: heading,
      shirtColorHex,
      pantsColorHex,
      patrolStartX: corridor.startX,
      patrolStartZ: corridor.startZ,
      patrolEndX: corridor.endX,
      patrolEndZ: corridor.endZ,
      patrolTargetEnd,
      walkSpeedMps: corridor.walkSpeedMps,
    };
  });
}

function findNearestThreatVehicle(
  ped: SimPedestrian,
  vehicles: readonly SimVehicle[],
): SimVehicle | null {
  let closest: SimVehicle | null = null;
  let closestDistSq =
    PEDESTRIAN_THREAT_RADIUS_METERS * PEDESTRIAN_THREAT_RADIUS_METERS;

  for (const vehicle of vehicles) {
    if (Math.abs(vehicle.speedMps) <= PEDESTRIAN_THREAT_SPEED_MPS) {
      continue;
    }
    const dx = ped.x - vehicle.x;
    const dz = ped.z - vehicle.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < closestDistSq) {
      closestDistSq = distSq;
      closest = vehicle;
    }
  }
  return closest;
}

function computeLateralEscapeHeading(
  ped: SimPedestrian,
  threat: SimVehicle,
): number {
  const dx = ped.x - threat.x;
  const dz = ped.z - threat.z;
  const dist = Math.hypot(dx, dz);
  const awayX = dist > 1e-4 ? dx / dist : 1;
  const awayZ = dist > 1e-4 ? dz / dist : 0;

  const rightX = -Math.cos(threat.heading);
  const rightZ = Math.sin(threat.heading);
  const sideSign = dx * rightX + dz * rightZ >= 0 ? 1 : -1;

  const escapeX = rightX * sideSign * 0.65 + awayX * 0.35;
  const escapeZ = rightZ * sideSign * 0.65 + awayZ * 0.35;
  return normalizeAngle(Math.atan2(escapeX, escapeZ));
}

export function stepPedestrians(
  pedestrians: SimPedestrian[],
  vehicles: readonly SimVehicle[],
  playerX: number,
  playerZ: number,
  dt: number,
  map: CaliMapConfig = CALI_MAP,
  hornPressed = false,
): void {
  const safeDt = clamp(dt, 0, 0.1);
  if (safeDt <= 0) {
    return;
  }

  const hornRadiusSq =
    PEDESTRIAN_HORN_SCARE_RADIUS_METERS * PEDESTRIAN_HORN_SCARE_RADIUS_METERS;

  for (const ped of pedestrians) {
    if (hornPressed) {
      const dxHorn = ped.x - playerX;
      const dzHorn = ped.z - playerZ;
      if (dxHorn * dxHorn + dzHorn * dzHorn <= hornRadiusSq) {
        ped.fleeing = true;
        ped.fleeTimerSeconds = Math.max(
          ped.fleeTimerSeconds,
          PEDESTRIAN_HORN_FLEE_DURATION_SECONDS + safeDt,
        );
        const dist = Math.hypot(dxHorn, dzHorn);
        ped.fleeHeading =
          dist > 1e-4
            ? normalizeAngle(Math.atan2(dxHorn, dzHorn))
            : normalizeAngle(ped.heading + Math.PI);
      }
    }

    const threat = findNearestThreatVehicle(ped, vehicles);
    if (threat) {
      ped.fleeing = true;
      ped.fleeTimerSeconds = Math.max(
        ped.fleeTimerSeconds,
        PEDESTRIAN_FLEE_DURATION_SECONDS,
      );
      ped.fleeHeading = computeLateralEscapeHeading(ped, threat);
    }

    if (ped.fleeing) {
      ped.fleeTimerSeconds = Math.max(0, ped.fleeTimerSeconds - safeDt);
      ped.heading = ped.fleeHeading;
      ped.speedMps = PEDESTRIAN_FLEE_SPEED_MPS;

      const nextX = ped.x + Math.sin(ped.heading) * ped.speedMps * safeDt;
      const nextZ = ped.z + Math.cos(ped.heading) * ped.speedMps * safeDt;
      const col = resolveCircleWorldCollision(
        nextX,
        nextZ,
        PEDESTRIAN_COLLISION_RADIUS,
        map,
      );
      ped.x = col.x;
      ped.z = col.z;
      ped.y = getTerrainElevation(col.x, col.z);

      if (col.collided) {
        ped.fleeHeading = normalizeAngle(ped.fleeHeading + Math.PI * 0.5);
      }
      if (ped.fleeTimerSeconds <= 0 && !threat) {
        ped.fleeing = false;
        ped.speedMps = ped.walkSpeedMps;
      }
      continue;
    }

    let targetX = ped.patrolTargetEnd ? ped.patrolEndX : ped.patrolStartX;
    let targetZ = ped.patrolTargetEnd ? ped.patrolEndZ : ped.patrolStartZ;
    if (
      Math.hypot(targetX - ped.x, targetZ - ped.z) < PEDESTRIAN_WAYPOINT_RADIUS
    ) {
      ped.patrolTargetEnd = !ped.patrolTargetEnd;
      targetX = ped.patrolTargetEnd ? ped.patrolEndX : ped.patrolStartX;
      targetZ = ped.patrolTargetEnd ? ped.patrolEndZ : ped.patrolStartZ;
    }

    let walkHeading = normalizeAngle(
      Math.atan2(targetX - ped.x, targetZ - ped.z),
    );
    const dxPlayer = ped.x - playerX;
    const dzPlayer = ped.z - playerZ;
    if (
      dxPlayer * dxPlayer + dzPlayer * dzPlayer <
      PEDESTRIAN_PLAYER_AVOID_RADIUS * PEDESTRIAN_PLAYER_AVOID_RADIUS
    ) {
      const awayPlayer = Math.atan2(dxPlayer, dzPlayer);
      const diff = normalizeAngle(awayPlayer - walkHeading);
      walkHeading = normalizeAngle(walkHeading + clamp(diff, -0.35, 0.35));
    }

    ped.heading = walkHeading;
    ped.speedMps = ped.walkSpeedMps;

    const nextX = ped.x + Math.sin(ped.heading) * ped.speedMps * safeDt;
    const nextZ = ped.z + Math.cos(ped.heading) * ped.speedMps * safeDt;
    const col = resolveCircleWorldCollision(
      nextX,
      nextZ,
      PEDESTRIAN_COLLISION_RADIUS,
      map,
    );
    ped.x = col.x;
    ped.z = col.z;
    ped.y = getTerrainElevation(col.x, col.z);
  }
}
