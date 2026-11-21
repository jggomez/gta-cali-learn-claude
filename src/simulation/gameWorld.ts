/**
 * Pure headless GameWorld orchestrating player movement, vehicle enter/exit,
 * Cali ambient traffic, Police pursuit, and bust mechanics.
 * Zero Three.js or DOM dependencies.
 */

import {
  CALI_MAP,
  getDistrictAt,
  getTerrainElevation,
} from '../config/caliMap';
import type {
  CaliMapConfig,
  InputState,
  PlayerMode,
  PlayerSnapshot,
  SpawnPose,
  TrafficRoute,
  WantedLevel,
  WorldSnapshot,
} from '../types/game';
import {
  PLAYER_COLLISION_RADIUS,
  clamp,
  resolveCircleWorldCollision,
  stepOnFoot,
  stepPlayerVehicle,
} from './physics';
import {
  createInitialVehicles,
  stepPoliceVehicle,
  stepTrafficVehicle,
  toVehicleSnapshot,
  type SimVehicle,
} from './trafficAi';

export interface ResetWorldOptions {
  readonly startInVehicle?: boolean;
  readonly spawn?: SpawnPose;
  readonly wantedStars?: WantedLevel;
}

const VEHICLE_ENTER_RADIUS = 6.0;
const BUST_RANGE_METERS = 6.8;
const BUST_MAX_SPEED_KMH = 20;
const BUST_DURATION_SECONDS = 3.2;
const BUST_DECAY_PER_SECOND = 0.45;
const DRIFT_SCORE_MIN_KMH = 25;
const DRIFT_SCORE_MULTIPLIER = 2.5;
const UNOCCUPIED_COAST_DECEL_MPS2 = 16;

const ACTIVE_POLICE_BY_WANTED: Readonly<Record<WantedLevel, number>> = {
  0: 0,
  1: 1,
  2: 2,
  3: 4,
};

function distanceToVehicleExterior(
  px: number,
  pz: number,
  vehicle: SimVehicle,
): number {
  const fwdX = Math.sin(vehicle.heading);
  const fwdZ = Math.cos(vehicle.heading);
  const rightX = -fwdZ;
  const rightZ = fwdX;

  const dx = px - vehicle.x;
  const dz = pz - vehicle.z;
  const localFwd = dx * fwdX + dz * fwdZ;
  const localRight = dx * rightX + dz * rightZ;

  const clampedFwd = clamp(localFwd, -vehicle.halfLength, vehicle.halfLength);
  const clampedRight = clamp(localRight, -vehicle.halfWidth, vehicle.halfWidth);

  return Math.hypot(localFwd - clampedFwd, localRight - clampedRight);
}

export class GameWorld {
  private readonly map: CaliMapConfig;
  private readonly routeMap: ReadonlyMap<string, TrafficRoute>;

  private timeSeconds = 0;
  private playerMode: PlayerMode = 'on_foot';
  private playerX = 0;
  private playerY = 0;
  private playerZ = 0;
  private playerHeading = 0;
  private playerSpeedMps = 0;
  private activeVehicleId: string | null = null;
  private playerIsSprinting = false;
  private playerInRiverHazard = false;

  private vehicles: SimVehicle[] = [];
  private wantedStars: WantedLevel = 0;
  private bustProgress = 0;
  private isBusted = false;
  private driftScorePoints = 0;
  private topSpeedKmh = 0;
  private currentDistrict = '';
  private collisionImpact = 0;
  private prevInteractPressed = false;

  public constructor(map: CaliMapConfig = CALI_MAP) {
    this.map = map;
    this.routeMap = new Map(map.trafficRoutes.map((route) => [route.id, route]));
    this.reset();
  }

