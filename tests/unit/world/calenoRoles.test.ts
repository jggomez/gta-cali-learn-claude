import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRealGlbForHeadlessTest } from '../../helpers/headlessGlb';
import type { LoadedCharacterAsset } from '../../../src/world/assetLoader';
import { BULEVAR_BENCH_SPECS, CHOLADO_STAND_SPECS } from '../../../src/world/caliLandmarks';
import { buildAmbientRoleSpots } from '../../../src/world/calenoPeople';
import { AmbientRoleCast } from '../../../src/world/calenoRoles';

let valeria: LoadedCharacterAsset;
let caleno: LoadedCharacterAsset;
let donor: LoadedCharacterAsset;

beforeAll(async () => {
  [valeria, caleno, donor] = await Promise.all([
    loadRealGlbForHeadlessTest('public/models/valeria.glb'),
    loadRealGlbForHeadlessTest('public/models/caleno.glb'),
    loadRealGlbForHeadlessTest('public/models/character.glb'),
  ]);
}, 30000);

function bone(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name) ?? root.getObjectByName(`mixamorig${name}`);
  if (!found) throw new Error(`bone ${name} missing`);
  return found;
}

function buildCast(): AmbientRoleCast {
  const spots = buildAmbientRoleSpots(CHOLADO_STAND_SPECS, BULEVAR_BENCH_SPECS);
  return new AmbientRoleCast({ valeria, caleno, donor }, spots, () => 0.28);
}

describe('AmbientRoleCast (static Caleño role NPCs)', () => {
  it('stands one vendor at each of the 5 cholado carts', () => {
    const cast = buildCast();
    const vendors = cast.members.filter((m) => m.spot.role === 'cholado_vendor');
    expect(vendors).toHaveLength(5);
    for (const vendor of vendors) {
      expect(vendor.group.position.y).toBeCloseTo(0.28, 5);
      expect(vendor.group.userData.ambientRole).toBe('cholado_vendor');
    }
    cast.dispose();
  });

  it('dances salsa on Bulevar del Río', () => {
    const cast = buildCast();
    const dancers = cast.members.filter((m) => m.spot.role === 'salsa_dancer');
    expect(dancers.length).toBeGreaterThanOrEqual(2);
    const names = new Set<string>();
    for (const dancer of dancers) {
      expect(dancer.danceAction?.isRunning()).toBe(true);
      expect(dancer.danceAction?.getClip().name).toBe('SambaDance');
      names.add(dancer.group.getObjectByName('caleno_model_root') ? 'caleno' : 'calena');
      // The (retargeted) dance keeps feet on the ground and the body upright
      const root = dancer.group;
      root.position.set(0, 0, 0);
      for (const t of [0.4, 1.3, 2.2]) {
        dancer.mixer?.update(t);
        root.updateMatrixWorld(true);
        const foot = Math.min(
          bone(root, 'LeftFoot').getWorldPosition(new THREE.Vector3()).y,
          bone(root, 'RightFoot').getWorldPosition(new THREE.Vector3()).y,
        );
        const hips = bone(root, 'Hips').getWorldPosition(new THREE.Vector3()).y;
        const head = bone(root, 'Head').getWorldPosition(new THREE.Vector3()).y;
        expect(foot).toBeGreaterThan(-0.08);
        expect(foot).toBeLessThan(0.3);
        expect(head - hips).toBeGreaterThan(0.25);
      }
    }
    // A mixed salsa group: Caleños and Caleñas dancing together
    expect(names).toEqual(new Set(['caleno', 'calena']));
    cast.dispose();
  });

  it('gives the tinto seller a thermos in his hand', () => {
    const cast = buildCast();
    const tinto = cast.members.find((m) => m.spot.role === 'tinto_vendor');
    const thermos = tinto?.group.getObjectByName('prop_termo_tinto');
    expect(thermos).toBeDefined();
    expect(thermos?.parent?.name.replace(/^mixamorig:?/, '')).toBe('RightHand');
    cast.dispose();
  });

  it('seats bench sitters with thighs forward and hips at bench height, without a running mixer', () => {
    const cast = buildCast();
    const sitters = cast.members.filter((m) => m.spot.role === 'bench_sitter');
    expect(sitters.length).toBeGreaterThan(0);
    for (const sitter of sitters) {
      expect(sitter.mixer).toBeNull();
      const root = sitter.group;
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      root.updateMatrixWorld(true);
      const hip = bone(root, 'LeftUpLeg').getWorldPosition(new THREE.Vector3());
      const knee = bone(root, 'LeftLeg').getWorldPosition(new THREE.Vector3());
      const foot = bone(root, 'LeftFoot').getWorldPosition(new THREE.Vector3());
      expect(knee.z - hip.z).toBeGreaterThan(0.3);
      expect(Math.abs(knee.y - hip.y)).toBeLessThan(0.15);
      expect(foot.y).toBeLessThan(knee.y - 0.3);
      expect(hip.y).toBeGreaterThan(0.45);
      expect(hip.y).toBeLessThan(0.75);
    }
    cast.dispose();
  });

  it('hides far roles and freezes their animation (LOD)', () => {
    const cast = buildCast();
    const vendor = cast.members.find((m) => m.spot.id === 'vendor_san_antonio');
    if (!vendor?.mixer) throw new Error('vendor missing');
    cast.update(0.016, vendor.spot.x + 200, vendor.spot.z, false);
    expect(vendor.group.visible).toBe(false);
    const before = vendor.mixer.time;
    cast.update(0.5, vendor.spot.x + 200, vendor.spot.z, false);
    expect(vendor.mixer.time).toBe(before);
    cast.update(0.016, vendor.spot.x + 2, vendor.spot.z, false);
    expect(vendor.group.visible).toBe(true);
    expect(vendor.mixer.time).toBeGreaterThan(before);
    cast.dispose();
  });
});
