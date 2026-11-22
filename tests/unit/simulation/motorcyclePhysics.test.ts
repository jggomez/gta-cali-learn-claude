import { describe, expect, it } from 'vitest';
import { CALI_MAP, getTerrainElevation } from '../../../src/config/caliMap';
import {
  getVehicleHandlingProfile,
  isTwoWheelerKind,
  resolveVehicleCollisionRadius,
  stepPlayerVehicle,
  type VehicleMotionState,
} from '../../../src/simulation/physics';
import type { InputState, VehicleKind } from '../../../src/types/game';

const FRAME_DT = 1 / 60;

function createInput(overrides: Partial<InputState> = {}): InputState {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    handbrake: false,
    boost: false,
    interactPressed: false,
    ...overrides,
  };
}

function createBikeState(
  kind: VehicleKind,
  overrides: Partial<VehicleMotionState> = {},
): VehicleMotionState {
  const x = overrides.x ?? -4;
  const z = overrides.z ?? 140;
  return {
    kind,
    x,
    y: getTerrainElevation(x, z),
    z,
    heading: Math.PI,
    speedMps: 0,
    steerAngle: 0,
    nitro: 100,
    isDrifting: false,
    isBoosting: false,
    halfWidth: 0.38,
    halfLength: 0.98,
    leanAngle: 0,
    wheelieAngle: 0,
    ...overrides,
  };
}

function runFrames(
  start: VehicleMotionState,
  input: InputState,
  frames: number,
  holdSpeedMps?: number,
): VehicleMotionState {
  let state = start;
  for (let i = 0; i < frames; i += 1) {
    const next = stepPlayerVehicle(state, input, FRAME_DT, CALI_MAP, state.kind);
    state = {
      ...state,
      ...next,
      ...(holdSpeedMps !== undefined ? { speedMps: holdSpeedMps } : {}),
    };
  }
  return state;
}