  public reset(options?: ResetWorldOptions): void {
    this.vehicles = createInitialVehicles(this.map);
    this.timeSeconds = 0;
    this.bustProgress = 0;
    this.isBusted = false;
    this.driftScorePoints = 0;
    this.topSpeedKmh = 0;
    this.collisionImpact = 0;
    this.prevInteractPressed = false;
    this.playerIsSprinting = false;
    this.playerInRiverHazard = false;
    this.wantedStars = options?.wantedStars ?? 0;

    const playerCar = this.vehicles.find((v) => v.role === 'player') ?? null;

    if (options?.startInVehicle && playerCar) {
      if (options.spawn) {
        playerCar.x = options.spawn.x;
        playerCar.z = options.spawn.z;
        playerCar.y = getTerrainElevation(options.spawn.x, options.spawn.z);
        playerCar.heading = options.spawn.heading;
      }
      this.playerMode = 'driving';
      this.activeVehicleId = playerCar.id;
      this.syncPlayerFromVehicle(playerCar);
    } else {
      const spawn = options?.spawn ?? this.map.playerStart;
      this.playerMode = 'on_foot';
      this.activeVehicleId = null;
      this.playerX = spawn.x;
      this.playerZ = spawn.z;
      this.playerY = getTerrainElevation(spawn.x, spawn.z);
      this.playerHeading = spawn.heading;
      this.playerSpeedMps = 0;
    }

    this.currentDistrict = getDistrictAt(this.playerX, this.playerZ);
    this.syncPoliceSirens();
  }

  public setWantedStars(stars: WantedLevel): void {
    this.wantedStars = stars;
    if (stars === 0) {
      this.bustProgress = 0;
    }
    this.syncPoliceSirens();
  }

  public step(dt: number, input: InputState): Readonly<WorldSnapshot> {
    const clampedDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.timeSeconds += clampedDt;
    this.collisionImpact = 0;

    const interactTriggered = input.interactPressed && !this.prevInteractPressed;
    this.prevInteractPressed = input.interactPressed;

    if (interactTriggered && !this.isBusted) {
      this.handleInteractToggle();
    }

    if (clampedDt > 0 && !this.isBusted) {
      this.stepPlayer(clampedDt, input);
      this.stepUnoccupiedPlayerCar(clampedDt);
      this.stepNpcVehicles(clampedDt);
      this.resolveVehicleToVehicleBumps();
      this.updateBustMechanic(clampedDt);
    } else if (clampedDt > 0) {
      this.syncPoliceSirens();
    }

    this.currentDistrict = getDistrictAt(this.playerX, this.playerZ);
    return this.getSnapshot();
  }

  public getSnapshot(): Readonly<WorldSnapshot> {
    const activeVehicle = this.getActiveVehicle();
    const playerCar = this.vehicles.find((v) => v.role === 'player') ?? null;
    const nearby =
      this.playerMode === 'on_foot' ? this.findEnterableVehicle() : null;

    const player: PlayerSnapshot = {
      mode: this.playerMode,
      x: this.playerX,
      y: this.playerY,
      z: this.playerZ,
      heading: this.playerHeading,
      speedMps: this.playerSpeedMps,
      speedKmh: Math.abs(this.playerSpeedMps) * 3.6,
      vehicleId: this.activeVehicleId,
      nearbyVehicleId: nearby?.id ?? null,
      canEnterVehicle: nearby !== null,
      nitro: activeVehicle?.nitro ?? playerCar?.nitro ?? 0,
      isDrifting: activeVehicle?.isDrifting ?? false,
      isBoosting: activeVehicle?.isBoosting ?? false,
      isSprinting: this.playerIsSprinting,
      inRiverHazard: this.playerInRiverHazard,
    };

    return {
      timeSeconds: this.timeSeconds,
      player,
      vehicles: this.vehicles.map(toVehicleSnapshot),
      wantedStars: this.wantedStars,
      bustProgress: this.bustProgress,
      isBusted: this.isBusted,
      driftScore: Math.round(this.driftScorePoints),
      topSpeedKmh: this.topSpeedKmh,
      currentDistrict: this.currentDistrict,
      collisionImpact: this.collisionImpact,
    };
  }

  private getActiveVehicle(): SimVehicle | null {
    if (!this.activeVehicleId) {
      return null;
    }
    return this.vehicles.find((v) => v.id === this.activeVehicleId) ?? null;
  }

