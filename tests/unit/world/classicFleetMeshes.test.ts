import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ClassicCarKind, MotorcycleKind } from '../../../src/types/game';
import { CLASSIC_CAR_PROFILES } from '../../../src/world/classicFleetMeshes';
import {
  MOTORCYCLE_PLATE_CODES,
  getMotorcycleRiderSeat,
} from '../../../src/world/motorcycleMeshes';
import { createVehicleMesh } from '../../../src/world/vehicleMeshes';
import { disposeObjectTree } from '../../../src/world/worldRenderer';

const CLASSIC_KINDS: readonly ClassicCarKind[] = [
  'mazda_323_coupe',
  'renault_18_gtx',
  'chevrolet_sprint_turbo',
  'chevrolet_monza',
  'nissan_sentra_b13',
  'chevette_turbo',
  'renault_twingo',
];

const MOTO_KINDS: readonly MotorcycleKind[] = ['yamaha_rx115', 'yamaha_dt125'];

function countVertices(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      total += node.geometry.getAttribute('position')?.count ?? 0;
    }
  });
  return total;
}

function boundsOf(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
}

describe('world/classicFleetMeshes profile-driven 80s-90s Cali classics', () => {
  it('declares a distinct body profile (style, lights, length) for every classic kind', () => {
    const signatures = new Set<string>();
    for (const kind of CLASSIC_KINDS) {
      const profile = CLASSIC_CAR_PROFILES[kind];
      expect(profile.length).toBeGreaterThan(3.3);
      expect(profile.length).toBeLessThan(4.7);
      expect(profile.wheelbase).toBeLessThan(profile.length);
      expect(profile.hoodLength + profile.trunkLength).toBeLessThan(profile.length);
      signatures.add(`${profile.bodyStyle}/${profile.headlights}/${profile.length}`);
    }
    expect(signatures.size).toBe(CLASSIC_KINDS.length);
    const styles = new Set(CLASSIC_KINDS.map((k) => CLASSIC_CAR_PROFILES[k].bodyStyle));
    expect(styles).toEqual(new Set(['hatch', 'sedan', 'coupe']));
    expect(CLASSIC_CAR_PROFILES.mazda_323_coupe.headlights).toBe('popup');
  });

  it('builds sculpted clearcoat rigs with the runtime userData contract and plates outside the hull', () => {
    const vertexCounts = new Set<number>();
    for (const kind of CLASSIC_KINDS) {
      const vehicle = createVehicleMesh(kind, 0xe11d48, 0x111827, 0x00f0ff);
      expect(vehicle.name).toBe(`vehicle_${kind}`);

      const size = boundsOf(vehicle);
      expect(size.x).toBeGreaterThan(1.4);
      expect(size.y).toBeGreaterThan(1.0);
      expect(size.z).toBeGreaterThan(3.2);

      expect((vehicle.userData.wheels as THREE.Object3D[]).length).toBe(4);
      expect((vehicle.userData.frontWheels as THREE.Object3D[]).length).toBe(2);
      expect(
        (vehicle.userData.brakeLightMaterials as THREE.Material[]).length,
      ).toBeGreaterThanOrEqual(1);
      expect(vehicle.userData.headlightCones).toBeInstanceOf(THREE.Object3D);
      expect(vehicle.userData.nitroFlames).toBeInstanceOf(THREE.Object3D);
      expect(vehicle.userData.underglowMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);

      let hasClearcoat = false;
      let hasExtrude = false;
      vehicle.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          if (node.geometry instanceof THREE.ExtrudeGeometry) hasExtrude = true;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          if (mats.some((m) => m instanceof THREE.MeshPhysicalMaterial && m.clearcoat >= 0.95)) {
            hasClearcoat = true;
          }
        }
      });
      expect(hasClearcoat).toBe(true);
      expect(hasExtrude).toBe(true);

      const front = vehicle.getObjectByName('colombian_license_plate_front');
      const rear = vehicle.getObjectByName('colombian_license_plate_rear');
      const hull = vehicle.getObjectByName(`${kind}_hull`);
      expect(front?.userData.plateCode).toBe(CLASSIC_CAR_PROFILES[kind].plateCode);
      expect(front?.userData.plateStyle).toBe('private_yellow');
      expect(rear?.userData.plateCode).toBe(CLASSIC_CAR_PROFILES[kind].plateCode);
      expect(hull).toBeInstanceOf(THREE.Mesh);
      if (hull && front && rear) {
        const hullBox = new THREE.Box3().setFromObject(hull);
        expect(front.position.z).toBeGreaterThanOrEqual(hullBox.max.z - 0.02);
        expect(rear.position.z).toBeLessThanOrEqual(hullBox.min.z + 0.02);
      }

      vertexCounts.add(countVertices(vehicle));
      expect(() => disposeObjectTree(vehicle)).not.toThrow();
    }
    expect(vertexCounts.size).toBe(CLASSIC_KINDS.length);
  });

  it('skips underglow on traffic classics without neon', () => {
    const traffic = createVehicleMesh('renault_18_gtx', 0xf8fafc, 0x111827);
    expect(traffic.userData.underglowMaterial).toBeUndefined();
    disposeObjectTree(traffic);
  });
});

