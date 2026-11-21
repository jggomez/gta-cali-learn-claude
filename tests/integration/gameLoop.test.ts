import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audioEngine';
import { CALI_MAP } from '../../src/config/caliMap';
import { InputManager, type InputTargetLike } from '../../src/game/inputManager';
import { MissionDirector, StorageAdapter, type StorageLike } from '../../src/missions/missionDirector';
import { GameWorld } from '../../src/simulation/gameWorld';
import { normalizeAngle } from '../../src/simulation/physics';
import type { InputState, MissionSnapshot, Vec2, WorldSnapshot } from '../../src/types/game';

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

class SyntheticInputTarget implements InputTargetLike {
  private readonly handlers = new Map<string, Set<EventListener>>();

  public addEventListener(type: string, listener: EventListener): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(listener);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.handlers.get(type)?.delete(listener);
  }

  public emit(type: string, event: Partial<KeyboardEvent> & { prevented?: boolean } = {}): boolean {
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

function stepLoopOnce(
  ctx: LoopContext,
  input: InputState,
  dt: number = STEP_DT,
): { world: Readonly<WorldSnapshot>; mission: Readonly<MissionSnapshot> } {
  let worldSnap = ctx.world.step(dt, input);
  const missionSnap = ctx.mission.update(worldSnap, dt);
  if (worldSnap.wantedStars !== missionSnap.targetWantedStars) {
    ctx.world.setWantedStars(missionSnap.targetWantedStars);
    worldSnap = ctx.world.getSnapshot();
  }
  ctx.audio.update(worldSnap, dt);
  return { world: worldSnap, mission: missionSnap };
}

function boardBansheeFromStart(ctx: LoopContext): {
  world: Readonly<WorldSnapshot>;
  mission: Readonly<MissionSnapshot>;
} {
  let latest = {
    world: ctx.world.getSnapshot(),
    mission: ctx.mission.getSnapshot(),
  };

  for (let i = 0; i < 120 && !latest.world.player.canEnterVehicle; i += 1) {
    latest = stepLoopOnce(ctx, { ...IDLE_INPUT, forward: true });
  }

  expect(latest.world.player.canEnterVehicle).toBe(true);

  latest = stepLoopOnce(ctx, { ...IDLE_INPUT, interactPressed: true });
  latest = stepLoopOnce(ctx, IDLE_INPUT);

  expect(latest.world.player.mode).toBe('driving');
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
  options: { readonly arrivalRadius?: number; readonly maxSteps?: number; readonly useBoost?: boolean } = {},
): { world: Readonly<WorldSnapshot>; mission: Readonly<MissionSnapshot>; steps: number } {
  const arrivalRadius = options.arrivalRadius ?? 10;
  const maxSteps = options.maxSteps ?? 4200;
  const useBoost = options.useBoost ?? true;

  let waypointIndex = 0;
  let steps = 0;
  let latest = {
    world: ctx.world.getSnapshot(),
    mission: ctx.mission.getSnapshot(),
  };

  while (waypointIndex < waypoints.length && steps < maxSteps) {
    if (latest.mission.mode !== 'playing') {
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
  it('completes Mission 1 (Fuga en el Bulevar) end-to-end with real steering inputs and persists best time', () => {
    const rawStorage = createMemoryStorage();
    const storage = new StorageAdapter(rawStorage);
    const world = new GameWorld(CALI_MAP);
    const mission = new MissionDirector(CALI_MAP, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    world.reset({ startInVehicle: false, wantedStars: 0 });
    mission.startMission('mission_1_bulevar');

    // Step 0 -> Step 1: Board Valeria's Banshee in Barrio San Antonio
    const afterBoard = boardBansheeFromStart(ctx);
    expect(afterBoard.mission.activeObjective?.id).toBe('m1_torre_pickup');
    expect(afterBoard.world.wantedStars).toBe(0);

    // Step 1 -> Step 2: Drive Calle 2 San Antonio -> Avenida Colombia North to Torre de Cali
    const atTorre = driveRoute(
      ctx,
      [
        { x: -4, z: 36 },
        { x: -4, z: -40 },
        { x: -4, z: -112 },
      ],
      { arrivalRadius: 12 },
    );

    expect(atTorre.mission.mode).toBe('playing');
    expect(atTorre.mission.activeObjective?.id).toBe('m1_bulevar_checkpoint');
    expect(atTorre.mission.targetWantedStars).toBe(2);
    expect(atTorre.world.wantedStars).toBe(2);

    // Step 2 -> Step 3: Escape south down Avenida Colombia through Bulevar del Río
    const atBulevar = driveRoute(
      ctx,
      [
        { x: -4, z: -70 },
        { x: -4, z: -24 },
        { x: -4, z: 12 },
      ],
      { arrivalRadius: 12 },
    );

    expect(atBulevar.mission.mode).toBe('playing');
    expect(atBulevar.mission.activeObjective?.id).toBe('m1_ermita_finish');
    expect(atBulevar.world.wantedStars).toBe(2);

    // Step 3 -> Mission Passed: Head north to Calle 13, cross Puente La Ermita to Iglesia La Ermita
    const atErmita = driveRoute(
      ctx,
      [
        { x: -4, z: -24 },
        { x: 20, z: -24 },
        { x: 50, z: -24 },
        { x: 58, z: -24 },
      ],
      { arrivalRadius: 12 },
    );

    expect(atErmita.mission.mode).toBe('mission_passed');
    expect(atErmita.mission.cashCop).toBe(250_000);
    expect(atErmita.mission.rewardCop).toBe(250_000);
    expect(atErmita.mission.isNewRecord).toBe(true);
    expect(atErmita.mission.bestTimes.mission_1_bulevar).toBeGreaterThan(0);
    expect(atErmita.world.wantedStars).toBe(0);

    // Verify persistence across a fresh StorageAdapter read
    const reloaded = new StorageAdapter(rawStorage).loadRecords();
    expect(reloaded.completedMissions).toContain('mission_1_bulevar');
    expect(reloaded.totalCashCop).toBe(250_000);
    expect(reloaded.bestTimes.mission_1_bulevar).toBeGreaterThan(0);

    audio.dispose();
  });

  it('completes Mission 2 (Noche de Salsa en Cristo Rey) across Puente Bulevar Sur and up to Cristo Rey summit', () => {
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

    world.reset({ startInVehicle: false, wantedStars: 0 });
    mission.startMission('mission_2_cristo_rey');

    // Step 0 -> Step 1: Board Banshee in San Antonio
    const afterBoard = boardBansheeFromStart(ctx);
    expect(afterBoard.mission.activeObjective?.id).toBe('m2_estadio_stage');

    // Step 1 -> Step 2: Drive south to Calle 5, cross Puente Bulevar Sur to Estadio Pascual Guerrero
    const atEstadio = driveRoute(
      ctx,
      [
        { x: -68, z: 36 },
        { x: -68, z: 77 },
        { x: -4, z: 77 },
        { x: 20, z: 77 },
        { x: 50, z: 77 },
        { x: 132, z: 77 },
      ],
      { arrivalRadius: 13 },
    );

    expect(atEstadio.mission.mode).toBe('playing');
    expect(atEstadio.mission.activeObjective?.id).toBe('m2_cristo_rey_summit');
    expect(atEstadio.mission.targetWantedStars).toBe(3);
    expect(atEstadio.world.wantedStars).toBe(3);

    // Step 2 -> Victory: Return west over Puente Bulevar Sur, north on Circunvalar, up Cerro Los Cristales ramp
    const atCristoRey = driveRoute(
      ctx,
      [
        { x: 96, z: 77 },
        { x: 50, z: 77 },
        { x: 20, z: 77 },
        { x: -68, z: 77 },
        { x: -68, z: -24 },
        { x: -120, z: -24 },
        { x: -176, z: -24 },
      ],
      { arrivalRadius: 13, maxSteps: 5400 },
    );

    expect(atCristoRey.mission.mode).toBe('victory');
    expect(atCristoRey.world.player.y).toBeGreaterThan(18);
    expect(atCristoRey.mission.cashCop).toBe(750_000);
    expect(atCristoRey.mission.bestTimes.mission_2_cristo_rey).toBeGreaterThan(0);
    expect(atCristoRey.mission.completedMissions).toContain('mission_2_cristo_rey');
    expect(atCristoRey.world.wantedStars).toBe(0);

    audio.dispose();
  });

  it('freezes simulation progression while paused, resumes cleanly, and resets state on restart', () => {
    const storage = new StorageAdapter(createMemoryStorage());
    const world = new GameWorld(CALI_MAP);
    const mission = new MissionDirector(CALI_MAP, storage);
    const audio = new AudioEngine({ contextFactory: () => null });
    const ctx: LoopContext = { world, mission, audio };

    world.reset({ startInVehicle: false, wantedStars: 0 });
    mission.startMission('mission_1_bulevar');
    boardBansheeFromStart(ctx);

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

    // Restart cleanly returns player to San Antonio on foot with 0 wanted stars
    world.reset({ startInVehicle: false, wantedStars: 0 });
    const restartedMission = mission.startMission('mission_1_bulevar');
    const restartedWorld = world.getSnapshot();

    expect(restartedMission.mode).toBe('playing');
    expect(restartedMission.timerSeconds).toBe(0);
    expect(restartedMission.targetWantedStars).toBe(0);
    expect(restartedWorld.wantedStars).toBe(0);
    expect(restartedWorld.bustProgress).toBe(0);
    expect(restartedWorld.player.mode).toBe('on_foot');
    expect(restartedWorld.player.x).toBe(CALI_MAP.playerStart.x);
    expect(restartedWorld.player.z).toBe(CALI_MAP.playerStart.z);
    expect(restartedWorld.currentDistrict).toBe('Barrio San Antonio');

    audio.dispose();
  });

  it('handles keyboard controls, edge-triggered actions, scroll prevention, and blur reset in InputManager', () => {
    const target = new SyntheticInputTarget();
    let playing = true;
    const onCycleRadio = vi.fn();
    const onCycleCamera = vi.fn();
    const onToggleMute = vi.fn();
    const onTogglePause = vi.fn();

    const inputManager = new InputManager(
      {
        onCycleRadio,
        onCycleCamera,
        onToggleMute,
        onTogglePause,
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
    target.emit('keydown', { code: 'Escape' });
    expect(onCycleRadio).toHaveBeenCalledTimes(1);
    expect(onCycleCamera).toHaveBeenCalledTimes(1);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(onTogglePause).toHaveBeenCalledTimes(1);

    // Does not prevent scrolling when not playing
    playing = false;
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
});
