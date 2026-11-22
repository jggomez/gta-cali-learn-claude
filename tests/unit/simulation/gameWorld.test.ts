import { describe, expect, it } from 'vitest';
import {
  CALI_MAP,
  getTerrainElevation,
  isPointInRiver,
} from '../../../src/config/caliMap';
import { GameWorld } from '../../../src/simulation/gameWorld';
import { resolveCircleWorldCollision } from '../../../src/simulation/physics';
import {
  createInitialPedestrians,
  createInitialVehicles,
  stepPedestrians,
  stepPoliceVehicle,
} from '../../../src/simulation/trafficAi';
import type { CaliMapConfig, InputState } from '../../../src/types/game';

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

  it('exposes nearbyVehicleKind, hijacks a nearby taxi, and leaves previously driven vehicles parked', () => {
    const world = new GameWorld(CALI_MAP);
    const initialSnap = world.getSnapshot();
    expect(initialSnap.player.nearbyVehicleKind).toBe('banshee');

    // Locate the first taxi and spawn player right beside it on foot
    const taxi = initialSnap.vehicles.find((v) => v.kind === 'taxi');
    expect(taxi).toBeDefined();

    world.reset({
      startInVehicle: false,
      spawn: { x: taxi!.x - 2.5, z: taxi!.z, heading: Math.PI / 2 },
    });

    const nearTaxiSnap = world.getSnapshot();
    expect(nearTaxiSnap.player.canEnterVehicle).toBe(true);
    expect(nearTaxiSnap.player.nearbyVehicleId).toBe(taxi!.id);
    expect(nearTaxiSnap.player.nearbyVehicleKind).toBe('taxi');

    // Hijack the taxi with F
    const boarded = world.step(0.05, createInput({ interactPressed: true }));
    expect(boarded.player.mode).toBe('driving');
    expect(boarded.player.vehicleId).toBe(taxi!.id);
    expect(boarded.wantedStars).toBe(0);

    // Drive the hijacked taxi
    let driven = boarded;
    for (let i = 0; i < 30; i += 1) {
      driven = world.step(0.05, createInput({ forward: true }));
    }
    const drivenTaxi = driven.vehicles.find((v) => v.id === taxi!.id);
    expect(drivenTaxi).toBeDefined();
    expect(driven.player.x).toBeCloseTo(drivenTaxi!.x, 5);
    expect(driven.player.z).toBeCloseTo(drivenTaxi!.z, 5);

    // Original Banshee stayed parked at its spawn
    const parkedBanshee = driven.vehicles.find((v) => v.id === 'player_banshee');
    expect(parkedBanshee!.x).toBeCloseTo(CALI_MAP.playerCarSpawn.x, 3);
    expect(parkedBanshee!.z).toBeCloseTo(CALI_MAP.playerCarSpawn.z, 3);

    // Exit the hijacked taxi and confirm it coasts to a stop and stays parked
    const exited = world.step(0.05, createInput({ interactPressed: true }));
    expect(exited.player.mode).toBe('on_foot');

    const otherTraffic = exited.vehicles.find(
      (v) => v.role === 'traffic' && v.id !== taxi!.id,
    );
    expect(otherTraffic).toBeDefined();
    const otherStart = { x: otherTraffic!.x, z: otherTraffic!.z };

    // Let taxi settle to a complete stop, then confirm it stays parked
    for (let i = 0; i < 20; i += 1) {
      world.step(0.05, createInput());
    }
    const settledTaxi = world
      .getSnapshot()
      .vehicles.find((v) => v.id === taxi!.id)!;
    const parkedPos = { x: settledTaxi.x, z: settledTaxi.z };

    for (let i = 0; i < 30; i += 1) {
      world.step(0.05, createInput());
    }
    const afterWaitSnap = world.getSnapshot();
    const stillParkedTaxi = afterWaitSnap.vehicles.find((v) => v.id === taxi!.id)!;
    expect(stillParkedTaxi.speedMps).toBeCloseTo(0, 3);
    expect(stillParkedTaxi.x).toBeCloseTo(parkedPos.x, 3);
    expect(stillParkedTaxi.z).toBeCloseTo(parkedPos.z, 3);

    // Other non-hijacked traffic kept cruising
    const movedOther = afterWaitSnap.vehicles.find((v) => v.id === otherTraffic!.id)!;
    expect(
      Math.hypot(movedOther.x - otherStart.x, movedOther.z - otherStart.z),
    ).toBeGreaterThan(10);
  });

  it('raises wantedStars immediately when hijacking a police cruiser', () => {
    const world = new GameWorld(CALI_MAP);
    const policeSpawn = CALI_MAP.policeSpawns[0]!;

    world.reset({
      startInVehicle: false,
      spawn: { x: policeSpawn.x - 2.5, z: policeSpawn.z, heading: Math.PI / 2 },
      wantedStars: 0,
    });

    const nearPolice = world.getSnapshot();
    expect(nearPolice.player.nearbyVehicleKind).toBe('police');
    expect(nearPolice.player.nearbyVehicleId).toBe('police_0');

    const hijacked = world.step(0.05, createInput({ interactPressed: true }));
    expect(hijacked.player.mode).toBe('driving');
    expect(hijacked.player.vehicleId).toBe('police_0');
    expect(hijacked.wantedStars).toBeGreaterThanOrEqual(1);
    expect(
      hijacked.vehicles.some((v) => v.sirenActive && v.id !== 'police_0'),
    ).toBe(true);
  });

  it('spawns sidewalk pedestrians cleanly on terrain, walks them, and makes them flee fast cars', () => {
    const world = new GameWorld(CALI_MAP);
    const initialSnap = world.getSnapshot();
    const initialPeds = initialSnap.pedestrians ?? [];

    expect(initialPeds.length).toBeGreaterThanOrEqual(16);
    for (const ped of initialPeds) {
      expect(ped.y).toBeCloseTo(getTerrainElevation(ped.x, ped.z), 4);
      expect(isPointInRiver(ped.x, ped.z)).toBe(false);
      expect(
        resolveCircleWorldCollision(ped.x, ped.z, 0.45, CALI_MAP).collided,
      ).toBe(false);
      expect(ped.fleeing).toBe(false);
    }

    // Step 1 second with player idle -> pedestrians walk along sidewalks safely
    let walkedSnap = initialSnap;
    for (let i = 0; i < 100; i += 1) {
      walkedSnap = world.step(0.05, createInput());
      for (const ped of walkedSnap.pedestrians ?? []) {
        expect(isPointInRiver(ped.x, ped.z)).toBe(false);
      }
    }
    const walkedPeds = walkedSnap.pedestrians ?? [];
    const movedCount = walkedPeds.filter((ped, idx) => {
      const start = initialPeds[idx]!;
      return Math.hypot(ped.x - start.x, ped.z - start.z) > 0.5;
    }).length;
    expect(movedCount).toBeGreaterThanOrEqual(14);

    // Direct fast-vehicle threat test -> pedestrian flips fleeing: true and jogs away
    const peds = createInitialPedestrians(CALI_MAP);
    const targetPed = peds[0]!;
    const vehicles = createInitialVehicles(CALI_MAP);
    const fastCar = vehicles[0]!;
    fastCar.x = targetPed.x - 4;
    fastCar.z = targetPed.z;
    fastCar.heading = Math.PI / 2;
    fastCar.speedMps = 20;

    stepPedestrians(peds, [fastCar], -200, -200, 0.05, CALI_MAP);
    expect(targetPed.fleeing).toBe(true);
    expect(targetPed.speedMps).toBeGreaterThan(4.0);
    expect(isPointInRiver(targetPed.x, targetPed.z)).toBe(false);

    // Once fast vehicle moves far away and > 2.5s elapse, pedestrian calms down
    fastCar.x = 200;
    fastCar.z = 200;
    for (let i = 0; i < 60; i += 1) {
      stepPedestrians(peds, [fastCar], -200, -200, 0.05, CALI_MAP);
    }
    expect(targetPed.fleeing).toBe(false);
  });

  it('raises wantedStars on hard police cruiser ramming and clears stars via policeEvadeProgress when far away', () => {
    const world = new GameWorld(CALI_MAP);
    // Spawn on Av. Colombia heading straight toward police_0 at (-4, -60)
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: -84, heading: 0 },
      wantedStars: 0,
    });

    let ramSnap = world.getSnapshot();
    let rammed = false;
    for (let i = 0; i < 50; i += 1) {
      ramSnap = world.step(0.05, createInput({ forward: true, boost: true }));
      if (ramSnap.wantedStars >= 1) {
        rammed = true;
        break;
      }
    }

    expect(rammed).toBe(true);
    expect(ramSnap.wantedStars).toBe(1);
    expect(ramSnap.collisionImpact).toBeGreaterThan(0);
    expect(ramSnap.policeEvadeProgress).toBe(0);

    // Cooldown prevents instant multi-star escalation on the immediately following frame
    const nextTick = world.step(0.05, createInput({ forward: true }));
    expect(nextTick.wantedStars).toBe(1);

    // Test smooth evasion fill (> 58m) -> clears wantedStars at 1.0, and decay when police close (< 50m)
    const distantPoliceMap: CaliMapConfig = {
      ...CALI_MAP,
      policeSpawns: [{ x: 174, z: 166, heading: Math.PI }],
    };
    const evadeWorld = new GameWorld(distantPoliceMap);
    evadeWorld.reset({
      startInVehicle: true,
      spawn: { x: -176, z: -24, heading: Math.PI / 2 },
      wantedStars: 1,
    });

    // Mid-evasion check (~6s -> ~0.5 progress)
    let midSnap = evadeWorld.getSnapshot();
    for (let i = 0; i < 120; i += 1) {
      midSnap = evadeWorld.step(0.05, createInput());
    }
    expect(midSnap.wantedStars).toBe(1);
    expect(midSnap.policeEvadeProgress).toBeGreaterThan(0.4);
    expect(midSnap.policeEvadeProgress).toBeLessThan(0.7);

    // Complete evasion (~12s total) -> reaches 1.0 and clears wantedStars to 0
    let clearedSnap = midSnap;
    let peakEvade = midSnap.policeEvadeProgress ?? 0;
    for (let i = 0; i < 150; i += 1) {
      clearedSnap = evadeWorld.step(0.05, createInput());
      peakEvade = Math.max(peakEvade, clearedSnap.policeEvadeProgress ?? 0);
      if (clearedSnap.wantedStars === 0) {
        break;
      }
    }
    expect(clearedSnap.wantedStars).toBe(0);
    expect(peakEvade).toBeCloseTo(1, 3);

    // Decay check: police cruiser starts at 70m, fills evade slightly, then closes inside 50m
    const closingPoliceMap: CaliMapConfig = {
      ...CALI_MAP,
      policeSpawns: [{ x: -4, z: -70, heading: 0 }],
    };
    const decayWorld = new GameWorld(closingPoliceMap);
    decayWorld.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 10, heading: 0 },
      wantedStars: 1,
    });

    let peakBeforeClose = 0;
    let afterCloseSnap = decayWorld.getSnapshot();
    for (let i = 0; i < 80; i += 1) {
      afterCloseSnap = decayWorld.step(0.05, createInput());
      peakBeforeClose = Math.max(
        peakBeforeClose,
        afterCloseSnap.policeEvadeProgress ?? 0,
      );
    }
    expect(peakBeforeClose).toBeGreaterThan(0.05);
    expect(afterCloseSnap.policeEvadeProgress ?? 0).toBeLessThan(peakBeforeClose);
  });

  it('does not falsely escalate wantedStars when accelerating away from a nearby police cruiser', () => {
    const world = new GameWorld(CALI_MAP);
    // Spawn just south of police_0 (-4, -60) facing south (heading = 0, moving AWAY from police)
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: -57, heading: 0 },
      wantedStars: 0,
    });

    let snap = world.getSnapshot();
    for (let i = 0; i < 30; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, boost: true }));
    }

    expect(snap.player.speedMps).toBeGreaterThan(20);
    expect(snap.wantedStars).toBe(0);
  });

  it('positions player and Banshee cleanly at distinct per-mission spawn and carSpawn poses', () => {
    const world = new GameWorld(CALI_MAP);

    // Mission 1: on foot at Torre de Cali with Banshee parked at getaway carSpawn
    const m1Start = CALI_MAP.missionStarts.mission_1_bulevar;
    world.reset({
      spawn: m1Start.playerSpawn,
      carSpawn: m1Start.carSpawn,
      startInVehicle: m1Start.startInVehicle,
      wantedStars: m1Start.initialWantedStars,
    });
    const m1Snap = world.getSnapshot();
    const m1Car = m1Snap.vehicles.find((v) => v.id === 'player_banshee');
    expect(m1Snap.player.mode).toBe('on_foot');
    expect(m1Snap.player.vehicleId).toBeNull();
    expect(m1Snap.player.x).toBe(m1Start.playerSpawn.x);
    expect(m1Snap.player.z).toBe(m1Start.playerSpawn.z);
    expect(m1Snap.player.y).toBeCloseTo(
      getTerrainElevation(m1Start.playerSpawn.x, m1Start.playerSpawn.z),
      5,
    );
    expect(m1Snap.player.heading).toBe(m1Start.playerSpawn.heading);
    expect(m1Snap.currentDistrict).toBe('Avenida Las Américas');
    expect(m1Car).toBeDefined();
    expect(m1Car!.x).toBe(m1Start.carSpawn.x);
    expect(m1Car!.z).toBe(m1Start.carSpawn.z);
    expect(m1Car!.y).toBeCloseTo(
      getTerrainElevation(m1Start.carSpawn.x, m1Start.carSpawn.z),
      5,
    );
    expect(m1Car!.heading).toBe(m1Start.carSpawn.heading);
    expect(m1Car!.speedMps).toBe(0);

    // Mission 2: driving at Estadio Pascual Guerrero with 3 wanted stars
    const m2Start = CALI_MAP.missionStarts.mission_2_cristo_rey;
    world.reset({
      spawn: m2Start.playerSpawn,
      carSpawn: m2Start.carSpawn,
      startInVehicle: m2Start.startInVehicle,
      wantedStars: m2Start.initialWantedStars,
    });
    const m2Snap = world.getSnapshot();
    const m2Car = m2Snap.vehicles.find((v) => v.id === 'player_banshee');
    expect(m2Snap.player.mode).toBe('driving');
    expect(m2Snap.player.vehicleId).toBe('player_banshee');
    expect(m2Snap.player.x).toBe(m2Start.carSpawn.x);
    expect(m2Snap.player.z).toBe(m2Start.carSpawn.z);
    expect(m2Snap.player.heading).toBe(m2Start.carSpawn.heading);
    expect(m2Snap.wantedStars).toBe(3);
    expect(m2Snap.currentDistrict).toBe('Estadio Pascual Guerrero');
    expect(m2Car!.x).toBe(m2Start.carSpawn.x);
    expect(m2Car!.z).toBe(m2Start.carSpawn.z);
    expect(m2Car!.heading).toBe(m2Start.carSpawn.heading);

    // Elevated hillside carSpawn takes precedence when startInVehicle is true
    const elevatedCarSpawn = { x: -96, z: 32, heading: 1.25 };
    world.reset({
      spawn: { x: 0, z: 0, heading: 0 },
      carSpawn: elevatedCarSpawn,
      startInVehicle: true,
    });
    const elevatedSnap = world.getSnapshot();
    const elevatedCar = elevatedSnap.vehicles.find((v) => v.id === 'player_banshee');
    expect(elevatedSnap.player.x).toBe(elevatedCarSpawn.x);
    expect(elevatedSnap.player.z).toBe(elevatedCarSpawn.z);
    expect(elevatedSnap.player.y).toBeCloseTo(
      getTerrainElevation(elevatedCarSpawn.x, elevatedCarSpawn.z),
      5,
    );
    expect(elevatedSnap.player.y).toBeGreaterThan(2);
    expect(elevatedCar!.heading).toBe(elevatedCarSpawn.heading);

    // Free Roam: on foot at Bulevar del Río with Banshee parked nearby
    const roamStart = CALI_MAP.missionStarts.free_roam;
    world.reset({
      spawn: roamStart.playerSpawn,
      carSpawn: roamStart.carSpawn,
      startInVehicle: roamStart.startInVehicle,
      wantedStars: roamStart.initialWantedStars,
    });
    const roamSnap = world.getSnapshot();
    const roamCar = roamSnap.vehicles.find((v) => v.id === 'player_banshee');
    expect(roamSnap.player.mode).toBe('on_foot');
    expect(roamSnap.player.x).toBe(roamStart.playerSpawn.x);
    expect(roamSnap.player.z).toBe(roamStart.playerSpawn.z);
    expect(roamSnap.currentDistrict).toBe('Bulevar del Río');
    expect(roamCar!.x).toBe(roamStart.carSpawn.x);
    expect(roamCar!.z).toBe(roamStart.carSpawn.z);
    expect(roamCar!.heading).toBe(roamStart.carSpawn.heading);
  });

  it('refills nitro cleanly to 100 for both player Banshee and active hijacked vehicles', () => {
    const world = new GameWorld(CALI_MAP);
    const initialTaxi = world
      .getSnapshot()
      .vehicles.find((v) => v.kind === 'taxi')!;
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 40, heading: Math.PI },
    });

    // Burn nitro while boosting north along Av. Colombia
    let snap = world.getSnapshot();
    for (let i = 0; i < 40; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, boost: true }));
    }
    const drainedBanshee = snap.vehicles.find((v) => v.id === 'player_banshee');
    expect(snap.player.nitro).toBeLessThan(80);
    expect(drainedBanshee!.nitro).toBeLessThan(80);

    world.refillNitro();
    const refilledSnap = world.getSnapshot();
    const refilledBanshee = refilledSnap.vehicles.find((v) => v.id === 'player_banshee');
    expect(refilledSnap.player.nitro).toBe(100);
    expect(refilledBanshee!.nitro).toBe(100);

    // Hijack a taxi, drain its nitro, and verify refillNitro restores the active vehicle too
    world.reset({
      startInVehicle: false,
      spawn: { x: initialTaxi.x - 2.5, z: initialTaxi.z, heading: Math.PI / 2 },
    });
    world.step(0.05, createInput({ interactPressed: true }));
    for (let i = 0; i < 30; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, boost: true }));
    }
    expect(snap.player.vehicleId).toBe(initialTaxi.id);
    expect(snap.player.nitro).toBeLessThan(90);

    world.refillNitro();
    const refilledTaxiSnap = world.getSnapshot();
    const refilledTaxi = refilledTaxiSnap.vehicles.find((v) => v.id === initialTaxi.id);
    expect(refilledTaxiSnap.player.nitro).toBe(100);
    expect(refilledTaxi!.nitro).toBe(100);
  });
});