function yawBetween(from: VehicleMotionState, to: VehicleMotionState): number {
  const delta = to.heading - from.heading;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

describe('simulation/physics two-wheeler (Yamaha RX115 / DT125) dynamics', () => {
  it('flags only the Cali motorcycles as two-wheelers with bounded lean/wheelie params', () => {
    expect(isTwoWheelerKind('yamaha_rx115')).toBe(true);
    expect(isTwoWheelerKind('yamaha_dt125')).toBe(true);
    expect(isTwoWheelerKind('renault4_turbo')).toBe(false);
    expect(isTwoWheelerKind('mazda_323_coupe')).toBe(false);

    for (const kind of ['yamaha_rx115', 'yamaha_dt125'] as const) {
      const profile = getVehicleHandlingProfile(kind);
      expect(profile.isTwoWheeler).toBe(true);
      expect(profile.maxLeanRad).toBeGreaterThan(0.4);
      expect(profile.maxLeanRad).toBeLessThan(0.9);
      expect(profile.leanRatePerSec).toBeGreaterThan(0);
      expect(profile.wheelieMaxRad).toBeGreaterThan(0.2);
      expect(profile.wheelieMaxSpeedMps).toBeGreaterThan(5);
    }
  });

  it('leans into the steer direction proportionally to speed and never exceeds maxLean', () => {
    const profile = getVehicleHandlingProfile('yamaha_rx115');
    const maxLean = profile.maxLeanRad ?? 0;

    const leftFast = runFrames(
      createBikeState('yamaha_rx115', { speedMps: 25 }),
      createInput({ left: true }),
      90,
      25,
    );
    const rightFast = runFrames(
      createBikeState('yamaha_rx115', { speedMps: 25 }),
      createInput({ right: true }),
      90,
      25,
    );
    const leftSlow = runFrames(
      createBikeState('yamaha_rx115', { speedMps: 4 }),
      createInput({ left: true }),
      90,
      4,
    );

    expect(leftFast.leanAngle ?? 0).toBeGreaterThan(0.3);
    expect(rightFast.leanAngle ?? 0).toBeLessThan(-0.3);
    expect(Math.abs(leftFast.leanAngle ?? 0)).toBeLessThanOrEqual(maxLean + 1e-9);
    expect(Math.abs(rightFast.leanAngle ?? 0)).toBeLessThanOrEqual(maxLean + 1e-9);
    expect(Math.abs(leftSlow.leanAngle ?? 0)).toBeLessThan(Math.abs(leftFast.leanAngle ?? 0));

    const upright = runFrames(leftFast, createInput(), 120, 25);
    expect(Math.abs(upright.leanAngle ?? 0)).toBeLessThan(0.02);
  });

  it('derives turn rate from lean so the heading follows the bike lean direction', () => {
    const start = createBikeState('yamaha_rx115', { speedMps: 20 });
    const firstFrame = runFrames(start, createInput({ left: true }), 1, 20);
    const settled = runFrames(start, createInput({ left: true }), 45, 20);

    expect(Math.abs(yawBetween(start, firstFrame))).toBeLessThan(0.05);
    expect((settled.leanAngle ?? 0) > 0).toBe(true);
    expect(yawBetween(start, settled)).toBeGreaterThan(0.3);
  });

  it('pops a wheelie on throttle only at low speed and lowers it at cruising speed', () => {
    const launch = runFrames(
      createBikeState('yamaha_rx115', { speedMps: 2 }),
      createInput({ forward: true }),
      20,
      2,
    );
    expect(launch.wheelieAngle ?? 0).toBeGreaterThan(0.1);

    const profile = getVehicleHandlingProfile('yamaha_rx115');
    expect(launch.wheelieAngle ?? 0).toBeLessThanOrEqual((profile.wheelieMaxRad ?? 0) + 1e-9);

    const cruising = runFrames(
      createBikeState('yamaha_rx115', { speedMps: 30 }),
      createInput({ forward: true }),
      30,
      30,
    );
    expect(cruising.wheelieAngle ?? 0).toBe(0);

    const nitroWheelie = runFrames(
      createBikeState('yamaha_dt125', { speedMps: 15 }),
      createInput({ forward: true, boost: true }),
      20,
      15,
    );
    expect(nitroWheelie.wheelieAngle ?? 0).toBeGreaterThan(0.1);

    const car = runFrames(
      createBikeState('renault4_turbo', { speedMps: 2, halfWidth: 0.94 }),
      createInput({ forward: true, boost: true }),
      20,
      2,
    );
    expect(car.wheelieAngle ?? 0).toBe(0);
    expect(car.leanAngle ?? 0).toBe(0);
  });

  it('reduces steering authority while the front wheel is up', () => {
    const base = createBikeState('yamaha_rx115', { speedMps: 6 });
    const grounded = runFrames(base, createInput({ left: true }), 20, 6);
    const wheelie = runFrames(
      { ...base, wheelieAngle: 0.45 },
      createInput({ left: true, forward: true }),
      20,
      6,
    );
    const groundedYaw = Math.abs(yawBetween(base, grounded));
    const wheelieYaw = Math.abs(yawBetween(base, wheelie));
    expect(wheelieYaw).toBeLessThan(groundedYaw * 0.8);
  });

  it('slides the rear on handbrake as a rear-brake skid', () => {
    const result = stepPlayerVehicle(
      createBikeState('yamaha_dt125', { speedMps: 20 }),
      createInput({ handbrake: true, left: true }),
      FRAME_DT,
      CALI_MAP,
      'yamaha_dt125',
    );
    expect(result.isDrifting).toBe(true);
    expect(result.speedMps).toBeLessThan(20);
  });

  it('uses a slim ~0.55 m collision radius for bikes but keeps the 1.35 m car minimum', () => {
    expect(resolveVehicleCollisionRadius('yamaha_rx115', 0.38)).toBeCloseTo(0.55, 5);
    expect(resolveVehicleCollisionRadius('yamaha_dt125', 0.42)).toBeCloseTo(0.55, 5);
    expect(resolveVehicleCollisionRadius('renault4_turbo', 0.94)).toBe(1.35);
    expect(resolveVehicleCollisionRadius('mio_bus', 1.3)).toBe(1.35);
    expect(resolveVehicleCollisionRadius('chiva', 1.25, 1.25)).toBe(1.25);
    expect(resolveVehicleCollisionRadius('yamaha_rx115', 0.38, 1.25)).toBeCloseTo(0.55, 5);
    expect(resolveVehicleCollisionRadius(undefined, 1.05)).toBe(1.35);
  });

  it('lets a bike squeeze closer to a wall than a car before being pushed out', () => {
    const wall = CALI_MAP.buildingColliders[0];
    expect(wall).toBeDefined();
    if (!wall) return;
    const probeX = wall.minX - 0.8;
    const probeZ = (wall.minZ + wall.maxZ) * 0.5;
    const bike = stepPlayerVehicle(
      createBikeState('yamaha_rx115', { x: probeX, z: probeZ, heading: 0 }),
      createInput(),
      FRAME_DT,
      CALI_MAP,
      'yamaha_rx115',
    );
    const car = stepPlayerVehicle(
      createBikeState('renault4_turbo', { x: probeX, z: probeZ, heading: 0, halfWidth: 0.94 }),
      createInput(),
      FRAME_DT,
      CALI_MAP,
      'renault4_turbo',
    );
    expect(bike.collided).toBe(false);
    expect(car.collided).toBe(true);
  });
});

describe('simulation/physics classic Cali fleet handling', () => {
  it('gives each classic fast car a 175-205 km/h nitro top speed with distinct tuning', () => {
    const classics = [
      'mazda_323_coupe',
      'renault_18_gtx',
      'chevrolet_sprint_turbo',
      'chevrolet_monza',
      'nissan_sentra_b13',
      'chevette_turbo',
      'renault_twingo',
    ] as const;
    const signatures = new Set<string>();
    for (const kind of classics) {
      const profile = getVehicleHandlingProfile(kind);
      const topKmh = profile.boostMaxSpeedMps * 3.6;
      expect(topKmh, kind).toBeGreaterThanOrEqual(175);
      expect(topKmh, kind).toBeLessThanOrEqual(205);
      expect(profile.baseMaxSpeedMps).toBeLessThan(profile.boostMaxSpeedMps);
      expect(profile.isTwoWheeler ?? false).toBe(false);
      signatures.add(`${profile.accelMps2}/${profile.baseTurnRate}/${profile.boostMaxSpeedMps}`);
    }
    expect(signatures.size).toBe(classics.length);
  });
});