  private syncPlayerFromVehicle(vehicle: SimVehicle): void {
    this.playerX = vehicle.x;
    this.playerY = vehicle.y;
    this.playerZ = vehicle.z;
    this.playerHeading = vehicle.heading;
    this.playerSpeedMps = vehicle.speedMps;
  }

  private findEnterableVehicle(): SimVehicle | null {
    let bestBanshee: SimVehicle | null = null;
    let bestBansheeDist = Number.POSITIVE_INFINITY;
    let nearestAny: SimVehicle | null = null;
    let nearestAnyDist = Number.POSITIVE_INFINITY;

    for (const vehicle of this.vehicles) {
      const dist = distanceToVehicleExterior(this.playerX, this.playerZ, vehicle);
      if (dist > VEHICLE_ENTER_RADIUS) {
        continue;
      }
      if (vehicle.kind === 'banshee' && dist < bestBansheeDist) {
        bestBanshee = vehicle;
        bestBansheeDist = dist;
      }
      if (dist < nearestAnyDist) {
        nearestAny = vehicle;
        nearestAnyDist = dist;
      }
    }

    return bestBanshee ?? nearestAny;
  }

  private handleInteractToggle(): void {
    if (this.playerMode === 'on_foot') {
      const target = this.findEnterableVehicle();
      if (!target) {
        return;
      }
      this.playerMode = 'driving';
      this.activeVehicleId = target.id;
      this.playerIsSprinting = false;
      this.syncPlayerFromVehicle(target);
      return;
    }

    const vehicle = this.getActiveVehicle();
    if (!vehicle) {
      this.playerMode = 'on_foot';
      this.activeVehicleId = null;
      return;
    }

    vehicle.isDrifting = false;
    vehicle.isBoosting = false;
    vehicle.speedMps *= 0.25;

    const exitPos = this.findSafeExitPosition(vehicle);
    this.playerMode = 'on_foot';
    this.activeVehicleId = null;
    this.playerX = exitPos.x;
    this.playerZ = exitPos.z;
    this.playerY = getTerrainElevation(exitPos.x, exitPos.z);
    this.playerHeading = vehicle.heading;
    this.playerSpeedMps = 0;
    this.playerIsSprinting = false;
    this.playerInRiverHazard = exitPos.inRiverHazard;
  }

  private findSafeExitPosition(vehicle: SimVehicle): {
    readonly x: number;
    readonly z: number;
    readonly inRiverHazard: boolean;
  } {
    const fwdX = Math.sin(vehicle.heading);
    const fwdZ = Math.cos(vehicle.heading);
    const leftX = fwdZ;
    const leftZ = -fwdX;
    const sideOffset = vehicle.halfWidth + 1.45;
    const rearOffset = vehicle.halfLength + 1.45;

    const primaryCandidate = {
      x: vehicle.x + leftX * sideOffset,
      z: vehicle.z + leftZ * sideOffset,
    };
    const candidates = [
      primaryCandidate,
      { x: vehicle.x - leftX * sideOffset, z: vehicle.z - leftZ * sideOffset },
      { x: vehicle.x - fwdX * rearOffset, z: vehicle.z - fwdZ * rearOffset },
    ];

    let fallback = resolveCircleWorldCollision(
      primaryCandidate.x,
      primaryCandidate.z,
      PLAYER_COLLISION_RADIUS,
      this.map,
    );

    for (const candidate of candidates) {
      const check = resolveCircleWorldCollision(
        candidate.x,
        candidate.z,
        PLAYER_COLLISION_RADIUS,
        this.map,
      );
      if (!check.collided && !check.inRiverHazard) {
        return { x: check.x, z: check.z, inRiverHazard: false };
      }
      if (!check.inRiverHazard && fallback.inRiverHazard) {
        fallback = check;
      }
    }

    return {
      x: fallback.x,
      z: fallback.z,
      inRiverHazard: fallback.inRiverHazard,
    };
  }

