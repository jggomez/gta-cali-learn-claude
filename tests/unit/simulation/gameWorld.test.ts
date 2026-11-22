import { describe, expect, it } from 'vitest';
import {
  CALI_MAP,
  DEFAULT_GARAGE_CONFIG,
  PAY_N_SPRAY_ZONES,
  ROADBLOCK_ZONES,
  STUNT_JUMPS,
  getTerrainElevation,
  isPointInRiver,
} from '../../../src/config/caliMap';
import { GameWorld, computeTrafficLightPhase } from '../../../src/simulation/gameWorld';
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
    const trafficCars = snap.vehicles.filter(
      (v) => v.role === 'traffic' && v.hasNpcDriver,
    );
    const parkedCars = snap.vehicles.filter(
      (v) => v.role === 'traffic' && !v.hasNpcDriver,
    );
    const policeCars = snap.vehicles.filter((v) => v.role === 'police');

    expect(playerCars).toHaveLength(1);
    expect(playerCars[0]?.kind).toBe('renault4_turbo');
    expect(playerCars[0]?.colorHex).toBe(DEFAULT_GARAGE_CONFIG.paintHex);
    expect(playerCars[0]?.neonHex).toBe(DEFAULT_GARAGE_CONFIG.neonHex);
    expect(playerCars[0]?.airborneHeight).toBe(0);
    expect(trafficCars).toHaveLength(CALI_MAP.trafficRoutes.length * 2);
    expect(parkedCars).toHaveLength(CALI_MAP.parkedVehicles?.length ?? 0);
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
      .vehicles.filter((v) => v.role === 'traffic' && v.hasNpcDriver)
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
    expect(initialSnap.player.nearbyVehicleKind).toBe('renault4_turbo');

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

  it('swaps player vehicle cleanly via applyGarageCar without resetting position and supports garage ResetWorldOptions', () => {
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 30, heading: Math.PI },
      playerCarKind: 'spark_gt_turbo',
      playerPaintHex: 0x0284c7,
      playerNeonHex: 0xffb800,
    });

    const initialCar = world
      .getSnapshot()
      .vehicles.find((v) => v.id === 'player_banshee')!;
    expect(initialCar.kind).toBe('spark_gt_turbo');
    expect(initialCar.colorHex).toBe(0x0284c7);
    expect(initialCar.neonHex).toBe(0xffb800);
    expect(initialCar.halfWidth).toBeCloseTo(0.92, 4);
    expect(initialCar.halfLength).toBeCloseTo(1.98, 4);

    // Drive forward briefly, then swap car at runtime
    for (let i = 0; i < 10; i += 1) {
      world.step(0.05, createInput({ forward: true }));
    }
    const beforeSwap = world.getSnapshot();
    const posBefore = { x: beforeSwap.player.x, z: beforeSwap.player.z };

    world.applyGarageCar('willys_v8', 0x10b981, 0xff2e93);
    const afterSwap = world.getSnapshot();
    const swappedCar = afterSwap.vehicles.find((v) => v.id === 'player_banshee')!;
    expect(swappedCar.kind).toBe('willys_v8');
    expect(swappedCar.colorHex).toBe(0x10b981);
    expect(swappedCar.neonHex).toBe(0xff2e93);
    expect(swappedCar.halfWidth).toBeCloseTo(1.04, 4);
    expect(swappedCar.halfLength).toBeCloseTo(2.15, 4);
    expect(afterSwap.player.x).toBeCloseTo(posBefore.x, 5);
    expect(afterSwap.player.z).toBeCloseTo(posBefore.z, 5);
  });

  it('launches stunt jumps with airborne arc, +35 nitro refill, telemetry, and 4s per-ramp cooldown', () => {
    const jump = STUNT_JUMPS[0]!; // stunt_bulevar_launch at (-4, 48) heading PI
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 72, heading: Math.PI },
    });

    // Burn some nitro while accelerating toward the ramp so we exceed minSpeedMps (22)
    let snap = world.getSnapshot();
    let maxAirborneHeight = 0;
    let maxAirborneSeconds = 0;
    let nitroBeforeJump = 100;
    let nitroAtLaunch = 0;

    for (let i = 0; i < 60; i += 1) {
      const prevAt = snap.lastStuntJumpAt ?? 0;
      const prevNitro = snap.player.nitro;
      snap = world.step(0.05, createInput({ forward: true, boost: i < 20 }));
      const playerCar = snap.vehicles.find((v) => v.id === 'player_banshee')!;
      maxAirborneHeight = Math.max(maxAirborneHeight, playerCar.airborneHeight ?? 0);
      maxAirborneSeconds = Math.max(maxAirborneSeconds, snap.airborneSeconds ?? 0);
      if ((snap.lastStuntJumpAt ?? 0) > prevAt) {
        nitroBeforeJump = prevNitro;
        nitroAtLaunch = snap.player.nitro;
      }
    }

    expect(snap.lastStuntJumpName).toBe(jump.name);
    expect(snap.lastStuntJumpCop).toBe(jump.rewardCop);
    expect(snap.lastStuntJumpAt).toBeGreaterThan(0);
    expect(maxAirborneHeight).toBeGreaterThan(2.5);
    expect(maxAirborneSeconds).toBeGreaterThan(0.5);
    expect(nitroAtLaunch).toBeGreaterThanOrEqual(Math.min(100, nitroBeforeJump + 30));

    // After landing, airborneHeight clamps cleanly back to 0
    for (let i = 0; i < 30; i += 1) {
      snap = world.step(0.05, createInput({ forward: true }));
    }
    const landedCar = snap.vehicles.find((v) => v.id === 'player_banshee')!;
    expect(landedCar.airborneHeight).toBe(0);
    expect(landedCar.y).toBeCloseTo(getTerrainElevation(landedCar.x, landedCar.z), 4);

    // Cooldown test: re-crossing the SAME ramp inside 4s must NOT re-trigger,
    // and crossing again after >= 4s MUST re-trigger cleanly
    const cooldownMap: CaliMapConfig = {
      ...CALI_MAP,
      buildingColliders: [],
      landmarks: [],
      trafficRoutes: [],
      policeSpawns: [],
      stuntJumps: [
        {
          id: 'stunt_cooldown_probe',
          name: 'Salto Prueba Cooldown',
          x: -4,
          z: 0,
          heading: Math.PI,
          length: 220,
          width: 10,
          minSpeedMps: 20,
          launchVy: 8.5,
          rewardCop: 35_000,
        },
      ],
    };
    const cooldownWorld = new GameWorld(cooldownMap);
    cooldownWorld.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 100, heading: Math.PI },
    });

    let cdSnap = cooldownWorld.getSnapshot();
    for (let i = 0; i < 40; i += 1) {
      cdSnap = cooldownWorld.step(0.05, createInput({ forward: true, boost: true }));
      if ((cdSnap.lastStuntJumpAt ?? 0) > 0) {
        break;
      }
    }
    const firstTriggerAt = cdSnap.lastStuntJumpAt!;
    expect(firstTriggerAt).toBeGreaterThan(0);

    // Stay above minSpeedMps inside the ramp for 2.5s (lands at ~0.9s, still < 4s cooldown -> no re-trigger)
    for (let i = 0; i < 50; i += 1) {
      cdSnap = cooldownWorld.step(0.05, createInput({ forward: true }));
    }
    expect(cdSnap.timeSeconds - firstTriggerAt).toBeLessThan(4);
    expect(cdSnap.lastStuntJumpAt).toBe(firstTriggerAt);

    // Continue past 4s cooldown while still on the ramp above minSpeedMps -> re-triggers!
    for (let i = 0; i < 40; i += 1) {
      cdSnap = cooldownWorld.step(0.05, createInput({ forward: true }));
      if ((cdSnap.lastStuntJumpAt ?? 0) > firstTriggerAt) {
        break;
      }
    }
    expect(cdSnap.lastStuntJumpAt).toBeGreaterThanOrEqual(firstTriggerAt + 4);
  });

  it('clears wantedStars, refills nitro, repaints car, and enforces 6s cooldown at Pay n Spray zones', () => {
    const shop = PAY_N_SPRAY_ZONES[0]!; // Taller San Antonio (-78, 18)
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: shop.x - 10, z: shop.z, heading: Math.PI / 2 },
      wantedStars: 3,
      playerPaintHex: 0xe63946,
    });

    // Drain nitro slightly while driving into the Pay 'n' Spray zone
    let snap = world.getSnapshot();
    for (let i = 0; i < 20; i += 1) {
      snap = world.step(0.05, createInput({ forward: true, boost: true }));
      if (snap.lastPayNSprayName !== null) {
        break;
      }
    }

    const carAfterSpray = snap.vehicles.find((v) => v.id === 'player_banshee')!;
    expect(snap.wantedStars).toBe(0);
    expect(snap.bustProgress).toBe(0);
    expect(snap.policeEvadeProgress).toBe(0);
    expect(snap.vehicles.filter((v) => v.sirenActive)).toHaveLength(0);
    expect(snap.player.nitro).toBe(100);
    expect(carAfterSpray.colorHex).not.toBe(0xe63946);
    expect(snap.lastPayNSprayName).toBe(shop.name);
    expect(snap.lastPayNSprayAt).toBeGreaterThan(0);

    // Cooldown check: stop inside the shop, raise wantedStars inside 6s -> must NOT respray yet
    const firstSprayAt = snap.lastPayNSprayAt!;
    const colorAfterFirst = carAfterSpray.colorHex;
    // Brake cleanly inside the workshop zone
    for (let i = 0; i < 12; i += 1) {
      snap = world.step(0.05, createInput({ handbrake: true }));
    }
    world.setWantedStars(2);
    snap = world.step(0.05, createInput({ handbrake: true }));
    expect(snap.wantedStars).toBe(2);
    expect(snap.lastPayNSprayAt).toBe(firstSprayAt);
    expect(snap.vehicles.find((v) => v.id === 'player_banshee')!.colorHex).toBe(
      colorAfterFirst,
    );

    // Wait out the remaining 6s cooldown at 0 stars, then trigger again inside the shop
    world.setWantedStars(0);
    for (let i = 0; i < 120; i += 1) {
      snap = world.step(0.05, createInput());
    }
    world.setWantedStars(2);
    snap = world.step(0.05, createInput());
    expect(snap.wantedStars).toBe(0);
    expect(snap.lastPayNSprayAt).toBeGreaterThan(firstSprayAt);
    expect(snap.vehicles.find((v) => v.id === 'player_banshee')!.colorHex).not.toBe(
      colorAfterFirst,
    );

    // Requested at 0 stars via horn inside the shop after another 6s cooldown
    const secondSprayAt = snap.lastPayNSprayAt!;
    const colorAfterSecond = snap.vehicles.find((v) => v.id === 'player_banshee')!.colorHex;
    for (let i = 0; i < 125; i += 1) {
      snap = world.step(0.05, createInput());
    }
    snap = world.step(0.05, createInput({ hornPressed: true }));
    expect(snap.lastPayNSprayAt).toBeGreaterThan(secondSprayAt);
    expect(snap.vehicles.find((v) => v.id === 'player_banshee')!.colorHex).not.toBe(
      colorAfterSecond,
    );
  });

  it('builds driftComboMultiplier up to 5x, banks cashout after 1.4s clean recovery, and cancels on hard crash', () => {
    const openMap: CaliMapConfig = {
      ...CALI_MAP,
      buildingColliders: [],
      landmarks: [],
      trafficRoutes: [],
      policeSpawns: [],
      stuntJumps: [],
      payNSprayZones: [],
      roadblockZones: [],
    };
    const world = new GameWorld(openMap);
    world.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 40, heading: Math.PI },
    });

    // Accelerate to high speed (> 28 km/h)
    for (let i = 0; i < 35; i += 1) {
      world.step(0.05, createInput({ forward: true, boost: true }));
    }

    // Sustain continuous drift to escalate combo multiplier all the way to 5x & build pending bank
    let maxMultiplier = 1;
    let peakPending = 0;
    let snap = world.getSnapshot();
    for (let i = 0; i < 95; i += 1) {
      snap = world.step(
        0.05,
        createInput({ forward: true, left: true, handbrake: true, boost: true }),
      );
      maxMultiplier = Math.max(maxMultiplier, snap.driftComboMultiplier ?? 1);
      peakPending = Math.max(peakPending, snap.driftBankPendingCop ?? 0);
    }

    expect(maxMultiplier).toBe(5);
    expect(peakPending).toBeGreaterThan(0);
    expect(snap.lastDriftCashoutCop).toBe(0);

    // Clean non-drifting recovery for > 1.4s banks into lastDriftCashoutCop
    for (let i = 0; i < 32; i += 1) {
      snap = world.step(0.05, createInput({ forward: true }));
    }
    expect(snap.driftBankPendingCop).toBe(0);
    expect(snap.driftComboMultiplier).toBe(1);
    expect(snap.lastDriftCashoutCop).toBeGreaterThanOrEqual(peakPending);

    // Crash cancellation: build a new pending drift, then collide hard with Río Cali / building
    const crashWorld = new GameWorld(CALI_MAP);
    crashWorld.reset({
      startInVehicle: true,
      spawn: { x: -4, z: 120, heading: Math.PI },
    });
    for (let i = 0; i < 20; i += 1) {
      crashWorld.step(0.05, createInput({ forward: true }));
    }
    let driftSnap = crashWorld.getSnapshot();
    for (let i = 0; i < 10; i += 1) {
      driftSnap = crashWorld.step(
        0.05,
        createInput({ forward: true, right: true, handbrake: true }),
      );
    }
    expect(driftSnap.driftBankPendingCop).toBeGreaterThan(0);

    // Accelerate straight East into Río Cali bank to trigger collisionImpact > 0.35
    let crashed = false;
    for (let i = 0; i < 80; i += 1) {
      driftSnap = crashWorld.step(0.05, createInput({ forward: true, boost: true }));
      if (driftSnap.collisionImpact > 0.35) {
        crashed = true;
        break;
      }
    }
    expect(crashed).toBe(true);
    expect(driftSnap.driftBankPendingCop).toBe(0);
    expect(driftSnap.driftComboMultiplier).toBe(1);
    expect(driftSnap.lastDriftCashoutCop).toBe(0);
  });

  it('activates 3-star Retén Policial roadblocks: Willys/boost smashes through while slower cars slow sharply', () => {
    const roadblock = ROADBLOCK_ZONES[0]!; // Puente La Ermita (38, -24)
    const world = new GameWorld(CALI_MAP);
    world.reset({
      startInVehicle: true,
      spawn: { x: 24, z: roadblock.z, heading: Math.PI / 2 },
      wantedStars: 2,
    });
    expect(world.getSnapshot().roadblockActive).toBe(false);

    // Case 1: Slow non-Willys car (< 26 m/s, no boost) at 3 stars -> sharp slowdown (0.42x) & impact 0.65
    world.setWantedStars(3);
    expect(world.getSnapshot().roadblockActive).toBe(true);
    let slowSnap = world.getSnapshot();
    let hitSlow = false;
    let speedBeforeSlowHit = 0;
    let speedAfterSlowHit = 0;
    for (let i = 0; i < 40; i += 1) {
      const prevSpeed = slowSnap.player.speedMps;
      // Keep speed moderate (~16-20 m/s) by feathering throttle
      slowSnap = world.step(
        0.05,
        createInput({ forward: prevSpeed < 17 }),
      );
      if (slowSnap.collisionImpact >= 0.6) {
        hitSlow = true;
        speedBeforeSlowHit = prevSpeed;
        speedAfterSlowHit = slowSnap.player.speedMps;
        break;
      }
    }
    expect(hitSlow).toBe(true);
    expect(slowSnap.collisionImpact).toBeCloseTo(0.65, 2);
    expect(speedAfterSlowHit).toBeLessThan(speedBeforeSlowHit * 0.55);

    // Case 2: Willys V8 at 3 stars -> smashes right through (0.78x speed dip, impact 0.45)
    world.reset({
      startInVehicle: true,
      spawn: { x: 24, z: roadblock.z, heading: Math.PI / 2 },
      wantedStars: 3,
      playerCarKind: 'willys_v8',
    });
    let smashSnap = world.getSnapshot();
    let hitSmash = false;
    let speedBeforeSmash = 0;
    let speedAfterSmash = 0;
    for (let i = 0; i < 40; i += 1) {
      const prevSpeed = smashSnap.player.speedMps;
      smashSnap = world.step(
        0.05,
        createInput({ forward: prevSpeed < 18 }),
      );
      if (smashSnap.collisionImpact >= 0.4) {
        hitSmash = true;
        speedBeforeSmash = prevSpeed;
        speedAfterSmash = smashSnap.player.speedMps;
        break;
      }
    }
    expect(hitSmash).toBe(true);
    expect(smashSnap.collisionImpact).toBeCloseTo(0.45, 2);
    expect(speedAfterSmash).toBeGreaterThan(speedBeforeSmash * 0.68);
    expect(speedAfterSmash).toBeLessThan(speedBeforeSmash * 0.9);
  });

  it('triggers hornActive and scares pedestrians within 18m on [H] hornPressed', () => {
    const world = new GameWorld(CALI_MAP);
    const initialPeds = world.getSnapshot().pedestrians ?? [];
    const targetPed = initialPeds[0]!;
    const farPed = initialPeds.find(
      (ped) => Math.hypot(ped.x - targetPed.x, ped.z - targetPed.z) > 60,
    )!;

    world.reset({
      startInVehicle: true,
      spawn: { x: targetPed.x - 6, z: targetPed.z, heading: Math.PI / 2 },
    });

    const hornSnap = world.step(0.05, createInput({ hornPressed: true }));
    expect(hornSnap.hornActive).toBe(true);

    const scaredPed = hornSnap.pedestrians!.find((p) => p.id === targetPed.id)!;
    const calmPed = hornSnap.pedestrians!.find((p) => p.id === farPed.id)!;
    expect(scaredPed.fleeing).toBe(true);
    expect(calmPed.fleeing).toBe(false);

    // Pedestrians stay fleeing for >= 3.5s after releasing horn
    let afterSnap = hornSnap;
    for (let i = 0; i < 50; i += 1) {
      afterSnap = world.step(0.05, createInput({ hornPressed: false }));
    }
    expect(afterSnap.hornActive).toBe(false);
    const stillFleeingPed = afterSnap.pedestrians!.find((p) => p.id === targetPed.id)!;
    expect(stillFleeingPed.fleeing).toBe(true);
  });

  it('cycles trafficLightPhase deterministically over a 20s period', () => {
    expect(computeTrafficLightPhase(0)).toBe('ns_green');
    expect(computeTrafficLightPhase(7.9)).toBe('ns_green');
    expect(computeTrafficLightPhase(8.0)).toBe('ns_yellow');
    expect(computeTrafficLightPhase(9.9)).toBe('ns_yellow');
    expect(computeTrafficLightPhase(10.0)).toBe('ew_green');
    expect(computeTrafficLightPhase(17.9)).toBe('ew_green');
    expect(computeTrafficLightPhase(18.0)).toBe('ew_yellow');
    expect(computeTrafficLightPhase(19.9)).toBe('ew_yellow');
    expect(computeTrafficLightPhase(20.0)).toBe('ns_green');

    const world = new GameWorld(CALI_MAP);
    expect(world.getSnapshot().trafficLightPhase).toBe('ns_green');

    // Step 8.5s -> ns_yellow
    let snap = world.getSnapshot();
    for (let i = 0; i < 85; i += 1) {
      snap = world.step(0.1, createInput());
    }
    expect(snap.trafficLightPhase).toBe('ns_yellow');

    // Step +2.5s (11s total) -> ew_green
    for (let i = 0; i < 25; i += 1) {
      snap = world.step(0.1, createInput());
    }
    expect(snap.trafficLightPhase).toBe('ew_green');

    // Step +7.5s (18.5s total) -> ew_yellow
    for (let i = 0; i < 75; i += 1) {
      snap = world.step(0.1, createInput());
    }
    expect(snap.trafficLightPhase).toBe('ew_yellow');

    // Step +2.5s (21s total) -> loops back to ns_green
    for (let i = 0; i < 25; i += 1) {
      snap = world.step(0.1, createInput());
    }
    expect(snap.trafficLightPhase).toBe('ns_green');
  });

  it('spawns 2 rival street racers when enableRivals is true, drives them along Mission 3 checkpoints, and tracks racePosition', () => {
    const world = new GameWorld(CALI_MAP);
    expect(world.getSnapshot().racePosition).toBeNull();
    expect(world.getSnapshot().raceTotalRacers).toBe(0);

    const m3Start = CALI_MAP.missionStarts.mission_3_pique_bulevar;
    world.reset({
      spawn: m3Start.playerSpawn,
      carSpawn: m3Start.carSpawn,
      startInVehicle: true,
      enableRivals: true,
    });

    const startSnap = world.getSnapshot();
    const rivals = startSnap.vehicles.filter((v) => v.role === 'racer');
    expect(rivals).toHaveLength(2);
    const sparkRival = rivals.find((v) => v.id === 'rival_spark_gt')!;
    const willysRival = rivals.find((v) => v.id === 'rival_willys_v8')!;
    expect(sparkRival.kind).toBe('spark_gt_turbo');
    expect(sparkRival.x).toBe(-7);
    expect(sparkRival.z).toBe(57);
    expect(willysRival.kind).toBe('willys_v8');
    expect(willysRival.x).toBe(-1);
    expect(willysRival.z).toBe(55);
    expect(startSnap.raceTotalRacers).toBe(3);
    expect(startSnap.racePosition).toBe(3);

    // Advance race: rivals sprint north to CP1 (-4, -24) and turn east across Puente La Ermita without river hits
    let racedSnap = startSnap;
    for (let i = 0; i < 160; i += 1) {
      racedSnap = world.step(0.05, createInput());
      for (const rival of racedSnap.vehicles.filter((v) => v.role === 'racer')) {
        expect(isPointInRiver(rival.x, rival.z)).toBe(false);
      }
    }
    const movedSpark = racedSnap.vehicles.find((v) => v.id === 'rival_spark_gt')!;
    const movedWillys = racedSnap.vehicles.find((v) => v.id === 'rival_willys_v8')!;
    expect(movedSpark.x).toBeGreaterThan(30);
    expect(movedWillys.x).toBeGreaterThan(20);
    expect(movedSpark.speedMps).toBeGreaterThan(15);

    // Explicit setPlayerRaceProgress updates player ahead of rivals into 1st place
    world.setPlayerRaceProgress(3);
    expect(world.getSnapshot().racePosition).toBe(1);
    expect(world.getSnapshot().raceTotalRacers).toBe(3);
  });
});
