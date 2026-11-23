/**
 * Headless mission autopilot: drives the REAL GameWorld + MissionDirector loop exactly like
 * GameApp.startMission / GameApp.stepPlayingFrame do, using only player inputs (no teleports,
 * no cheats). Used to prove every mission can actually be beaten under real physics, AABB
 * collisions, traffic, police pursuit, and timers.
 */

import { CALI_MAP, DEFAULT_GARAGE_CONFIG } from '../../src/config/caliMap';
import { MissionDirector, StorageAdapter, type StorageLike } from '../../src/missions/missionDirector';
import { GameWorld } from '../../src/simulation/gameWorld';
import { normalizeAngle, resolveCircleWorldCollision } from '../../src/simulation/physics';
import type {
  CaliMapConfig,
  InputState,
  MissionId,
  MissionSnapshot,
  ObjectiveSnapshot,
  PlayerCarKind,
  Vec2,
  VehicleSnapshot,
  WorldSnapshot,
} from '../../src/types/game';

export const AUTOPILOT_DT = 1 / 60;

export interface AutopilotOptions {
  readonly maxSimSeconds?: number;
  /**
   * Deterministic variation (the simulation itself has no RNG): seed N hesitates N*5 frames
   * before the first input and drives corners slightly more/less aggressively.
   */
  readonly seed?: number;
  /** Garaje car (defaults to the stock DEFAULT_GARAGE_CONFIG car). */
  readonly carKind?: PlayerCarKind;
  /** Overrides the seed-derived cornering style (used to probe the fastest believable time). */
  readonly speedScale?: number;
  readonly map?: CaliMapConfig;
  /** Optional per-frame probe for diagnostics. */
  readonly onFrame?: (
    world: WorldSnapshot,
    mission: MissionSnapshot,
    input: InputState,
    frame: number,
  ) => void;
}

export interface AutopilotResult {
  readonly missionId: MissionId;
  readonly completed: boolean;
  readonly finalMode: MissionSnapshot['mode'];
  readonly simSeconds: number;
  readonly missionElapsedSeconds: number;
  readonly lastCompletedTimeSeconds: number | null;
  readonly countdownRemainingSeconds: number | null;
  readonly racePosition: number | null;
  readonly failureReason: string | null;
  readonly lastStepIndex: number;
  readonly lastObjectiveId: string | null;
  readonly lastPosition: Vec2;
  readonly maxWantedStars: number;
  /** Largest per-frame player displacement while the player mode was unchanged (teleport guard). */
  readonly maxFrameStepMeters: number;
  /** Landmarks discovered during this run. */
  readonly discoveredLandmarkCount: number;
  readonly stuckRecoveries: number;
}

const IDLE: InputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  boost: false,
  interactPressed: false,
  hornPressed: false,
};

function memoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Point on the GPS polyline `lookahead` metres ahead of the player (route[0] ~ player). */
function pickRouteTarget(route: readonly Vec2[], from: Vec2, lookahead: number): Vec2 {
  let remaining = lookahead;
  let prev = from;
  for (let i = 1; i < route.length; i += 1) {
    const next = route[i]!;
    const seg = dist(prev, next);
    if (seg >= remaining) {
      const t = remaining / Math.max(seg, 1e-6);
      return { x: prev.x + (next.x - prev.x) * t, z: prev.z + (next.z - prev.z) * t };
    }
    remaining -= seg;
    prev = next;
  }
  return route[route.length - 1] ?? from;
}

/** Sharpest heading change along the route within `horizon` metres ahead (radians). */
function upcomingTurnSharpness(route: readonly Vec2[], from: Vec2, horizon: number): number {
  let travelled = 0;
  let prev = from;
  let prevHeading: number | null = null;
  let sharpest = 0;
  for (let i = 1; i < route.length && travelled < horizon; i += 1) {
    const next = route[i]!;
    const seg = dist(prev, next);
    if (seg < 1) {
      continue;
    }
    const heading = Math.atan2(next.x - prev.x, next.z - prev.z);
    if (prevHeading !== null) {
      sharpest = Math.max(sharpest, Math.abs(normalizeAngle(heading - prevHeading)));
    }
    prevHeading = heading;
    travelled += seg;
    prev = next;
  }
  return sharpest;
}

