/**
 * Pure mission state machine and localStorage persistence adapter for GTA VI: Cali.
 * Strictly decoupled from Three.js, DOM globals, simulation internals, world, audio, and UI.
 */

import { CALI_MAP } from '../config/caliMap';
import { LOCALE_CALI } from '../config/localeCali';
import {
  computeGpsRoute,
  computeNextTurnBearing,
  computeRouteDistanceMeters,
} from '../config/roadGraph';
import type {
  BannerAccent,
  CaliMapConfig,
  CheckpointBanner,
  DialogueSpeaker,
  DialogueToast,
  FailureReason,
  GameMode,
  LandmarkDef,
  LandmarkId,
  MissionId,
  MissionSnapshot,
  MissionWaypoint,
  ObjectiveKind,
  ObjectivePropKind,
  ObjectiveSnapshot,
  RadioStationId,
  StorageRecords,
  TimeOfDay,
  Vec2,
  WantedLevel,
  WorldSnapshot,
} from '../types/game';

export const STORAGE_KEY = 'gta_cali_records_v1';

const VALID_MISSIONS: ReadonlySet<string> = new Set<MissionId>([
  'mission_1_bulevar',
  'mission_2_cristo_rey',
  'free_roam',
]);

const VALID_LANDMARKS: ReadonlySet<string> = new Set<LandmarkId>([
  'san_antonio',
  'torre_de_cali',
  'bulevar_del_rio',
  'la_ermita',
  'estadio_pascual',
  'cristo_rey',
]);

const FREE_ROAM_TOUR_ORDER: readonly LandmarkId[] = [
  'la_ermita',
  'torre_de_cali',
  'san_antonio',
  'cristo_rey',
  'estadio_pascual',
  'bulevar_del_rio',
];

const VALID_STATIONS: ReadonlySet<string> = new Set<RadioStationId>([
  'salsa_brava',
  'sucursal_synth',
  'off',
]);

const TICKER_ROTATION_SECONDS = 10;
const INTRO_DIALOGUE_SECONDS = 7;
const CHECKPOINT_DIALOGUE_SECONDS = 7;
const COMPLETE_DIALOGUE_SECONDS = 8.5;
const LANDMARK_DIALOGUE_SECONDS = 5;
const RIVER_WARNING_COOLDOWN_SECONDS = 8;
const BANNER_DURATION_SECONDS = 3.6;
const MISSION2_COUNTDOWN_SECONDS = 95;
const MISSION2_RING_BONUS_SECONDS = 10;

const BEACON_CYAN = 0x00f0ff;
const BEACON_MAGENTA = 0xff2e93;
const BEACON_GOLD = 0xffb800;
const BEACON_EMERALD = 0x00e699;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaveBestTimeResult {
  readonly records: StorageRecords;
  readonly isNewRecord: boolean;
}

function createDefaultRecords(): StorageRecords {
  return {
    version: 1,
    bestTimes: {},
    completedMissions: [],
    discoveredLandmarks: [],
    totalCashCop: 0,
    preferredStation: 'salsa_brava',
    muted: false,
  };
}

