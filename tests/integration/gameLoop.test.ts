import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audioEngine';
import {
  VoiceEngine,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
} from '../../src/audio/voiceEngine';
import { CALI_MAP, DEFAULT_GARAGE_CONFIG } from '../../src/config/caliMap';
import { LOCALE_CALI } from '../../src/config/localeCali';
import { GameApp } from '../../src/game/gameApp';
import { InputManager, type InputTargetLike } from '../../src/game/inputManager';
import {
  MissionDirector,
  STORAGE_KEY,
  StorageAdapter,
  type StorageLike,
} from '../../src/missions/missionDirector';
import { GameWorld } from '../../src/simulation/gameWorld';
import { normalizeAngle } from '../../src/simulation/physics';
import type {
  CaliMapConfig,
  GarageConfig,
  InputState,
  MissionId,
  MissionSnapshot,
  Vec2,
  WorldSnapshot,
} from '../../src/types/game';

const STEP_DT = 1 / 60;

const IDLE_INPUT: InputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  boost: false,
  interactPressed: false,
  hornPressed: false,
};

function createMemoryStorage(): StorageLike & { readonly store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

class FakeDomNode {
  public readonly tagName: string;
  public className = '';
  public textContent = '';
  public hidden = false;
  public type = '';
  public width = 0;
  public height = 0;
  public clientWidth = 1280;
  public clientHeight = 720;
  public readonly dataset: Record<string, string> = {};
  public readonly style: Record<string, string> = {};
  public readonly children: FakeDomNode[] = [];
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, EventListener[]>();
  private parent: FakeDomNode | null = null;

  public constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public append(...nodes: FakeDomNode[]): void {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  public appendChild(node: FakeDomNode): FakeDomNode {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  public remove(): void {
    if (!this.parent) {
      return;
    }
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) {
      this.parent.children.splice(idx, 1);
    }
    this.parent = null;
  }

  public addEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type);
    if (!list) {
      return;
    }
    const idx = list.indexOf(listener);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
  }

  public click(): void {
    for (const listener of this.listeners.get('click') ?? []) {
      listener({} as Event);
    }
  }

  public contains(): boolean {
    return false;
  }

  public getContext(): null {
    return null;
  }

  public findFirst(predicate: (el: FakeDomNode) => boolean): FakeDomNode | null {
    if (predicate(this)) {
      return this;
    }
    for (const child of this.children) {
      const hit = child.findFirst(predicate);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
}

class SyntheticInputTarget implements InputTargetLike {
  private readonly handlers = new Map<string, Set<EventListener>>();
  public readonly lastOptions = new Map<string, boolean | AddEventListenerOptions | undefined>();
  public pointerLockResult: Promise<void> | (() => never) | void = undefined;
  public pointerLockCalls = 0;

  public addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(listener);
    this.lastOptions.set(type, options);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.handlers.get(type)?.delete(listener);
  }

  public listenerCount(type?: string): number {
    if (type !== undefined) {
      return this.handlers.get(type)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }

  public requestPointerLock(): Promise<void> | void {
    this.pointerLockCalls += 1;
    const result = this.pointerLockResult;
    if (typeof result === 'function') {
      return result();
    }
    return result;
  }

  public emit(
    type: string,
    event: Partial<KeyboardEvent> &
      Partial<PointerEvent> &
      Partial<WheelEvent> & { prevented?: boolean } = {},
  ): boolean {
    let prevented = false;
    const syntheticEvent = {
      code: '',
      repeat: false,
      target: null,
      ...event,
      preventDefault(): void {
        prevented = true;
      },
    } as unknown as Event;

    const listeners = this.handlers.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(syntheticEvent);
      }
    }
    return prevented;
  }
}

interface LoopContext {
  readonly world: GameWorld;
  readonly mission: MissionDirector;
  readonly audio: AudioEngine;
}

interface LoopSnapshot {
  readonly world: Readonly<WorldSnapshot>;
  readonly mission: Readonly<MissionSnapshot>;
}

function startMissionInLoop(
  ctx: LoopContext,
  missionId: MissionId,
  map: CaliMapConfig = CALI_MAP,
): LoopSnapshot {
  const start = map.missionStarts[missionId];
  ctx.world.reset({
    spawn: start.playerSpawn,
    carSpawn: start.carSpawn,
    startInVehicle: start.startInVehicle,
    wantedStars: start.initialWantedStars,
  });
  const mission = ctx.mission.startMission(missionId);
  return { world: ctx.world.getSnapshot(), mission };
}

function stepLoopOnce(
  ctx: LoopContext,
  input: InputState,
  dt: number = STEP_DT,
): LoopSnapshot {
  const prevMission = ctx.mission.getSnapshot();
  const prevObjectiveStep = prevMission.activeObjective?.stepIndex ?? -1;

  let worldSnap = ctx.world.step(dt, input);
  const missionSnap = ctx.mission.update(worldSnap, dt);
  const nextObjectiveStep = missionSnap.activeObjective?.stepIndex ?? -1;
  let worldMutated = false;

  if (
    missionSnap.mode === 'playing' &&
    missionSnap.activeMission === 'mission_2_cristo_rey' &&
    prevObjectiveStep >= 0 &&
    nextObjectiveStep > prevObjectiveStep
  ) {
    ctx.world.refillNitro();
    worldMutated = true;
  }

  if (worldSnap.wantedStars !== missionSnap.targetWantedStars) {
    ctx.world.setWantedStars(missionSnap.targetWantedStars);
    worldMutated = true;
  }

  if (worldMutated) {
    worldSnap = ctx.world.getSnapshot();
  }

  ctx.audio.update(worldSnap, dt);
  return { world: worldSnap, mission: missionSnap };
}

function walkToTarget(
  ctx: LoopContext,
  target: Vec2,
  stopWhen: (snap: LoopSnapshot) => boolean,
  maxSteps: number = 600,
): LoopSnapshot {
  let latest: LoopSnapshot = {
    world: ctx.world.getSnapshot(),
    mission: ctx.mission.getSnapshot(),
  };

  for (let i = 0; i < maxSteps && !stopWhen(latest); i += 1) {
    if (latest.mission.mode !== 'playing') {
      break;
    }
    const dx = target.x - latest.world.player.x;
    const dz = target.z - latest.world.player.z;
    const desiredHeading = Math.atan2(dx, dz);
    const headingError = normalizeAngle(desiredHeading - latest.world.player.heading);
    const input: InputState = {
      ...IDLE_INPUT,
      forward: Math.abs(headingError) < 0.7,
      left: headingError > 0.05,
      right: headingError < -0.05,
      boost: true,
    };
    latest = stepLoopOnce(ctx, input);
  }

  return latest;
}

function walkAndBoardBanshee(ctx: LoopContext): LoopSnapshot {
  const initialCar = ctx.world
    .getSnapshot()
    .vehicles.find((v) => v.id === 'player_banshee');
  expect(initialCar).toBeDefined();

  let latest = walkToTarget(
    ctx,
    { x: initialCar!.x, z: initialCar!.z },
    (snap) =>
      snap.world.player.canEnterVehicle &&
      snap.world.player.nearbyVehicleId === 'player_banshee',
  );

  expect(latest.world.player.canEnterVehicle).toBe(true);
  expect(latest.world.player.nearbyVehicleId).toBe('player_banshee');

  latest = stepLoopOnce(ctx, { ...IDLE_INPUT, interactPressed: true });
  latest = stepLoopOnce(ctx, IDLE_INPUT);

  expect(latest.world.player.mode).toBe('driving');
  expect(latest.world.player.vehicleId).toBe('player_banshee');
  return latest;
}

