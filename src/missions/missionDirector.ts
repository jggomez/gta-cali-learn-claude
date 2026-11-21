/**
 * Pure mission state machine and localStorage persistence adapter for GTA VI: Cali.
 * Strictly decoupled from Three.js, DOM globals, simulation internals, world, audio, and UI.
 */

import { CALI_MAP } from '../config/caliMap';
import { LOCALE_CALI } from '../config/localeCali';
import type {
  CaliMapConfig,
  DialogueSpeaker,
  DialogueToast,
  GameMode,
  LandmarkId,
  MissionId,
  MissionSnapshot,
  MissionWaypoint,
  ObjectiveKind,
  ObjectiveSnapshot,
  RadioStationId,
  StorageRecords,
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
  private targetWantedStars: WantedLevel = 0;
  private records: StorageRecords;
  private dialogue: DialogueToast | null = null;
  private tickerIndex = 0;
  private tickerElapsed = 0;
  private rewardCop = 0;
  private elapsedSeconds = 0;
  private lastCompletedTimeSeconds: number | null = null;
  private isNewRecord = false;
  private riverWarningCooldown = 0;

  public constructor(map: CaliMapConfig = CALI_MAP, storage?: StorageAdapter) {
    this.map = map;
    this.storage = storage ?? new StorageAdapter();
    this.records = this.storage.loadRecords();
  }

  public startMission(missionId: MissionId): Readonly<MissionSnapshot> {
    this.activeMission = missionId;
    this.mode = 'playing';
    this.stepIndex = 0;
    this.targetWantedStars = 0;
    this.rewardCop = 0;
    this.elapsedSeconds = 0;
    this.lastCompletedTimeSeconds = null;
    this.isNewRecord = false;
    this.riverWarningCooldown = 0;

    if (missionId === 'mission_1_bulevar') {
      this.setDialogue('m1Intro', LOCALE_CALI.dialogues.m1Intro, INTRO_DIALOGUE_SECONDS);
      this.activeObjective = this.createEnterVehicleObjective(
        'm1_enter_vehicle',
        LOCALE_CALI.objectives.mission1.enterVehicleLabel,
        LOCALE_CALI.objectives.mission1.enterVehicleDetail,
        4,
        { x: this.map.playerCarSpawn.x, z: this.map.playerCarSpawn.z },
      );
    } else if (missionId === 'mission_2_cristo_rey') {
      this.setDialogue('m2Intro', LOCALE_CALI.dialogues.m2Intro, INTRO_DIALOGUE_SECONDS);
      this.activeObjective = this.createEnterVehicleObjective(
        'm2_enter_vehicle',
        LOCALE_CALI.objectives.mission2.enterVehicleLabel,
        LOCALE_CALI.objectives.mission2.enterVehicleDetail,
        3,
        { x: this.map.playerCarSpawn.x, z: this.map.playerCarSpawn.z },
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
    this.targetWantedStars = 0;
    this.dialogue = null;
    this.rewardCop = 0;
    this.lastCompletedTimeSeconds = null;
    this.isNewRecord = false;
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
    this.tickViralTicker(safeDt);
    this.checkLandmarkDiscoveries(world);
    this.checkRiverWarning(world, safeDt);

    if (this.activeMission !== 'free_roam' && world.isBusted) {
      this.mode = 'busted';
      this.targetWantedStars = 0;
      return this.getSnapshot();
    }

    if (this.activeMission === 'mission_1_bulevar') {
      this.updateMission1(world);
    } else if (this.activeMission === 'mission_2_cristo_rey') {
      this.updateMission2(world);
    } else {
      this.activeObjective = this.createFreeRoamObjective();
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
      activeObjective: this.activeObjective ? { ...this.activeObjective } : null,
      targetWantedStars: this.targetWantedStars,
      completedMissions: [...this.records.completedMissions],
      bestTimes: { ...this.records.bestTimes },
      discoveredLandmarks: [...this.records.discoveredLandmarks],
      dialogue: this.dialogue ? { ...this.dialogue } : null,
      viralTicker,
      rewardCop: this.rewardCop,
      cashCop: this.records.totalCashCop,
      timerSeconds: this.elapsedSeconds,
      elapsedSeconds: this.elapsedSeconds,
      lastCompletedTimeSeconds: this.lastCompletedTimeSeconds,
      isNewRecord: this.isNewRecord,
    };
  }

  public getRecords(): Readonly<StorageRecords> {
    return cloneRecords(this.records);
  }

  private updateMission1(world: WorldSnapshot): void {
    const waypoints = this.map.missionWaypoints;
    const copy = LOCALE_CALI.objectives.mission1;

    if (this.stepIndex === 0) {
      this.syncEnterVehicleTarget(world);
      if (world.player.mode === 'driving') {
        this.stepIndex = 1;
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission1Pickup,
          'reach_point',
          copy.pickupLabel,
          copy.pickupDetail,
          1,
          4,
          BEACON_MAGENTA,
        );
      }
      return;
    }

    if (this.stepIndex === 1) {
      if (this.isInsideWaypoint(world, waypoints.mission1Pickup)) {
        this.stepIndex = 2;
        this.targetWantedStars = 2;
        this.setDialogue('m1Pickup', LOCALE_CALI.dialogues.m1Pickup, CHECKPOINT_DIALOGUE_SECONDS);
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission1Escape,
          'reach_point',
          copy.bulevarLabel,
          copy.bulevarDetail,
          2,
          4,
          BEACON_GOLD,
        );
      }
      return;
    }

    if (this.stepIndex === 2) {
      if (this.isInsideWaypoint(world, waypoints.mission1Escape)) {
        this.stepIndex = 3;
        this.setDialogue('m1Bulevar', LOCALE_CALI.dialogues.m1Bulevar, CHECKPOINT_DIALOGUE_SECONDS);
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission1Finish,
          'escape_police',
          copy.escapeLabel,
          copy.escapeDetail,
          3,
          4,
          BEACON_EMERALD,
        );
      }
      return;
    }

    if (this.stepIndex === 3 && this.isInsideWaypoint(world, waypoints.mission1Finish)) {
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
      this.syncEnterVehicleTarget(world);
      if (world.player.mode === 'driving') {
        this.stepIndex = 1;
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission2Stage,
          'reach_point',
          copy.stageLabel,
          copy.stageDetail,
          1,
          3,
          BEACON_MAGENTA,
        );
      }
      return;
    }

    if (this.stepIndex === 1) {
      if (this.isInsideWaypoint(world, waypoints.mission2Stage)) {
        this.stepIndex = 2;
        this.targetWantedStars = 3;
        this.setDialogue('m2Stage', LOCALE_CALI.dialogues.m2Stage, CHECKPOINT_DIALOGUE_SECONDS);
        this.activeObjective = this.createWaypointObjective(
          waypoints.mission2Summit,
          'escape_police',
          copy.summitLabel,
          copy.summitDetail,
          2,
          3,
          BEACON_GOLD,
        );
      }
      return;
    }

    if (this.stepIndex === 2 && this.isInsideWaypoint(world, waypoints.mission2Summit)) {
      this.completeStoryMission(
        'mission_2_cristo_rey',
        'victory',
        'm2Passed',
        LOCALE_CALI.dialogues.m2Passed,
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
    this.targetWantedStars = 0;
    this.activeObjective = null;
    this.rewardCop = reward;
    this.lastCompletedTimeSeconds = completionTime;
    this.isNewRecord = isNewRecord;
    this.setDialogue(dialogueId, dialogueContent, COMPLETE_DIALOGUE_SECONDS);
  }

  private checkLandmarkDiscoveries(world: WorldSnapshot): void {
    let discoveredAny = false;
    let lastDiscoveredId: LandmarkId | null = null;
    const updated = [...this.records.discoveredLandmarks];

    for (const landmark of this.map.landmarks) {
      if (updated.includes(landmark.id)) {
        continue;
      }
      const dist = distance2D(
        world.player.x,
        world.player.z,
        landmark.position.x,
        landmark.position.z,
      );
      if (dist <= landmark.discoveryRadius) {
        updated.push(landmark.id);
        discoveredAny = true;
        lastDiscoveredId = landmark.id;
      }
    }

    if (discoveredAny) {
      this.records = this.storage.saveRecords({
        ...this.records,
        discoveredLandmarks: updated,
      });

      if (
        lastDiscoveredId !== null &&
        (this.dialogue === null || this.dialogue.id.startsWith('landmark_'))
      ) {
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

  private createEnterVehicleObjective(
    id: string,
    label: string,
    detail: string,
    totalSteps: number,
    target: Vec2,
  ): ObjectiveSnapshot {
    return {
      id,
      kind: 'enter_vehicle',
      label,
      detail,
      target,
      radius: 6,
      landmarkId: 'san_antonio',
      stepIndex: 0,
      totalSteps,
      beaconColorHex: BEACON_CYAN,
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
    };
  }

  private createFreeRoamObjective(): ObjectiveSnapshot {
    const discovered = this.records.discoveredLandmarks;
    const total = this.map.landmarks.length;
    const nextLandmark = this.map.landmarks.find((landmark) => !discovered.includes(landmark.id));

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
      stepIndex: discovered.length,
      totalSteps: total,
      beaconColorHex: BEACON_EMERALD,
    };
  }
}
