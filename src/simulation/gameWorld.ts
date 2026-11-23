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
  PlayerCarKind,
  PlayerMode,
  PlayerSnapshot,
  SpawnPose,
  TrafficLightPhase,
  TrafficRoute,
  WantedLevel,
  WorldSnapshot,
} from '../types/game';
import {
  PLAYER_COLLISION_RADIUS,
  STUNT_GRAVITY_MPS2,
  clamp,
  isVehicleOnStuntRamp,
  resolveCircleWorldCollision,
  resolveVehicleCollisionRadius,
  stepOnFoot,
  stepPlayerVehicle,
  stepVerticalMotion,
} from './physics';
import {
  createInitialPedestrians,
  createInitialVehicles,
  getVehicleDimensions,
  stepPedestrians,
  stepPoliceVehicle,
  stepRacerVehicle,
  stepTrafficVehicle,
  toPedestrianSnapshot,
  toVehicleSnapshot,
  type SimPedestrian,
  type SimVehicle,
} from './trafficAi';

export interface ResetWorldOptions {
  readonly startInVehicle?: boolean;
  readonly spawn?: SpawnPose;
  readonly carSpawn?: SpawnPose;
  readonly wantedStars?: WantedLevel;
  readonly playerCarKind?: PlayerCarKind;
  readonly playerPaintHex?: number;
  readonly playerNeonHex?: number;
  readonly enableRivals?: boolean;
}

const MAX_NITRO = 100;
const VEHICLE_BUMP_RADIUS_MIN = 1.25;
const VEHICLE_ENTRY_MIN_HALF_LENGTH = 1.8;
const TRAFFIC_LIGHT_CYCLE_SECONDS = 20;

const STUNT_JUMP_COOLDOWN_SECONDS = 4;
const STUNT_JUMP_NITRO_BONUS = 35;

const PAY_N_SPRAY_COOLDOWN_SECONDS = 6;
const CALI_RESPRAY_COLORS: readonly number[] = [
  0xe63946,
  0x10b981,
  0xff2e93,
  0xffc400,
  0x0284c7,
  0xf8fafc,
];

const DRIFT_COMBO_MIN_KMH = 28;
const DRIFT_COMBO_MAX_MULTIPLIER = 5;
const DRIFT_COMBO_STEP_SECONDS = 1.0;
const DRIFT_COMBO_COP_PER_KMH_SEC = 25;
const DRIFT_CASHOUT_GRACE_SECONDS = 1.4;
const DRIFT_MIN_CASHOUT_COP = 500;
const DRIFT_CRASH_CANCEL_IMPACT = 0.35;

const ROADBLOCK_COOLDOWN_SECONDS = 2.5;
const ROADBLOCK_SMASH_MIN_SPEED_MPS = 26;
const ROADBLOCK_SMASH_SPEED_FACTOR = 0.78;
const ROADBLOCK_SMASH_IMPACT = 0.45;
const ROADBLOCK_SLOW_SPEED_FACTOR = 0.42;
const ROADBLOCK_SLOW_IMPACT = 0.65;
const ROADBLOCK_CLEAR_AIRBORNE_METERS = 2.2;

export function computeTrafficLightPhase(timeSeconds: number): TrafficLightPhase {
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds >= 0 ? timeSeconds : 0;
  const phaseTime = safeTime % TRAFFIC_LIGHT_CYCLE_SECONDS;
  if (phaseTime < 8) {
    return 'ns_green';
  }
  if (phaseTime < 10) {
    return 'ns_yellow';
  }
  if (phaseTime < 18) {
    return 'ew_green';
  }
  return 'ew_yellow';
}

const VEHICLE_ENTER_RADIUS = 6.5;
const HIJACK_MIN_NITRO = 60;
const BUST_RANGE_METERS = 6.8;
const BUST_MAX_SPEED_KMH = 20;
const BUST_DURATION_SECONDS = 3.2;
const BUST_DECAY_PER_SECOND = 0.45;
const POLICE_RAM_DISTANCE_METERS = 4.2;
const POLICE_RAM_MIN_SPEED_MPS = 10;
const POLICE_RAM_MIN_APPROACH_MPS = 2.0;
const POLICE_RAM_COOLDOWN_SECONDS = 2.5;
const EVADE_CLEAR_DISTANCE_METERS = 58;
const EVADE_RESET_DISTANCE_METERS = 50;
const EVADE_DURATION_SECONDS = 12;
const EVADE_DECAY_PER_SECOND = 0.3;
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

  // Motos are short: pad their entry footprint so they are as easy to mount as a car
  const entryHalfLength = Math.max(vehicle.halfLength, VEHICLE_ENTRY_MIN_HALF_LENGTH);
  const clampedFwd = clamp(localFwd, -entryHalfLength, entryHalfLength);
  const clampedRight = clamp(localRight, -vehicle.halfWidth, vehicle.halfWidth);

  return Math.hypot(localFwd - clampedFwd, localRight - clampedRight);
}

