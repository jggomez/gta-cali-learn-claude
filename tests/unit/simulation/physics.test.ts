import { describe, expect, it } from 'vitest';
import {
  CALI_MAP,
  getTerrainElevation,
  isPointInRiver,
  isPointOnBridge,
} from '../../../src/config/caliMap';
import {
  clamp,
  getVehicleHandlingProfile,
  normalizeAngle,
  resolveCircleWorldCollision,
  stepOnFoot,
  stepPlayerVehicle,
  type VehicleMotionState,
} from '../../../src/simulation/physics';
import type { InputState, VehicleKind } from '../../../src/types/game';

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

function createVehicleState(
  overrides: Partial<VehicleMotionState> = {},
): VehicleMotionState {
  const x = overrides.x ?? -4;
  const z = overrides.z ?? 60;
  return {
    x,
    y: overrides.y ?? getTerrainElevation(x, z),
    z,
    heading: overrides.heading ?? Math.PI, // North (-Z) along Av. Colombia
    speedMps: overrides.speedMps ?? 0,
    steerAngle: overrides.steerAngle ?? 0,
    nitro: overrides.nitro ?? 100,
    isDrifting: overrides.isDrifting ?? false,
    isBoosting: overrides.isBoosting ?? false,
    halfWidth: overrides.halfWidth ?? 1.05,
    halfLength: overrides.halfLength ?? 2.35,
  };
}

describe('simulation/physics math helpers', () => {
  it('normalizes angles into (-PI, PI]', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 6);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 6);
    expect(normalizeAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 6);
  });

  it('clamps numeric values cleanly', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4.5, 0, 10)).toBe(4.5);
  });
});

describe('simulation/physics vehicle driving', () => {
  it('accelerates smoothly up to ~40 m/s base top speed without nitro', () => {
    let state = createVehicleState({ x: -4, z: 140, heading: Math.PI });
    const dt = 1 / 60;

    for (let i = 0; i < 180; i += 1) {
      const next = stepPlayerVehicle(
        state,
        createInput({ forward: true }),
        dt,
        CALI_MAP,
      );
      state = { ...state, ...next };
    }

    expect(state.speedMps).toBeGreaterThanOrEqual(39);
    expect(state.speedMps).toBeLessThanOrEqual(40.5);
    expect(state.isBoosting).toBe(false);
    expect(state.z).toBeLessThan(100);
  });

  it('engages nitro boost toward ~54 m/s, drains nitro, and recharges when released', () => {
    let state = createVehicleState({
      x: -4,
      z: 150,
      heading: Math.PI,
      speedMps: 36,
      nitro: 100,
    });
    const dt = 1 / 60;

    for (let i = 0; i < 90; i += 1) {
      const next = stepPlayerVehicle(
        state,
        createInput({ forward: true, boost: true }),
        dt,
        CALI_MAP,
      );
      state = { ...state, ...next };
    }

    expect(state.isBoosting).toBe(true);
    expect(state.speedMps).toBeGreaterThan(48);
    expect(state.speedMps).toBeLessThanOrEqual(54.5);
    expect(state.nitro).toBeLessThan(80);

    const depletedNitro = state.nitro;
    for (let i = 0; i < 90; i += 1) {
      const next = stepPlayerVehicle(
        state,
        createInput({ forward: true, boost: false }),
        dt,
        CALI_MAP,
      );
      state = { ...state, ...next };
    }

    expect(state.isBoosting).toBe(false);
    expect(state.nitro).toBeGreaterThan(depletedNitro + 10);
  });

  it('activates handbrake drift with higher turn rate and subtle lateral slip', () => {
    const start = createVehicleState({
      x: -4,
      z: 20,
      heading: Math.PI,
      speedMps: 26,
    });
    const dt = 0.05;

    const normalTurn = stepPlayerVehicle(
      start,
      createInput({ forward: true, left: true }),
      dt,
      CALI_MAP,
    );
    const driftTurn = stepPlayerVehicle(
      start,
      createInput({ forward: true, left: true, handbrake: true }),
      dt,
      CALI_MAP,
    );

    const normalDelta = Math.abs(normalizeAngle(normalTurn.heading - start.heading));
    const driftDelta = Math.abs(normalizeAngle(driftTurn.heading - start.heading));

    expect(normalTurn.isDrifting).toBe(false);
    expect(driftTurn.isDrifting).toBe(true);
    expect(driftDelta).toBeGreaterThan(normalDelta * 1.2);
  });

  it('reverses gently when pressing backward from standstill', () => {
    let state = createVehicleState({ x: -4, z: 20, heading: Math.PI });
    for (let i = 0; i < 40; i += 1) {
      const next = stepPlayerVehicle(
        state,
        createInput({ backward: true }),
        0.05,
        CALI_MAP,
      );
      state = { ...state, ...next };
    }

    expect(state.speedMps).toBeLessThan(-5);
    expect(state.speedMps).toBeGreaterThanOrEqual(-15);
    expect(state.z).toBeGreaterThan(20);
  });

  it('climbs smoothly up Cerro Los Cristales to Mirador de Cristo Rey', () => {
    let state = createVehicleState({
      x: -100,
      z: -24,
      heading: -Math.PI / 2, // West (-X) up the mountain ramp
      speedMps: 24,
    });
    const startElevation = state.y;

    for (let i = 0; i < 160; i += 1) {
      if (state.x <= -175) {
        break;
      }
      const next = stepPlayerVehicle(
        state,
        createInput({ forward: true }),
        0.05,
        CALI_MAP,
      );
      state = { ...state, ...next };
      expect(state.y).toBeCloseTo(getTerrainElevation(state.x, state.z), 4);
    }

    expect(state.x).toBeLessThanOrEqual(-170);
    expect(state.y).toBeGreaterThan(startElevation + 20);
    expect(state.y).toBeCloseTo(getTerrainElevation(state.x, state.z), 4);
  });
});

