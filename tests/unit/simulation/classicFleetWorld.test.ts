import { describe, expect, it } from 'vitest';
import {
  CALI_MAP,
  PARKED_VEHICLES,
  TRAFFIC_ROUTES,
  isPointInRiver,
} from '../../../src/config/caliMap';
import { GameWorld } from '../../../src/simulation/gameWorld';
import { isTwoWheelerKind, resolveCircleWorldCollision } from '../../../src/simulation/physics';
import { createInitialVehicles, getVehicleDimensions } from '../../../src/simulation/trafficAi';
import type { InputState } from '../../../src/types/game';

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

describe('simulation classic Cali fleet + motos in the world', () => {
  it('mixes typical Cali traffic: classics, taxis, many motos, MIO and chiva', () => {
    const kinds = TRAFFIC_ROUTES.map((route) => route.vehicleKind);
    const motoRoutes = kinds.filter((kind) => isTwoWheelerKind(kind));
    expect(motoRoutes.length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain('taxi');
    expect(kinds).toContain('mio_bus');
    expect(kinds).toContain('chiva');
    expect(kinds).toContain('renault_18_gtx');
    expect(kinds).toContain('chevrolet_sprint_turbo');
  });

  it('places parked hijackable classics and motos on open ground clear of buildings and river', () => {
    expect(PARKED_VEHICLES.length).toBeGreaterThanOrEqual(6);
    const parkedKinds = new Set(PARKED_VEHICLES.map((p) => p.vehicleKind));
    expect([...parkedKinds].some((kind) => isTwoWheelerKind(kind))).toBe(true);
    expect([...parkedKinds].some((kind) => !isTwoWheelerKind(kind))).toBe(true);

    for (const parked of PARKED_VEHICLES) {
      const dims = getVehicleDimensions(parked.vehicleKind);
      const probe = resolveCircleWorldCollision(
        parked.x,
        parked.z,
        Math.max(dims.halfWidth, dims.halfLength),
      );
      expect(probe.collided, `${parked.id} overlaps world geometry`).toBe(false);
      expect(isPointInRiver(parked.x, parked.z)).toBe(false);
    }
  });

  it('spawns parked vehicles without NPC drivers while route traffic reports one', () => {
    const vehicles = createInitialVehicles(CALI_MAP);
    const world = new GameWorld(CALI_MAP);
    const snap = world.getSnapshot();

    for (const parked of PARKED_VEHICLES) {
      const record = vehicles.find((v) => v.id === parked.id);
      expect(record?.kind).toBe(parked.vehicleKind);
      expect(record?.routeId).toBeNull();
      const parkedSnap = snap.vehicles.find((v) => v.id === parked.id);
      expect(parkedSnap?.hasNpcDriver).toBe(false);
      expect(parkedSnap?.speedMps).toBe(0);
    }

    const routeTraffic = snap.vehicles.filter(
      (v) => v.role === 'traffic' && v.id.startsWith('traffic_'),
    );
    expect(routeTraffic.length).toBe(TRAFFIC_ROUTES.length * 2);
    expect(routeTraffic.every((v) => v.hasNpcDriver === true)).toBe(true);
    expect(snap.vehicles.find((v) => v.id === 'player_banshee')?.hasNpcDriver).toBe(false);
  });

  it('lets the player hop onto a garage moto from the same on-foot start as a car', () => {
    const world = new GameWorld(CALI_MAP);
    world.applyGarageCar('yamaha_dt125', 0xf8fafc, 0x00f0ff);
    const snap = world.step(0.016, createInput());
    expect(snap.player.mode).toBe('on_foot');
    expect(snap.player.canEnterVehicle).toBe(true);
    expect(snap.player.nearbyVehicleKind).toBe('yamaha_dt125');
  });

  it('rides a garage Yamaha RX115 with slim dims and exposes lean + wheelie in snapshots', () => {
    const world = new GameWorld(CALI_MAP);
    world.applyGarageCar('yamaha_rx115', 0x1d4ed8, 0x00f0ff);
    const dims = getVehicleDimensions('yamaha_rx115');
    expect(dims.halfWidth).toBeLessThan(0.5);

    world.reset({
      startInVehicle: true,
      playerCarKind: 'yamaha_rx115',
      playerPaintHex: 0x1d4ed8,
      playerNeonHex: 0x00f0ff,
    });
    expect(world.getSnapshot().player.mode).toBe('driving');
    let snap = world.step(0.05, createInput({ forward: true }));
    const launched = snap.vehicles.find((v) => v.id === 'player_banshee');
    expect(launched?.kind).toBe('yamaha_rx115');
    expect(launched?.halfWidth).toBeCloseTo(dims.halfWidth, 5);
    expect(launched?.wheelieAngle ?? 0).toBeGreaterThan(0);

    for (let i = 0; i < 20; i += 1) {
      snap = world.step(0.05, createInput({ forward: true }));
    }
    for (let i = 0; i < 6; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, left: true }));
    }
    const leaning = snap.vehicles.find((v) => v.id === 'player_banshee');
    expect(leaning?.leanAngle ?? 0).toBeGreaterThan(0.1);
  });
});