class AutopilotPolicy {
  /** Cornering-speed style multiplier: different seeds model more or less daring drivers. */
  private readonly speedScale: number;
  private interactLatch = false;
  private stuckSeconds = 0;
  private recoverSeconds = 0;
  private recoverSteerLeft = true;
  private exitedVehicleForOnFoot = false;
  private readonly trail: { x: number; z: number; dt: number }[] = [];
  private escapeAttempts = 0;
  private escapeQueue: { seconds: number; readonly input: InputState | 'punch' }[] = [];
  public stuckRecoveries = 0;

  private readonly map: CaliMapConfig;
  private wallProbeFrame = 0;
  private wallProbeCached = false;

  public constructor(map: CaliMapConfig, speedScale = 1) {
    this.map = map;
    this.speedScale = speedScale;
  }

  public decide(world: WorldSnapshot, mission: MissionSnapshot, dt: number): InputState {
    const objective = mission.activeObjective;
    const player = world.player;
    const here: Vec2 = { x: player.x, z: player.z };

    // Release the interact key every other frame: world.step only reacts to the press edge.
    if (this.interactLatch) {
      this.interactLatch = false;
      return IDLE;
    }

    if (!objective || !objective.target) {
      return IDLE;
    }

    if (player.mode === 'driving' && objective.requiresOnFoot === true && !this.exitedVehicleForOnFoot) {
      if (Math.abs(player.speedMps) < 2) {
        this.exitedVehicleForOnFoot = true;
        return this.pressInteract();
      }
      return { ...IDLE, backward: player.speedMps > 0, forward: player.speedMps < 0 };
    }

    if (player.mode === 'on_foot') {
      const needsVehicle =
        objective.kind === 'enter_vehicle' ||
        (objective.requiresOnFoot !== true && dist(here, objective.target) > 45);
      if (needsVehicle) {
        const car = this.pickVehicle(world, objective);
        if (car) {
          if (player.canEnterVehicle && (player.nearbyVehicleId === car.id || objective.kind !== 'enter_vehicle')) {
            return this.pressInteract();
          }
          return this.walkToward(world, { x: car.x, z: car.z }, dt);
        }
      }
      return this.walkToward(world, this.routeTarget(objective, here, 3), dt);
    }

    return this.drive(world, objective, dt);
  }

  private pressInteract(): InputState {
    this.interactLatch = true;
    return { ...IDLE, interactPressed: true };
  }