/** Sampling period and depth of the `/rewind` history ring buffer. */
const REWIND_SAMPLE_SECONDS = 0.25;
const REWIND_HISTORY_SECONDS = 8;
const REWIND_MIN_SECONDS = 1;

interface RewindFrame {
  readonly t: number;
  readonly playerMode: PlayerMode;
  readonly playerX: number;
  readonly playerY: number;
  readonly playerZ: number;
  readonly playerHeading: number;
  readonly playerSpeedMps: number;
  readonly activeVehicleId: string | null;
  readonly vehicles: SimVehicle[];
  readonly pedestrians: SimPedestrian[];
  readonly bustProgress: number;
  readonly policeEvadeProgress: number;
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
  private pedestrians: SimPedestrian[] = [];
  private wantedStars: WantedLevel = 0;
  private bustProgress = 0;
  private policeEvadeProgress = 0;
  private policeRamCooldownSeconds = 0;
  private isBusted = false;
  private driftScorePoints = 0;
  private topSpeedKmh = 0;
  private currentDistrict = '';
  private collisionImpact = 0;
  private prevInteractPressed = false;

  private driftComboMultiplier = 1;
  private driftChainSeconds = 0;
  private driftRecoverySeconds = 0;
  private driftBankPendingCop = 0;
  private lastDriftCashoutCop = 0;

  private airborneSeconds = 0;
  private lastStuntJumpName: string | null = null;
  private lastStuntJumpCop = 0;
  private lastStuntJumpAt = 0;
  private stuntJumpCooldowns = new Map<string, number>();

  private lastPayNSprayAt = 0;
  private lastPayNSprayName: string | null = null;
  private payNSprayCooldowns = new Map<string, number>();
  private payNSprayRequested = false;

  private roadblockCooldowns = new Map<string, number>();
  private hornActive = false;
  private rivalsEnabled = false;
  private playerRaceCheckpointIndex = 0;
  private rewindHistory: RewindFrame[] = [];
  private bustHeld = false;
  private lastRewindSampleAt = Number.NEGATIVE_INFINITY;

  public constructor(map: CaliMapConfig = CALI_MAP) {
    this.map = map;
    this.routeMap = new Map(map.trafficRoutes.map((route) => [route.id, route]));
    this.reset();
  }

