import { describe, expect, it } from 'vitest';
import { CALI_MAP, isPointInRiver } from '../../../src/config/caliMap';
import { GameWorld } from '../../../src/simulation/gameWorld';
import {
  createInitialVehicles,
  stepPoliceVehicle,
} from '../../../src/simulation/trafficAi';
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

describe('simulation/GameWorld', () => {
  it('spawns player near Banshee with canEnterVehicle true and populates Cali vehicles', () => {
    const world = new GameWorld(CALI_MAP);
    const snap = world.getSnapshot();

    expect(snap.player.mode).toBe('on_foot');
    expect(snap.player.canEnterVehicle).toBe(true);
    expect(snap.player.nearbyVehicleId).toBe('player_banshee');
    expect(snap.currentDistrict).toBe('Barrio San Antonio');

    const playerCars = snap.vehicles.filter((v) => v.role === 'player');
    const trafficCars = snap.vehicles.filter((v) => v.role === 'traffic');
    const policeCars = snap.vehicles.filter((v) => v.role === 'police');

    expect(playerCars).toHaveLength(1);
    expect(playerCars[0]?.kind).toBe('banshee');
    expect(trafficCars).toHaveLength(CALI_MAP.trafficRoutes.length * 2);
    expect(policeCars).toHaveLength(CALI_MAP.policeSpawns.length);
  });

  it('toggles enter/exit vehicle on interactPressed edge and drives player and car together', () => {
    const world = new GameWorld(CALI_MAP);

    // Rising edge enters the Banshee
    const entered = world.step(0.05, createInput({ interactPressed: true }));
    expect(entered.player.mode).toBe('driving');
    expect(entered.player.vehicleId).toBe('player_banshee');

    // Holding interactPressed does NOT immediately exit
    const stillDriving = world.step(0.05, createInput({ interactPressed: true }));
    expect(stillDriving.player.mode).toBe('driving');

    // Release interact and accelerate east
    const startX = stillDriving.player.x;
    let driven = stillDriving;
    for (let i = 0; i < 20; i += 1) {
      driven = world.step(0.05, createInput({ forward: true }));
    }

    const banshee = driven.vehicles.find((v) => v.id === 'player_banshee');
    expect(banshee).toBeDefined();
    expect(driven.player.x).toBeGreaterThan(startX + 5);
    expect(driven.player.x).toBeCloseTo(banshee!.x, 5);
    expect(driven.player.z).toBeCloseTo(banshee!.z, 5);
    expect(driven.topSpeedKmh).toBeGreaterThan(30);

    // New rising edge exits smoothly beside the vehicle door
    const exited = world.step(0.05, createInput({ interactPressed: true }));
    expect(exited.player.mode).toBe('on_foot');
    expect(exited.player.vehicleId).toBeNull();
    expect(isPointInRiver(exited.player.x, exited.player.z)).toBe(false);
    const distFromCar = Math.hypot(
      exited.player.x - banshee!.x,
      exited.player.z - banshee!.z,
    );
    expect(distFromCar).toBeGreaterThan(1.5);
    expect(distFromCar).toBeLessThan(6);
  });

  it('moves ambient traffic vehicles smoothly along their Cali routes', () => {
    const world = new GameWorld(CALI_MAP);
    const before = world
      .getSnapshot()
      .vehicles.filter((v) => v.role === 'traffic')
      .map((v) => ({ id: v.id, x: v.x, z: v.z }));

    for (let i = 0; i < 40; i += 1) {
      world.step(0.05, createInput());
    }

    const after = world
      .getSnapshot()
      .vehicles.filter((v) => v.role === 'traffic');

    for (const initial of before) {
      const current = after.find((v) => v.id === initial.id);
      expect(current).toBeDefined();
      const moved = Math.hypot(current!.x - initial.x, current!.z - initial.z);
      expect(moved).toBeGreaterThan(10);
      expect(isPointInRiver(current!.x, current!.z)).toBe(false);
    }
  });

  it('scales active pursuing police cruisers by wantedStars and triggers siren pursuit', () => {
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: -20, heading: 0 },
      wantedStars: 0,
    });

    expect(
      world.getSnapshot().vehicles.filter((v) => v.sirenActive),
    ).toHaveLength(0);

    world.setWantedStars(2);
    const initialSnap = world.step(0.05, createInput());
    const activePolice = initialSnap.vehicles.filter((v) => v.sirenActive);
    expect(activePolice).toHaveLength(2);

    const closestBefore = Math.min(
      ...activePolice.map((p) =>
        Math.hypot(p.x - initialSnap.player.x, p.z - initialSnap.player.z),
      ),
    );

    let latest = initialSnap;
    for (let i = 0; i < 40; i += 1) {
      latest = world.step(0.05, createInput());
    }

    const activeAfter = latest.vehicles.filter((v) => v.sirenActive);
    expect(activeAfter).toHaveLength(2);
    const closestAfter = Math.min(
      ...activeAfter.map((p) =>
        Math.hypot(p.x - latest.player.x, p.z - latest.player.z),
      ),
    );
    expect(closestAfter).toBeLessThan(closestBefore);

    world.setWantedStars(3);
    const threeStarSnap = world.step(0.05, createInput());
    expect(
      threeStarSnap.vehicles.filter((v) => v.sirenActive),
    ).toHaveLength(4);
  });

  it('triggers isBusted after sustained close-range low-speed police contact and clears bustProgress when speeding away', () => {
    // Spawn player right next to the first police cruiser (-4, -60)
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: -56, heading: 0 },
      wantedStars: 2,
    });

    // Partially fill bustProgress while stationary
    let snap = world.getSnapshot();
    for (let i = 0; i < 30; i += 1) {
      snap = world.step(0.05, createInput());
    }
    expect(snap.bustProgress).toBeGreaterThan(0.3);
    expect(snap.isBusted).toBe(false);

    // Speed away with boost -> bustProgress decays toward 0
    const peakBust = snap.bustProgress;
    for (let i = 0; i < 40; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, boost: true }));
    }
    expect(snap.bustProgress).toBeLessThan(peakBust);
    expect(snap.isBusted).toBe(false);

    // Reset next to police cruiser and stay slow until busted (~3.2s)
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: -56, heading: 0 },
      wantedStars: 2,
    });

    for (let i = 0; i < 80; i += 1) {
      snap = world.step(0.05, createInput());
      if (snap.isBusted) {
        break;
      }
    }

    expect(snap.isBusted).toBe(true);
    expect(snap.bustProgress).toBe(1);
  });

  it('accumulates driftScore while drifting at speed and clamps extreme dt safely', () => {
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 60, heading: Math.PI },
    });

    // Accelerate to speed
    for (let i = 0; i < 30; i += 1) {
      world.step(0.05, createInput({ forward: true }));
    }

    // Drift turn
    let snap = world.getSnapshot();
    for (let i = 0; i < 20; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, left: true, handbrake: true }));
    }
    expect(snap.driftScore).toBeGreaterThan(0);

    // Extreme dt is clamped to <= 0.1s
    const beforeTime = snap.timeSeconds;
    const afterExtreme = world.step(5.0, createInput());
    expect(afterExtreme.timeSeconds - beforeTime).toBeCloseTo(0.1, 6);
  });

  it('routes pursuing police cruisers across a Río Cali bridge when target is on the opposite bank', () => {
    const vehicles = createInitialVehicles(CALI_MAP);
    const eastBankCruiser = vehicles.find((v) => v.id === 'police_1');
    expect(eastBankCruiser).toBeDefined();
    expect(eastBankCruiser!.x).toBeGreaterThan(CALI_MAP.river.maxX);

    // Target is on the West bank at Bulevar del Río (-4, 12)
    for (let i = 0; i < 240; i += 1) {
      stepPoliceVehicle(eastBankCruiser!, -4, 12, true, 0.05, CALI_MAP);
      expect(isPointInRiver(eastBankCruiser!.x, eastBankCruiser!.z)).toBe(false);
      if (eastBankCruiser!.x < CALI_MAP.river.minX) {
        break;
      }
    }

    expect(eastBankCruiser!.x).toBeLessThan(CALI_MAP.river.minX);
  });
});