  private stepPlayer(dt: number, input: InputState): void {
    const activeVehicle = this.getActiveVehicle();
    if (this.playerMode === 'driving' && activeVehicle) {
      const result = stepPlayerVehicle(activeVehicle, input, dt, this.map);
      activeVehicle.x = result.x;
      activeVehicle.y = result.y;
      activeVehicle.z = result.z;
      activeVehicle.heading = result.heading;
      activeVehicle.speedMps = result.speedMps;
      activeVehicle.steerAngle = result.steerAngle;
      activeVehicle.nitro = result.nitro;
      activeVehicle.isDrifting = result.isDrifting;
      activeVehicle.isBoosting = result.isBoosting;

      this.syncPlayerFromVehicle(activeVehicle);
      this.playerIsSprinting = false;
      this.playerInRiverHazard = result.inRiverHazard;
      this.collisionImpact = result.collisionImpact;
      this.topSpeedKmh = Math.max(this.topSpeedKmh, result.speedKmh);

      if (result.isDrifting && result.speedKmh >= DRIFT_SCORE_MIN_KMH) {
        this.driftScorePoints +=
          result.speedKmh * dt * DRIFT_SCORE_MULTIPLIER;
      }
      return;
    }

    const footResult = stepOnFoot(
      {
        x: this.playerX,
        y: this.playerY,
        z: this.playerZ,
        heading: this.playerHeading,
      },
      input,
      dt,
      this.map,
    );

    this.playerX = footResult.x;
    this.playerY = footResult.y;
    this.playerZ = footResult.z;
    this.playerHeading = footResult.heading;
    this.playerSpeedMps = footResult.speedMps;
    this.playerIsSprinting = footResult.isSprinting;
    this.playerInRiverHazard = footResult.inRiverHazard;
    this.collisionImpact = footResult.collisionImpact;
    this.topSpeedKmh = Math.max(this.topSpeedKmh, footResult.speedKmh);
  }