  private pickVehicle(world: WorldSnapshot, objective: ObjectiveSnapshot): VehicleSnapshot | null {
    const here: Vec2 = { x: world.player.x, z: world.player.z };
    const own = world.vehicles.find((v) => v.role === 'player') ?? null;
    if (objective.kind === 'enter_vehicle') {
      return own;
    }
    if (own && dist(here, own) < 80) {
      return own;
    }
    let best: VehicleSnapshot | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const vehicle of world.vehicles) {
      if (vehicle.role === 'police' || vehicle.role === 'racer' || vehicle.kind === 'mio_bus' || vehicle.kind === 'chiva') {
        continue;
      }
      const d = dist(here, vehicle);
      if (d < bestDist) {
        best = vehicle;
        bestDist = d;
      }
    }
    return best;
  }

  private routeTarget(objective: ObjectiveSnapshot, here: Vec2, lookahead: number): Vec2 {
    const target = objective.target!;
    const route = objective.gpsRoute;
    if (!route || route.length < 2 || dist(here, target) < lookahead) {
      return target;
    }
    return pickRouteTarget(route, here, lookahead);
  }

  private steerToward(heading: number, here: Vec2, aim: Vec2): number {
    return normalizeAngle(Math.atan2(aim.x - here.x, aim.z - here.z) - heading);
  }

  private walkToward(world: WorldSnapshot, aim: Vec2, dt: number): InputState {
    const player = world.player;
    const here: Vec2 = { x: player.x, z: player.z };
    const delta = this.steerToward(player.heading, here, aim);
    const recovering = this.trackStuck(Math.abs(player.speedMps) < 0.5 && Math.abs(delta) < 0.6, dt, 0.6);
    if (recovering) {
      return { ...IDLE, backward: true, left: this.recoverSteerLeft, right: !this.recoverSteerLeft };
    }
    return {
      ...IDLE,
      forward: Math.abs(delta) < 1.2,
      boost: true,
      left: delta > 0.04,
      right: delta < -0.04,
    };
  }

  private drive(world: WorldSnapshot, objective: ObjectiveSnapshot, dt: number): InputState {
    const player = world.player;
    const here: Vec2 = { x: player.x, z: player.z };
    const speed = player.speedMps;
    const lookahead = Math.max(7, Math.min(22, Math.abs(speed) * 0.7));
    const aim = this.routeTarget(objective, here, lookahead);
    let delta = this.steerToward(player.heading, here, aim);

    // Wall/vehicle stall beats everything else: back out with a turn.
    const recovering = this.trackStuck(this.isStalled(here, speed, dt), dt, 0.9);
    if (recovering) {
      this.escapeQueue = [];
      return { ...IDLE, backward: true, left: this.recoverSteerLeft, right: !this.recoverSteerLeft };
    }

    // Police pinning us at low speed fills the bust meter: break contact first.
    const escape = this.policeEscape(world, speed, dt);
    if (escape === 'punch') {
      return { ...IDLE, forward: true, boost: player.nitro > 1, left: delta > 0.03, right: delta < -0.03 };
    }
    if (escape) {
      return escape;
    }

    // Swerve around a vehicle in our lane ahead (police, traffic, rivals) by shifting the aim
    // point sideways a lane width, so the dodge stays on the road.
    const avoidance = this.avoidanceSteer(world, speed);
    if (avoidance !== 0) {
      const leftX = Math.cos(player.heading);
      const leftZ = -Math.sin(player.heading);
      const shifted = { x: aim.x + leftX * avoidance * 4, z: aim.z + leftZ * avoidance * 4 };
      delta = this.steerToward(player.heading, here, shifted);
    }

    // A wall inside our stopping distance (e.g. a landmark building at a tour target): brake.
    if (speed > 8 && this.wallAhead(world, speed)) {
      return { ...IDLE, backward: true, left: delta > 0.03, right: delta < -0.03 };
    }

    // Target behind us at speed: brake in a straight line first, then turn around.
    if (Math.abs(delta) > 1.6 && speed > 9) {
      return { ...IDLE, backward: true };
    }

    const route = objective.gpsRoute ?? [];
    const sharpness = Math.max(Math.abs(delta), upcomingTurnSharpness(route, here, Math.max(25, speed * 1.6)));
    const baseTarget = sharpness > 1.2 ? 11 : sharpness > 0.7 ? 16 : sharpness > 0.35 ? 24 : 60;
    const targetSpeed = baseTarget * this.speedScale;
    const tooFast = speed > targetSpeed + 3;
    const straight = Math.abs(delta) < 0.12 && sharpness < 0.2;

    return {
      ...IDLE,
      forward: !tooFast,
      backward: tooFast && speed > targetSpeed + 8,
      boost: straight && !tooFast && player.nitro > 5,
      left: delta > 0.03,
      right: delta < -0.03,
    };
  }

  private wallAhead(world: WorldSnapshot, speed: number): boolean {
    this.wallProbeFrame += 1;
    if (this.wallProbeFrame % 3 !== 0) {
      return this.wallProbeCached;
    }
    const player = world.player;
    const fwdX = Math.sin(player.heading);
    const fwdZ = Math.cos(player.heading);
    const stopDistance = (speed * speed) / (2 * 30) + 5;
    let hit = false;
    for (let d = 3; d <= stopDistance && !hit; d += 2) {
      const probe = resolveCircleWorldCollision(player.x + fwdX * d, player.z + fwdZ * d, 1.2, this.map);
      hit = probe.collided && !probe.inRiverHazard;
    }
    this.wallProbeCached = hit;
    return hit;
  }

  /** Returns a scripted input, 'punch' (full throttle along the route), or null. */
  private policeEscape(world: WorldSnapshot, speed: number, dt: number): InputState | 'punch' | null {
    const queued = this.nextEscape(dt);
    if (queued) {
      return queued;
    }
    if (world.wantedStars === 0 || Math.abs(speed) > 6 || world.bustProgress < 0.12) {
      return null;
    }
    const player = world.player;
    let nearest: VehicleSnapshot | null = null;
    let nearestDist = 7;
    for (const vehicle of world.vehicles) {
      const d = Math.hypot(vehicle.x - player.x, vehicle.z - player.z);
      if (vehicle.role === 'police' && vehicle.id !== player.vehicleId && d < nearestDist) {
        nearest = vehicle;
        nearestDist = d;
      }
    }
    if (!nearest) {
      return null;
    }
    const fwdX = Math.sin(player.heading);
    const fwdZ = Math.cos(player.heading);
    const dx = nearest.x - player.x;
    const dz = nearest.z - player.z;
    const ahead = dx * fwdX + dz * fwdZ;
    const lateral = dx * fwdZ - dz * fwdX;
    this.escapeAttempts += 1;
    // Alternate the turn direction on repeated attempts in case one side is walled in.
    const flip = this.escapeAttempts % 2 === 0;
    const awayLeft = (lateral < 0) !== flip;
    this.escapeQueue =
      ahead > 0.5
        ? [
            // Cop in front: reverse out swinging the nose away, then floor it along the route.
            { seconds: 0.7, input: { ...IDLE, backward: true, left: !awayLeft, right: awayLeft } },
            { seconds: 1.0, input: 'punch' },
          ]
        : [{ seconds: 1.0, input: 'punch' }];
    return this.nextEscape(dt);
  }

  private nextEscape(dt: number): InputState | 'punch' | null {
    const head = this.escapeQueue[0];
    if (!head) {
      return null;
    }
    head.seconds -= dt;
    if (head.seconds <= 0) {
      this.escapeQueue.shift();
    }
    return head.input;
  }

  /** Stalled = commanded forward but covered under ~2.5 m over the last second. */
  private isStalled(here: Vec2, speed: number, dt: number): boolean {
    this.trail.push({ x: here.x, z: here.z, dt });
    let window = 0;
    let oldest = here;
    for (let i = this.trail.length - 1; i >= 0; i -= 1) {
      window += this.trail[i]!.dt;
      oldest = this.trail[i]!;
      if (window >= 1) {
        break;
      }
    }
    while (this.trail.length > 90) {
      this.trail.shift();
    }
    if (window < 1) {
      return Math.abs(speed) < 0.5 && this.trail.length > 30;
    }
    return dist(here, oldest) < 2.5;
  }

  /** Steering (+1 left / -1 right) to dodge the closest vehicle in a corridor ahead, else 0. */
  private avoidanceSteer(world: WorldSnapshot, speed: number): number {
    const player = world.player;
    const fwdX = Math.sin(player.heading);
    const fwdZ = Math.cos(player.heading);
    const reach = Math.max(8, speed * 0.9);
    let closest = Number.POSITIVE_INFINITY;
    let lateralOfClosest = 0;
    for (const vehicle of world.vehicles) {
      if (vehicle.id === player.vehicleId) {
        continue;
      }
      const dx = vehicle.x - player.x;
      const dz = vehicle.z - player.z;
      const ahead = dx * fwdX + dz * fwdZ;
      // Left of the heading: left = (cos h, -sin h).
      const lateral = dx * fwdZ - dz * fwdX;
      // Give police a wider berth: ramming a cruiser escalates the wanted level.
      const corridor = vehicle.role === 'police' ? 4.2 : 3.2;
      const reachFor = vehicle.role === 'police' ? reach * 1.4 : reach;
      if (ahead > 1 && ahead < reachFor && Math.abs(lateral) < corridor && ahead < closest) {
        closest = ahead;
        lateralOfClosest = lateral;
      }
    }
    if (!Number.isFinite(closest)) {
      return 0;
    }
    // Obstacle on our left (lateral > 0) -> steer right, and vice versa.
    return lateralOfClosest > 0 ? -1 : 1;
  }

  /** Returns true while a reverse-and-turn recovery manoeuvre is active. */
  private trackStuck(isStalled: boolean, dt: number, threshold: number): boolean {
    if (this.recoverSeconds > 0) {
      this.recoverSeconds -= dt;
      return true;
    }
    this.stuckSeconds = isStalled ? this.stuckSeconds + dt : 0;
    if (this.stuckSeconds > threshold) {
      this.stuckSeconds = 0;
      this.recoverSeconds = 1.1;
      this.recoverSteerLeft = !this.recoverSteerLeft;
      this.stuckRecoveries += 1;
      return true;
    }
    return false;
  }
}