  public reset(options?: ResetWorldOptions): void {
    this.rewindHistory = [];
    this.lastRewindSampleAt = Number.NEGATIVE_INFINITY;
    this.bustHeld = false;
    this.vehicles = createInitialVehicles(this.map, {
      playerCarKind: options?.playerCarKind,
      playerPaintHex: options?.playerPaintHex,
      playerNeonHex: options?.playerNeonHex,
      enableRivals: options?.enableRivals,
    });
    this.pedestrians = createInitialPedestrians(this.map);
    this.timeSeconds = 0;
    this.bustProgress = 0;
    this.policeEvadeProgress = 0;
    this.policeRamCooldownSeconds = 0;
    this.isBusted = false;
    this.driftScorePoints = 0;
    this.topSpeedKmh = 0;
    this.collisionImpact = 0;
    this.prevInteractPressed = false;
    this.playerIsSprinting = false;
    this.playerInRiverHazard = false;
    this.wantedStars = options?.wantedStars ?? 0;

    this.driftComboMultiplier = 1;
    this.driftChainSeconds = 0;
    this.driftRecoverySeconds = 0;
    this.driftBankPendingCop = 0;
    this.lastDriftCashoutCop = 0;

    this.airborneSeconds = 0;
    this.lastStuntJumpName = null;
    this.lastStuntJumpCop = 0;
    this.lastStuntJumpAt = 0;
    this.stuntJumpCooldowns = new Map<string, number>();

    this.lastPayNSprayAt = 0;
    this.lastPayNSprayName = null;
    this.payNSprayCooldowns = new Map<string, number>();
    this.payNSprayRequested = false;

    this.roadblockCooldowns = new Map<string, number>();
    this.hornActive = false;
    this.rivalsEnabled = Boolean(options?.enableRivals);
    this.playerRaceCheckpointIndex = 0;

    const playerCar = this.vehicles.find((v) => v.role === 'player') ?? null;

    if (options?.startInVehicle && playerCar) {
      const carPose = options.carSpawn ?? options.spawn;
      if (carPose) {
        this.placeVehicleAt(playerCar, carPose);
      }
      this.playerMode = 'driving';
      this.activeVehicleId = playerCar.id;
      this.syncPlayerFromVehicle(playerCar);
    } else {
      if (playerCar && options?.carSpawn) {
        this.placeVehicleAt(playerCar, options.carSpawn);
      }
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

  public applyGarageCar(
    carKind: PlayerCarKind,
    paintHex: number,
    neonHex: number,
  ): void {
    const playerCar = this.vehicles.find((v) => v.id === 'player_banshee');
    if (!playerCar) {
      return;
    }
    const dims = getVehicleDimensions(carKind);
    playerCar.kind = carKind;
    playerCar.colorHex = paintHex;
    playerCar.neonHex = neonHex;
    playerCar.halfWidth = dims.halfWidth;
    playerCar.halfLength = dims.halfLength;
  }

  public setPlayerRaceProgress(checkpointIndex: number): void {
    const checkpoints = this.map.missionWaypoints.mission3Checkpoints ?? [];
    this.playerRaceCheckpointIndex = clamp(
      Math.floor(checkpointIndex),
      0,
      checkpoints.length,
    );
  }

  public requestPayNSpray(): void {
    this.payNSprayRequested = true;
  }

  /**
   * `/rewind` (named after the Claude Code command): restores the player, vehicles, pedestrians and
   * bust progress from about `seconds` ago. The clock and wanted level are kept, so it never buys
   * mission time. Returns false when there is not enough history yet.
   */
  public rewind(seconds: number): boolean {
    const target = this.timeSeconds - Math.max(0, seconds);
    let index = -1;
    for (let i = this.rewindHistory.length - 1; i >= 0; i -= 1) {
      if ((this.rewindHistory[i]?.t ?? Infinity) <= target) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      const oldest = this.rewindHistory[0];
      if (!oldest || this.timeSeconds - oldest.t < REWIND_MIN_SECONDS) {
        return false;
      }
      index = 0;
    }
    const frame = this.rewindHistory[index];
    if (!frame) return false;
    this.playerMode = frame.playerMode;
    this.playerX = frame.playerX;
    this.playerY = frame.playerY;
    this.playerZ = frame.playerZ;
    this.playerHeading = frame.playerHeading;
    this.playerSpeedMps = frame.playerSpeedMps;
    this.activeVehicleId = frame.activeVehicleId;
    this.vehicles = structuredClone(frame.vehicles);
    this.pedestrians = structuredClone(frame.pedestrians);
    this.bustProgress = frame.bustProgress;
    this.policeEvadeProgress = frame.policeEvadeProgress;
    this.isBusted = false;
    this.collisionImpact = 0;
    this.cancelDriftCombo();
    this.rewindHistory = this.rewindHistory.slice(0, index + 1);
    this.lastRewindSampleAt = this.timeSeconds;
    return true;
  }

  private sampleRewindHistory(): void {
    if (this.timeSeconds - this.lastRewindSampleAt < REWIND_SAMPLE_SECONDS) {
      return;
    }
    this.lastRewindSampleAt = this.timeSeconds;
    this.rewindHistory.push({
      t: this.timeSeconds,
      playerMode: this.playerMode,
      playerX: this.playerX,
      playerY: this.playerY,
      playerZ: this.playerZ,
      playerHeading: this.playerHeading,
      playerSpeedMps: this.playerSpeedMps,
      activeVehicleId: this.activeVehicleId,
      vehicles: structuredClone(this.vehicles),
      pedestrians: structuredClone(this.pedestrians),
      bustProgress: this.bustProgress,
      policeEvadeProgress: this.policeEvadeProgress,
    });
    const horizon = this.timeSeconds - REWIND_HISTORY_SECONDS;
    while ((this.rewindHistory[0]?.t ?? Infinity) < horizon) {
      this.rewindHistory.shift();
    }
  }

  /**
   * Police-hack terminal: while a question is open the arrest meter neither fills nor decays,
   * so answering can still save the player. The clock keeps running.
   */
  public setBustHold(held: boolean): void {
    this.bustHeld = held;
  }

  /** A correct police-hack answer shakes the cops off: the arrest meter resets. */
  public relieveBust(): void {
    if (!this.isBusted) {
      this.bustProgress = 0;
    }
  }

  public refillNitro(): void {
    const activeVehicle = this.getActiveVehicle();
    if (activeVehicle) {
      activeVehicle.nitro = MAX_NITRO;
    }
    const playerCar = this.vehicles.find((v) => v.role === 'player') ?? null;
    if (playerCar) {
      playerCar.nitro = MAX_NITRO;
    }
  }

  public setWantedStars(stars: WantedLevel): void {
    if (stars !== this.wantedStars) {
      this.policeEvadeProgress = 0;
    }
    this.wantedStars = stars;
    if (stars === 0) {
      this.bustProgress = 0;
      this.policeEvadeProgress = 0;
    }
    this.syncPoliceSirens();
  }

  public step(dt: number, input: InputState): Readonly<WorldSnapshot> {
    const clampedDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.timeSeconds += clampedDt;
    this.collisionImpact = 0;
    this.policeRamCooldownSeconds = Math.max(
      0,
      this.policeRamCooldownSeconds - clampedDt,
    );

    const interactTriggered = input.interactPressed && !this.prevInteractPressed;
    this.prevInteractPressed = input.interactPressed;
    this.hornActive = !this.isBusted && Boolean(input.hornPressed);

    if (interactTriggered && !this.isBusted) {
      this.handleInteractToggle();
    }

    if (clampedDt > 0 && !this.isBusted) {
      this.stepPlayer(clampedDt, input);
      this.stepUnoccupiedPlayerVehicles(clampedDt);
      this.stepNpcVehicles(clampedDt);
      stepPedestrians(
        this.pedestrians,
        this.vehicles,
        this.playerX,
        this.playerZ,
        clampedDt,
        this.map,
        this.hornActive,
      );
      this.checkPayNSprayZones(input);
      this.checkRoadblockZones();
      this.resolveVehicleToVehicleBumps();
      this.updateDriftCombo(clampedDt);
      this.updatePlayerRaceProgress();
      this.updateBustMechanic(clampedDt);
      this.updatePoliceEvasion(clampedDt);
    } else if (clampedDt > 0) {
      this.syncPoliceSirens();
    }

    this.payNSprayRequested = false;
    this.currentDistrict = getDistrictAt(this.playerX, this.playerZ);
    if (!this.isBusted) {
      this.sampleRewindHistory();
    }
    return this.getSnapshot();
  }

  public getSnapshot(): Readonly<WorldSnapshot> {
    const activeVehicle = this.getActiveVehicle();
    const playerCar = this.vehicles.find((v) => v.role === 'player') ?? null;
    const nearby =
      this.playerMode === 'on_foot' ? this.findEnterableVehicle() : null;
    const raceStanding = this.computeRaceStanding();

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
      nearbyVehicleKind: nearby?.kind ?? null,
      activeVehicleKind: activeVehicle?.kind ?? null,
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
      pedestrians: this.pedestrians.map(toPedestrianSnapshot),
      wantedStars: this.wantedStars,
      bustProgress: this.bustProgress,
      policeEvadeProgress: this.policeEvadeProgress,
      isBusted: this.isBusted,
      driftScore: Math.round(this.driftScorePoints),
      topSpeedKmh: this.topSpeedKmh,
      currentDistrict: this.currentDistrict,
      collisionImpact: this.collisionImpact,
      driftComboMultiplier: this.driftComboMultiplier,
      driftBankPendingCop: Math.round(this.driftBankPendingCop),
      lastDriftCashoutCop: this.lastDriftCashoutCop,
      airborneSeconds: this.airborneSeconds,
      lastStuntJumpName: this.lastStuntJumpName,
      lastStuntJumpCop: this.lastStuntJumpCop,
      lastStuntJumpAt: this.lastStuntJumpAt,
      lastPayNSprayAt: this.lastPayNSprayAt,
      lastPayNSprayName: this.lastPayNSprayName,
      roadblockActive: this.isRoadblockActive(),
      racePosition: raceStanding.racePosition,
      raceTotalRacers: raceStanding.raceTotalRacers,
      hornActive: this.hornActive,
      trafficLightPhase: computeTrafficLightPhase(this.timeSeconds),
    };
  }

  private getActiveVehicle(): SimVehicle | null {
    if (!this.activeVehicleId) {
      return null;
    }
    return this.vehicles.find((v) => v.id === this.activeVehicleId) ?? null;
  }

  private placeVehicleAt(vehicle: SimVehicle, pose: SpawnPose): void {
    vehicle.x = pose.x;
    vehicle.z = pose.z;
    vehicle.y = getTerrainElevation(pose.x, pose.z);
    vehicle.heading = pose.heading;
    vehicle.speedMps = 0;
    vehicle.steerAngle = 0;
    vehicle.isDrifting = false;
    vehicle.isBoosting = false;
    vehicle.airborneHeight = 0;
    vehicle.verticalVelocity = 0;
    vehicle.leanAngle = 0;
    vehicle.wheelieAngle = 0;
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
      if (vehicle.role === 'player' && dist < bestBansheeDist) {
        bestBanshee = vehicle;
        bestBansheeDist = dist;
      }
      if (dist < nearestAnyDist) {
        nearestAny = vehicle;
        nearestAnyDist = dist;
      }
    }

    if (!nearestAny) {
      return null;
    }

    // The player's own Garaje vehicle always wins while it is within reach, so a car passing by
    // on the road never steals the [F] press the HUD prompt promised for the player's ride.
    return bestBanshee ?? nearestAny;
  }

