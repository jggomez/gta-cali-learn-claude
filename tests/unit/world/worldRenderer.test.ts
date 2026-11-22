import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SkidMarkPool } from '../../../src/world/particles';
import {
  computeRearTireWorldPositions,
  disposeObjectTree,
  sampleGpsRoutePose,
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
    expect(matSpies.length).toBe(8);
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
});
