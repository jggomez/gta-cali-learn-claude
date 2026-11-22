import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { VehicleKind } from '../../../src/types/game';
import { SkidMarkPool } from '../../../src/world/particles';
import { createVehicleMesh } from '../../../src/world/vehicleMeshes';
import {
  computeRearTireWorldPositions,
  computeVehiclePitchRad,
  disposeObjectTree,
  resolveExhaustBackfire,
  resolveHeadlightHeight,
  sampleGpsRoutePose,
  shouldRebuildVehicleMesh,
  shouldUseFerrariModel,
} from '../../../src/world/worldRenderer';

describe('computeRearTireWorldPositions', () => {
  const flatGround = (): number => 2.5;

  it('places rear tires behind vehicle along -Z with +X left and -X right at heading = 0 (+Z forward)', () => {
    const vehicle = {
      x: 10,
      z: 20,
      heading: 0,
      halfWidth: 1.05,
      halfLength: 2.35,
    };

    const tires = computeRearTireWorldPositions(vehicle, flatGround);

    expect(tires.leftZ).toBeLessThan(vehicle.z);
    expect(tires.rightZ).toBeLessThan(vehicle.z);
    expect(tires.leftZ).toBeCloseTo(tires.rightZ, 6);

    // +Z forward right-handed frame: vehicle left is +X, vehicle right is -X
    expect(tires.leftX).toBeGreaterThan(vehicle.x);
    expect(tires.rightX).toBeLessThan(vehicle.x);
    expect((tires.leftX + tires.rightX) / 2).toBeCloseTo(vehicle.x, 6);

    const trackWidth = Math.hypot(
      tires.leftX - tires.rightX,
      tires.leftZ - tires.rightZ,
    );
    expect(trackWidth).toBeGreaterThan(vehicle.halfWidth * 1.2);
    expect(trackWidth).toBeLessThan(vehicle.halfWidth * 2.0);

    const rearOffset = vehicle.z - (tires.leftZ + tires.rightZ) / 2;
    expect(rearOffset).toBeGreaterThan(vehicle.halfLength * 0.45);
    expect(rearOffset).toBeLessThan(vehicle.halfLength);

    expect(tires.leftY).toBe(2.5);
    expect(tires.rightY).toBe(2.5);
  });

  it('rotates rear axle to -X with left at -Z and right at +Z at heading = Math.PI / 2 (+X forward)', () => {
    const vehicle = {
      x: -4,
      z: 12,
      heading: Math.PI / 2,
      halfWidth: 1.0,
      halfLength: 2.2,
    };

    const tires = computeRearTireWorldPositions(vehicle, flatGround);

    // Facing +X: rear axle sits behind at x < vehicle.x
    expect(tires.leftX).toBeLessThan(vehicle.x);
    expect(tires.rightX).toBeLessThan(vehicle.x);
    expect(tires.leftX).toBeCloseTo(tires.rightX, 6);

    // Facing +X: vehicle left is -Z, vehicle right is +Z
    expect(tires.leftZ).toBeLessThan(vehicle.z);
    expect(tires.rightZ).toBeGreaterThan(vehicle.z);
    expect((tires.leftZ + tires.rightZ) / 2).toBeCloseTo(vehicle.z, 6);

    const trackWidth = Math.hypot(
      tires.leftX - tires.rightX,
      tires.leftZ - tires.rightZ,
    );
    expect(trackWidth).toBeCloseTo(vehicle.halfWidth * 2 * 0.82, 5);
  });

  it('rotates rear axle to +Z with left at -X and right at +X at heading = Math.PI (-Z forward)', () => {
    const vehicle = {
      x: 5,
      z: -15,
      heading: Math.PI,
      halfWidth: 1.25,
      halfLength: 3.8,
    };

    const tires = computeRearTireWorldPositions(vehicle, flatGround);

    // Facing -Z: rear axle sits behind at z > vehicle.z
    expect(tires.leftZ).toBeGreaterThan(vehicle.z);
    expect(tires.rightZ).toBeGreaterThan(vehicle.z);
    expect(tires.leftZ).toBeCloseTo(tires.rightZ, 6);

    // Facing -Z: vehicle left is -X, vehicle right is +X
    expect(tires.leftX).toBeLessThan(vehicle.x);
    expect(tires.rightX).toBeGreaterThan(vehicle.x);
    expect((tires.leftX + tires.rightX) / 2).toBeCloseTo(vehicle.x, 6);
  });

  it('samples per-tire ground elevation independently on sloped terrain and guards non-finite inputs', () => {
    const slopedElevation = (x: number, z: number): number => 10 + x * 0.2 - z * 0.1;
    const tires = computeRearTireWorldPositions(
      {
        x: 0,
        z: 0,
        heading: 0,
        halfWidth: 1.0,
        halfLength: 2.0,
      },
      slopedElevation,
    );

    expect(tires.leftY).toBeCloseTo(slopedElevation(tires.leftX, tires.leftZ), 6);
    expect(tires.rightY).toBeCloseTo(slopedElevation(tires.rightX, tires.rightZ), 6);
    expect(tires.leftY).not.toBeCloseTo(tires.rightY, 3);

    const sanitized = computeRearTireWorldPositions(
      {
        x: Number.NaN,
        z: Number.POSITIVE_INFINITY,
        heading: Number.NaN,
        halfWidth: -2,
        halfLength: 0,
      },
      () => Number.NaN,
    );

    expect(Number.isFinite(sanitized.leftX)).toBe(true);
    expect(Number.isFinite(sanitized.leftY)).toBe(true);
    expect(Number.isFinite(sanitized.leftZ)).toBe(true);
    expect(Number.isFinite(sanitized.rightX)).toBe(true);
    expect(Number.isFinite(sanitized.rightY)).toBe(true);
    expect(Number.isFinite(sanitized.rightZ)).toBe(true);
  });
});