  private handleInteractToggle(): void {
    if (this.playerMode === 'on_foot') {
      const target = this.findEnterableVehicle();
      if (!target) {
        return;
      }

      if (target.role !== 'player') {
        if (!target.isHijackedByPlayer) {
          target.speedMps = 0;
          target.nitro = Math.max(target.nitro, HIJACK_MIN_NITRO);
        }
        target.isHijackedByPlayer = true;
        target.sirenActive = false;
        if (target.kind === 'police') {
          if (this.wantedStars < 1) {
            this.wantedStars = 1;
            this.policeEvadeProgress = 0;
          }
        }
      }

      this.playerMode = 'driving';
      this.activeVehicleId = target.id;
      this.playerIsSprinting = false;
      this.syncPlayerFromVehicle(target);
      this.syncPoliceSirens();
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
    vehicle.sirenActive = false;
    vehicle.speedMps *= 0.25;
    vehicle.leanAngle = 0;
    vehicle.wheelieAngle = 0;

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
      const prevX = activeVehicle.x;
      const prevZ = activeVehicle.z;
      const result = stepPlayerVehicle(
        activeVehicle,
        input,
        dt,
        this.map,
        activeVehicle.kind,
      );
      activeVehicle.x = result.x;
      activeVehicle.y = result.y;
      activeVehicle.z = result.z;
      activeVehicle.heading = result.heading;
      activeVehicle.speedMps = result.speedMps;
      activeVehicle.steerAngle = result.steerAngle;
      activeVehicle.nitro = result.nitro;
      activeVehicle.isDrifting = result.isDrifting;
      activeVehicle.isBoosting = result.isBoosting;
      activeVehicle.airborneHeight = result.airborneHeight;
      activeVehicle.verticalVelocity = result.verticalVelocity;
      activeVehicle.leanAngle = result.leanAngle;
      activeVehicle.wheelieAngle = result.wheelieAngle;

      if (
        activeVehicle.airborneHeight <= 0 &&
        activeVehicle.verticalVelocity <= 0
      ) {
        this.tryTriggerStuntJump(activeVehicle, prevX, prevZ, dt);
      }

      if (activeVehicle.airborneHeight > 0) {
        this.airborneSeconds += dt;
      } else {
        this.airborneSeconds = 0;
      }

      this.syncPlayerFromVehicle(activeVehicle);
      this.playerIsSprinting = false;
      this.playerInRiverHazard = result.inRiverHazard;
      this.collisionImpact = result.collisionImpact;
      this.topSpeedKmh = Math.max(this.topSpeedKmh, result.speedKmh);

      if (activeVehicle.isDrifting && result.speedKmh >= DRIFT_SCORE_MIN_KMH) {
        this.driftScorePoints +=
          result.speedKmh * dt * DRIFT_SCORE_MULTIPLIER;
      }
      return;
    }

    this.airborneSeconds = 0;
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

  private stepUnoccupiedPlayerVehicles(dt: number): void {
    for (const vehicle of this.vehicles) {
      const isPlayerOwned =
        vehicle.role === 'player' || vehicle.isHijackedByPlayer;
      if (!isPlayerOwned || vehicle.id === this.activeVehicleId) {
        continue;
      }
      vehicle.isDrifting = false;
      vehicle.isBoosting = false;
      vehicle.sirenActive = false;
      if (vehicle.airborneHeight > 0 || vehicle.verticalVelocity > 0) {
        const settled = stepVerticalMotion(
          vehicle.airborneHeight,
          vehicle.verticalVelocity,
          dt,
          STUNT_GRAVITY_MPS2,
        );
        vehicle.airborneHeight = settled.airborneHeight;
        vehicle.verticalVelocity = settled.verticalVelocity;
        vehicle.y =
          getTerrainElevation(vehicle.x, vehicle.z) + vehicle.airborneHeight;
      }
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
          resolveVehicleCollisionRadius(vehicle.kind, vehicle.halfWidth),
          this.map,
        );
        vehicle.x = col.x;
        vehicle.z = col.z;
        vehicle.y =
          getTerrainElevation(col.x, col.z) + vehicle.airborneHeight;
        if (col.collided) {
          vehicle.speedMps = 0;
        }
      } else {
        vehicle.speedMps = 0;
      }
    }
  }

  private selectActivePoliceIds(): ReadonlySet<string> {
    const activeCount = ACTIVE_POLICE_BY_WANTED[this.wantedStars];
    if (activeCount <= 0) {
      return new Set<string>();
    }

    const candidates = this.vehicles
      .filter(
        (v) =>
          v.role === 'police' &&
          !v.isHijackedByPlayer &&
          v.id !== this.activeVehicleId,
      )
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
        vehicle.sirenActive =
          !vehicle.isHijackedByPlayer && activeIds.has(vehicle.id);
      }
    }
  }

  private stepNpcVehicles(dt: number): void {
    const activePoliceIds = this.selectActivePoliceIds();
    const raceCheckpoints = this.map.missionWaypoints.mission3Checkpoints ?? [];

    for (const vehicle of this.vehicles) {
      if (vehicle.id === this.activeVehicleId || vehicle.isHijackedByPlayer) {
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
      } else if (vehicle.role === 'racer') {
        stepRacerVehicle(vehicle, raceCheckpoints, dt, this.map);
      }
    }
  }

  private tryTriggerStuntJump(
    vehicle: SimVehicle,
    prevX: number,
    prevZ: number,
    dt: number,
  ): void {
    const jumps = this.map.stuntJumps;
    if (!jumps || jumps.length === 0) {
      return;
    }

    const midX = (prevX + vehicle.x) * 0.5;
    const midZ = (prevZ + vehicle.z) * 0.5;

    for (const jump of jumps) {
      const lastUsedAt = this.stuntJumpCooldowns.get(jump.id);
      if (
        lastUsedAt !== undefined &&
        this.timeSeconds - lastUsedAt < STUNT_JUMP_COOLDOWN_SECONDS
      ) {
        continue;
      }

      const hitRamp =
        isVehicleOnStuntRamp(
          vehicle.x,
          vehicle.z,
          vehicle.heading,
          vehicle.speedMps,
          jump,
        ) ||
        isVehicleOnStuntRamp(
          midX,
          midZ,
          vehicle.heading,
          vehicle.speedMps,
          jump,
        );
      if (!hitRamp) {
        continue;
      }

      const launched = stepVerticalMotion(
        0,
        jump.launchVy,
        dt,
        STUNT_GRAVITY_MPS2,
      );
      vehicle.airborneHeight = launched.airborneHeight;
      vehicle.verticalVelocity = launched.verticalVelocity;
      vehicle.y =
        getTerrainElevation(vehicle.x, vehicle.z) + vehicle.airborneHeight;
      vehicle.isDrifting = false;
      vehicle.nitro = clamp(vehicle.nitro + STUNT_JUMP_NITRO_BONUS, 0, MAX_NITRO);
      this.stuntJumpCooldowns.set(jump.id, this.timeSeconds);
      this.lastStuntJumpName = jump.name;
      this.lastStuntJumpCop = jump.rewardCop;
      this.lastStuntJumpAt = this.timeSeconds;
      break;
    }
  }

  private checkPayNSprayZones(input: InputState): void {
    const zones = this.map.payNSprayZones;
    const activeVehicle = this.getActiveVehicle();
    if (
      !zones ||
      zones.length === 0 ||
      this.playerMode !== 'driving' ||
      !activeVehicle
    ) {
      return;
    }

    const shouldService =
      this.wantedStars > 0 ||
      this.payNSprayRequested ||
      Boolean(input.hornPressed);
    if (!shouldService) {
      return;
    }

    for (const zone of zones) {
      const dist = Math.hypot(
        activeVehicle.x - zone.x,
        activeVehicle.z - zone.z,
      );
      if (dist > zone.radius) {
        continue;
      }

      const lastUsedAt = this.payNSprayCooldowns.get(zone.id);
      if (
        lastUsedAt !== undefined &&
        this.timeSeconds - lastUsedAt < PAY_N_SPRAY_COOLDOWN_SECONDS
      ) {
        continue;
      }

      this.wantedStars = 0;
      this.bustProgress = 0;
      this.policeEvadeProgress = 0;
      activeVehicle.nitro = MAX_NITRO;
      activeVehicle.colorHex = this.pickFreshResprayColor(activeVehicle.colorHex);
      this.payNSprayCooldowns.set(zone.id, this.timeSeconds);
      this.lastPayNSprayAt = this.timeSeconds;
      this.lastPayNSprayName = zone.name;
      this.syncPoliceSirens();
      break;
    }
  }

  private pickFreshResprayColor(currentColorHex: number): number {
    const currentIdx = CALI_RESPRAY_COLORS.indexOf(currentColorHex);
    const nextColor =
      CALI_RESPRAY_COLORS[(currentIdx + 1) % CALI_RESPRAY_COLORS.length] ??
      0x10b981;
    return nextColor === currentColorHex ? 0x10b981 : nextColor;
  }

  private isRoadblockActive(): boolean {
    return (
      this.wantedStars >= 3 && (this.map.roadblockZones?.length ?? 0) > 0
    );
  }

  private checkRoadblockZones(): void {
    if (!this.isRoadblockActive() || this.playerMode !== 'driving') {
      return;
    }
    const activeVehicle = this.getActiveVehicle();
    const zones = this.map.roadblockZones;
    if (
      !activeVehicle ||
      !zones ||
      activeVehicle.airborneHeight >= ROADBLOCK_CLEAR_AIRBORNE_METERS
    ) {
      return;
    }

    for (const zone of zones) {
      const lastHitAt = this.roadblockCooldowns.get(zone.id);
      if (
        lastHitAt !== undefined &&
        this.timeSeconds - lastHitAt < ROADBLOCK_COOLDOWN_SECONDS
      ) {
        continue;
      }

      const dx = activeVehicle.x - zone.x;
      const dz = activeVehicle.z - zone.z;
      const fwdX = Math.sin(zone.heading);
      const fwdZ = Math.cos(zone.heading);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const localFwd = dx * fwdX + dz * fwdZ;
      const localRight = dx * rightX + dz * rightZ;
      const hitDepth = Math.max(3.2, activeVehicle.halfLength + 1.0);

      if (
        Math.abs(localFwd) <= hitDepth &&
        Math.abs(localRight) <= zone.halfWidth
      ) {
        this.roadblockCooldowns.set(zone.id, this.timeSeconds);
        const canSmash =
          activeVehicle.kind === 'willys_v8' ||
          activeVehicle.isBoosting ||
          Math.abs(activeVehicle.speedMps) >= ROADBLOCK_SMASH_MIN_SPEED_MPS;
        if (canSmash) {
          activeVehicle.speedMps *= ROADBLOCK_SMASH_SPEED_FACTOR;
          this.collisionImpact = Math.max(
            this.collisionImpact,
            ROADBLOCK_SMASH_IMPACT,
          );
        } else {
          activeVehicle.speedMps *= ROADBLOCK_SLOW_SPEED_FACTOR;
          this.collisionImpact = Math.max(
            this.collisionImpact,
            ROADBLOCK_SLOW_IMPACT,
          );
        }
        this.syncPlayerFromVehicle(activeVehicle);
        break;
      }
    }
  }

  private cancelDriftCombo(): void {
    this.driftBankPendingCop = 0;
    this.driftChainSeconds = 0;
    this.driftRecoverySeconds = 0;
    this.driftComboMultiplier = 1;
  }

  private updateDriftCombo(dt: number): void {
    if (this.collisionImpact > DRIFT_CRASH_CANCEL_IMPACT) {
      this.cancelDriftCombo();
      return;
    }

    const activeVehicle = this.getActiveVehicle();
    const speedKmh = activeVehicle ? Math.abs(activeVehicle.speedMps) * 3.6 : 0;
    const isActiveDrift =
      this.playerMode === 'driving' &&
      activeVehicle !== null &&
      activeVehicle.isDrifting &&
      speedKmh >= DRIFT_COMBO_MIN_KMH;

    if (isActiveDrift) {
      this.lastDriftCashoutCop = 0;
      this.driftRecoverySeconds = 0;
      this.driftChainSeconds += dt;
      this.driftComboMultiplier = clamp(
        1 + Math.floor(this.driftChainSeconds / DRIFT_COMBO_STEP_SECONDS),
        1,
        DRIFT_COMBO_MAX_MULTIPLIER,
      );
      this.driftBankPendingCop +=
        speedKmh * dt * DRIFT_COMBO_COP_PER_KMH_SEC * this.driftComboMultiplier;
      return;
    }

    if (this.driftBankPendingCop > 0) {
      this.driftRecoverySeconds += dt;
      if (this.driftRecoverySeconds >= DRIFT_CASHOUT_GRACE_SECONDS) {
        const rounded = Math.round(this.driftBankPendingCop);
        if (rounded >= DRIFT_MIN_CASHOUT_COP) {
          this.lastDriftCashoutCop = rounded;
        }
        this.cancelDriftCombo();
      }
    } else {
      this.driftChainSeconds = 0;
      this.driftRecoverySeconds = 0;
      this.driftComboMultiplier = 1;
    }
  }

  private updatePlayerRaceProgress(): void {
    if (!this.rivalsEnabled) {
      return;
    }
    const checkpoints = this.map.missionWaypoints.mission3Checkpoints ?? [];
    const current = checkpoints[this.playerRaceCheckpointIndex];
    if (!current) {
      return;
    }
    if (
      Math.hypot(this.playerX - current.x, this.playerZ - current.z) <=
      current.radius
    ) {
      this.playerRaceCheckpointIndex += 1;
    }
  }

  private computeRaceStanding(): {
    readonly racePosition: number | null;
    readonly raceTotalRacers: number;
  } {
    if (!this.rivalsEnabled) {
      return { racePosition: null, raceTotalRacers: 0 };
    }
    const racers = this.vehicles.filter((v) => v.role === 'racer');
    if (racers.length === 0) {
      return { racePosition: null, raceTotalRacers: 0 };
    }

    const checkpoints = this.map.missionWaypoints.mission3Checkpoints ?? [];
    const distToNext = (x: number, z: number, cpIdx: number): number => {
      const cp = checkpoints[cpIdx];
      return cp ? Math.hypot(cp.x - x, cp.z - z) : 0;
    };

    const playerCp = this.playerRaceCheckpointIndex;
    const playerDist = distToNext(this.playerX, this.playerZ, playerCp);

    let position = 1;
    for (const racer of racers) {
      const racerCp = racer.waypointIndex;
      const racerDist = distToNext(racer.x, racer.z, racerCp);
      if (
        racerCp > playerCp ||
        (racerCp === playerCp && racerDist < playerDist - 0.05)
      ) {
        position += 1;
      }
    }

    return {
      racePosition: position,
      raceTotalRacers: racers.length + 1,
    };
  }

  private checkPoliceRam(
    activeVehicle: SimVehicle,
    other: SimVehicle,
    dist: number,
    playerSpeedMps: number,
  ): void {
    if (
      other.role !== 'police' ||
      other.isHijackedByPlayer ||
      dist >= POLICE_RAM_DISTANCE_METERS ||
      playerSpeedMps <= POLICE_RAM_MIN_SPEED_MPS ||
      this.policeRamCooldownSeconds > 0
    ) {
      return;
    }

    const vx = Math.sin(activeVehicle.heading) * activeVehicle.speedMps;
    const vz = Math.cos(activeVehicle.heading) * activeVehicle.speedMps;
    const toOtherX = other.x - activeVehicle.x;
    const toOtherZ = other.z - activeVehicle.z;
    const approachSpeed =
      dist > 1e-4 ? (vx * toOtherX + vz * toOtherZ) / dist : playerSpeedMps;
    if (approachSpeed <= POLICE_RAM_MIN_APPROACH_MPS) {
      return;
    }

    this.wantedStars = Math.min(3, this.wantedStars + 1) as WantedLevel;
    this.policeEvadeProgress = 0;
    this.policeRamCooldownSeconds = POLICE_RAM_COOLDOWN_SECONDS;
    const ramImpact = clamp(playerSpeedMps / 28, 0.45, 1);
    this.collisionImpact = Math.max(this.collisionImpact, ramImpact);
    this.syncPoliceSirens();
  }

  private resolveVehicleToVehicleBumps(): void {
    const activeVehicle = this.getActiveVehicle();
    if (!activeVehicle) {
      return;
    }

    const playerRadius = resolveVehicleCollisionRadius(
      activeVehicle.kind,
      activeVehicle.halfWidth,
      VEHICLE_BUMP_RADIUS_MIN,
    );
    const playerSpeedBeforeBump = Math.abs(activeVehicle.speedMps);

    for (const other of this.vehicles) {
      if (other.id === activeVehicle.id) {
        continue;
      }
      const otherRadius = resolveVehicleCollisionRadius(
        other.kind,
        other.halfWidth,
        VEHICLE_BUMP_RADIUS_MIN,
      );
      const minSep = playerRadius + otherRadius;
      const dx = activeVehicle.x - other.x;
      const dz = activeVehicle.z - other.z;
      const distSq = dx * dx + dz * dz;
      const dist = Math.sqrt(distSq);

      this.checkPoliceRam(activeVehicle, other, dist, playerSpeedBeforeBump);

      if (distSq >= minSep * minSep) {
        continue;
      }

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
      activeVehicle.y =
        getTerrainElevation(playerCol.x, playerCol.z) +
        activeVehicle.airborneHeight;

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

  private getClosestPursuingPoliceDistance(): number {
    let minDist = Number.POSITIVE_INFINITY;
    for (const vehicle of this.vehicles) {
      if (
        vehicle.role !== 'police' ||
        !vehicle.sirenActive ||
        vehicle.isHijackedByPlayer ||
        vehicle.id === this.activeVehicleId
      ) {
        continue;
      }
      const dist = Math.hypot(
        vehicle.x - this.playerX,
        vehicle.z - this.playerZ,
      );
      if (dist < minDist) {
        minDist = dist;
      }
    }
    return minDist;
  }

  private updateBustMechanic(dt: number): void {
    if (this.bustHeld) {
      return;
    }
    if (this.wantedStars === 0) {
      this.bustProgress = 0;
      return;
    }

    const playerSpeedKmh = Math.abs(this.playerSpeedMps) * 3.6;
    const policeInRange =
      this.getClosestPursuingPoliceDistance() <= BUST_RANGE_METERS;

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

  private updatePoliceEvasion(dt: number): void {
    if (this.wantedStars === 0) {
      this.policeEvadeProgress = 0;
      return;
    }

    const minPursuerDist = this.getClosestPursuingPoliceDistance();

    if (minPursuerDist > EVADE_CLEAR_DISTANCE_METERS) {
      this.policeEvadeProgress = clamp(
        this.policeEvadeProgress + dt / EVADE_DURATION_SECONDS,
        0,
        1,
      );
      if (this.policeEvadeProgress >= 1 - 1e-6) {
        this.policeEvadeProgress = 1;
        this.wantedStars = 0;
        this.bustProgress = 0;
        this.syncPoliceSirens();
      }
    } else if (minPursuerDist < EVADE_RESET_DISTANCE_METERS) {
      this.policeEvadeProgress = clamp(
        this.policeEvadeProgress - dt * EVADE_DECAY_PER_SECOND,
        0,
        1,
      );
    }
  }
}
