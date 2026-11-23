import { describe, expect, it } from 'vitest';
import { CALI_MAP, DEFAULT_GARAGE_CONFIG } from '../../../src/config/caliMap';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import {
  MissionDirector,
  STORAGE_KEY,
  StorageAdapter,
  type StorageLike,
} from '../../../src/missions/missionDirector';
import type {
  GarageConfig,
  PlayerMode,
  WantedLevel,
  WorldSnapshot,
} from '../../../src/types/game';

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class ThrowingStorage implements StorageLike {
  public getItem(): string | null {
    throw new Error('Storage access denied');
  }

  public setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

interface WorldOverrides {
  x?: number;
  z?: number;
  heading?: number;
  mode?: PlayerMode;
  wantedStars?: WantedLevel;
  isBusted?: boolean;
  inRiverHazard?: boolean;
  timeSeconds?: number;
  lastStuntJumpName?: string | null;
  lastStuntJumpCop?: number;
  lastStuntJumpAt?: number;
  lastDriftCashoutCop?: number;
  lastPayNSprayAt?: number;
  lastPayNSprayName?: string | null;
}

function makeWorld(overrides: WorldOverrides = {}): WorldSnapshot {
  const mode = overrides.mode ?? 'on_foot';
  const x = overrides.x ?? CALI_MAP.playerStart.x;
  const z = overrides.z ?? CALI_MAP.playerStart.z;

  return {
    timeSeconds: overrides.timeSeconds ?? 0,
    player: {
      mode,
      x,
      y: 0,
      z,
      heading: overrides.heading ?? 0,
      speedMps: mode === 'driving' ? 20 : 0,
      speedKmh: mode === 'driving' ? 72 : 0,
      vehicleId: mode === 'driving' ? 'player_banshee' : null,
      nearbyVehicleId: mode === 'on_foot' ? 'player_banshee' : null,
      canEnterVehicle: mode === 'on_foot',
      nitro: 100,
      isDrifting: false,
      isBoosting: false,
      isSprinting: false,
      inRiverHazard: overrides.inRiverHazard ?? false,
    },
    vehicles: [
      {
        id: 'player_banshee',
        kind: 'banshee',
        role: 'player',
        x: CALI_MAP.playerCarSpawn.x,
        y: 0,
        z: CALI_MAP.playerCarSpawn.z,
        heading: CALI_MAP.playerCarSpawn.heading,
        speedMps: 0,
        speedKmh: 0,
        steerAngle: 0,
        isDrifting: false,
        isBoosting: false,
        nitro: 100,
        sirenActive: false,
        colorHex: 0xff2e93,
        halfWidth: 1.1,
        halfLength: 2.3,
      },
    ],
    wantedStars: overrides.wantedStars ?? 0,
    bustProgress: overrides.isBusted ? 1 : 0,
    isBusted: overrides.isBusted ?? false,
    driftScore: 0,
    topSpeedKmh: 72,
    currentDistrict: 'Barrio San Antonio',
    collisionImpact: 0,
    ...(overrides.lastStuntJumpName !== undefined
      ? { lastStuntJumpName: overrides.lastStuntJumpName }
      : {}),
    ...(overrides.lastStuntJumpCop !== undefined
      ? { lastStuntJumpCop: overrides.lastStuntJumpCop }
      : {}),
    ...(overrides.lastStuntJumpAt !== undefined
      ? { lastStuntJumpAt: overrides.lastStuntJumpAt }
      : {}),
    ...(overrides.lastDriftCashoutCop !== undefined
      ? { lastDriftCashoutCop: overrides.lastDriftCashoutCop }
      : {}),
    ...(overrides.lastPayNSprayAt !== undefined
      ? { lastPayNSprayAt: overrides.lastPayNSprayAt }
      : {}),
    ...(overrides.lastPayNSprayName !== undefined
      ? { lastPayNSprayName: overrides.lastPayNSprayName }
      : {}),
  };
}

describe('StorageAdapter', () => {
  it('returns default records when storage is empty or unavailable', () => {
    const adapter = new StorageAdapter(null);
    const records = adapter.loadRecords();

    expect(records).toEqual({
      version: 1,
      bestTimes: {},
      completedMissions: [],
      discoveredLandmarks: [],
      totalCashCop: 0,
      preferredStation: 'salsa_brava',
      muted: false,
    });
  });

  it('persists and reloads validated records under gta_cali_records_v1', () => {
    const backing = new MemoryStorage();
    const adapter = new StorageAdapter(backing);

    adapter.saveRecords({
      version: 1,
      bestTimes: { mission_1_bulevar: 42.5 },
      completedMissions: ['mission_1_bulevar'],
      discoveredLandmarks: ['san_antonio', 'torre_de_cali'],
      totalCashCop: 250_000,
      preferredStation: 'sucursal_synth',
      muted: true,
    });

    const raw = backing.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();

    const reloaded = new StorageAdapter(backing).loadRecords();
    expect(reloaded.bestTimes.mission_1_bulevar).toBe(42.5);
    expect(reloaded.completedMissions).toEqual(['mission_1_bulevar']);
    expect(reloaded.discoveredLandmarks).toEqual(['san_antonio', 'torre_de_cali']);
    expect(reloaded.totalCashCop).toBe(250_000);
    expect(reloaded.preferredStation).toBe('sucursal_synth');
    expect(reloaded.muted).toBe(true);
  });

  it('falls back safely when backing storage contains corrupt JSON or invalid version', () => {
    const backing = new MemoryStorage();
    backing.setItem(STORAGE_KEY, '{corrupt json!!!');

    const adapter = new StorageAdapter(backing);
    expect(adapter.loadRecords()).toEqual({
      version: 1,
      bestTimes: {},
      completedMissions: [],
      discoveredLandmarks: [],
      totalCashCop: 0,
      preferredStation: 'salsa_brava',
      muted: false,
    });

    backing.setItem(STORAGE_KEY, JSON.stringify({ version: 99, totalCashCop: 999 }));
    expect(adapter.loadRecords().totalCashCop).toBe(0);
  });

  it('sanitizes invalid fields inside an otherwise valid v1 payload', () => {
    const backing = new MemoryStorage();
    backing.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        bestTimes: {
          mission_1_bulevar: 31.2,
          mission_2_cristo_rey: -5,
          unknown_mission: 12,
        },
        completedMissions: ['mission_1_bulevar', 'mission_1_bulevar', 'bogus'],
        discoveredLandmarks: ['la_ermita', 'fake_landmark'],
        totalCashCop: -100,
        preferredStation: 'invalid_fm',
        muted: 'yes',
      }),
    );

    const records = new StorageAdapter(backing).loadRecords();
    expect(records.bestTimes).toEqual({ mission_1_bulevar: 31.2 });
    expect(records.completedMissions).toEqual(['mission_1_bulevar']);
    expect(records.discoveredLandmarks).toEqual(['la_ermita']);
    expect(records.totalCashCop).toBe(0);
    expect(records.preferredStation).toBe('salsa_brava');
    expect(records.muted).toBe(false);
  });

  it('silently falls back to in-memory state when storage throws', () => {
    const adapter = new StorageAdapter(new ThrowingStorage());

    expect(adapter.loadRecords().totalCashCop).toBe(0);

    const result = adapter.saveBestTime('mission_1_bulevar', 55.4);
    expect(result.isNewRecord).toBe(true);
    expect(adapter.loadRecords().bestTimes.mission_1_bulevar).toBe(55.4);

    const slower = adapter.saveBestTime('mission_1_bulevar', 70.0);
    expect(slower.isNewRecord).toBe(false);
    expect(adapter.loadRecords().bestTimes.mission_1_bulevar).toBe(55.4);
  });
});

