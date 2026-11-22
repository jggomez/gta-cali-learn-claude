import { describe, expect, it } from 'vitest';
import { CALI_MAP } from '../../../src/config/caliMap';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import {
  MissionDirector,
  STORAGE_KEY,
  StorageAdapter,
  type StorageLike,
} from '../../../src/missions/missionDirector';
import type { PlayerMode, WantedLevel, WorldSnapshot } from '../../../src/types/game';

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
  it('runs complete Mission 1 progression with wanted stars, reward, dialogue, and best time persistence', () => {
    const backing = new MemoryStorage();
    const storage = new StorageAdapter(backing);
    const director = new MissionDirector(CALI_MAP, storage);

    expect(director.getSnapshot().mode).toBe('title');

    // Start Mission 1
    let snap = director.startMission('mission_1_bulevar');
    expect(snap.mode).toBe('playing');
    expect(snap.missionTitle).toBe(LOCALE_CALI.missions.mission_1_bulevar.title);
    expect(snap.activeObjective?.kind).toBe('enter_vehicle');
    expect(snap.activeObjective?.propKind).toBe('none');
    expect(snap.dialogue?.speaker).toBe('valeria');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1Intro.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m1Start.title);
    expect(snap.banner?.subtitle).toBe(LOCALE_CALI.banners.m1Start.subtitle);
    expect(snap.banner?.accent).toBe('cyan');
    expect(snap.banner?.remainingSeconds).toBeCloseTo(3.6, 5);
    expect(snap.targetWantedStars).toBe(0);

    // Step 0 -> Step 1: enter Banshee
    snap = director.update(makeWorld({ mode: 'driving', x: -82, z: 36, heading: Math.PI / 2 }), 2);
    expect(snap.activeObjective?.kind).toBe('reach_point');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Pickup.id);
    expect(snap.activeObjective?.stepIndex).toBe(1);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('vinyl_briefcase');
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThan(0);
    expect(Number.isFinite(snap.activeObjective?.bearingDeltaRad)).toBe(true);

    // Step 1 -> Step 2: reach Torre de Cali pickup (triggers 2 wanted stars + banner)
    const pickup = CALI_MAP.missionWaypoints.mission1Pickup;
    snap = director.update(makeWorld({ mode: 'driving', x: pickup.x, z: pickup.z }), 10);
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.dialogue?.speaker).toBe('mateo');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1Pickup.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m1Pickup.title);
    expect(snap.banner?.accent).toBe('police');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Escape.id);
    expect(snap.activeObjective?.stepIndex).toBe(2);
    expect(snap.activeObjective?.propKind).toBe('none');
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);

    // Step 2 -> Step 3: reach Bulevar del Río
    const escape = CALI_MAP.missionWaypoints.mission1Escape;
    snap = director.update(makeWorld({ mode: 'driving', x: escape.x, z: escape.z }), 8);
    expect(snap.targetWantedStars).toBe(2);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m1Bulevar.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m1Bulevar.title);
    expect(snap.banner?.accent).toBe('gold');
    expect(snap.activeObjective?.kind).toBe('escape_police');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission1Finish.id);
    expect(snap.activeObjective?.stepIndex).toBe(3);
    expect(snap.activeObjective?.propKind).toBe('none');
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThan(0);

    // Step 3 -> Mission Passed: reach Iglesia La Ermita
    const finish = CALI_MAP.missionWaypoints.mission1Finish;
    snap = director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 12);
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

  it('runs complete Mission 2 4-step progression through ramp guidance to Grand Victory epilogue with 3 wanted stars', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));

    let snap = director.startMission('mission_2_cristo_rey');
    expect(snap.mode).toBe('playing');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Intro.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2Start.title);
    expect(snap.banner?.accent).toBe('gold');
    expect(snap.activeObjective?.kind).toBe('enter_vehicle');
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('none');

    // Step 0 -> Step 1: Enter vehicle -> Estadio Pascual Guerrero
    snap = director.update(makeWorld({ mode: 'driving', x: -82, z: 36 }), 3);
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2Stage.id);
    expect(snap.activeObjective?.stepIndex).toBe(1);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('mateo_speakers');
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThan(0);
    expect(Number.isFinite(snap.activeObjective?.bearingDeltaRad)).toBe(true);
    expect(snap.targetWantedStars).toBe(0);

    // Step 1 -> Step 2: Reach Estadio -> 3 wanted stars -> Av. Circunvalar ramp entry
    const stage = CALI_MAP.missionWaypoints.mission2Stage;
    snap = director.update(makeWorld({ mode: 'driving', x: stage.x, z: stage.z }), 14);
    expect(snap.targetWantedStars).toBe(3);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Stage.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2Stage.title);
    expect(snap.banner?.accent).toBe('police');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2RampEntry.id);
    expect(snap.activeObjective?.stepIndex).toBe(2);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('none');
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(snap.activeObjective?.distanceMeters).toBeGreaterThan(0);

    // Step 2 -> Step 3: Reach Ramp Entry -> Cristo Rey summit stage
    const ramp = CALI_MAP.missionWaypoints.mission2RampEntry;
    snap = director.update(makeWorld({ mode: 'driving', x: ramp.x, z: ramp.z }), 10);
    expect(snap.targetWantedStars).toBe(3);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Ramp.text);
    expect(snap.banner?.title).toBe(LOCALE_CALI.banners.m2Ramp.title);
    expect(snap.banner?.accent).toBe('gold');
    expect(snap.activeObjective?.kind).toBe('escape_police');
    expect(snap.activeObjective?.id).toBe(CALI_MAP.missionWaypoints.mission2Summit.id);
    expect(snap.activeObjective?.stepIndex).toBe(3);
    expect(snap.activeObjective?.totalSteps).toBe(4);
    expect(snap.activeObjective?.propKind).toBe('summit_stage');
    expect((snap.activeObjective?.gpsRoute?.length ?? 0)).toBeGreaterThanOrEqual(2);

    // Step 3 -> Grand Victory: Reach Cristo Rey summit
    const summit = CALI_MAP.missionWaypoints.mission2Summit;
    snap = director.update(makeWorld({ mode: 'driving', x: summit.x, z: summit.z }), 10);
    expect(snap.mode).toBe('victory');
    expect(snap.targetWantedStars).toBe(0);
    expect(snap.banner).toBeNull();
    expect(snap.rewardCop).toBe(LOCALE_CALI.missions.mission_2_cristo_rey.rewardCop);
    expect(snap.cashCop).toBe(500_000);
    expect(snap.completedMissions).toContain('mission_2_cristo_rey');
    expect(snap.bestTimes.mission_2_cristo_rey).toBe(37);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.dialogue?.text).toBe(LOCALE_CALI.dialogues.m2Passed.text);
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

  it('transitions to busted mode when world reports isBusted during story missions', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    director.startMission('mission_1_bulevar');

    const snap = director.update(makeWorld({ mode: 'driving', wantedStars: 2, isBusted: true }), 1);
    expect(snap.mode).toBe('busted');
    expect(snap.targetWantedStars).toBe(0);
  });

  it('discovers all 6 landmarks in Free Roam with zero fail condition', () => {
    const director = new MissionDirector(CALI_MAP, new StorageAdapter(new MemoryStorage()));
    let snap = director.startMission('free_roam');

    expect(snap.mode).toBe('playing');
    expect(snap.activeObjective?.kind).toBe('explore');
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI.objectives.freeRoam.exploreLabel);

    // Even if world.isBusted were true, Free Roam has zero fail condition
    snap = director.update(makeWorld({ isBusted: true, x: 200, z: 200 }), 1);
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
    const escape = CALI_MAP.missionWaypoints.mission1Escape;
    const finish = CALI_MAP.missionWaypoints.mission1Finish;

    // First run: 40s
    director.startMission('mission_1_bulevar');
    const riverSnap = director.update(makeWorld({ mode: 'on_foot', inRiverHazard: true }), 1);
    expect(riverSnap.dialogue?.text).toBe(LOCALE_CALI.dialogues.riverWarning.text);

    director.update(makeWorld({ mode: 'driving', x: -82, z: 36 }), 9);
    director.update(makeWorld({ mode: 'driving', x: pickup.x, z: pickup.z }), 10);
    director.update(makeWorld({ mode: 'driving', x: escape.x, z: escape.z }), 10);
    let snap = director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 10);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.bestTimes.mission_1_bulevar).toBe(40);

    // Second run slower: 60s -> not a new record
    director.startMission('mission_1_bulevar');
    director.update(makeWorld({ mode: 'driving', x: -82, z: 36 }), 15);
    director.update(makeWorld({ mode: 'driving', x: pickup.x, z: pickup.z }), 15);
    director.update(makeWorld({ mode: 'driving', x: escape.x, z: escape.z }), 15);
    snap = director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 15);
    expect(snap.isNewRecord).toBe(false);
    expect(snap.bestTimes.mission_1_bulevar).toBe(40);

    // Third run faster: 20s -> beats record
    director.startMission('mission_1_bulevar');
    director.update(makeWorld({ mode: 'driving', x: -82, z: 36 }), 5);
    director.update(makeWorld({ mode: 'driving', x: pickup.x, z: pickup.z }), 5);
    director.update(makeWorld({ mode: 'driving', x: escape.x, z: escape.z }), 5);
    snap = director.update(makeWorld({ mode: 'driving', x: finish.x, z: finish.z }), 5);
    expect(snap.isNewRecord).toBe(true);
    expect(snap.bestTimes.mission_1_bulevar).toBe(20);
  });
});