function computeSteeringInput(world: WorldSnapshot, target: Vec2, useBoost: boolean): InputState {
  const dx = target.x - world.player.x;
  const dz = target.z - world.player.z;
  const dist = Math.hypot(dx, dz);
  const desiredHeading = Math.atan2(dx, dz);
  const headingError = normalizeAngle(desiredHeading - world.player.heading);
  const absErr = Math.abs(headingError);

  // If facing almost opposite while stationary or slow, steer tightly forward to U-turn quickly
  const needSharpTurn = absErr > 0.75;
  const shouldBrakeForTurn = absErr > 0.9 && world.player.speedMps > 16;
  const left = headingError > 0.04;
  const right = headingError < -0.04;

  return {
    forward: !shouldBrakeForTurn,
    backward: shouldBrakeForTurn,
    left,
    right,
    handbrake: needSharpTurn && world.player.speedMps > 12,
    boost: useBoost && absErr < 0.25 && dist > 18 && world.player.nitro > 10,
    interactPressed: false,
    hornPressed: false,
  };
}

function driveRoute(
  ctx: LoopContext,
  waypoints: readonly Vec2[],
  options: {
    readonly arrivalRadius?: number;
    readonly maxSteps?: number;
    readonly useBoost?: boolean;
    readonly stopWhen?: (snap: LoopSnapshot) => boolean;
  } = {},
): { world: Readonly<WorldSnapshot>; mission: Readonly<MissionSnapshot>; steps: number } {
  const arrivalRadius = options.arrivalRadius ?? 10;
  const maxSteps = options.maxSteps ?? 4200;
  const useBoost = options.useBoost ?? true;

  let waypointIndex = 0;
  let steps = 0;
  let latest: LoopSnapshot = {
    world: ctx.world.getSnapshot(),
    mission: ctx.mission.getSnapshot(),
  };

  while (waypointIndex < waypoints.length && steps < maxSteps) {
    if (latest.mission.mode !== 'playing' || options.stopWhen?.(latest)) {
      break;
    }

    const currentTarget = waypoints[waypointIndex];
    if (!currentTarget) {
      break;
    }

    const dist = Math.hypot(
      currentTarget.x - latest.world.player.x,
      currentTarget.z - latest.world.player.z,
    );
    const threshold = waypointIndex === waypoints.length - 1 ? arrivalRadius : Math.max(arrivalRadius, 11);

    if (dist <= threshold) {
      waypointIndex += 1;
      continue;
    }

    const input = computeSteeringInput(latest.world, currentTarget, useBoost);
    latest = stepLoopOnce(ctx, input);
    steps += 1;
  }

  return { ...latest, steps };
}