describe('MissionDirector', () => {
  it('runs redesigned Mission 1 on-foot Torre heist through getaway car, La Ermita, and San Antonio hideout', () => {
    const backing = new MemoryStorage();
    const storage = new StorageAdapter(backing);
    const director = new MissionDirector(CALI_MAP, storage);

    expect(director.getSnapshot().mode).toBe('title');
    expect(director.getSnapshot().timeOfDay).toBe('golden_hour');
    expect(director.getSnapshot().isCountdown).toBe(false);
    expect(director.getSnapshot().failureReason).toBeNull();

    // Start Mission 1 (golden_hour, Step 0 on-foot Torre pickup)
    let snap = director.startMission('mission_1_bulevar');
    expect(snap.mode).toBe('playing');
    expect(snap.timeOfDay).toBe('golden_hour');
    expect(snap.isCountdown).toBe(false);
    expect(snap.failureReason).toBeNull();
    expect(snap.missionTitle).toBe(LOCALE_CALI.missions.mission_1_bulevar.title);
    expect(snap.banner?.title).toBe('GOLPE EN LA TORRE');
    expect(snap.banner?.subtitle).toContain('a pie');
    expect(snap.dialogue?.text).toContain('Corre a pie hasta la Torre de Cali');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Pickup.id);
    expect(snap.activeObjective?.kind).toBe('reach_point');
    expect(snap.activeObjective?.requiresOnFoot).toBe(true);
    expect(snap.activeObjective?.propKind).toBe('vinyl_briefcase');
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission1.heistOnFootLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission1.heistOnFootDetail);
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.targetWantedStars).toBe(0);

    // Driving through Torre pickup while in car MUST NOT trigger requiresOnFoot Step 0
    const pickup = CALI_MAP.missionWaypoints.mission1Pickup;
    snap = director.update(makeWorld({ mode: 'driving', x: pickup.x, z: pickup.z }), 2);
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Pickup.id);
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.targetWantedStars).toBe(0);

    // Step 0 -> Step 1: arrive at Torre pickup ON FOOT -> triggers ★★ + alarm banner + board getaway car
    snap = director.update(makeWorld({ mode: 'on_foot', x: pickup.x, z: pickup.z }), 3);
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m1HeistAlarm.title);
    expect(snap.banner?.accent).toBe('police');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1Alarm.text);
    expect(snap.activeObjective?.id).toBe('m1_board_getaway');
    expect(snap.activeObjective?.kind).toBe('enter_vehicle');
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission1.boardGetawayLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission1.boardGetawayDetail);
    expect(snap.activeObjective?.stepIndex).toBe(1);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(snap.activeObjective?.bearingDeltaRad)).toBe(true);

    // Step 1 -> Step 2: board getaway car -> Puente La Ermita / Iglesia La Ermita
    snap = director.update(makeWorld({ mode: 'driving', x: -16, z: -102, heading: 0 }), 5);
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m1Boarded.title);
    expect(snap.banner?.accent).toBe('cyan');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1EscapeCar.text);
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Finish.id);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission1.crossBridgeLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission1.crossBridgeDetail);
    expect(snap.activeObjective?.stepIndex).toBe(2);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);

    // Step 2 -> Step 3: reach Iglesia La Ermita -> escape to Barrio San Antonio hideout
    const finish = CALI_MAP.missionWaypoints.mission1Finish;
    snap = director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 10);
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m1Bridge.title);
    expect(snap.banner?.accent).toBe('gold');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1Bulevar.text);
    expect(snap.dialogue?.text).toContain('Barrio San Antonio');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Hideout.id);
    expect(snap.activeObjective?.kind).toBe('escape_police');
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission1.hideoutLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission1.hideoutDetail);
    expect(snap.activeObjective?.stepIndex).toBe(3);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThan(0);

    // Step 3 -> Mission Passed: reach Barrio San Antonio hideout
    const hideout = CALI_MAP.missionWaypoints.mission1Hideout;
    snap = director.update(makeWorld({ mode: 'driving', x: hideout.x, z: hideout.z }), 12);
    expect(snap.mode).toBe('mission_passed');
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.activeObjective).toBeNull();
    expect(snap.banner).toBeNull();
    expect(snap.rewardCop).toBe(LOCALE_CALI.missions.mission_1_bulevar.rewardCop);
    expect(snap.cashCop).toBe(LOCALE_CALI.missions.mission_1_bulevar.rewardCop);
    expect(snap.lastCompletedTimeSeconds).toBe(32);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.completedMissions).toContain('mission_1_bulevar');
    expect(snap.bestTimes.mission_1_bulevar).toBe(32);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1Passed.text);

    // Persisted in storage for fresh instance
    const reloadedDirector = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
    expect(reloadedDirector.getRecords().bestTimes.mission_1_bulevar).toBe(32);
    expect(reloadedDirector.getRecords().completedMissions).toContain('mission_1_bulevar');
    expect(reloadedDirector.getRecords().totalCashCop).toBe(250_000);
  });

  it('runs redesigned Mission 2 nighttime 95s countdown with +10s speed ring bonuses across all 4 steps to Grand Victory', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));

    let snap = director.startMission('mission_2_cristo_rey');
    expect(snap.mode).toBe('playing');
    expect(snap.timeOfDay).toBe('night');
    expect(snap.isCountdown).toBe(true);
    expect(snap.timerSeconds).toBe(95);
    expect(snap.failureReason).toBeNull();
    expect(snap.targetWantedStars).toBe(3);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Launch.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2Launch.title);
    expect(snap.banner?.accent).toBe('police');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2RingBridge.id);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission2.ringBridgeLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission2.ringBridgeDetail);
    expect(snap.activeObjective?.detail).toContain('+10s');
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('mateo_speakers');

    // Countdown decrements smoothly on each update
    snap = director.update(makeWorld({ mode: 'driving', x: 120, z: 77, wantedStars: 3 }), 10);
    expect(snap.timerSeconds).toBe(85);
    expect(snap.elapsedSeconds).toBe(10);
    expect(snap.targetWantedStars).toBe(3);

    // Step 0 -> Step 1: Reach Puente Bulevar Sur speed ring (+10s bonus -> 85 - 5 + 10 = 90)
    const ringBridge = CALI_MAP.missionWaypoints.mission2RingBridge;
    snap = director.update(
      makeWorld({ mode: 'driving', x: ringBridge.x, z: ringBridge.z, wantedStars: 3 }),
      5,
    );
    expect(snap.timerSeconds).toBe(90);
    expect(snap.targetWantedStars).toBe(3);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2RingBonus.title);
    expect(snap.banner?.title).toContain('+10s');
    expect(snap.banner?.accent).toBe('emerald');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Ring1.text);
    expect(snap.dialogue?.text).toContain('Diez segundos extra');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2RingBulevar.id);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission2.ringBulevarLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission2.ringBulevarDetail);
    expect(snap.activeObjective?.detail).toContain('+10s');
    expect(snap.activeObjective?.stepIndex).toBe(1);
    expect(snap.activeObjective?.totalSteps).toBe(4);

    // Step 1 -> Step 2: Reach Bulevar speed ring (+10s bonus -> 90 - 10 + 10 = 90)
    const ringBulevar = CALI_MAP.missionWaypoints.mission2RingBulevar;
    snap = director.update(
      makeWorld({ mode: 'driving', x: ringBulevar.x, z: ringBulevar.z, wantedStars: 3 }),
      10,
    );
    expect(snap.timerSeconds).toBe(90);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2RingBonus.title);
    expect(snap.banner?.accent).toBe('emerald');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Ring2.text);
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2RampEntry.id);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission2.rampLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission2.rampDetail);
    expect(snap.activeObjective?.stepIndex).toBe(2);
    expect(snap.activeObjective?.totalSteps).toBe(4);

    // Step 2 -> Step 3: Enter Cristo Rey ramp (+10s bonus -> 90 - 10 + 10 = 90)
    const ramp = CALI_MAP.missionWaypoints.mission2RampEntry;
    snap = director.update(
      makeWorld({ mode: 'driving', x: ramp.x, z: ramp.z, wantedStars: 3 }),
      10,
    );
    expect(snap.timerSeconds).toBe(90);
    expect(snap.targetWantedStars).toBe(3);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Ramp.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2Ramp.title);
    expect(snap.banner?.accent).toBe('gold');
    expect(snap.activeObjective?.kind).toBe('escape_police');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2Summit.id);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission2.summitLabel);
    expect(snap.activeObjective?.detail).toBe(LOCALE_CALI.objectives.mission2.summitDetail);
    expect(snap.activeObjective?.stepIndex).toBe(3);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('summit_stage');
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);

    // Step 3 -> Grand Victory: Reach Cristo Rey summit
    const summit = CALI_MAP.missionWaypoints.mission2Summit;
    snap = director.update(
      makeWorld({ mode: 'driving', x: summit.x, z: summit.z, wantedStars: 3 }),
      12,
    );
    expect(snap.mode).toBe('victory');
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.banner).toBeNull();
    expect(snap.rewardCop).toBe(LOCALE_CALI.missions.mission_2_cristo_rey.rewardCop);
    expect(snap.cashCop).toBe(500_000);
    expect(snap.completedMissions).toContain('mission_2_cristo_rey');
    expect(snap.bestTimes.mission_2_cristo_rey).toBe(47);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Passed.text);
  });

  it('fails Mission 2 with mode busted and failureReason time_up when the 95s countdown expires', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    director.startMission('mission_2_cristo_rey');

    let snap = director.update(makeWorld({ mode: 'driving', x: 120, z: 77, wantedStars: 3 }), 75);
    expect(snap.mode).toBe('playing');
    expect(snap.timerSeconds).toBe(20);
    expect(snap.failureReason).toBeNull();

    snap = director.update(makeWorld({ mode: 'driving', x: 120, z: 77, wantedStars: 3 }), 20);
    expect(snap.mode).toBe('busted');
    expect(snap.failureReason).toBe('time_up');
    expect(snap.timerSeconds).toBe(0);
    expect(snap.targetWantedStars).toBe(0);
  });

  it('toggles timeOfDay between golden_hour and night with localized cyan banners', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    director.startMission('free_roam');
    expect(director.getSnapshot().timeOfDay).toBe('golden_hour');

    let snap = director.toggleTimeOfDay();
    expect(snap.timeOfDay).toBe('night');
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.timeChanged.night.title);
    expect(snap.banner?.subtitle).toBe(LOCALE_CALI.banners.timeChanged.night.subtitle);
    expect(snap.banner?.accent).toBe('cyan');

    snap = director.toggleTimeOfDay();
    expect(snap.timeOfDay).toBe('golden_hour');
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.timeChanged.day.title);
    expect(snap.banner?.subtitle).toBe(LOCALE_CALI.banners.timeChanged.day.subtitle);
    expect(snap.banner?.accent).toBe('cyan');
  });

  it('ticks checkpoint banners down to expiry and integrates dynamic police stars across Free Roam and Story', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));

    // Banner countdown in story mission
    let snap = director.startMission('mission_1_bulevar');
    expect(snap.banner?.remainingSeconds).toBeCloseTo(3.6, 5);

    snap = director.update(makeWorld({ mode: 'on_foot', wantedStars: 1 }), 1.5);
    expect(snap.banner?.remainingSeconds).toBeCloseTo(2.1, 5);
    // Story mission mirrors higher dynamic world wanted stars (Math.max(floor=0, world=1))
    expect(snap.targetWantedStars).toBe(1);

    snap = director.update(makeWorld({ mode: 'on_foot', wantedStars: 0 }), 2.5);
    expect(snap.banner).toBeNull();
    expect(snap.targetWantedStars).toBe(0);

    // Free Roam dynamic police transitions: 0 -> >=1 and >=1 -> 0
    snap = director.startMission('free_roam');
    expect(snap.banner).toBeNull();
    expect(snap.targetWantedStars).toBe(0);

    snap = director.update(makeWorld({ mode: 'driving', x: 180, z: 180, wantedStars: 2 }), 0.5);
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.freeRoamWanted.title);
    expect(snap.banner?.accent).toBe('police');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.freeRoamWanted.text);

    // Staying wanted ticks down the banner without resetting it
    snap = director.update(makeWorld({ mode: 'driving', x: 180, z: 180, wantedStars: 3 }), 1.0);
    expect(snap.targetWantedStars).toBe(3);
    expect(snap.banner?.remainingSeconds).toBeCloseTo(2.6, 5);

    // Escaping back to 0 triggers escaped banner & dialogue
    snap = director.update(makeWorld({ mode: 'driving', x: 180, z: 180, wantedStars: 0 }), 0.5);
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.freeRoamEscaped.title);
    expect(snap.banner?.accent).toBe('emerald');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.freeRoamEscaped.text);
  });

  it('transitions to busted mode with failureReason busted when world reports isBusted during story missions', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    director.startMission('mission_1_bulevar');

    const snap = director.update(makeWorld({ mode: 'driving', wantedStars: 2, isBusted: true }), 1);
    expect(snap.mode).toBe('busted');
    expect(snap.failureReason).toBe('busted');
    expect(snap.targetWantedStars).toBe(0);
  });

  it('discovers all 6 landmarks in Free Roam without any timer or objective failure', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    let snap = director.startMission('free_roam');

    expect(snap.mode).toBe('playing');
    expect(snap.activeObjective?.kind).toBe('explore');
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.freeRoam.exploreLabel);

    // Roaming far away with no timer never fails Free Roam (only a police bust does)
    snap = director.update(makeWorld({ x: 200, z: 200 }), 1);
    expect(snap.mode).toBe('playing');

    for (const landmark of CALI_MAP.landmarks) {
      snap = director.update(
        makeWorld({ mode: 'driving', x: landmark.position.x, z: landmark.position.z }),
        1,
      );
    }

    expect(snap.discoveredLandmarks).toHaveLength(CALI_MAP.landmarks.length);
    expect(snap.dialogue?.speaker).toBe('system');
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.freeRoam.allDiscoveredLabel);
    expect(snap.activeObjective?.target).toBeNull();
  });

  it('completes the Free Roam tour as a timed mission only during a Reto AcaDevHack run', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    let snap = director.startMission('free_roam', { challengeRun: true });
    expect(snap.isChallengeRun).toBe(true);

    for (const landmark of CALI_MAP.landmarks) {
      snap = director.update(
        makeWorld({ mode: 'driving', x: landmark.position.x, z: landmark.position.z }),
        10,
      );
    }

    expect(snap.mode).toBe('mission_passed');
    expect(snap.lastCompletedTimeSeconds).toBeCloseTo(10 * CALI_MAP.landmarks.length, 3);
    expect(snap.bestTimes.free_roam).toBeCloseTo(10 * CALI_MAP.landmarks.length, 3);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.freeRoamTourPassed.text);

    // A regular Free Roam session never ends on its own
    snap = director.startMission('free_roam');
    expect(snap.isChallengeRun).toBe(false);
    for (const landmark of CALI_MAP.landmarks) {
      snap = director.update(
        makeWorld({ mode: 'driving', x: landmark.position.x, z: landmark.position.z }),
        10,
      );
    }
    expect(snap.mode).toBe('playing');
  });

  it('shows the Busted screen in casual Free Roam when the world reports a bust (no frozen-world softlock)', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    director.startMission('free_roam');

    const snap = director.update(makeWorld({ mode: 'driving', wantedStars: 1, isBusted: true }), 1);

    expect(snap.mode).toBe('busted');
    expect(snap.failureReason).toBe('busted');
    expect(snap.activeMission).toBe('free_roam');
    expect(snap.isChallengeRun).toBe(false);
  });

  it('fails the Reto Free Roam tour when the world reports a bust (frozen world must not softlock the run)', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    director.startMission('free_roam', { challengeRun: true });

    const snap = director.update(makeWorld({ mode: 'driving', wantedStars: 2, isBusted: true }), 1);

    expect(snap.mode).toBe('busted');
    expect(snap.failureReason).toBe('busted');
    expect(snap.isChallengeRun).toBe(true);
  });

  it('starts Free Roam cleanly at stepIndex 0 (la_ermita) even when localStorage already has all 6 landmarks discovered', () => {
    const backing = new MemoryStorage();
    const storage = new StorageAdapter(backing);
    storage.saveRecords({
      version: 1,
      bestTimes: { mission_1_bulevar: 35, mission_2_cristo_rey: 48 },
      completedMissions: ['mission_1_bulevar', 'mission_2_cristo_rey'],
      discoveredLandmarks: CALI_MAP.landmarks.map((landmark) => landmark.id),
      totalCashCop: 750_000,
      preferredStation: 'salsa_brava',
      muted: false,
    });

    const director = new MissionDirector(CALI_MAP, storage);
    const roamSpawn = CALI_MAP.missionStarts.free_roam.playerSpawn;
    const roamCar = CALI_MAP.missionStarts.free_roam.carSpawn;

    // Immediately after startMission('free_roam'): PASO 1 DE 6 targeting la_ermita
    let snap = director.startMission('free_roam');
    expect(snap.discoveredLandmarks).toHaveLength(6);
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.totalSteps).toBe(6);
    expect(snap.activeObjective?.landmarkId).toBe('la_ermita');
    expect(snap.activeObjective?.target).not.toBeNull();

    // Frame 1 at Free Roam spawn (6, 14) and walking to parked car (-4, 18) MUST NOT auto-skip Step 0
    snap = director.update(makeWorld({ mode: 'on_foot', x: roamSpawn.x, z: roamSpawn.z }), 0.016);
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.landmarkId).toBe('la_ermita');
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThan(0);

    snap = director.update(makeWorld({ mode: 'on_foot', x: roamCar.x, z: roamCar.z }), 0.5);
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.landmarkId).toBe('la_ermita');

    // Progress sequentially through all 6 tour stops: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6
    const tourOrder = [
      'la_ermita',
      'torre_de_cali',
      'san_antonio',
      'cristo_rey',
      'estadio_pascual',
      'bulevar_del_rio',
    ] as const;

    for (let i = 0; i < tourOrder.length; i += 1) {
      const targetId = tourOrder[i];
      const landmark = CALI_MAP.landmarks.find((entry) => entry.id === targetId);
      expect(landmark).toBeDefined();
      snap = director.update(
        makeWorld({ mode: 'driving', x: landmark!.position.x, z: landmark!.position.z }),
        1,
      );
      expect(snap.activeObjective?.stepIndex).toBe(i + 1);
      expect(snap.dialogue?.speaker).toBe('system');
      expect(snap.dialogue?.text).toContain(LOCALE_CALI.landmarks[targetId!]);
      // Lifetime discoveredLandmarks remains intact throughout the tour
      expect(snap.discoveredLandmarks).toHaveLength(6);

      const nextExpectedId = tourOrder[i + 1];
      if (nextExpectedId) {
        expect(snap.activeObjective?.landmarkId).toBe(nextExpectedId);
      } else {
        expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.freeRoam.allDiscoveredLabel);
        expect(snap.activeObjective?.target).toBeNull();
      }
    }

    // Returning to title and starting Free Roam again resets tour cleanly back to stepIndex 0
    director.returnToTitle();
    snap = director.startMission('free_roam');
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.landmarkId).toBe('la_ermita');
    expect(director.getRecords().discoveredLandmarks).toHaveLength(6);
  });

  it('supports pause/resume, returnToTitle, audio preferences, dialogue timeout, and viral ticker rotation', () => {
    const storage = new StorageAdapter(new MemoryStorage());
    const director = new MissionDirector(CALI_MAP, storage);

    director.saveAudioPreferences('sucursal_synth', true);
    expect(director.getRecords().preferredStation).toBe('sucursal_synth');
    expect(director.getRecords().muted).toBe(true);

    let snap = director.startMission('mission_1_bulevar');
    const initialTicker = snap.viralTicker;

    // Pause freezes timer
    snap = director.setPaused(true);
    expect(snap.mode).toBe('paused');
    snap = director.update(makeWorld({ x: 200, z: 200 }), 5);
    expect(snap.elapsedSeconds).toBe(0);

    // Resume and advance 11s -> intro dialogue expires and ticker rotates
    director.setPaused(false);
    snap = director.update(makeWorld({ x: 200, z: 200 }), 11);
    expect(snap.elapsedSeconds).toBe(11);
    expect(snap.dialogue).toBeNull();
    expect(snap.viralTicker).not.toBe(initialTicker);

    // Return to title clears active objective and mode
    snap = director.returnToTitle();
    expect(snap.mode).toBe('title');
    expect(snap.activeObjective).toBeNull();
  });

  it('tracks new record improvements on mission replay and warns on river hazard', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    const pickup = CALI_MAP.missionWaypoints.mission1Pickup;
    const finish = CALI_MAP.missionWaypoints.mission1Finish;
    const hideout = CALI_MAP.missionWaypoints.mission1Hideout;

    // First run: 40s
    director.startMission('mission_1_bulevar');
    const riverSnap = director.update(makeWorld({ mode: 'on_foot', inRiverHazard: true }), 1);
    expect(riverSnap.dialogue?.text).toBe(LOCALE_CALI.dialogues.riverWarning.text);

    director.update(makeWorld({ mode: 'on_foot', x: pickup.x, z: pickup.z }), 9);
    director.update(makeWorld({ mode: 'driving', x: -16, z: -102 }), 10);
    director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 10);
    let snap = director.update(makeWorld({ mode: 'driving', x: hideout.x, z: hideout.z }), 10);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.bestTimes.mission_1_bulevar).toBe(40);

    // Second run slower: 60s -> not a new record
    director.startMission('mission_1_bulevar');
    director.update(makeWorld({ mode: 'on_foot', x: pickup.x, z: pickup.z }), 15);
    director.update(makeWorld({ mode: 'driving', x: -16, z: -102 }), 15);
    director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 15);
    snap = director.update(makeWorld({ mode: 'driving', x: hideout.x, z: hideout.z }), 15);
    expect(snap.isNewRecord).toBe(false);
    expect(snap.bestTimes.mission_1_bulevar).toBe(40);

    // Third run faster: 20s -> beats record
    director.startMission('mission_1_bulevar');
    director.update(makeWorld({ mode: 'on_foot', x: pickup.x, z: pickup.z }), 5);
    director.update(makeWorld({ mode: 'driving', x: -16, z: -102 }), 5);
    director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 5);
    snap = director.update(makeWorld({ mode: 'driving', x: hideout.x, z: hideout.z }), 5);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.bestTimes.mission_1_bulevar).toBe(20);
  });

  it('runs Mission 3 Pique Callejero across all 6 checkpoints with CP3 police ambush and 400k COP reward', () => {
    const backing = new MemoryStorage();
    const storage = new StorageAdapter(backing);
    const director = new MissionDirector(CALI_MAP, storage);
    const checkpoints = CALI_MAP.missionWaypoints.mission3Checkpoints!;
    expect(checkpoints).toHaveLength(6);

    let snap = director.startMission('mission_3_pique_bulevar');
    expect(snap.mode).toBe('playing');
    expect(snap.timeOfDay).toBe('golden_hour');
    expect(snap.isCountdown).toBe(false);
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.missionTitle).toBe(LOCALE_CALI.missions.mission_3_pique_bulevar.title);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m3Intro.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m3Start.title);
    expect(snap.activeObjective?.id).toBe('m3_cp1_bulevar');
    expect(snap.activeObjective?.stepIndex).toBe(0);
    expect(snap.activeObjective?.totalSteps).toBe(6);

    // CP1 -> CP2
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[0]!.x, z: checkpoints[0]!.z }),
      6,
    );
    expect(snap.activeObjective?.id).toBe('m3_cp2_ermita');
    expect(snap.activeObjective?.stepIndex).toBe(1);
    expect(snap.targetWantedStars).toBe(0);

    // CP2 -> CP3
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[1]!.x, z: checkpoints[1]!.z }),
      6,
    );
    expect(snap.activeObjective?.id).toBe('m3_cp3_granada');
    expect(snap.activeObjective?.stepIndex).toBe(2);
    expect(snap.targetWantedStars).toBe(0);

    // CP3 (m3_cp3_granada) -> triggers ★★ police ambush + dialogue + banner, advances to CP4
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[2]!.x, z: checkpoints[2]!.z }),
      7,
    );
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m3Ambush.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m3Ambush.title);
    expect(snap.banner?.accent).toBe('police');
    expect(snap.activeObjective?.id).toBe('m3_cp4_oriente');
    expect(snap.activeObjective?.stepIndex).toBe(3);

    // CP4 -> CP5
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[3]!.x, z: checkpoints[3]!.z, wantedStars: 2 }),
      8,
    );
    expect(snap.activeObjective?.id).toBe('m3_cp5_puente_sur');
    expect(snap.activeObjective?.stepIndex).toBe(4);
    expect(snap.targetWantedStars).toBe(2);

    // CP5 -> CP6 (final finish checkpoint)
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[4]!.x, z: checkpoints[4]!.z, wantedStars: 2 }),
      7,
    );
    expect(snap.activeObjective?.id).toBe('m3_cp6_meta_bulevar');
    expect(snap.activeObjective?.stepIndex).toBe(5);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.mission3.finishLabel);

    // CP6 -> Mission Passed + 400_000 COP + persisted best time
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[5]!.x, z: checkpoints[5]!.z, wantedStars: 2 }),
      6,
    );
    expect(snap.mode).toBe('mission_passed');
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.activeObjective).toBeNull();
    expect(snap.rewardCop).toBe(400_000);
    expect(snap.cashCop).toBe(400_000);
    expect(snap.completedMissions).toContain('mission_3_pique_bulevar');
    expect(snap.bestTimes.mission_3_pique_bulevar).toBe(40);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m3Passed.text);

    // Reloaded from StorageAdapter preserves mission_3_pique_bulevar records
    const reloaded = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
    expect(reloaded.getRecords().completedMissions).toContain('mission_3_pique_bulevar');
    expect(reloaded.getRecords().bestTimes.mission_3_pique_bulevar).toBe(40);
    expect(reloaded.getRecords().totalCashCop).toBe(400_000);
  });

  it('credits stunt jump and drift cashout COP once each and fires stuntJump/payNSpray banners & dialogues', () => {
    const backing = new MemoryStorage();
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
    director.startMission('free_roam');

    // Stunt Jump event awards once
    let snap = director.update(
      makeWorld({
        mode: 'driving',
        x: 180,
        z: 180,
        lastStuntJumpName: 'Salto del Bulevar',
        lastStuntJumpCop: 35_000,
        lastStuntJumpAt: 4.5,
      }),
      0.5,
    );
    expect(snap.cashCop).toBe(35_000);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.stuntJump.title);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.stuntJump.text);

    // Same timestamp repeated -> must NOT double-credit
    snap = director.update(
      makeWorld({
        mode: 'driving',
        x: 180,
        z: 180,
        lastStuntJumpName: 'Salto del Bulevar',
        lastStuntJumpCop: 35_000,
        lastStuntJumpAt: 4.5,
      }),
      0.5,
    );
    expect(snap.cashCop).toBe(35_000);

    // Drift Cashout event awards once, then re-arms after clearing to 0
    snap = director.update(
      makeWorld({
        mode: 'driving',
        x: 180,
        z: 180,
        lastStuntJumpAt: 4.5,
        lastStuntJumpCop: 35_000,
        lastDriftCashoutCop: 6_500,
      }),
      0.5,
    );
    expect(snap.cashCop).toBe(41_500);

    snap = director.update(
      makeWorld({
        mode: 'driving',
        x: 180,
        z: 180,
        lastStuntJumpAt: 4.5,
        lastStuntJumpCop: 35_000,
        lastDriftCashoutCop: 6_500,
      }),
      0.5,
    );
    expect(snap.cashCop).toBe(41_500);

    // Reset cashout to 0 then trigger a second 6_500 cashout -> credits again
    director.update(
      makeWorld({ mode: 'driving', x: 180, z: 180, lastDriftCashoutCop: 0 }),
      0.5,
    );
    snap = director.update(
      makeWorld({ mode: 'driving', x: 180, z: 180, lastDriftCashoutCop: 6_500 }),
      0.5,
    );
    expect(snap.cashCop).toBe(48_000);

    // Pay 'n' Spray fires banner & dialogue and clears mission floor stars
    const checkpoints = CALI_MAP.missionWaypoints.mission3Checkpoints!;
    director.startMission('mission_3_pique_bulevar');
    director.update(makeWorld({ mode: 'driving', x: checkpoints[0]!.x, z: checkpoints[0]!.z }), 2);
    director.update(makeWorld({ mode: 'driving', x: checkpoints[1]!.x, z: checkpoints[1]!.z }), 2);
    snap = director.update(
      makeWorld({ mode: 'driving', x: checkpoints[2]!.x, z: checkpoints[2]!.z }),
      2,
    );
    expect(snap.targetWantedStars).toBe(2);

    snap = director.update(
      makeWorld({
        mode: 'driving',
        x: 96,
        z: -12,
        wantedStars: 0,
        lastPayNSprayName: 'Taller Barrio Granada',
        lastPayNSprayAt: 8.5,
      }),
      0.5,
    );
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.payNSpray.title);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.payNSpray.text);
  });

  it('persists, reloads, and strictly sanitizes GarageConfig via getGarageConfig and saveGarageConfig', () => {
    const backing = new MemoryStorage();
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(backing));

    // Default fallback
    expect(director.getGarageConfig()).toEqual(DEFAULT_GARAGE_CONFIG);

    // Save valid custom GarageConfig and reload in a fresh MissionDirector
    const customGarage: GarageConfig = {
      carKind: 'willys_v8',
      paintHex: 0x10b981,
      neonHex: 0xffb800,
      avatar: 'mateo',
      outfit: 'tricolor',
    };
    const saved = director.saveGarageConfig(customGarage);
    expect(saved).toEqual(customGarage);
    expect(director.getGarageConfig()).toEqual(customGarage);

    const reloaded = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
    expect(reloaded.getGarageConfig()).toEqual(customGarage);

    // New Cali looks persist too
    for (const outfit of ['camiseta_seleccion', 'esqueleto_blanco', 'camisa_salsera'] as const) {
      director.saveGarageConfig({ ...customGarage, outfit });
      expect(new MissionDirector(CALI_MAP, new StorageAdapter(backing)).getGarageConfig().outfit).toBe(outfit);
    }

    // Corrupt/invalid garage fields in localStorage are strictly sanitized
    backing.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        bestTimes: {},
        completedMissions: [],
        discoveredLandmarks: [],
        totalCashCop: 0,
        preferredStation: 'salsa_brava',
        muted: false,
        garage: {
          carKind: 'invalid_spaceship',
          paintHex: -42,
          neonHex: 0x1ffffff,
          avatar: 'unknown_avatar',
          outfit: 'unknown_outfit',
        },
      }),
    );
    const sanitizedDirector = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
    expect(sanitizedDirector.getGarageConfig()).toEqual(DEFAULT_GARAGE_CONFIG);
  });

  it('persists every classic Cali car and moto kind through the sanitized garage round-trip', () => {
    const newKinds = [
      'mazda_323_coupe',
      'renault_18_gtx',
      'chevrolet_sprint_turbo',
      'chevrolet_monza',
      'nissan_sentra_b13',
      'chevette_turbo',
      'renault_twingo',
      'yamaha_rx115',
      'yamaha_dt125',
    ] as const;

    for (const carKind of newKinds) {
      const backing = new MemoryStorage();
      const director = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
      const garage: GarageConfig = {
        carKind,
        paintHex: 0xe11d48,
        neonHex: 0x00f0ff,
        avatar: 'valeria',
        outfit: 'escarlata',
      };
      director.saveGarageConfig(garage);
      const reloaded = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
      expect(reloaded.getGarageConfig().carKind, carKind).toBe(carKind);
    }
  });
});