  private stepUnoccupiedPlayerCar(dt: number): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.role !== 'player' || vehicle.id === this.activeVehicleId) {
        continue;
      }
      vehicle.isDrifting = false;
      vehicle.isBoosting = false;
      if (Math.abs(vehicle.speedMps) > 0.05) {
        const delta = UNOCCUPIED_COAST_DECEL_MPS2 * dt;
        vehicle.speedMps =
          Math.abs(vehicle.speedMps) <= delta
            ? 0
            : vehicle.speedMps - Math.sign(vehicle.speedMps) * delta;
        const nextX =
          vehicle.x + Math.sin(vehicle.heading) * vehicle.speedMps * dt;
        const nextZ =
          vehicle.z + Math.cos(vehicle.heading) * vehicle.speedMps * dt;
        const col = resolveCircleWorldCollision(
          nextX,
          nextZ,
          Math.max(vehicle.halfWidth, 1.35),
          this.map,
        );
        vehicle.x = col.x;
        vehicle.z = col.z;
        vehicle.y = getTerrainElevation(col.x, col.z);
        if (col.collided) {
          vehicle.speedMps = 0;
        }
      }
    }
  }

  private selectActivePoliceIds(): ReadonlySet<string> {
    const activeCount = ACTIVE_POLICE_BY_WANTED[this.wantedStars];
    if (activeCount <= 0) {
      return new Set<string>();
    }

    const candidates = this.vehicles
      .filter((v) => v.role === 'police' && v.id !== this.activeVehicleId)
      .map((v) => ({
        id: v.id,
        distSq:
          (v.x - this.playerX) * (v.x - this.playerX) +
          (v.z - this.playerZ) * (v.z - this.playerZ),
      }))
      .sort((a, b) => a.distSq - b.distSq);

    const activeIds = new Set<string>();
    for (const candidate of candidates.slice(0, activeCount)) {
      activeIds.add(candidate.id);
    }
    return activeIds;
  }

  private syncPoliceSirens(): void {
    const activeIds = this.selectActivePoliceIds();
    for (const vehicle of this.vehicles) {
      if (vehicle.role === 'police') {
        vehicle.sirenActive = activeIds.has(vehicle.id);
      }
    }
  }

  private stepNpcVehicles(dt: number): void {
    const activePoliceIds = this.selectActivePoliceIds();

    for (const vehicle of this.vehicles) {
      if (vehicle.id === this.activeVehicleId) {
        continue;
      }

      if (vehicle.role === 'traffic' && vehicle.routeId) {
        const route = this.routeMap.get(vehicle.routeId);
        if (route) {
          stepTrafficVehicle(vehicle, route, dt, this.map);
        }
      } else if (vehicle.role === 'police') {
        stepPoliceVehicle(
          vehicle,
          this.playerX,
          this.playerZ,
          activePoliceIds.has(vehicle.id),
          dt,
          this.map,
        );
      }
    }
  }

  private resolveVehicleToVehicleBumps(): void {
    const activeVehicle = this.getActiveVehicle();
    if (!activeVehicle) {
      return;
    }

    const playerRadius = Math.max(activeVehicle.halfWidth, 1.25);

    for (const other of this.vehicles) {
      if (other.id === activeVehicle.id) {
        continue;
      }
      const otherRadius = Math.max(other.halfWidth, 1.25);
      const minSep = playerRadius + otherRadius;
      const dx = activeVehicle.x - other.x;
      const dz = activeVehicle.z - other.z;
      const distSq = dx * dx + dz * dz;

      if (distSq >= minSep * minSep) {
        continue;
      }

      const dist = Math.sqrt(distSq);
      const nx = dist > 1e-4 ? dx / dist : 1;
      const nz = dist > 1e-4 ? dz / dist : 0;
      const overlap = minSep - dist;

      const playerCol = resolveCircleWorldCollision(
        activeVehicle.x + nx * overlap * 0.3,
        activeVehicle.z + nz * overlap * 0.3,
        playerRadius,
        this.map,
      );
      activeVehicle.x = playerCol.x;
      activeVehicle.z = playerCol.z;
      activeVehicle.y = getTerrainElevation(playerCol.x, playerCol.z);

      const otherCol = resolveCircleWorldCollision(
        other.x - nx * overlap * 0.7,
        other.z - nz * overlap * 0.7,
        otherRadius,
        this.map,
      );
      other.x = otherCol.x;
      other.z = otherCol.z;
      other.y = getTerrainElevation(otherCol.x, otherCol.z);

      const relSpeed = Math.abs(activeVehicle.speedMps - other.speedMps);
      const bumpImpact = clamp(relSpeed / 28, 0.2, 1);
      this.collisionImpact = Math.max(this.collisionImpact, bumpImpact);
      activeVehicle.speedMps *= 0.85;
      other.speedMps *= 0.5;
      this.syncPlayerFromVehicle(activeVehicle);
    }
  }

  private updateBustMechanic(dt: number): void {
    if (this.wantedStars === 0) {
      this.bustProgress = 0;
      return;
    }

    const playerSpeedKmh = Math.abs(this.playerSpeedMps) * 3.6;
    let policeInRange = false;

    for (const vehicle of this.vehicles) {
      if (
        vehicle.role !== 'police' ||
        !vehicle.sirenActive ||
        vehicle.id === this.activeVehicleId
      ) {
        continue;
      }
      const dist = Math.hypot(
        vehicle.x - this.playerX,
        vehicle.z - this.playerZ,
      );
      if (dist <= BUST_RANGE_METERS) {
        policeInRange = true;
        break;
      }
    }

    if (policeInRange && playerSpeedKmh < BUST_MAX_SPEED_KMH) {
      this.bustProgress = clamp(
        this.bustProgress + dt / BUST_DURATION_SECONDS,
        0,
        1,
      );
      if (this.bustProgress >= 1) {
        this.isBusted = true;
      }
    } else {
      this.bustProgress = clamp(
        this.bustProgress - dt * BUST_DECAY_PER_SECOND,
        0,
        1,
      );
    }
  }
}
