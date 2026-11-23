import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CALI_MAP } from '../../../src/config/caliMap';
import { DEVHACK_BILLBOARDS } from '../../../src/config/devhackAds';
import { buildCaliWorld, setWorldNightLighting } from '../../../src/world/caliLandmarks';
import {
  DEVHACK_BILLBOARDS_GROUP_NAME,
  DEVHACK_BILLBOARD_MESH_COUNT,
  buildDevhackBillboards,
  createDevhackAdTexture,
} from '../../../src/world/devhackBillboards';
import { batchStaticMeshes } from '../../../src/world/staticBatcher';

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      found.push(node);
    }
  });
  return found;
}

describe('buildDevhackBillboards (headless)', () => {
  it('builds one named node per placement with the expected mesh count', () => {
    const group = buildDevhackBillboards();
    expect(group.name).toBe(DEVHACK_BILLBOARDS_GROUP_NAME);
    expect(group.children.length).toBe(DEVHACK_BILLBOARDS.length);
    expect(meshes(group).length).toBe(DEVHACK_BILLBOARDS.length * DEVHACK_BILLBOARD_MESH_COUNT);
    for (const placement of DEVHACK_BILLBOARDS) {
      const node = group.getObjectByName(placement.id);
      expect(node).toBeDefined();
      expect(node?.position.x).toBeCloseTo(placement.x);
      expect(node?.position.z).toBeCloseTo(placement.z);
      expect(node?.rotation.y).toBeCloseTo(placement.yaw);
    }
  });

  it('lifts the 6 m x 3 m panel 4-5 m off the ground and keeps it out of static batching', () => {
    const group = buildDevhackBillboards();
    const placement = DEVHACK_BILLBOARDS[0]!;
    const front = group.getObjectByName(`${placement.id}_panel_front`) as THREE.Mesh;
    expect(front).toBeInstanceOf(THREE.Mesh);
    const params = (front.geometry as THREE.PlaneGeometry).parameters;
    expect(params.width).toBe(6);
    expect(params.height).toBe(3);
    expect(front.position.y).toBeGreaterThanOrEqual(4);
    expect(front.position.y).toBeLessThanOrEqual(5);
    expect(front.userData.noStaticBatch).toBe(true);
    const material = front.material as THREE.MeshStandardMaterial;
    expect(material.emissiveMap).toBe(material.map);
    expect(material.userData.nightEmissive).toEqual({ dayIntensity: 0.55, nightIntensity: 0.8 });
  });

  it('falls back to a DataTexture when no 2D canvas is available', () => {
    expect(createDevhackAdTexture('school')).toBeInstanceOf(THREE.Texture);
  });

  it('is part of the Cali world and brightens at night', () => {
    const world = buildCaliWorld(CALI_MAP);
    const group = world.group.getObjectByName(DEVHACK_BILLBOARDS_GROUP_NAME);
    expect(group).toBeDefined();
    const panel = group!.getObjectByName(
      `${DEVHACK_BILLBOARDS[0]!.id}_panel_front`,
    ) as THREE.Mesh;
    const material = panel.material as THREE.MeshStandardMaterial;
    setWorldNightLighting(world.group, world.waterMesh, 'night');
    expect(material.emissiveIntensity).toBeCloseTo(0.8);
    setWorldNightLighting(world.group, world.waterMesh, 'golden_hour');
    expect(material.emissiveIntensity).toBeCloseTo(0.55);
  });

  it('lets the static batcher merge frames and posts while panels stay separate', () => {
    const root = new THREE.Group();
    root.add(buildDevhackBillboards());
    batchStaticMeshes(root, { cellSizeMeters: 400 });
    const remaining = meshes(root);
    const panels = remaining.filter((mesh) => mesh.name.includes('_panel_'));
    expect(panels.length).toBe(DEVHACK_BILLBOARDS.length * 2);
    expect(remaining.length).toBeLessThan(DEVHACK_BILLBOARDS.length * DEVHACK_BILLBOARD_MESH_COUNT);
  });
});