describe('simulation/physics world collisions & river', () => {
  it('slides smoothly off AABB buildings and clamps inside world boundaries', () => {
    // bldg_centro_1: minX -52, maxX -38, minZ -95, maxZ -73
    const hit = resolveCircleWorldCollision(-37.2, -84, 1.5, CALI_MAP);
    expect(hit.collided).toBe(true);
    expect(hit.hitColliderId).toBe('bldg_centro_1');
    expect(hit.x).toBeGreaterThanOrEqual(-38 + 1.5 - 1e-4);
    expect(hit.z).toBeCloseTo(-84, 4);
    expect(hit.inRiverHazard).toBe(false);

    const boundary = resolveCircleWorldCollision(260, -255, 1.5, CALI_MAP);
    expect(boundary.collided).toBe(true);
    expect(boundary.x).toBeLessThanOrEqual(CALI_MAP.worldHalfSize - 6);
    expect(boundary.z).toBeGreaterThanOrEqual(-(CALI_MAP.worldHalfSize - 6));
  });

  it('blocks solid landmark cores while keeping Bulevar del Río and San Antonio plazas drivable', () => {
    // Torre de Cali core at (-4, -140), footprint 11x11
    const torreHit = resolveCircleWorldCollision(-4, -140, 1.4, CALI_MAP);
    expect(torreHit.collided).toBe(true);

    // Bulevar del Río plaza at (12, 12) is drivable
    const bulevar = resolveCircleWorldCollision(12, 12, 1.4, CALI_MAP);
    expect(bulevar.collided).toBe(false);

    // San Antonio plaza at (-96, 32) is drivable
    const sanAntonio = resolveCircleWorldCollision(-96, 32, 1.4, CALI_MAP);
    expect(sanAntonio.collided).toBe(false);
  });

  it('blocks entering Río Cali water and pushes onto nearest bank', () => {
    expect(isPointInRiver(30, 10)).toBe(true);
    const westSide = resolveCircleWorldCollision(30, 10, 1.4, CALI_MAP);
    expect(westSide.inRiverHazard).toBe(true);
    expect(westSide.collided).toBe(true);
    expect(isPointInRiver(westSide.x, westSide.z)).toBe(false);
    expect(westSide.x).toBeLessThanOrEqual(CALI_MAP.river.minX - 1.4 + 1e-4);

    const eastSide = resolveCircleWorldCollision(41, 10, 1.4, CALI_MAP);
    expect(eastSide.inRiverHazard).toBe(true);
    expect(eastSide.collided).toBe(true);
    expect(isPointInRiver(eastSide.x, eastSide.z)).toBe(false);
    expect(eastSide.x).toBeGreaterThanOrEqual(CALI_MAP.river.maxX + 1.4 - 1e-4);
  });

  it('allows seamless driving across Puente La Ermita and Puente Bulevar Sur', () => {
    for (const bridgeZ of [-24, 77]) {
      let state = createVehicleState({
        x: 16,
        z: bridgeZ,
        heading: Math.PI / 2, // East (+X) across bridge
        speedMps: 22,
      });

      let sawBridge = false;
      for (let i = 0; i < 60; i += 1) {
        const next = stepPlayerVehicle(
          state,
          createInput({ forward: true }),
          0.05,
          CALI_MAP,
        );
        expect(next.inRiverHazard).toBe(false);
        expect(next.collided).toBe(false);
        if (isPointOnBridge(next.x, next.z)) {
          sawBridge = true;
        }
        state = { ...state, ...next };
        if (state.x > 54) {
          break;
        }
      }

      expect(sawBridge).toBe(true);
      expect(state.x).toBeGreaterThan(52);
    }
  });
});