describe('sampleGpsRoutePose', () => {
  it('returns null for invalid, empty, single-point, negative, or out-of-range inputs', () => {
    expect(sampleGpsRoutePose([], 5)).toBeNull();
    expect(sampleGpsRoutePose([{ x: 0, z: 0 }], 0)).toBeNull();
    expect(
      sampleGpsRoutePose(
        [
          { x: 0, z: 0 },
          { x: 0, z: 20 },
        ],
        -1,
      ),
    ).toBeNull();
    expect(
      sampleGpsRoutePose(
        [
          { x: 0, z: 0 },
          { x: 0, z: 20 },
        ],
        Number.NaN,
      ),
    ).toBeNull();
    expect(
      sampleGpsRoutePose(
        [
          { x: 0, z: 0 },
          { x: 0, z: 20 },
        ],
        25,
      ),
    ).toBeNull();
  });

  it('skips zero-length segments and interpolates position and +Z-aligned heading across turns', () => {
    const route = [
      { x: 0, z: 0 },
      { x: 0, z: 0 }, // Degenerate duplicate point
      { x: 0, z: 10 },
      { x: 10, z: 10 },
    ] as const;

    const atStart = sampleGpsRoutePose(route, 0);
    expect(atStart).not.toBeNull();
    expect(atStart?.x).toBeCloseTo(0, 6);
    expect(atStart?.z).toBeCloseTo(0, 6);
    expect(atStart?.heading).toBeCloseTo(0, 6);

    const midSecondSegment = sampleGpsRoutePose(route, 15);
    expect(midSecondSegment).not.toBeNull();
    expect(midSecondSegment?.x).toBeCloseTo(5, 6);
    expect(midSecondSegment?.z).toBeCloseTo(10, 6);
    expect(midSecondSegment?.heading).toBeCloseTo(Math.PI / 2, 6);

    const exactEnd = sampleGpsRoutePose(route, 20);
    expect(exactEnd).not.toBeNull();
    expect(exactEnd?.x).toBeCloseTo(10, 6);
    expect(exactEnd?.z).toBeCloseTo(10, 6);
  });
});