function cloneRecords(records: StorageRecords): StorageRecords {
  return {
    version: 1,
    bestTimes: { ...records.bestTimes },
    completedMissions: [...records.completedMissions],
    discoveredLandmarks: [...records.discoveredLandmarks],
    totalCashCop: records.totalCashCop,
    preferredStation: records.preferredStation,
    muted: records.muted,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeRecords(raw: unknown): StorageRecords {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return createDefaultRecords();
  }

  const bestTimes: Partial<Record<MissionId, number>> = {};
  if (isPlainObject(raw.bestTimes)) {
    for (const [key, val] of Object.entries(raw.bestTimes)) {
      if (VALID_MISSIONS.has(key) && typeof val === 'number' && Number.isFinite(val) && val > 0) {
        bestTimes[key as MissionId] = val;
      }
    }
  }

  const completedMissions: MissionId[] = [];
  if (Array.isArray(raw.completedMissions)) {
    for (const entry of raw.completedMissions) {
      if (
        typeof entry === 'string' &&
        VALID_MISSIONS.has(entry) &&
        !completedMissions.includes(entry as MissionId)
      ) {
        completedMissions.push(entry as MissionId);
      }
    }
  }

  const discoveredLandmarks: LandmarkId[] = [];
  if (Array.isArray(raw.discoveredLandmarks)) {
    for (const entry of raw.discoveredLandmarks) {
      if (
        typeof entry === 'string' &&
        VALID_LANDMARKS.has(entry) &&
        !discoveredLandmarks.includes(entry as LandmarkId)
      ) {
        discoveredLandmarks.push(entry as LandmarkId);
      }
    }
  }

  const totalCashCop =
    typeof raw.totalCashCop === 'number' && Number.isFinite(raw.totalCashCop) && raw.totalCashCop >= 0
      ? Math.floor(raw.totalCashCop)
      : 0;

  const preferredStation: RadioStationId =
    typeof raw.preferredStation === 'string' && VALID_STATIONS.has(raw.preferredStation)
      ? (raw.preferredStation as RadioStationId)
      : 'salsa_brava';

  const muted = typeof raw.muted === 'boolean' ? raw.muted : false;

  return {
    version: 1,
    bestTimes,
    completedMissions,
    discoveredLandmarks,
    totalCashCop,
    preferredStation,
    muted,
  };
}

function resolveDefaultStorage(): StorageLike | null {
  try {
    const scope = globalThis as { localStorage?: unknown };
    const candidate = scope.localStorage;
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      typeof (candidate as StorageLike).getItem === 'function' &&
      typeof (candidate as StorageLike).setItem === 'function'
    ) {
      return candidate as StorageLike;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeTimeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0.01;
  }
  return Math.max(0.01, Math.round(seconds * 1000) / 1000);
}

/**
 * Validated persistence adapter with silent in-memory fallback when localStorage is unavailable or throws.
 */
export class StorageAdapter {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private memoryFallback: StorageRecords;
  private usingFallback: boolean;

  public constructor(storage?: StorageLike | null, storageKey: string = STORAGE_KEY) {
    this.storage = storage === undefined ? resolveDefaultStorage() : storage;
    this.storageKey = storageKey;
    this.memoryFallback = createDefaultRecords();
    this.usingFallback = this.storage === null;
  }

  public isUsingFallback(): boolean {
    return this.usingFallback;
  }

  public loadRecords(): StorageRecords {
    if (!this.storage || this.usingFallback) {
      return cloneRecords(this.memoryFallback);
    }

    let serialized: string | null;
    try {
      serialized = this.storage.getItem(this.storageKey);
    } catch {
      this.usingFallback = true;
      return cloneRecords(this.memoryFallback);
    }

    if (serialized === null) {
      return cloneRecords(this.memoryFallback);
    }

    try {
      const parsed: unknown = JSON.parse(serialized);
      const sanitized = sanitizeRecords(parsed);
      this.memoryFallback = cloneRecords(sanitized);
      return cloneRecords(sanitized);
    } catch {
      this.memoryFallback = createDefaultRecords();
      return createDefaultRecords();
    }
  }

  public saveRecords(records: StorageRecords): StorageRecords {
    const sanitized = sanitizeRecords(records);
    this.memoryFallback = cloneRecords(sanitized);

    if (this.storage) {
      try {
        this.storage.setItem(this.storageKey, JSON.stringify(sanitized));
        this.usingFallback = false;
      } catch {
        this.usingFallback = true;
      }
    }

    return cloneRecords(sanitized);
  }

  public saveBestTime(missionId: MissionId, seconds: number): SaveBestTimeResult {
    const current = this.loadRecords();
    const normalized = normalizeTimeSeconds(seconds);
    const existingBest = current.bestTimes[missionId];
    const isNewRecord = existingBest === undefined || normalized < existingBest;

    const updated: StorageRecords = {
      ...current,
      bestTimes: isNewRecord
        ? { ...current.bestTimes, [missionId]: normalized }
        : { ...current.bestTimes },
    };

    return {
      records: this.saveRecords(updated),
      isNewRecord,
    };
  }
}

function distance2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * Pure mission state machine governing Mission 1, Mission 2, Free Roam, dialogues, landmarks, and records.
 */
export class MissionDirector {
  private readonly map: CaliMapConfig;
  private readonly storage: StorageAdapter;

  private mode: GameMode = 'title';
  private activeMission: MissionId = 'mission_1_bulevar';
  private stepIndex = 0;
  private activeObjective: ObjectiveSnapshot | null = null;
  private missionFloorStars: WantedLevel = 0;
  private targetWantedStars: WantedLevel = 0;
  private lastFreeRoamWantedStars: WantedLevel = 0;
  private records: StorageRecords;
  private dialogue: DialogueToast | null = null;
  private banner: CheckpointBanner | null = null;
  private tickerIndex = 0;
  private tickerElapsed = 0;
  private rewardCop = 0;
  private elapsedSeconds = 0;
  private lastCompletedTimeSeconds: number | null = null;
  private isNewRecord = false;
  private riverWarningCooldown = 0;
  private timeOfDay: TimeOfDay = 'golden_hour';
  private isCountdown = false;
  private countdownRemaining = 0;
  private failureReason: FailureReason | null = null;
  private freeRoamVisited: LandmarkId[] = [];
  private freeRoamLeftSpawnZone = false;

  public constructor(map: CaliMapConfig = CALI_MAP, storage?: StorageAdapter) {
    this.map = map;
    this.storage = storage ?? new StorageAdapter();
    this.records = this.storage.loadRecords();
  }

  public toggleTimeOfDay(): Readonly<MissionSnapshot> {
    this.timeOfDay = this.timeOfDay === 'golden_hour' ? 'night' : 'golden_hour';
    const bannerCopy =
      this.timeOfDay === 'golden_hour'
        ? LOCALE_CALI.banners.timeChanged.day
        : LOCALE_CALI.banners.timeChanged.night;
    this.setBanner(`time_${this.timeOfDay}`, bannerCopy, 'cyan');
    return this.getSnapshot();
  }

  public startMission(missionId: MissionId): Readonly<MissionSnapshot> {
    this.activeMission = missionId;
    this.mode = 'playing';
    this.stepIndex = 0;
    this.missionFloorStars = 0;
    this.targetWantedStars = 0;
    this.lastFreeRoamWantedStars = 0;
    this.banner = null;
    this.rewardCop = 0;
    this.elapsedSeconds = 0;
    this.lastCompletedTimeSeconds = null;
    this.isNewRecord = false;
    this.riverWarningCooldown = 0;
    this.isCountdown = false;
    this.countdownRemaining = 0;
    this.failureReason = null;
    this.freeRoamVisited = [];
    this.freeRoamLeftSpawnZone = false;
    this.timeOfDay = this.map.missionStarts[missionId].defaultTimeOfDay;

    if (missionId === 'mission_1_bulevar') {
      const copy = LOCALE_CALI.objectives.mission1;
      this.setDialogue('m1Intro', LOCALE_CALI.dialogues.m1Intro, INTRO_DIALOGUE_SECONDS);
      this.setBanner('m1Start', LOCALE_CALI.banners.m1Start, 'cyan');
      this.activeObjective = this.createWaypointObjective(
        this.map.missionWaypoints.mission1Pickup,
        'reach_point',
        copy.heistOnFootLabel,
        copy.heistOnFootDetail,
        0,
        4,
        BEACON_GOLD,
        'vinyl_briefcase',
        true,
      );
    } else if (missionId === 'mission_2_cristo_rey') {
      const copy = LOCALE_CALI.objectives.mission2;
      this.isCountdown = true;
      this.countdownRemaining = MISSION2_COUNTDOWN_SECONDS;
      this.missionFloorStars = this.map.missionStarts.mission_2_cristo_rey.initialWantedStars;
      this.targetWantedStars = this.missionFloorStars;
      this.setDialogue('m2Launch', LOCALE_CALI.dialogues.m2Launch, INTRO_DIALOGUE_SECONDS);
      this.setBanner('m2Launch', LOCALE_CALI.banners.m2Launch, 'police');
      this.activeObjective = this.createWaypointObjective(
        this.map.missionWaypoints.mission2RingBridge,
        'reach_point',
        copy.ringBridgeLabel,
        copy.ringBridgeDetail,
        0,
        4,
        BEACON_CYAN,
        'mateo_speakers',
      );
    } else {
      this.setDialogue('freeRoamIntro', LOCALE_CALI.dialogues.freeRoamIntro, INTRO_DIALOGUE_SECONDS);
      this.activeObjective = this.createFreeRoamObjective();
    }

    return this.getSnapshot();
  }

  public setPaused(paused: boolean): Readonly<MissionSnapshot> {
    if (paused && this.mode === 'playing') {
      this.mode = 'paused';
    } else if (!paused && this.mode === 'paused') {
      this.mode = 'playing';
    }
    return this.getSnapshot();
  }

  public returnToTitle(): Readonly<MissionSnapshot> {
    this.mode = 'title';
    this.activeObjective = null;
    this.missionFloorStars = 0;
    this.targetWantedStars = 0;
    this.lastFreeRoamWantedStars = 0;
    this.dialogue = null;
    this.banner = null;
    this.rewardCop = 0;
    this.lastCompletedTimeSeconds = null;
    this.isNewRecord = false;
    this.isCountdown = false;
    this.countdownRemaining = 0;
    this.failureReason = null;
    this.freeRoamVisited = [];
    this.freeRoamLeftSpawnZone = false;
    this.timeOfDay = 'golden_hour';
    return this.getSnapshot();
  }

  public saveAudioPreferences(station: RadioStationId, muted: boolean): void {
    this.records = this.storage.saveRecords({
      ...this.records,
      preferredStation: station,
      muted,
    });
  }

  public update(world: WorldSnapshot, dt: number): Readonly<MissionSnapshot> {
    if (this.mode !== 'playing') {
      return this.getSnapshot();
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.elapsedSeconds += safeDt;

    this.tickDialogue(safeDt);
    this.tickBanner(safeDt);
    this.tickViralTicker(safeDt);
    this.checkLandmarkDiscoveries(world);
    this.checkRiverWarning(world, safeDt);

    if (this.activeMission !== 'free_roam' && world.isBusted) {
      this.failMission('busted');
      return this.getSnapshot();
    }

    if (this.isCountdown) {
      this.countdownRemaining = Math.max(0, this.countdownRemaining - safeDt);
      if (this.countdownRemaining <= 0) {
        this.failMission('time_up');
        return this.getSnapshot();
      }
    }

    if (this.activeMission === 'mission_1_bulevar') {
      this.updateMission1(world);
      if (this.mode === 'playing') {
        this.targetWantedStars = Math.max(this.missionFloorStars, world.wantedStars) as WantedLevel;
      }
    } else if (this.activeMission === 'mission_2_cristo_rey') {
      this.updateMission2(world);
      if (this.mode === 'playing') {
        this.targetWantedStars = Math.max(this.missionFloorStars, world.wantedStars) as WantedLevel;
      }
    } else {
      this.updateFreeRoamPolice(world);
      this.activeObjective = this.createFreeRoamObjective();
    }

    if (this.mode === 'playing') {
      this.enrichActiveObjectiveNavigation(world);
    }

    return this.getSnapshot();
  }

  public getSnapshot(): Readonly<MissionSnapshot> {
    const tickerList = LOCALE_CALI.viralTicker;
    const viralTicker = tickerList[this.tickerIndex % tickerList.length] ?? '';

    return {
      mode: this.mode,
      activeMission: this.activeMission,
      missionTitle: LOCALE_CALI.missions[this.activeMission].title,
      activeObjective: this.activeObjective
        ? {
            ...this.activeObjective,
            target: this.activeObjective.target ? { ...this.activeObjective.target } : null,
            gpsRoute: this.activeObjective.gpsRoute
              ? this.activeObjective.gpsRoute.map((point) => ({ ...point }))
              : undefined,
          }
        : null,
      targetWantedStars: this.targetWantedStars,
      completedMissions: [...this.records.completedMissions],
      bestTimes: { ...this.records.bestTimes },
      discoveredLandmarks: [...this.records.discoveredLandmarks],
      dialogue: this.dialogue ? { ...this.dialogue } : null,
      banner: this.banner ? { ...this.banner } : null,
      viralTicker,
      rewardCop: this.rewardCop,
      cashCop: this.records.totalCashCop,
      timerSeconds: this.isCountdown ? this.countdownRemaining : this.elapsedSeconds,
      elapsedSeconds: this.elapsedSeconds,
      lastCompletedTimeSeconds: this.lastCompletedTimeSeconds,
      isNewRecord: this.isNewRecord,
      timeOfDay: this.timeOfDay,
      isCountdown: this.isCountdown,
      failureReason: this.failureReason,
    };
  }

  public getRecords(): Readonly<StorageRecords> {
    return cloneRecords(this.records);
  }

  private failMission(reason: FailureReason): void {
    this.mode = 'busted';
    this.failureReason = reason;
    this.missionFloorStars = 0;
    this.targetWantedStars = 0;
    this.banner = null;
  }

  private updateMission1(world: WorldSnapshot): void {
    const waypoints = this.map.missionWaypoints;
    const copy = LOCALE_CALI.objectives.mission1;

    if (this.stepIndex === 0) {
      if (world.player.mode === 'on_foot' && this.isInsideWaypoint(world, waypoints.mission1Pickup)) {
        this.stepIndex = 1;
        this.missionFloorStars = 2;
        this.setDialogue('m1Alarm', LOCALE_CALI.dialogues.m1Alarm, CHECKPOINT_DIALOGUE_SECONDS);
        this.setBanner('m1HeistAlarm', LOCALE_CALI.banners.m1HeistAlarm, 'police');
        const playerCar = world.vehicles.find((vehicle) => vehicle.role === 'player');
        const getawayTarget = playerCar
          ? { x: playerCar.x, z: playerCar.z }
          : {
              x: this.map.missionStarts.mission_1_bulevar.carSpawn.x,
              z: this.map.missionStarts.mission_1_bulevar.carSpawn.z,
            };
        this.activeObjective = this.createEnterVehicleObjective(
          'm1_board_getaway',
          copy.boardGetawayLabel,
          copy.boardGetawayDetail,
          1,
          4,
          getawayTarget,
          'torre_de_cali',
        );
      }
      return;
    }

    if (this.stepIndex === 1) {
      this.syncEnterVehicleTarget(world);
      if (world.player.mode === 'driving') {
        this.stepIndex = 2;
        this.setDialogue('m1EscapeCar', LOCALE_CALI.dialogues.m1EscapeCar, CHECKPOINT_DIALOGUE_SECONDS);
        this.setBanner('m1Boarded', LOCALE_CALI.banners.m1Boarded, 'cyan');
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission1Finish,
          'reach_point',
          copy.crossBridgeLabel,
          copy.crossBridgeDetail,
          2,
          4,
          BEACON_GOLD,
          'none',
        );
      }
      return;
    }

    if (this.stepIndex === 2) {
      if (this.isInsideWaypoint(world, waypoints.mission1Finish)) {
        this.stepIndex = 3;
        this.setDialogue('m1Bulevar', LOCALE_CALI.dialogues.m1Bulevar, CHECKPOINT_DIALOGUE_SECONDS);
        this.setBanner('m1Bridge', LOCALE_CALI.banners.m1Bridge, 'gold');
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission1Hideout,
          'escape_police',
          copy.hideoutLabel,
          copy.hideoutDetail,
          3,
          4,
          BEACON_EMERALD,
          'none',
        );
      }
      return;
    }

    if (this.stepIndex === 3 && this.isInsideWaypoint(world, waypoints.mission1Hideout)) {
      this.completeStoryMission(
        'mission_1_bulevar',
        'mission_passed',
        'm1Passed',
        LOCALE_CALI.dialogues.m1Passed,
      );
    }
  }

  private updateMission2(world: WorldSnapshot): void {
    const waypoints = this.map.missionWaypoints;
    const copy = LOCALE_CALI.objectives.mission2;

    if (this.stepIndex === 0) {
      if (this.isInsideWaypoint(world, waypoints.mission2RingBridge)) {
        this.stepIndex = 1;
        this.countdownRemaining += MISSION2_RING_BONUS_SECONDS;
        this.setDialogue('m2Ring1', LOCALE_CALI.dialogues.m2Ring1, CHECKPOINT_DIALOGUE_SECONDS);
        this.setBanner('m2RingBonus', LOCALE_CALI.banners.m2RingBonus, 'emerald');
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission2RingBulevar,
          'reach_point',
          copy.ringBulevarLabel,
          copy.ringBulevarDetail,
          1,
          4,
          BEACON_MAGENTA,
          'none',
        );
      }
      return;
    }

    if (this.stepIndex === 1) {
      if (this.isInsideWaypoint(world, waypoints.mission2RingBulevar)) {
        this.stepIndex = 2;
        this.countdownRemaining += MISSION2_RING_BONUS_SECONDS;
        this.setDialogue('m2Ring2', LOCALE_CALI.dialogues.m2Ring2, CHECKPOINT_DIALOGUE_SECONDS);
        this.setBanner('m2RingBonus', LOCALE_CALI.banners.m2RingBonus, 'emerald');
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission2RampEntry,
          'reach_point',
          copy.rampLabel,
          copy.rampDetail,
          2,
          4,
          BEACON_GOLD,
          'none',
        );
      }
      return;
    }

    if (this.stepIndex === 2) {
      if (this.isInsideWaypoint(world, waypoints.mission2RampEntry)) {
        this.stepIndex = 3;
        this.countdownRemaining += MISSION2_RING_BONUS_SECONDS;
        this.setDialogue('m2Ramp', LOCALE_CALI.dialogues.m2Ramp, CHECKPOINT_DIALOGUE_SECONDS);
        this.setBanner('m2Ramp', LOCALE_CALI.banners.m2Ramp, 'gold');
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission2Summit,
          'escape_police',
          copy.summitLabel,
          copy.summitDetail,
          3,
          4,
          BEACON_GOLD,
          'summit_stage',
        );
      }
      return;
    }

    if (this.stepIndex === 3 && this.isInsideWaypoint(world, waypoints.mission2Summit)) {
      this.completeStoryMission(
        'mission_2_cristo_rey',
        'victory',
        'm2Passed',
        LOCALE_CALI.dialogues.m2Passed,
      );
    }
  }

  private updateFreeRoamPolice(world: WorldSnapshot): void {
    const previousStars = this.lastFreeRoamWantedStars;
    const currentStars = world.wantedStars;
    this.targetWantedStars = currentStars;
    this.lastFreeRoamWantedStars = currentStars;

    if (previousStars === 0 && currentStars >= 1) {
      this.setBanner('freeRoamWanted', LOCALE_CALI.banners.freeRoamWanted, 'police');
      this.setDialogue(
        'freeRoamWanted',
        LOCALE_CALI.dialogues.freeRoamWanted,
        CHECKPOINT_DIALOGUE_SECONDS,
      );
    } else if (previousStars >= 1 && currentStars === 0) {
      this.setBanner('freeRoamEscaped', LOCALE_CALI.banners.freeRoamEscaped, 'emerald');
      this.setDialogue(
        'freeRoamEscaped',
        LOCALE_CALI.dialogues.freeRoamEscaped,
        CHECKPOINT_DIALOGUE_SECONDS,
      );
    }
  }

  private completeStoryMission(
    missionId: MissionId,
    nextMode: 'mission_passed' | 'victory',
    dialogueId: string,
    dialogueContent: { readonly speaker: DialogueSpeaker; readonly text: string },
  ): void {
    const reward = LOCALE_CALI.missions[missionId].rewardCop;
    const completionTime = normalizeTimeSeconds(this.elapsedSeconds);
    const existingBest = this.records.bestTimes[missionId];
    const isNewRecord = existingBest === undefined || completionTime < existingBest;

    const completedMissions = this.records.completedMissions.includes(missionId)
      ? [...this.records.completedMissions]
      : [...this.records.completedMissions, missionId];

    const bestTimes: Partial<Record<MissionId, number>> = isNewRecord
      ? { ...this.records.bestTimes, [missionId]: completionTime }
      : { ...this.records.bestTimes };

    this.records = this.storage.saveRecords({
      ...this.records,
      completedMissions,
      bestTimes,
      totalCashCop: this.records.totalCashCop + reward,
    });

    this.mode = nextMode;
    this.missionFloorStars = 0;
    this.targetWantedStars = 0;
    this.activeObjective = null;
    this.banner = null;
    this.rewardCop = reward;
    this.lastCompletedTimeSeconds = completionTime;
    this.isNewRecord = isNewRecord;
    this.setDialogue(dialogueId, dialogueContent, COMPLETE_DIALOGUE_SECONDS);
  }

  private isFreeRoamSpawnLandmark(landmark: LandmarkDef): boolean {
    const spawn = this.map.missionStarts.free_roam.playerSpawn;
    return (
      distance2D(spawn.x, spawn.z, landmark.position.x, landmark.position.z) <=
      landmark.discoveryRadius
    );
  }

  private getOrderedFreeRoamLandmarks(): readonly LandmarkDef[] {
    const ordered: LandmarkDef[] = [];
    for (const id of FREE_ROAM_TOUR_ORDER) {
      const match = this.map.landmarks.find((landmark) => landmark.id === id);
      if (match) {
        ordered.push(match);
      }
    }
    for (const landmark of this.map.landmarks) {
      if (!ordered.includes(landmark)) {
        ordered.push(landmark);
      }
    }
    return ordered;
  }

  private checkLandmarkDiscoveries(world: WorldSnapshot): void {
    const isFreeRoam = this.activeMission === 'free_roam';
    if (isFreeRoam && !this.freeRoamLeftSpawnZone) {
      const insideSpawnLandmark = this.map.landmarks.some(
        (landmark) =>
          this.isFreeRoamSpawnLandmark(landmark) &&
          distance2D(
            world.player.x,
            world.player.z,
            landmark.position.x,
            landmark.position.z,
          ) <= landmark.discoveryRadius,
      );
      if (!insideSpawnLandmark) {
        this.freeRoamLeftSpawnZone = true;
      }
    }

    let discoveredAnyLifetime = false;
    let lastDiscoveredId: LandmarkId | null = null;
    const updated = [...this.records.discoveredLandmarks];

    for (const landmark of this.map.landmarks) {
      const dist = distance2D(
        world.player.x,
        world.player.z,
        landmark.position.x,
        landmark.position.z,
      );
      if (dist > landmark.discoveryRadius) {
        continue;
      }

      const deferSpawnLandmark =
        isFreeRoam &&
        !this.freeRoamLeftSpawnZone &&
        this.freeRoamVisited.length === 0 &&
        this.isFreeRoamSpawnLandmark(landmark);
      if (deferSpawnLandmark) {
        continue;
      }

      if (!updated.includes(landmark.id)) {
        updated.push(landmark.id);
        discoveredAnyLifetime = true;
        lastDiscoveredId = landmark.id;
      }

      if (isFreeRoam && !this.freeRoamVisited.includes(landmark.id)) {
        this.freeRoamVisited.push(landmark.id);
        lastDiscoveredId = landmark.id;
      }
    }

    if (discoveredAnyLifetime) {
      this.records = this.storage.saveRecords({
        ...this.records,
        discoveredLandmarks: updated,
      });
    }

    if (lastDiscoveredId !== null) {
      const canShowDialogue =
        this.dialogue === null ||
        this.dialogue.id.startsWith('landmark_') ||
        (isFreeRoam && this.dialogue.id === 'freeRoamIntro');

      if (canShowDialogue) {
        const displayName = LOCALE_CALI.landmarks[lastDiscoveredId];
        this.setDialogue(
          `landmark_${lastDiscoveredId}`,
          LOCALE_CALI.dialogues.landmarkDiscovered(displayName),
          LANDMARK_DIALOGUE_SECONDS,
        );
      }
    }
  }

  private checkRiverWarning(world: WorldSnapshot, dt: number): void {
    this.riverWarningCooldown = Math.max(0, this.riverWarningCooldown - dt);
    if (world.player.inRiverHazard && this.riverWarningCooldown <= 0) {
      this.riverWarningCooldown = RIVER_WARNING_COOLDOWN_SECONDS;
      this.setDialogue('riverWarning', LOCALE_CALI.dialogues.riverWarning, LANDMARK_DIALOGUE_SECONDS);
    }
  }

  private tickDialogue(dt: number): void {
    if (!this.dialogue) {
      return;
    }
    const remaining = this.dialogue.remainingSeconds - dt;
    if (remaining <= 0) {
      this.dialogue = null;
    } else {
      this.dialogue = {
        ...this.dialogue,
        remainingSeconds: remaining,
      };
    }
  }

  private tickBanner(dt: number): void {
    if (!this.banner) {
      return;
    }
    const remaining = this.banner.remainingSeconds - dt;
    if (remaining <= 0) {
      this.banner = null;
    } else {
      this.banner = {
        ...this.banner,
        remainingSeconds: remaining,
      };
    }
  }

  private enrichActiveObjectiveNavigation(world: WorldSnapshot): void {
    if (!this.activeObjective) {
      return;
    }
    if (!this.activeObjective.target) {
      this.activeObjective = {
        ...this.activeObjective,
        gpsRoute: [],
        distanceMeters: null,
        bearingDeltaRad: null,
      };
      return;
    }

    const playerPos: Vec2 = { x: world.player.x, z: world.player.z };
    const gpsRoute = computeGpsRoute(playerPos, this.activeObjective.target, this.map);
    const distanceMeters = Math.round(computeRouteDistanceMeters(gpsRoute));
    const bearingDeltaRad = computeNextTurnBearing(playerPos, world.player.heading, gpsRoute);

    this.activeObjective = {
      ...this.activeObjective,
      gpsRoute,
      distanceMeters,
      bearingDeltaRad,
    };
  }

  private tickViralTicker(dt: number): void {
    this.tickerElapsed += dt;
    if (this.tickerElapsed >= TICKER_ROTATION_SECONDS) {
      const steps = Math.floor(this.tickerElapsed / TICKER_ROTATION_SECONDS);
      this.tickerIndex = (this.tickerIndex + steps) % LOCALE_CALI.viralTicker.length;
      this.tickerElapsed -= steps * TICKER_ROTATION_SECONDS;
    }
  }

  private syncEnterVehicleTarget(world: WorldSnapshot): void {
    if (!this.activeObjective || this.activeObjective.kind !== 'enter_vehicle') {
      return;
    }
    const playerCar = world.vehicles.find((vehicle) => vehicle.role === 'player');
    if (playerCar) {
      this.activeObjective = {
        ...this.activeObjective,
        target: { x: playerCar.x, z: playerCar.z },
      };
    }
  }

  private isInsideWaypoint(world: WorldSnapshot, waypoint: MissionWaypoint): boolean {
    return distance2D(world.player.x, world.player.z, waypoint.x, waypoint.z) <= waypoint.radius;
  }

  private setDialogue(
    id: string,
    content: { readonly speaker: DialogueSpeaker; readonly text: string },
    durationSeconds: number,
  ): void {
    this.dialogue = {
      id,
      speaker: content.speaker,
      text: content.text,
      remainingSeconds: durationSeconds,
    };
  }

  private setBanner(
    id: string,
    content: { readonly title: string; readonly subtitle: string },
    accent: BannerAccent,
  ): void {
    this.banner = {
      id,
      title: content.title,
      subtitle: content.subtitle,
      accent,
      remainingSeconds: BANNER_DURATION_SECONDS,
    };
  }

  private createEnterVehicleObjective(
    id: string,
    label: string,
    detail: string,
    stepIndex: number,
    totalSteps: number,
    target: Vec2,
    landmarkId: LandmarkId,
  ): ObjectiveSnapshot {
    return {
      id,
      kind: 'enter_vehicle',
      label,
      detail,
      target,
      radius: 6,
      landmarkId,
      stepIndex,
      totalSteps,
      beaconColorHex: BEACON_CYAN,
      propKind: 'none',
      requiresOnFoot: false,
    };
  }

  private createWaypointObjective(
    waypoint: MissionWaypoint,
    kind: ObjectiveKind,
    label: string,
    detail: string,
    stepIndex: number,
    totalSteps: number,
    beaconColorHex: number,
    propKind: ObjectivePropKind,
    requiresOnFoot = false,
  ): ObjectiveSnapshot {
    return {
      id: waypoint.id,
      kind,
      label,
      detail,
      target: { x: waypoint.x, z: waypoint.z },
      radius: waypoint.radius,
      landmarkId: waypoint.landmarkId,
      stepIndex,
      totalSteps,
      beaconColorHex,
      propKind,
      requiresOnFoot,
    };
  }

  private createFreeRoamObjective(): ObjectiveSnapshot {
    const orderedLandmarks = this.getOrderedFreeRoamLandmarks();
    const total = orderedLandmarks.length;
    const nextLandmark = orderedLandmarks.find(
      (landmark) => !this.freeRoamVisited.includes(landmark.id),
    );

    if (!nextLandmark) {
      return {
        id: 'free_roam_all_discovered',
        kind: 'explore',
        label: LOCALE_CALI.objectives.freeRoam.allDiscoveredLabel,
        detail: LOCALE_CALI.objectives.freeRoam.allDiscoveredDetail,
        target: null,
        radius: 0,
        landmarkId: null,
        stepIndex: total,
        totalSteps: total,
        beaconColorHex: BEACON_EMERALD,
        propKind: 'none',
      };
    }

    return {
      id: 'free_roam_explore',
      kind: 'explore',
      label: LOCALE_CALI.objectives.freeRoam.exploreLabel,
      detail: LOCALE_CALI.objectives.freeRoam.exploreDetail,
      target: { x: nextLandmark.position.x, z: nextLandmark.position.z },
      radius: nextLandmark.discoveryRadius,
      landmarkId: nextLandmark.id,
      stepIndex: this.freeRoamVisited.length,
      totalSteps: total,
      beaconColorHex: BEACON_EMERALD,
      propKind: 'none',
    };
  }
}