describe('GTA VI: Cali headless game loop integration', () => {
  it('completes Mission 1 (Golpe en la Torre) on foot to pickup, getaway Ferrari, Puente La Ermita, and San Antonio hideout', () => {
    const rawStorage = createMemoryStorage();
    const storage = new StorageAdapter(rawStorage);
    const world = new GameWorld(CALI_MAP);
    const mission = new MissionDirector(CALI_MAP, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    const initial = startMissionInLoop(ctx, 'mission_1_bulevar');
    const m1Start = CALI_MAP.missionStarts.mission_1_bulevar;
    expect(initial.world.player.mode).toBe('on_foot');
    expect(initial.world.player.x).toBe(m1Start.playerSpawn.x);
    expect(initial.world.player.z).toBe(m1Start.playerSpawn.z);
    expect(initial.world.wantedStars).toBe(0);
    expect(initial.mission.activeObjective?.id).toBe('m1_torre_pickup');

    // Step 0 -> Step 1: Walk on foot at Torre de Cali to (-4, -112) to trigger 2 wanted stars
    const atPickup = walkToTarget(
      ctx,
      { x: -4, z: -112 },
      (snap) => snap.mission.activeObjective?.id !== 'm1_torre_pickup',
    );
    expect(atPickup.world.player.mode).toBe('on_foot');
    expect(atPickup.mission.mode).toBe('playing');
    expect(atPickup.mission.activeObjective?.id).toBe('m1_board_getaway');
    expect(atPickup.mission.targetWantedStars).toBe(2);
    expect(atPickup.world.wantedStars).toBe(2);

    // Step 1 -> Step 2: Walk to parked Ferrari getaway car and board with F
    const afterBoard = walkAndBoardBanshee(ctx);
    expect(afterBoard.mission.mode).toBe('playing');
    expect(afterBoard.mission.activeObjective?.id).toBe('m1_ermita_finish');
    expect(afterBoard.world.wantedStars).toBeGreaterThanOrEqual(2);

    // Step 2 -> Step 3: Escape south down Av. Colombia & across Puente La Ermita to (58, -24)
    const atErmita = driveRoute(
      ctx,
      [
        { x: -4, z: -92 },
        { x: -4, z: -24 },
        { x: 20, z: -24 },
        { x: 50, z: -24 },
        { x: 58, z: -24 },
      ],
      { arrivalRadius: 6 },
    );

    expect(atErmita.mission.mode).toBe('playing');
    expect(atErmita.mission.activeObjective?.id).toBe('m1_san_antonio_hideout');

    // Step 3 -> Mission Passed: Loop back across Puente La Ermita to San Antonio hideout (-82, 36)
    const atHideout = driveRoute(
      ctx,
      [
        { x: 50, z: -24 },
        { x: 20, z: -24 },
        { x: -4, z: -24 },
        { x: -4, z: 36 },
        { x: -82, z: 36 },
      ],
      { arrivalRadius: 12 },
    );

    expect(atHideout.mission.mode).toBe('mission_passed');
    expect(atHideout.mission.cashCop).toBe(250_000);
    expect(atHideout.mission.rewardCop).toBe(250_000);
    expect(atHideout.mission.isNewRecord).toBe(true);
    expect(atHideout.mission.bestTimes.mission_1_bulevar).toBeGreaterThan(0);
    expect(atHideout.world.wantedStars).toBe(0);

    // Verify persistence across a fresh StorageAdapter read
    const reloaded = new StorageAdapter(rawStorage).loadRecords();
    expect(reloaded.completedMissions).toContain('mission_1_bulevar');
    expect(reloaded.totalCashCop).toBe(250_000);
    expect(reloaded.bestTimes.mission_1_bulevar).toBeGreaterThan(0);

    audio.dispose();
  });

  it('completes Mission 2 (Noche de Salsa en Cristo Rey) at night with countdown, nitro ring refills, and Cristo Rey summit', () => {
    const rawStorage = createMemoryStorage();
    const storage = new StorageAdapter(rawStorage);
    // Seed prior Mission 1 cash so we also validate cumulative cash progression
    storage.saveRecords({
      version: 1,
      bestTimes: { mission_1_bulevar: 42.5 },
      completedMissions: ['mission_1_bulevar'],
      discoveredLandmarks: ['san_antonio'],
      totalCashCop: 250_000,
      preferredStation: 'salsa_brava',
      muted: false,
    });

    const world = new GameWorld(CALI_MAP);
    const mission = new MissionDirector(CALI_MAP, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    const initial = startMissionInLoop(ctx, 'mission_2_cristo_rey');
    const m2Start = CALI_MAP.missionStarts.mission_2_cristo_rey;
    expect(initial.world.player.mode).toBe('driving');
    expect(initial.world.player.vehicleId).toBe('player_banshee');
    expect(initial.world.player.x).toBe(m2Start.carSpawn.x);
    expect(initial.world.player.z).toBe(m2Start.carSpawn.z);
    expect(initial.world.wantedStars).toBe(3);
    expect(initial.mission.timeOfDay).toBe('night');
    expect(initial.mission.isCountdown).toBe(true);
    expect(initial.mission.timerSeconds).toBeCloseTo(95, 1);
    expect(initial.mission.targetWantedStars).toBe(3);
    expect(initial.mission.activeObjective?.id).toBe('m2_ring_bridge');

    // Step 0 -> Step 1: Cross Puente Bulevar Sur ring (35, 77) in westbound lane and verify nitro refill
    const atBridgeRing = driveRoute(
      ctx,
      [
        { x: 76, z: 72 },
        { x: 35, z: 72 },
      ],
      {
        arrivalRadius: 14,
        stopWhen: (snap) => snap.mission.activeObjective?.id !== 'm2_ring_bridge',
      },
    );

    expect(atBridgeRing.mission.mode).toBe('playing');
    expect(atBridgeRing.mission.activeObjective?.id).toBe('m2_ring_bulevar');
    expect(atBridgeRing.mission.activeObjective?.stepIndex).toBe(1);
    expect(atBridgeRing.world.player.nitro).toBe(100);
    expect(atBridgeRing.world.wantedStars).toBe(3);

    // Step 1 -> Step 2: Cross Bulevar del Río ring (-4, 16)
    const atBulevarRing = driveRoute(
      ctx,
      [
        { x: 20, z: 72 },
        { x: -2, z: 72 },
        { x: -4, z: 46 },
        { x: -4, z: 16 },
      ],
      {
        arrivalRadius: 14,
        stopWhen: (snap) => snap.mission.activeObjective?.id !== 'm2_ring_bulevar',
      },
    );

    expect(atBulevarRing.mission.mode).toBe('playing');
    expect(atBulevarRing.mission.activeObjective?.id).toBe('m2_cristo_rey_ramp');
    expect(atBulevarRing.mission.activeObjective?.stepIndex).toBe(2);
    expect(atBulevarRing.world.player.nitro).toBe(100);

    // Step 2 -> Step 3: Enter Cristo Rey ramp (-68, -24)
    const atRamp = driveRoute(
      ctx,
      [
        { x: -4, z: -24 },
        { x: -36, z: -24 },
        { x: -68, z: -24 },
      ],
      {
        arrivalRadius: 16,
        stopWhen: (snap) => snap.mission.activeObjective?.id !== 'm2_cristo_rey_ramp',
      },
    );

    expect(atRamp.mission.mode).toBe('playing');
    expect(atRamp.mission.activeObjective?.id).toBe('m2_cristo_rey_summit');
    expect(atRamp.mission.activeObjective?.stepIndex).toBe(3);
    expect(atRamp.mission.activeObjective?.totalSteps).toBe(4);
    expect(atRamp.mission.activeObjective?.propKind).toBe('summit_stage');
    expect(atRamp.world.player.nitro).toBe(100);

    // Step 3 -> Victory: Climb Cerro Los Cristales ramp to Mirador de Cristo Rey (-176, -24)
    const atCristoRey = driveRoute(
      ctx,
      [
        { x: -120, z: -24 },
        { x: -176, z: -24 },
      ],
      { arrivalRadius: 13, maxSteps: 2400 },
    );

    expect(atCristoRey.mission.mode).toBe('victory');
    expect(atCristoRey.world.player.y).toBeGreaterThan(18);
    expect(atCristoRey.mission.cashCop).toBe(750_000);
    expect(atCristoRey.mission.bestTimes.mission_2_cristo_rey).toBeGreaterThan(0);
    expect(atCristoRey.mission.completedMissions).toContain('mission_2_cristo_rey');
    expect(atCristoRey.world.wantedStars).toBe(0);

    audio.dispose();
  });

  it('fails Mission 2 with failureReason time_up when the 95s nighttime countdown hits 0', () => {
    const noPoliceMap: CaliMapConfig = { ...CALI_MAP, policeSpawns: [] };
    const storage = new StorageAdapter(createMemoryStorage());
    const world = new GameWorld(noPoliceMap);
    const mission = new MissionDirector(noPoliceMap, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    const started = startMissionInLoop(ctx, 'mission_2_cristo_rey', noPoliceMap);
    expect(started.mission.isCountdown).toBe(true);
    expect(started.mission.timerSeconds).toBeCloseTo(95, 1);

    let latest = started;
    for (let i = 0; i < 1050 && latest.mission.mode === 'playing'; i += 1) {
      latest = stepLoopOnce(ctx, IDLE_INPUT, 0.1);
    }

    expect(latest.mission.mode).toBe('busted');
    expect(latest.mission.timerSeconds).toBe(0);
    expect(latest.mission.failureReason).toBe('time_up');

    audio.dispose();
  });

  it('starts Free Roam at Bulevar del Río and toggles golden_hour <-> night via KeyT / toggleTimeOfDay', () => {
    const storage = new StorageAdapter(createMemoryStorage());
    const world = new GameWorld(CALI_MAP);
    const mission = new MissionDirector(CALI_MAP, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    const started = startMissionInLoop(ctx, 'free_roam');
    const roamStart = CALI_MAP.missionStarts.free_roam;
    expect(started.world.player.mode).toBe('on_foot');
    expect(started.world.player.x).toBe(roamStart.playerSpawn.x);
    expect(started.world.player.z).toBe(roamStart.playerSpawn.z);
    expect(started.world.currentDistrict).toBe('Bulevar del Río');
    expect(started.mission.timeOfDay).toBe('golden_hour');
    expect(started.mission.isCountdown).toBe(false);

    const target = new SyntheticInputTarget();
    const inputManager = new InputManager(
      {
        onToggleTimeOfDay: () => {
          if (mission.getSnapshot().mode === 'playing') {
            mission.toggleTimeOfDay();
          }
        },
        isPlaying: () => mission.getSnapshot().mode === 'playing',
      },
      target,
    );

    // KeyT toggles golden_hour -> night (ignoring key repeat)
    target.emit('keydown', { code: 'KeyT' });
    target.emit('keydown', { code: 'KeyT', repeat: true });
    expect(mission.getSnapshot().timeOfDay).toBe('night');

    // Release and press KeyT again -> night -> golden_hour
    target.emit('keyup', { code: 'KeyT' });
    target.emit('keydown', { code: 'KeyT' });
    expect(mission.getSnapshot().timeOfDay).toBe('golden_hour');

    // Ignored when typing inside an input element or while paused
    target.emit('keyup', { code: 'KeyT' });
    target.emit('keydown', {
      code: 'KeyT',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    });
    expect(mission.getSnapshot().timeOfDay).toBe('golden_hour');

    mission.setPaused(true);
    target.emit('keydown', { code: 'KeyT' });
    expect(mission.getSnapshot().timeOfDay).toBe('golden_hour');

    inputManager.dispose();
    audio.dispose();
  });

  it('freezes simulation progression while paused, resumes cleanly, and resets state on restart', () => {
    const storage = new StorageAdapter(createMemoryStorage());
    const world = new GameWorld(CALI_MAP);
    const mission = new MissionDirector(CALI_MAP, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    startMissionInLoop(ctx, 'mission_1_bulevar');
    walkAndBoardBanshee(ctx);

    // Accelerate briefly and trigger wanted stars
    world.setWantedStars(2);
    for (let i = 0; i < 45; i += 1) {
      stepLoopOnce(ctx, { ...IDLE_INPUT, forward: true });
    }

    const beforePauseWorld = world.getSnapshot();
    const beforePauseMission = mission.getSnapshot();
    expect(beforePauseWorld.player.speedKmh).toBeGreaterThan(20);
    expect(beforePauseMission.timerSeconds).toBeGreaterThan(0.5);

    // Pause freezes both simulation stepping (gated by mode === 'playing') and mission timer
    const pausedMission = mission.setPaused(true);
    expect(pausedMission.mode).toBe('paused');

    for (let i = 0; i < 30; i += 1) {
      if (mission.getSnapshot().mode === 'playing') {
        stepLoopOnce(ctx, { ...IDLE_INPUT, forward: true });
      } else {
        mission.update(world.getSnapshot(), STEP_DT);
      }
    }

    const duringPauseWorld = world.getSnapshot();
    const duringPauseMission = mission.getSnapshot();
    expect(duringPauseWorld.timeSeconds).toBe(beforePauseWorld.timeSeconds);
    expect(duringPauseWorld.player.x).toBe(beforePauseWorld.player.x);
    expect(duringPauseMission.timerSeconds).toBe(beforePauseMission.timerSeconds);

    // Resume continues progression from frozen point
    const resumed = mission.setPaused(false);
    expect(resumed.mode).toBe('playing');
    const afterResume = stepLoopOnce(ctx, { ...IDLE_INPUT, forward: true });
    expect(afterResume.world.timeSeconds).toBeGreaterThan(beforePauseWorld.timeSeconds);
    expect(afterResume.mission.timerSeconds).toBeGreaterThan(beforePauseMission.timerSeconds);

    // Restart cleanly returns player to Mission 1 Torre de Cali spawn on foot with 0 wanted stars
    const restarted = startMissionInLoop(ctx, 'mission_1_bulevar');
    const m1Start = CALI_MAP.missionStarts.mission_1_bulevar;

    expect(restarted.mission.mode).toBe('playing');
    expect(restarted.mission.timerSeconds).toBe(0);
    expect(restarted.mission.targetWantedStars).toBe(0);
    expect(restarted.world.wantedStars).toBe(0);
    expect(restarted.world.bustProgress).toBe(0);
    expect(restarted.world.player.mode).toBe('on_foot');
    expect(restarted.world.player.x).toBe(m1Start.playerSpawn.x);
    expect(restarted.world.player.z).toBe(m1Start.playerSpawn.z);
    expect(restarted.world.currentDistrict).toBe('Avenida Las Américas');

    audio.dispose();
  });

  it('handles keyboard controls, edge-triggered actions, scroll prevention, and blur reset in InputManager', () => {
    const target = new SyntheticInputTarget();
    let playing = true;
    const onCycleRadio = vi.fn();
    const onCycleCamera = vi.fn();
    const onToggleMute = vi.fn();
    const onTogglePause = vi.fn();
    const onToggleTimeOfDay = vi.fn();

    const inputManager = new InputManager(
      {
        onCycleRadio,
        onCycleCamera,
        onToggleMute,
        onTogglePause,
        onToggleTimeOfDay,
        isPlaying: () => playing,
      },
      target,
    );

    // Held movement keys + scroll prevention while playing
    expect(target.emit('keydown', { code: 'ArrowUp' })).toBe(true);
    expect(target.emit('keydown', { code: 'KeyA' })).toBe(false);
    expect(target.emit('keydown', { code: 'Space' })).toBe(true);
    expect(target.emit('keydown', { code: 'ShiftLeft' })).toBe(false);
    expect(target.emit('keydown', { code: 'KeyF' })).toBe(false);

    const firstFrame = inputManager.consumeInputState();
    expect(firstFrame.forward).toBe(true);
    expect(firstFrame.left).toBe(true);
    expect(firstFrame.handbrake).toBe(true);
    expect(firstFrame.boost).toBe(true);
    expect(firstFrame.interactPressed).toBe(true);

    // interactPressed is edge-triggered and clears after consumption
    const secondFrame = inputManager.consumeInputState();
    expect(secondFrame.forward).toBe(true);
    expect(secondFrame.interactPressed).toBe(false);

    // Action callbacks fire once on fresh keydown (ignoring repeat)
    target.emit('keydown', { code: 'KeyR' });
    target.emit('keydown', { code: 'KeyR', repeat: true });
    target.emit('keydown', { code: 'KeyC' });
    target.emit('keydown', { code: 'KeyM' });
    target.emit('keydown', { code: 'KeyT' });
    target.emit('keydown', { code: 'KeyT', repeat: true });
    target.emit('keydown', { code: 'Escape' });
    expect(onCycleRadio).toHaveBeenCalledTimes(1);
    expect(onCycleCamera).toHaveBeenCalledTimes(1);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(onToggleTimeOfDay).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);

    // Does not prevent scrolling or toggle time-of-day when not playing
    playing = false;
    target.emit('keyup', { code: 'KeyT' });
    target.emit('keydown', { code: 'KeyT' });
    expect(onToggleTimeOfDay).toHaveBeenCalledTimes(1);
    expect(target.emit('keydown', { code: 'Space' })).toBe(false);
    expect(target.emit('keydown', { code: 'ArrowDown' })).toBe(false);

    // Blur clears all pressed keys
    target.emit('blur');
    const afterBlur = inputManager.consumeInputState();
    expect(afterBlur.forward).toBe(false);
    expect(afterBlur.left).toBe(false);
    expect(afterBlur.handbrake).toBe(false);
    expect(afterBlur.boost).toBe(false);
    expect(afterBlur.interactPressed).toBe(false);

    inputManager.dispose();
  });

  it('accumulates camera yaw/pitch on canvas left/right drag, consumes and resets, and ignores hover without press', () => {
    const windowTarget = new SyntheticInputTarget();
    const canvasTarget = new SyntheticInputTarget();
    const inputManager = new InputManager({}, windowTarget, canvasTarget);

    // Moving without pressing a button must not accumulate camera look
    canvasTarget.emit('pointermove', { clientX: 200, clientY: 120, movementX: 50, movementY: 20 });
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    // Left-button drag accumulates yaw and pitch deltas across multiple moves
    canvasTarget.emit('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    canvasTarget.emit('pointermove', { pointerId: 1, clientX: 160, clientY: 130 });
    canvasTarget.emit('pointermove', { pointerId: 1, clientX: 200, clientY: 150 });
    canvasTarget.emit('pointerup', { pointerId: 1, button: 0 });

    const leftDrag = inputManager.consumeCameraLook();
    expect(leftDrag.yawDelta).toBeLessThan(0);
    expect(leftDrag.pitchDelta).toBeGreaterThan(0);
    expect(leftDrag.zoomDelta).toBe(0);

    // Consuming resets accumulated deltas to zero
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    // Moving after pointerup must not accumulate
    canvasTarget.emit('pointermove', { pointerId: 1, clientX: 300, clientY: 250 });
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    // Right-button drag also orbits camera and pointercancel stops drag cleanly
    canvasTarget.emit('pointerdown', { button: 2, pointerId: 2, clientX: 200, clientY: 200 });
    canvasTarget.emit('pointermove', { pointerId: 2, clientX: 140, clientY: 170 });
    canvasTarget.emit('pointercancel', { pointerId: 2 });
    canvasTarget.emit('pointermove', { pointerId: 2, clientX: 50, clientY: 50 });

    const rightDrag = inputManager.consumeCameraLook();
    expect(rightDrag.yawDelta).toBeGreaterThan(0);
    expect(rightDrag.pitchDelta).toBeLessThan(0);

    // Middle-button press is ignored
    canvasTarget.emit('pointerdown', { button: 1, pointerId: 3, clientX: 100, clientY: 100 });
    canvasTarget.emit('pointermove', { pointerId: 3, clientX: 180, clientY: 180 });
    canvasTarget.emit('pointerup', { pointerId: 3, button: 1 });
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    inputManager.dispose();
  });

  it('accumulates clamped wheel zoom with passive: false, supports pointer lock, resets on blur, and prevents leaks after dispose', () => {
    const windowTarget = new SyntheticInputTarget();
    const canvasTarget = new SyntheticInputTarget();
    const inputManager = new InputManager({}, windowTarget, canvasTarget);

    // Wheel listener is registered with { passive: false } and prevents default scroll
    expect(canvasTarget.lastOptions.get('wheel')).toEqual({ passive: false });
    expect(canvasTarget.emit('wheel', { deltaY: 100, deltaMode: 0 })).toBe(true);
    expect(canvasTarget.emit('wheel', { deltaY: 100, deltaMode: 0 })).toBe(true);

    const zoomOut = inputManager.consumeCameraLook();
    expect(zoomOut.zoomDelta).toBeGreaterThan(0);
    expect(zoomOut.yawDelta).toBe(0);
    expect(zoomOut.pitchDelta).toBe(0);
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    // Extreme wheel spikes are sensibly clamped
    canvasTarget.emit('wheel', { deltaY: -50_000, deltaMode: 0 });
    const clampedZoomIn = inputManager.consumeCameraLook();
    expect(clampedZoomIn.zoomDelta).toBeLessThan(0);
    expect(Math.abs(clampedZoomIn.zoomDelta)).toBeLessThanOrEqual(4);

    // Double-click requests pointer lock and catches rejected promises or throws gracefully
    canvasTarget.pointerLockResult = Promise.reject(new Error('Pointer lock blocked'));
    expect(() => canvasTarget.emit('dblclick')).not.toThrow();
    canvasTarget.pointerLockResult = () => {
      throw new Error('Pointer lock unavailable');
    };
    expect(() => canvasTarget.emit('dblclick')).not.toThrow();
    expect(canvasTarget.pointerLockCalls).toBe(2);

    // When document.pointerLockElement matches canvas, movementX/Y orbit without dragging
    const prevDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { pointerLockElement: canvasTarget },
    });
    try {
      canvasTarget.emit('pointermove', { movementX: 80, movementY: -40 });
      const lockedLook = inputManager.consumeCameraLook();
      expect(lockedLook.yawDelta).toBeLessThan(0);
      expect(lockedLook.pitchDelta).toBeLessThan(0);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: prevDocument,
      });
    }

    // Blur cancels active drag and clears pending deltas
    canvasTarget.emit('pointerdown', { button: 0, pointerId: 5, clientX: 50, clientY: 50 });
    canvasTarget.emit('pointermove', { pointerId: 5, clientX: 110, clientY: 90 });
    canvasTarget.emit('wheel', { deltaY: 120, deltaMode: 0 });
    windowTarget.emit('blur');
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    // Moving after blur without a new pointerdown must not accumulate
    canvasTarget.emit('pointermove', { pointerId: 5, clientX: 200, clientY: 180 });
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });

    // Dispose detaches all listeners on both targets and prevents further accumulation
    inputManager.dispose();
    expect(windowTarget.listenerCount()).toBe(0);
    expect(canvasTarget.listenerCount()).toBe(0);

    canvasTarget.emit('pointerdown', { button: 0, pointerId: 6, clientX: 0, clientY: 0 });
    canvasTarget.emit('pointermove', { pointerId: 6, clientX: 100, clientY: 100 });
    canvasTarget.emit('wheel', { deltaY: 200, deltaMode: 0 });
    expect(inputManager.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });
    // Backward-compatible construction without canvas returns zeroed CameraLookInput
    const keyboardOnly = new InputManager({}, windowTarget);
    expect(keyboardOnly.consumeCameraLook()).toEqual({ yawDelta: 0, pitchDelta: 0, zoomDelta: 0 });
    keyboardOnly.dispose();
  });

  it('binds KeyV to onToggleVoices on non-repeat keydown and persists voicesEnabled via MissionDirector', () => {
    const target = new SyntheticInputTarget();
    const onToggleVoices = vi.fn();
    const inputManager = new InputManager({ onToggleVoices }, target);

    target.emit('keydown', { code: 'KeyV' });
    target.emit('keydown', { code: 'KeyV', repeat: true });
    expect(onToggleVoices).toHaveBeenCalledTimes(1);

    target.emit('keyup', { code: 'KeyV' });
    target.emit('keydown', {
      code: 'KeyV',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    });
    expect(onToggleVoices).toHaveBeenCalledTimes(1);

    target.emit('keydown', { code: 'KeyV' });
    expect(onToggleVoices).toHaveBeenCalledTimes(2);
    inputManager.dispose();

    // Persistence of voicesEnabled and legacy default true
    const backing = createMemoryStorage();
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
      }),
    );

    const legacyDirector = new MissionDirector(CALI_MAP, new StorageAdapter(backing));
    expect(legacyDirector.getRecords().voicesEnabled ?? true).toBe(true);

    legacyDirector.saveAudioPreferences('sucursal_synth', false, false);
    const reloadedDisabled = new StorageAdapter(backing).loadRecords();
    expect(reloadedDisabled.voicesEnabled).toBe(false);
    expect(reloadedDisabled.preferredStation).toBe('sucursal_synth');

    // Omitting voicesEnabled preserves stored value rather than clobbering
    legacyDirector.saveAudioPreferences('salsa_brava', true);
    expect(new StorageAdapter(backing).loadRecords().voicesEnabled).toBe(false);

    // Explicitly re-enabling persists true
    legacyDirector.saveAudioPreferences('salsa_brava', false, true);
    expect(new StorageAdapter(backing).loadRecords().voicesEnabled).toBe(true);
  });

  it('wires GameApp KeyV toggle, localStorage reload persistence, mission dialogues, police megaphone + squelch, collision foley, pedestrian callouts, and VoiceEngine disposal', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const storage = createMemoryStorage();
    const windowTarget = new SyntheticInputTarget();
    let rafHandle = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();

    const fakeWindow = {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1,
      localStorage: storage,
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      requestAnimationFrame: (cb: FrameRequestCallback): number => {
        rafHandle += 1;
        rafCallbacks.set(rafHandle, cb);
        return rafHandle;
      },
      cancelAnimationFrame: (id: number): void => {
        rafCallbacks.delete(id);
      },
    };

    const fakeDocument = {
      activeElement: null,
      pointerLockElement: null,
      createElement: (tag: string) => new FakeDomNode(tag),
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: fakeWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: fakeDocument,
    });

    const playCollisionSpy = vi.spyOn(AudioEngine.prototype, 'playCollision');
    const playRadioSquelchSpy = vi.spyOn(AudioEngine.prototype, 'playRadioSquelch');

    let nowMs = 10_000;
    const spokenUtterances: SpeechUtteranceLike[] = [];
    const synthCancelSpy = vi.fn();
    const synthStub: SpeechSynthesisLike = {
      getVoices: () => [{ lang: 'es-CO', name: 'Salomé Colombia' }],
      speak: (utterance: SpeechUtteranceLike) => {
        spokenUtterances.push({ ...utterance });
      },
      cancel: synthCancelSpy,
    };
    const makeUtterance = (text: string): SpeechUtteranceLike => ({
      text,
      lang: 'es-CO',
      rate: 1,
      pitch: 1,
      volume: 1,
      voice: null,
    });

    const voiceEngine = new VoiceEngine({
      synthFactory: () => synthStub,
      utteranceFactory: makeUtterance,
      nowMs: () => nowMs,
    });
    const speakSpy = vi.spyOn(voiceEngine, 'speak');
    const disposeVoiceSpy = vi.spyOn(voiceEngine, 'dispose');

    let currentFrameTime = 0;
    const tickFrame = (deltaMs = 16.67): void => {
      currentFrameTime += deltaMs;
      const entries = [...rafCallbacks.entries()];
      rafCallbacks.clear();
      for (const [, cb] of entries) {
        cb(currentFrameTime);
      }
    };

    try {
      const canvas = new FakeDomNode('canvas') as unknown as HTMLCanvasElement;
      const hudRoot = new FakeDomNode('div');
      const app = new GameApp(canvas, hudRoot as unknown as HTMLElement, CALI_MAP, {
        voiceEngine,
      });
      app.start();

      // Initially voicesEnabled is true and button reflects ON
      expect(app.getDebugSnapshot().audio.voicesEnabled).toBe(true);
      const voicesBtn = hudRoot.findFirst((el) => el.dataset.testid === 'btn-voices');
      expect(voicesBtn).not.toBeNull();
      expect(voicesBtn?.textContent).toBe(LOCALE_CALI.hud.voicesOnLabel);

      // Press KeyV -> disables voices, updates HUD & persists to localStorage
      windowTarget.emit('keydown', { code: 'KeyV' });
      windowTarget.emit('keyup', { code: 'KeyV' });
      expect(app.getDebugSnapshot().audio.voicesEnabled).toBe(false);
      expect(voiceEngine.isEnabled()).toBe(false);
      expect(voicesBtn?.textContent).toBe(LOCALE_CALI.hud.voicesOffLabel);
      expect(voicesBtn?.getAttribute('aria-pressed')).toBe('false');
      expect(new StorageAdapter(storage).loadRecords().voicesEnabled).toBe(false);

      // Reload a fresh GameApp against the same localStorage -> restores voicesEnabled === false
      const reloadedHudRoot = new FakeDomNode('div');
      const reloadedApp = new GameApp(
        new FakeDomNode('canvas') as unknown as HTMLCanvasElement,
        reloadedHudRoot as unknown as HTMLElement,
        CALI_MAP,
      );
      expect(reloadedApp.getDebugSnapshot().audio.voicesEnabled).toBe(false);
      reloadedApp.dispose();

      // Re-enable voices via clicking [data-testid="btn-voices"] HUD pill
      voicesBtn?.click();
      expect(app.getDebugSnapshot().audio.voicesEnabled).toBe(true);
      expect(voiceEngine.isEnabled()).toBe(true);
      expect(voicesBtn?.textContent).toBe(LOCALE_CALI.hud.voicesOnLabel);
      expect(voicesBtn?.getAttribute('aria-pressed')).toBe('true');

      // Mute via KeyM syncs voiceEngine.setMuted and preserves voicesEnabled
      windowTarget.emit('keydown', { code: 'KeyM' });
      windowTarget.emit('keyup', { code: 'KeyM' });
      expect(voiceEngine.isMuted()).toBe(true);
      expect(new StorageAdapter(storage).loadRecords().voicesEnabled).toBe(true);
      windowTarget.emit('keydown', { code: 'KeyM' });
      windowTarget.emit('keyup', { code: 'KeyM' });
      expect(voiceEngine.isMuted()).toBe(false);

      // Start Mission 1 -> mission intro dialogue speaks via VoiceEngine ('valeria', 'mission')
      const m1Btn = hudRoot.findFirst((el) => el.dataset.testid === 'btn-mission-1');
      expect(m1Btn).not.toBeNull();
      m1Btn?.click();
      tickFrame();

      expect(speakSpy).toHaveBeenCalledWith(
        LOCALE_CALI.dialogues.m1Intro.text,
        'valeria',
        'mission',
      );
      const m1IntroCallCount = speakSpy.mock.calls.filter(
        ([text]) => text === LOCALE_CALI.dialogues.m1Intro.text,
      ).length;
      expect(m1IntroCallCount).toBe(1);

      // Stepping again with the same dialogue ID must NOT duplicate speech
      tickFrame();
      expect(
        speakSpy.mock.calls.filter(([text]) => text === LOCALE_CALI.dialogues.m1Intro.text).length,
      ).toBe(1);

      // Simulate collision, police pursuit within 48m, wanted escalation, and pedestrian street callouts
      const baseWorld = app.getDebugSnapshot().world;
      const stepSpy = vi.spyOn(GameWorld.prototype, 'step');

      // Advance clock past 3500ms mission protect window so callouts are eligible
      nowMs += 5000;
      const nearbyPoliceSnapshot: WorldSnapshot = {
        ...baseWorld,
        wantedStars: 2,
        collisionImpact: 0.62,
        vehicles: [
          ...baseWorld.vehicles,
          {
            id: 'police_unit_test',
            kind: 'police',
            role: 'police',
            x: baseWorld.player.x + 12,
            y: 0,
            z: baseWorld.player.z + 8,
            heading: 0,
            speedMps: 14,
            speedKmh: 50,
            steerAngle: 0,
            isDrifting: false,
            isBoosting: false,
            nitro: 100,
            sirenActive: true,
            colorHex: 0xffffff,
            halfWidth: 1.05,
            halfLength: 2.25,
          },
        ],
        pedestrians: [
          {
            id: 'ped_flee_1',
            x: baseWorld.player.x + 5,
            y: 0,
            z: baseWorld.player.z + 4,
            heading: 0,
            speedMps: 4,
            fleeing: true,
            shirtColorHex: 0xff2e93,
            pantsColorHex: 0x1d0e3d,
          },
        ],
      };

      stepSpy.mockReturnValueOnce(nearbyPoliceSnapshot);
      const getSnapshotSpy = vi
        .spyOn(GameWorld.prototype, 'getSnapshot')
        .mockReturnValue(nearbyPoliceSnapshot);

      playRadioSquelchSpy.mockClear();
      playCollisionSpy.mockClear();

      tickFrame();

      // Collision impact > 0.14 triggers playCollision
      expect(playCollisionSpy).toHaveBeenCalledWith(0.62);
      // Police megaphone callout spoken + squelch triggered (both wanted escalation and megaphone)
      expect(speakSpy).toHaveBeenCalledWith(
        LOCALE_CALI.voiceLines.policeMegaphone[0],
        'police',
        'callout',
      );
      expect(playRadioSquelchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Newly fleeing pedestrian within 14m triggers pedestrianFlee callout
      expect(speakSpy).toHaveBeenCalledWith(
        LOCALE_CALI.voiceLines.pedestrianFlee[0],
        'pedestrian',
        'callout',
      );

      // Advance clock past pedestrian 6500ms cooldown -> fast Banshee past pedestrian within 13m triggers admire
      nowMs += 7000;
      const admireSnapshot: WorldSnapshot = {
        ...baseWorld,
        wantedStars: 0,
        collisionImpact: 0,
        player: {
          ...baseWorld.player,
          mode: 'driving',
          vehicleId: 'player_banshee',
          speedMps: 24,
          speedKmh: 86,
          isDrifting: false,
        },
        pedestrians: [
          {
            id: 'ped_admire_1',
            x: baseWorld.player.x + 6,
            y: 0,
            z: baseWorld.player.z + 5,
            heading: 0,
            speedMps: 1.2,
            fleeing: false,
            shirtColorHex: 0x00f0ff,
            pantsColorHex: 0x1d0e3d,
          },
        ],
      };
      stepSpy.mockReturnValueOnce(admireSnapshot);
      getSnapshotSpy.mockReturnValue(admireSnapshot);

      tickFrame();
      expect(speakSpy).toHaveBeenCalledWith(
        LOCALE_CALI.voiceLines.pedestrianAdmire[0],
        'pedestrian',
        'callout',
      );

      // Advance past cooldown -> drifting Banshee near pedestrian rotates to next admire line
      nowMs += 7000;
      const driftAdmireSnapshot: WorldSnapshot = {
        ...admireSnapshot,
        player: {
          ...admireSnapshot.player,
          speedMps: 11,
          speedKmh: 40,
          isDrifting: true,
        },
      };
      stepSpy.mockReturnValueOnce(driftAdmireSnapshot);
      getSnapshotSpy.mockReturnValue(driftAdmireSnapshot);
      tickFrame();
      expect(speakSpy).toHaveBeenCalledWith(
        LOCALE_CALI.voiceLines.pedestrianAdmire[1],
        'pedestrian',
        'callout',
      );

      stepSpy.mockRestore();
      getSnapshotSpy.mockRestore();

      // Mission restart via Pause -> Restart resets lastSpokenDialogueId and re-speaks intro
      windowTarget.emit('keydown', { code: 'Escape' });
      windowTarget.emit('keyup', { code: 'Escape' });
      const restartBtn = hudRoot.findFirst((el) => el.dataset.testid === 'btn-restart');
      expect(restartBtn).not.toBeNull();
      restartBtn?.click();
      expect(
        speakSpy.mock.calls.filter(([text]) => text === LOCALE_CALI.dialogues.m1Intro.text).length,
      ).toBe(2);

      // Dispose cleanly disposes VoiceEngine
      app.dispose();
      expect(disposeVoiceSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: originalDocument,
      });
    }
  });

  it('binds KeyG to onToggleGarage and KeyH to hornPressed + non-repeat onHorn in InputManager', () => {
    const target = new SyntheticInputTarget();
    const onToggleGarage = vi.fn();
    const onHorn = vi.fn();
    const inputManager = new InputManager({ onToggleGarage, onHorn }, target);

    // KeyG fires once on fresh keydown, ignores repeat and editable inputs
    target.emit('keydown', { code: 'KeyG' });
    target.emit('keydown', { code: 'KeyG', repeat: true });
    expect(onToggleGarage).toHaveBeenCalledTimes(1);

    target.emit('keyup', { code: 'KeyG' });
    target.emit('keydown', {
      code: 'KeyG',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    });
    expect(onToggleGarage).toHaveBeenCalledTimes(1);

    target.emit('keydown', { code: 'KeyG' });
    expect(onToggleGarage).toHaveBeenCalledTimes(2);

    // KeyH sets hornPressed while held and fires onHorn once on non-repeat keydown
    expect(inputManager.consumeInputState().hornPressed).toBe(false);
    target.emit('keydown', { code: 'KeyH' });
    target.emit('keydown', { code: 'KeyH', repeat: true });
    expect(onHorn).toHaveBeenCalledTimes(1);
    expect(inputManager.consumeInputState().hornPressed).toBe(true);
    expect(inputManager.consumeInputState().hornPressed).toBe(true);

    target.emit('keyup', { code: 'KeyH' });
    expect(inputManager.consumeInputState().hornPressed).toBe(false);

    // Blur clears hornPressed cleanly
    target.emit('keydown', { code: 'KeyH' });
    expect(onHorn).toHaveBeenCalledTimes(2);
    expect(inputManager.consumeInputState().hornPressed).toBe(true);
    target.emit('blur');
    expect(inputManager.consumeInputState().hornPressed).toBe(false);

    inputManager.dispose();
  });

  it('integrates Garaje Caleño [G] persistence, Mission 3 rivals & race progress, [H] horn reactions, and Stunt Jump / Pay n Spray audio & voices in GameApp', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const storage = createMemoryStorage();
    const windowTarget = new SyntheticInputTarget();
    let rafHandle = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();

    const fakeWindow = {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1,
      localStorage: storage,
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      requestAnimationFrame: (cb: FrameRequestCallback): number => {
        rafHandle += 1;
        rafCallbacks.set(rafHandle, cb);
        return rafHandle;
      },
      cancelAnimationFrame: (id: number): void => {
        rafCallbacks.delete(id);
      },
    };

    const fakeDocument = {
      activeElement: null,
      pointerLockElement: null,
      createElement: (tag: string) => new FakeDomNode(tag),
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: fakeWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: fakeDocument,
    });

    const playHornSpy = vi.spyOn(AudioEngine.prototype, 'playHorn');
    const playStuntJumpSpy = vi.spyOn(AudioEngine.prototype, 'playStuntJump');
    const playPayNSpraySpy = vi.spyOn(AudioEngine.prototype, 'playPayNSpray');
    const setRaceProgressSpy = vi.spyOn(GameWorld.prototype, 'setPlayerRaceProgress');

    let nowMs = 20_000;
    const synthStub: SpeechSynthesisLike = {
      getVoices: () => [{ lang: 'es-CO', name: 'Salomé Colombia' }],
      speak: vi.fn(),
      cancel: vi.fn(),
    };
    const voiceEngine = new VoiceEngine({
      synthFactory: () => synthStub,
      utteranceFactory: (text: string) => ({
        text,
        lang: 'es-CO',
        rate: 1,
        pitch: 1,
        volume: 1,
        voice: null,
      }),
      nowMs: () => nowMs,
    });
    const hornVoiceSpy = vi.spyOn(voiceEngine, 'speakPedestrianHornReaction');
    const payNSprayVoiceSpy = vi.spyOn(voiceEngine, 'speakPayNSprayCallout');

    let currentFrameTime = 0;
    const tickFrame = (deltaMs = 16.67): void => {
      currentFrameTime += deltaMs;
      const entries = [...rafCallbacks.entries()];
      rafCallbacks.clear();
      for (const [, cb] of entries) {
        cb(currentFrameTime);
      }
    };

    try {
      const canvas = new FakeDomNode('canvas') as unknown as HTMLCanvasElement;
      const hudRoot = new FakeDomNode('div');
      const app = new GameApp(canvas, hudRoot as unknown as HTMLElement, CALI_MAP, {
        voiceEngine,
      });
      app.start();

      // Default garage config exposed via getDebugSnapshot()
      expect(app.getDebugSnapshot().garage).toEqual(DEFAULT_GARAGE_CONFIG);

      // Press KeyG on Title Screen -> opens garage panel
      const garagePanel = hudRoot.findFirst((el) => el.dataset.testid === 'garage-panel');
      expect(garagePanel?.hidden).toBe(true);
      windowTarget.emit('keydown', { code: 'KeyG' });
      windowTarget.emit('keyup', { code: 'KeyG' });
      expect(garagePanel?.hidden).toBe(false);

      // Customize via Garage buttons (Jeep Willys + Mateo + Escarlata)
      hudRoot.findFirst((el) => el.dataset.testid === 'garage-car-willys_v8')?.click();
      hudRoot.findFirst((el) => el.dataset.testid === 'garage-avatar-mateo')?.click();
      hudRoot.findFirst((el) => el.dataset.testid === 'garage-outfit-escarlata')?.click();

      const expectedGarage: GarageConfig = {
        ...DEFAULT_GARAGE_CONFIG,
        carKind: 'willys_v8',
        avatar: 'mateo',
        outfit: 'escarlata',
      };
      expect(app.getDebugSnapshot().garage).toEqual(expectedGarage);
      const playerCarAfterGarage = app
        .getDebugSnapshot()
        .world.vehicles.find((v) => v.id === 'player_banshee');
      expect(playerCarAfterGarage?.kind).toBe('willys_v8');

      // Reload a fresh GameApp against the same localStorage -> garage persists!
      const reloadedApp = new GameApp(
        new FakeDomNode('canvas') as unknown as HTMLCanvasElement,
        new FakeDomNode('div') as unknown as HTMLElement,
        CALI_MAP,
      );
      expect(reloadedApp.getDebugSnapshot().garage).toEqual(expectedGarage);
      expect(
        reloadedApp.getDebugSnapshot().world.vehicles.find((v) => v.id === 'player_banshee')?.kind,
      ).toBe('willys_v8');
      reloadedApp.dispose();

      // Close Garage via KeyG
      windowTarget.emit('keydown', { code: 'KeyG' });
      windowTarget.emit('keyup', { code: 'KeyG' });
      expect(garagePanel?.hidden).toBe(true);

      // Launch Mission 3 -> starts in chosen Willys V8 with 2 rival racers (raceTotalRacers === 3)
      const m3Btn = hudRoot.findFirst((el) => el.dataset.testid === 'btn-mission-3');
      expect(m3Btn).not.toBeNull();
      m3Btn?.click();

      const m3Snap = app.getDebugSnapshot();
      expect(m3Snap.mode).toBe('playing');
      expect(m3Snap.mission.activeMission).toBe('mission_3_pique_bulevar');
      expect(m3Snap.world.raceTotalRacers).toBe(3);
      expect(m3Snap.world.racePosition).toBeGreaterThanOrEqual(1);
      expect(m3Snap.world.vehicles.find((v) => v.id === 'player_banshee')?.kind).toBe('willys_v8');
      const racePosBadge = hudRoot.findFirst((el) => el.dataset.testid === 'hud-race-pos');
      expect(racePosBadge?.hidden).toBe(false);
      expect(racePosBadge?.textContent).toMatch(/^POS [1-3]\/3$/);

      // Frame tick syncs player race progress for Mission 3
      tickFrame();
      expect(setRaceProgressSpy).toHaveBeenCalledWith(0);

      // KeyG while playing pauses simulation cleanly and resumes on close
      const timeBeforeGarage = app.getDebugSnapshot().world.timeSeconds;
      windowTarget.emit('keydown', { code: 'KeyG' });
      windowTarget.emit('keyup', { code: 'KeyG' });
      expect(garagePanel?.hidden).toBe(false);
      expect(app.getDebugSnapshot().mode).toBe('paused');
      tickFrame();
      expect(app.getDebugSnapshot().world.timeSeconds).toBe(timeBeforeGarage);

      windowTarget.emit('keydown', { code: 'KeyG' });
      windowTarget.emit('keyup', { code: 'KeyG' });
      expect(garagePanel?.hidden).toBe(true);
      expect(app.getDebugSnapshot().mode).toBe('playing');

      // Escape while Garage is open in-game closes Garage cleanly and resumes playing
      windowTarget.emit('keydown', { code: 'KeyG' });
      windowTarget.emit('keyup', { code: 'KeyG' });
      expect(garagePanel?.hidden).toBe(false);
      expect(app.getDebugSnapshot().mode).toBe('paused');
      windowTarget.emit('keydown', { code: 'Escape' });
      windowTarget.emit('keyup', { code: 'Escape' });
      expect(garagePanel?.hidden).toBe(true);
      expect(app.getDebugSnapshot().mode).toBe('playing');

      // Direct public updateGarage updates live player car and persists
      const sparkConfig: GarageConfig = {
        ...expectedGarage,
        carKind: 'spark_gt_turbo',
      };
      app.updateGarage(sparkConfig);
      expect(app.getDebugSnapshot().garage).toEqual(sparkConfig);
      expect(
        app.getDebugSnapshot().world.vehicles.find((v) => v.id === 'player_banshee')?.kind,
      ).toBe('spark_gt_turbo');

      // KeyH while driving triggers playHorn(kind) + pedestrian reaction within 18m
      nowMs += 8000;
      const baseWorld = app.getDebugSnapshot().world;
      const chivaDrivingSnapshot: WorldSnapshot = {
        ...baseWorld,
        player: {
          ...baseWorld.player,
          mode: 'driving',
          vehicleId: 'traffic_chiva_test',
        },
        vehicles: [
          ...baseWorld.vehicles,
          {
            id: 'traffic_chiva_test',
            kind: 'chiva',
            role: 'traffic',
            x: baseWorld.player.x,
            y: 0,
            z: baseWorld.player.z,
            heading: 0,
            speedMps: 8,
            speedKmh: 28,
            steerAngle: 0,
            isDrifting: false,
            isBoosting: false,
            nitro: 80,
            sirenActive: false,
            colorHex: 0xff2e93,
            halfWidth: 1.35,
            halfLength: 3.4,
          },
        ],
        pedestrians: [
          {
            id: 'ped_horn_near',
            x: baseWorld.player.x + 10,
            y: 0,
            z: baseWorld.player.z + 6,
            heading: 0,
            speedMps: 1.2,
            fleeing: false,
            shirtColorHex: 0x00f0ff,
            pantsColorHex: 0x1d0e3d,
          },
        ],
      };

      const getSnapshotSpy = vi
        .spyOn(GameWorld.prototype, 'getSnapshot')
        .mockReturnValue(chivaDrivingSnapshot);

      windowTarget.emit('keydown', { code: 'KeyH' });
      windowTarget.emit('keyup', { code: 'KeyH' });
      expect(playHornSpy).toHaveBeenCalledWith('chiva');
      expect(hornVoiceSpy).toHaveBeenCalledTimes(1);
      expect(hornVoiceSpy).toHaveBeenCalledWith(LOCALE_CALI.voiceLines.pedestrianHorn);

      // Distant pedestrian (> 18m) does not trigger horn voice reaction
      nowMs += 8000;
      getSnapshotSpy.mockReturnValue({
        ...chivaDrivingSnapshot,
        pedestrians: [
          {
            id: 'ped_horn_far',
            x: baseWorld.player.x + 40,
            y: 0,
            z: baseWorld.player.z + 40,
            heading: 0,
            speedMps: 1.2,
            fleeing: false,
            shirtColorHex: 0x00f0ff,
            pantsColorHex: 0x1d0e3d,
          },
        ],
      });
      windowTarget.emit('keydown', { code: 'KeyH' });
      windowTarget.emit('keyup', { code: 'KeyH' });
      expect(playHornSpy).toHaveBeenCalledTimes(2);
      expect(hornVoiceSpy).toHaveBeenCalledTimes(1);

      // Stunt Jump & Pay 'n' Spray transitions trigger audio + voice once per timestamp
      nowMs += 8000;
      const stepSpy = vi.spyOn(GameWorld.prototype, 'step');
      const stuntAndSpraySnapshot: WorldSnapshot = {
        ...baseWorld,
        lastStuntJumpAt: 12.5,
        lastStuntJumpName: 'Salto del Bulevar',
        lastStuntJumpCop: 35_000,
        lastPayNSprayAt: 14.2,
        lastPayNSprayName: 'Taller San Antonio',
      };
      stepSpy.mockReturnValue(stuntAndSpraySnapshot);
      getSnapshotSpy.mockReturnValue(stuntAndSpraySnapshot);

      tickFrame();
      expect(playStuntJumpSpy).toHaveBeenCalledTimes(1);
      expect(playPayNSpraySpy).toHaveBeenCalledTimes(1);
      expect(payNSprayVoiceSpy).toHaveBeenCalledTimes(1);
      expect(payNSprayVoiceSpy).toHaveBeenCalledWith(LOCALE_CALI.voiceLines.payNSpray);

      // Repeating same timestamps on next frame does not duplicate SFX or voice
      tickFrame();
      expect(playStuntJumpSpy).toHaveBeenCalledTimes(1);
      expect(playPayNSpraySpy).toHaveBeenCalledTimes(1);
      expect(payNSprayVoiceSpy).toHaveBeenCalledTimes(1);

      stepSpy.mockRestore();
      getSnapshotSpy.mockRestore();
      app.dispose();
    } finally {
      vi.restoreAllMocks();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: originalDocument,
      });
    }
  });
});