describe('simulation/physics on-foot movement', () => {
  it('supports crisp 6.5 m/s walking and 10.5 m/s sprinting with terrain elevation', () => {
    const start = {
      x: -90,
      y: getTerrainElevation(-90, 36),
      z: 36,
      heading: Math.PI / 2,
    };

    const walk = stepOnFoot(start, createInput({ forward: true }), 0.1, CALI_MAP);
    expect(walk.isSprinting).toBe(false);
    expect(walk.speedMps).toBeCloseTo(6.5, 4);
    expect(walk.x).toBeCloseTo(start.x + 0.65, 3);
    expect(walk.y).toBeCloseTo(getTerrainElevation(walk.x, walk.z), 4);

    const sprint = stepOnFoot(
      start,
      createInput({ forward: true, boost: true }),
      0.1,
      CALI_MAP,
    );
    expect(sprint.isSprinting).toBe(true);
    expect(sprint.speedMps).toBeCloseTo(10.5, 4);
    expect(sprint.x).toBeCloseTo(start.x + 1.05, 3);
  });
});

describe('simulation/physics per-vehicle handling profiles', () => {
  it('defines distinct speed and agility tiers across all Cali VehicleKinds', () => {
    const renault4 = getVehicleHandlingProfile('renault4_turbo');
    const sparkGt = getVehicleHandlingProfile('spark_gt_turbo');
    const willys = getVehicleHandlingProfile('willys_v8');
    const banshee = getVehicleHandlingProfile('banshee');
    const police = getVehicleHandlingProfile('police');
    const taxi = getVehicleHandlingProfile('taxi');
    const chiva = getVehicleHandlingProfile('chiva');
    const mioBus = getVehicleHandlingProfile('mio_bus');

    expect(renault4.baseMaxSpeedMps).toBe(41);
    expect(renault4.boostMaxSpeedMps).toBe(56);
    expect(sparkGt.baseMaxSpeedMps).toBe(40);
    expect(sparkGt.boostMaxSpeedMps).toBe(54.5);
    expect(willys.baseMaxSpeedMps).toBe(38.5);
    expect(willys.boostMaxSpeedMps).toBe(53);
    expect(banshee.baseMaxSpeedMps).toBe(40);
    expect(banshee.boostMaxSpeedMps).toBe(54);
    expect(police.baseMaxSpeedMps).toBe(37);
    expect(police.boostMaxSpeedMps).toBe(49);
    expect(taxi.baseMaxSpeedMps).toBe(33);
    expect(taxi.boostMaxSpeedMps).toBe(46);
    expect(chiva.baseMaxSpeedMps).toBe(22);
    expect(chiva.boostMaxSpeedMps).toBe(28);
    expect(mioBus.baseMaxSpeedMps).toBe(21);
    expect(mioBus.boostMaxSpeedMps).toBe(26);

    expect(banshee.baseTurnRate).toBeGreaterThan(chiva.baseTurnRate);
    expect(chiva.baseTurnRate).toBeGreaterThan(mioBus.baseTurnRate);
  });

  it('accelerates banshee faster than taxi faster than mio_bus under identical throttle', () => {
    const runThrottle = (kind: VehicleKind): number => {
      let state = createVehicleState({ x: -4, z: 140, heading: Math.PI });
      for (let i = 0; i < 240; i += 1) {
        const next = stepPlayerVehicle(
          state,
          createInput({ forward: true }),
          1 / 60,
          CALI_MAP,
          kind,
        );
        state = { ...state, ...next };
      }
      return state.speedMps;
    };

    const bansheeSpeed = runThrottle('banshee');
    const taxiSpeed = runThrottle('taxi');
    const busSpeed = runThrottle('mio_bus');

    expect(bansheeSpeed).toBeGreaterThan(taxiSpeed + 6);
    expect(taxiSpeed).toBeGreaterThan(busSpeed + 10);
    expect(taxiSpeed).toBeLessThanOrEqual(33.5);
    expect(busSpeed).toBeLessThanOrEqual(21.5);
  });

  it('gives mio_bus a wider turning radius than banshee at the same speed', () => {
    const start = createVehicleState({
      x: -4,
      z: 20,
      heading: Math.PI,
      speedMps: 18,
    });

    const bansheeTurn = stepPlayerVehicle(
      start,
      createInput({ forward: true, left: true }),
      0.05,
      CALI_MAP,
      'banshee',
    );
    const busTurn = stepPlayerVehicle(
      start,
      createInput({ forward: true, left: true }),
      0.05,
      CALI_MAP,
      'mio_bus',
    );

    const bansheeDelta = Math.abs(
      normalizeAngle(bansheeTurn.heading - start.heading),
    );
    const busDelta = Math.abs(normalizeAngle(busTurn.heading - start.heading));
    expect(bansheeDelta).toBeGreaterThan(busDelta * 1.3);
  });
});