describe('disposeObjectTree', () => {
  it('disposes SkidMarkPool meshes, multi-material textures, and directional light shadow targets cleanly', () => {
    const scene = new THREE.Scene();
    const skidMarks = new SkidMarkPool({ capacity: 8 });
    skidMarks.emitPair(1, 0, 2, -1, 0, 2, 0, 1.0, 0.55);
    scene.add(skidMarks.group);

    const skidGeometries = new Set<THREE.BufferGeometry>();
    const skidMaterials = new Set<THREE.Material>();
    skidMarks.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        skidGeometries.add(node.geometry);
        if (!Array.isArray(node.material)) {
          skidMaterials.add(node.material);
        }
      }
    });

    const geoSpies = [...skidGeometries].map((geo) => vi.spyOn(geo, 'dispose'));
    const matSpies = [...skidMaterials].map((mat) => vi.spyOn(mat, 'dispose'));

    const extraTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const texDisposeSpy = vi.spyOn(extraTex, 'dispose');
    const texturedMatA = new THREE.MeshStandardMaterial({ map: extraTex });
    const texturedMatB = new THREE.MeshBasicMaterial({ color: 0xffb800 });
    const matASpy = vi.spyOn(texturedMatA, 'dispose');
    const matBSpy = vi.spyOn(texturedMatB, 'dispose');
    const multiGeo = new THREE.BoxGeometry(1, 1, 1);
    const multiGeoSpy = vi.spyOn(multiGeo, 'dispose');
    scene.add(new THREE.Mesh(multiGeo, [texturedMatA, texturedMatB]));

    const sunLight = new THREE.DirectionalLight(0xfff0d4, 2.0);
    const shadowMapTarget = new THREE.WebGLRenderTarget(64, 64);
    const shadowMapPassTarget = new THREE.WebGLRenderTarget(64, 64);
    const shadowMapDisposeSpy = vi.spyOn(shadowMapTarget, 'dispose');
    const shadowMapPassDisposeSpy = vi.spyOn(shadowMapPassTarget, 'dispose');
    const lightDisposeSpy = vi.spyOn(sunLight, 'dispose');
    sunLight.shadow.map = shadowMapTarget;
    sunLight.shadow.mapPass = shadowMapPassTarget;
    scene.add(sunLight);

    disposeObjectTree(scene);

    expect(geoSpies.length).toBe(1);
    // Instanced SkidMarkPool shares a single material across every ribbon slot
    expect(matSpies.length).toBe(1);
    for (const spy of geoSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    for (const spy of matSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(texDisposeSpy).toHaveBeenCalledTimes(1);
    expect(matASpy).toHaveBeenCalledTimes(1);
    expect(matBSpy).toHaveBeenCalledTimes(1);
    expect(multiGeoSpy).toHaveBeenCalledTimes(1);
    expect(shadowMapDisposeSpy).toHaveBeenCalledTimes(1);
    expect(shadowMapPassDisposeSpy).toHaveBeenCalledTimes(1);
    expect(sunLight.shadow.map).toBeNull();
    expect(sunLight.shadow.mapPass).toBeNull();
    expect(lightDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes sculpted Colombian vehicle mesh trees (geometries, materials, lights) cleanly on runtime swap', () => {
    const policeSuv = createVehicleMesh('police', 0xf4f7fb, 0x0b6b3a);
    const r4Turbo = createVehicleMesh('renault4_turbo', 0xe63946, 0xf8fafc, 0x00f0ff);

    for (const vehicleGroup of [policeSuv, r4Turbo]) {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const lights = new Set<THREE.Light>();

      vehicleGroup.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          geometries.add(node.geometry);
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) {
            if (mat) {
              materials.add(mat);
            }
          }
        } else if (node instanceof THREE.Light) {
          lights.add(node);
        }
      });

      const geoSpies = [...geometries].map((geo) => vi.spyOn(geo, 'dispose'));
      const matSpies = [...materials].map((mat) => vi.spyOn(mat, 'dispose'));
      const lightSpies = [...lights].map((light) => vi.spyOn(light, 'dispose'));

      disposeObjectTree(vehicleGroup);

      expect(geoSpies.length).toBeGreaterThan(0);
      expect(matSpies.length).toBeGreaterThan(0);
      for (const spy of geoSpies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
      for (const spy of matSpies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
      for (const spy of lightSpies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
    }
  });
});