/** Runs one mission start-to-finish with the autopilot, mirroring GameApp's frame pipeline. */
export function runMissionAutopilot(
  missionId: MissionId,
  options: AutopilotOptions & { readonly challengeRun?: boolean } = {},
): AutopilotResult {
  const map = options.map ?? CALI_MAP;
  const maxFrames = Math.round((options.maxSimSeconds ?? 600) / AUTOPILOT_DT);
  const world = new GameWorld(map);
  const director = new MissionDirector(map, new StorageAdapter(memoryStorage()));
  const garage = { ...DEFAULT_GARAGE_CONFIG, carKind: options.carKind ?? DEFAULT_GARAGE_CONFIG.carKind };
  const start = map.missionStarts[missionId];

  // GameApp.startMission
  world.reset({
    spawn: start.playerSpawn,
    carSpawn: start.carSpawn,
    startInVehicle: start.startInVehicle,
    wantedStars: start.initialWantedStars,
    playerCarKind: garage.carKind,
    playerPaintHex: garage.paintHex,
    playerNeonHex: garage.neonHex,
    enableRivals: missionId === 'mission_3_pique_bulevar',
  });
  let missionSnap = director.startMission(missionId, { challengeRun: options.challengeRun === true });
  let worldSnap = world.getSnapshot();

  const seed = options.seed ?? 0;
  const policy = new AutopilotPolicy(map, options.speedScale ?? 1 + (((seed * 7) % 5) - 2) * 0.05);
  let frames = 0;
  let maxWanted = 0;
  let maxFrameStep = 0;
  let lastStepIndex = missionSnap.activeObjective?.stepIndex ?? -1;
  let lastObjectiveId = missionSnap.activeObjective?.id ?? null;
  let lastRacePosition: number | null = null;
  let lastCountdown: number | null = null;
  const delayFrames = seed * 5;

  while (frames < maxFrames && missionSnap.mode === 'playing') {
    const input = frames < delayFrames ? IDLE : policy.decide(worldSnap, missionSnap, AUTOPILOT_DT);
    const prevMission = missionSnap;
    const prevPlayer = worldSnap.player;
    const prevObjectiveStep = prevMission.activeObjective?.stepIndex ?? -1;

    // GameApp.stepPlayingFrame
    worldSnap = world.step(AUTOPILOT_DT, input);
    missionSnap = director.update(worldSnap, AUTOPILOT_DT);
    const nextObjectiveStep = missionSnap.activeObjective?.stepIndex ?? -1;
    let worldMutated = false;
    if (
      missionSnap.mode === 'playing' &&
      missionSnap.activeMission === 'mission_2_cristo_rey' &&
      prevObjectiveStep >= 0 &&
      nextObjectiveStep > prevObjectiveStep
    ) {
      world.refillNitro();
      worldMutated = true;
    }
    if (
      missionSnap.mode === 'playing' &&
      missionSnap.activeMission === 'mission_3_pique_bulevar' &&
      missionSnap.activeObjective
    ) {
      world.setPlayerRaceProgress(missionSnap.activeObjective.stepIndex);
      worldMutated = true;
    }
    if (worldSnap.wantedStars !== missionSnap.targetWantedStars) {
      world.setWantedStars(missionSnap.targetWantedStars);
      worldMutated = true;
    }
    if (worldMutated) {
      worldSnap = world.getSnapshot();
    }

    options.onFrame?.(worldSnap, missionSnap, input, frames);
    frames += 1;
    maxWanted = Math.max(maxWanted, worldSnap.wantedStars);
    if (prevPlayer.mode === worldSnap.player.mode) {
      maxFrameStep = Math.max(
        maxFrameStep,
        Math.hypot(worldSnap.player.x - prevPlayer.x, worldSnap.player.z - prevPlayer.z),
      );
    }
    if (worldSnap.racePosition !== undefined && worldSnap.racePosition !== null) {
      lastRacePosition = worldSnap.racePosition;
    }
    if (missionSnap.isCountdown) {
      lastCountdown = missionSnap.timerSeconds;
    }
    if (missionSnap.activeObjective) {
      lastStepIndex = missionSnap.activeObjective.stepIndex;
      lastObjectiveId = missionSnap.activeObjective.id;
    }
  }

  const completed = missionSnap.mode === 'mission_passed' || missionSnap.mode === 'victory';
  return {
    missionId,
    completed,
    finalMode: missionSnap.mode,
    simSeconds: frames * AUTOPILOT_DT,
    missionElapsedSeconds: missionSnap.elapsedSeconds,
    lastCompletedTimeSeconds: missionSnap.lastCompletedTimeSeconds,
    countdownRemainingSeconds: lastCountdown,
    racePosition: lastRacePosition,
    failureReason: missionSnap.failureReason ?? (completed ? null : missionSnap.mode === 'playing' ? 'sim_timeout' : null),
    lastStepIndex,
    lastObjectiveId,
    lastPosition: { x: worldSnap.player.x, z: worldSnap.player.z },
    maxWantedStars: maxWanted,
    stuckRecoveries: policy.stuckRecoveries,
    maxFrameStepMeters: maxFrameStep,
    // Fresh in-memory storage per run, so lifetime discoveries == landmarks reached this run.
    discoveredLandmarkCount: missionSnap.discoveredLandmarks.length,
  };
}