describe('world/motorcycleMeshes Yamaha RX115 / DT125 motos', () => {
  it('builds slim two-wheel rigs with a rear-only yellow Colombian moto plate', () => {
    const vertexCounts = new Set<number>();
    for (const kind of MOTO_KINDS) {
      const moto = createVehicleMesh(kind, 0x1d4ed8, 0xf8fafc, 0x00f0ff);
      expect(moto.name).toBe(`vehicle_${kind}`);

      // Measure the bike body only (the additive headlight beam fans wider than the bars)
      // and the hidden nitro flame cones trail behind the exhaust)
      const effects = [
        moto.userData.headlightCones as THREE.Object3D,
        moto.userData.nitroFlames as THREE.Object3D,
      ];
      moto.remove(...effects);
      const size = boundsOf(moto);
      moto.add(...effects);
      expect(size.x).toBeLessThan(1.2);
      expect(size.z).toBeGreaterThan(1.7);
      expect(size.z).toBeLessThan(2.6);
      expect(size.y).toBeGreaterThan(0.9);

      expect((moto.userData.wheels as THREE.Object3D[]).length).toBe(2);
      expect((moto.userData.frontWheels as THREE.Object3D[]).length).toBe(1);
      expect(
        (moto.userData.brakeLightMaterials as THREE.Material[]).length,
      ).toBeGreaterThanOrEqual(1);
      expect(moto.userData.headlightCones).toBeInstanceOf(THREE.Object3D);
      expect(moto.userData.nitroFlames).toBeInstanceOf(THREE.Object3D);

      expect(moto.getObjectByName('colombian_license_plate_front')).toBeUndefined();
      const rear = moto.getObjectByName('colombian_license_plate_rear');
      expect(rear?.userData.plateCode).toBe(MOTORCYCLE_PLATE_CODES[kind]);
      expect(rear?.userData.plateStyle).toBe('private_yellow');
      expect(MOTORCYCLE_PLATE_CODES[kind]).toMatch(/^[A-Z]{3} \d{2}[A-Z]$/);

      expect(moto.getObjectByName(`${kind}_expansion_chamber`)).toBeInstanceOf(THREE.Mesh);
      expect(moto.getObjectByName(`${kind}_fuel_tank`)).toBeInstanceOf(THREE.Mesh);

      const seat = getMotorcycleRiderSeat(kind);
      expect(seat.seatY).toBeGreaterThan(0.6);
      expect(seat.seatY).toBeLessThan(1.05);
      expect(moto.userData.riderSeat).toEqual(seat);

      const rider = moto.userData.npcRider as THREE.Object3D | undefined;
      expect(rider).toBeInstanceOf(THREE.Group);
      expect(rider?.getObjectByName('moto_rider_helmet')).toBeInstanceOf(THREE.Mesh);
      expect(rider?.getObjectByName('moto_rider_vest')).toBeInstanceOf(THREE.Mesh);
      expect(rider?.userData.vestPlateCode).toBe(MOTORCYCLE_PLATE_CODES[kind]);

      vertexCounts.add(countVertices(moto));
      expect(() => disposeObjectTree(moto)).not.toThrow();
    }
    expect(vertexCounts.size).toBe(MOTO_KINDS.length);
  });
});