describe('shouldUseFerrariModel & shouldRebuildVehicleMesh', () => {
  it('mounts Ferrari GLB strictly for banshee and retires Police and Taxi Ferraris', () => {
    const allKinds: readonly VehicleKind[] = [
      'renault4_turbo',
      'spark_gt_turbo',
      'willys_v8',
      'banshee',
      'police',
      'taxi',
      'mio_bus',
      'chiva',
    ];

    for (const kind of allKinds) {
      expect(shouldUseFerrariModel(kind, false)).toBe(false);
      expect(shouldUseFerrariModel(kind, true)).toBe(kind === 'banshee');
    }
  });

  it('detects missing entries and kind, paint color, neon underglow, and banshee GLB transitions', () => {
    const baseEntry = {
      kind: 'renault4_turbo' as VehicleKind,
      colorHex: 0xe63946,
      neonHex: 0x00f0ff as number | undefined,
      usesFerrariModel: false,
    };
    const baseSnapshot = {
      kind: 'renault4_turbo' as VehicleKind,
      colorHex: 0xe63946,
      neonHex: 0x00f0ff as number | undefined,
    };

    expect(shouldRebuildVehicleMesh(undefined, baseSnapshot)).toBe(true);
    expect(shouldRebuildVehicleMesh(baseEntry, baseSnapshot, true)).toBe(false);

    // Garage car swap
    expect(
      shouldRebuildVehicleMesh(baseEntry, { ...baseSnapshot, kind: 'willys_v8' }),
    ).toBe(true);

    // Garage or Pay 'n' Spray live repaint
    expect(
      shouldRebuildVehicleMesh(baseEntry, { ...baseSnapshot, colorHex: 0x10b981 }),
    ).toBe(true);

    // Neon underglow changed or cleared
    expect(
      shouldRebuildVehicleMesh(baseEntry, { ...baseSnapshot, neonHex: 0xff2e93 }),
    ).toBe(true);
    expect(
      shouldRebuildVehicleMesh(baseEntry, { ...baseSnapshot, neonHex: undefined }),
    ).toBe(true);

    // Banshee upgrades when Ferrari GLB finishes loading
    const bansheeEntry = {
      kind: 'banshee' as VehicleKind,
      colorHex: 0xb80e24,
      neonHex: 0x00f0ff,
      usesFerrariModel: false,
    };
    const bansheeSnapshot = {
      kind: 'banshee' as VehicleKind,
      colorHex: 0xb80e24,
      neonHex: 0x00f0ff,
    };
    expect(shouldRebuildVehicleMesh(bansheeEntry, bansheeSnapshot, false)).toBe(false);
    expect(shouldRebuildVehicleMesh(bansheeEntry, bansheeSnapshot, true)).toBe(true);

    // Police SUV and Taxi Zapatico NEVER rebuild into Ferrari GLB when template loads
    for (const nonFerrariKind of ['police', 'taxi'] as const) {
      expect(
        shouldRebuildVehicleMesh(
          {
            kind: nonFerrariKind,
            colorHex: 0xf4f7fb,
            neonHex: undefined,
            usesFerrariModel: false,
          },
          {
            kind: nonFerrariKind,
            colorHex: 0xf4f7fb,
            neonHex: undefined,
          },
          true,
        ),
      ).toBe(false);
    }
  });
});

describe('resolveHeadlightHeight', () => {
  it('returns calibrated headlight mount heights for every Cali vehicle kind', () => {
    const expectedHeights: Readonly<Record<VehicleKind, number>> = {
      renault4_turbo: 0.68,
      spark_gt_turbo: 0.62,
      willys_v8: 0.84,
      police: 0.86,
      taxi: 0.64,
      banshee: 0.58,
      mio_bus: 0.98,
      chiva: 1.04,
      mazda_323_coupe: 0.8,
      renault_18_gtx: 0.7,
      chevrolet_sprint_turbo: 0.62,
      chevrolet_monza: 0.64,
      nissan_sentra_b13: 0.66,
      chevette_turbo: 0.62,
      renault_twingo: 0.69,
      yamaha_rx115: 0.8603,
      yamaha_dt125: 1.0428,
    };

    for (const [kind, height] of Object.entries(expectedHeights) as [
      VehicleKind,
      number,
    ][]) {
      expect(resolveHeadlightHeight(kind)).toBeCloseTo(height, 4);
    }
  });
});

describe('computeVehiclePitchRad', () => {
  it('follows terrain slope and boost squat when grounded and pitches nose up proportionally when airborne', () => {
    expect(computeVehiclePitchRad(0, 0, false)).toBeCloseTo(0, 5);
    expect(computeVehiclePitchRad(0.08, 0, false)).toBeCloseTo(0, 5);
    expect(computeVehiclePitchRad(0, -0.15, false)).toBeCloseTo(-0.15, 5);
    expect(computeVehiclePitchRad(0, -0.15, true)).toBeCloseTo(-0.185, 5);

    const lowJumpPitch = computeVehiclePitchRad(0.4, 0, false);
    const highJumpPitch = computeVehiclePitchRad(2.2, 0, false);
    const extremeJumpPitch = computeVehiclePitchRad(12.0, 0, false);

    // Negative X rotation lifts vehicle +Z nose upward
    expect(lowJumpPitch).toBeLessThan(0);
    expect(highJumpPitch).toBeLessThan(lowJumpPitch);
    expect(extremeJumpPitch).toBeGreaterThanOrEqual(-0.35);

    // Guards non-finite inputs safely
    expect(Number.isFinite(computeVehiclePitchRad(Number.NaN, Number.NaN, false))).toBe(
      true,
    );
  });
});

describe('resolveExhaustBackfire', () => {
  it('triggers on stunt launch, nitro boost, and high-RPM acceleration bursts while rate-limiting', () => {
    const calm = resolveExhaustBackfire(
      { isBoosting: false, speedMps: 8, airborneHeight: 0 },
      1.0,
      0,
      false,
    );
    expect(calm).toBeNull();

    // Nitro boost triggers when cooldown is ready and respects cooldown while active
    const boostPop = resolveExhaustBackfire(
      { isBoosting: true, speedMps: 18, airborneHeight: 0 },
      4.0,
      0,
      false,
    );
    expect(boostPop).not.toBeNull();
    expect(boostPop?.intensity).toBeGreaterThan(1.0);
    expect(boostPop?.cooldownSeconds).toBeGreaterThan(0);

    const rateLimited = resolveExhaustBackfire(
      { isBoosting: true, speedMps: 18, airborneHeight: 0 },
      4.0,
      0.1,
      false,
    );
    expect(rateLimited).toBeNull();

    // High-RPM acceleration burst
    const highRpm = resolveExhaustBackfire(
      { isBoosting: false, speedMps: 15, airborneHeight: 0 },
      7.2,
      0,
      false,
    );
    expect(highRpm).not.toBeNull();
    expect(highRpm?.intensity).toBeGreaterThan(0.5);

    // Stunt jump takeoff fires immediately even during cooldown
    const stuntTakeoff = resolveExhaustBackfire(
      { isBoosting: false, speedMps: 24, airborneHeight: 0.3 },
      0,
      0.12,
      false,
    );
    expect(stuntTakeoff).not.toBeNull();
    expect(stuntTakeoff?.intensity).toBeGreaterThanOrEqual(1.3);
  });
});
