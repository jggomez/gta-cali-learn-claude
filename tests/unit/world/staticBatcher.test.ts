import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { batchStaticMeshes, updateDetailBatchCulling } from '../../../src/world/staticBatcher';

function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      count += 1;
    }
  });
  return count;
}

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

function buildPalmRow(material: THREE.Material, count: number): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(0.2, 0.3, 6, 8);
  for (let i = 0; i < count; i += 1) {
    const trunk = new THREE.Mesh(geometry, material);
    trunk.position.set(i * 4, 3, 2);
    trunk.rotation.z = 0.05 * i;
    trunk.castShadow = true;
    group.add(trunk);
  }
  return group;
}

describe('batchStaticMeshes', () => {
  it('merges meshes sharing a material inside a spatial cell into one draw call with identical world bounds', () => {
    const root = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2b });
    root.add(buildPalmRow(bark, 10));
    const before = worldBox(root);

    const stats = batchStaticMeshes(root, { cellSizeMeters: 1000 });

    expect(countMeshes(root)).toBe(1);
    expect(stats.sourceMeshes).toBe(10);
    expect(stats.batchMeshes).toBe(1);
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-4);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-4);
    let merged: THREE.Mesh | undefined;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) merged = node;
    });
    expect(merged?.material).toBe(bark);
    expect(merged?.castShadow).toBe(true);
  });

  it('keeps one batch per material and per spatial cell so frustum culling still works', () => {
    const root = new THREE.Group();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(2, 2, 2);
    for (const [x, mat] of [
      [0, a],
      [3, a],
      [0, b],
      [200, a],
    ] as const) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 1, 0);
      root.add(mesh);
    }

    const stats = batchStaticMeshes(root, { cellSizeMeters: 64 });

    expect(stats.batchMeshes).toBe(3);
    expect(countMeshes(root)).toBe(3);
  });

  it('preserves the mesh surfaceRole used by applyPhotographicAssets and never mixes roles', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const asphalt = new THREE.Mesh(geo, mat);
    asphalt.userData.surfaceRole = 'asphalt';
    const plain = new THREE.Mesh(geo, mat);
    plain.position.x = 2;
    root.add(asphalt, plain);

    batchStaticMeshes(root, { cellSizeMeters: 1000 });

    const roles: unknown[] = [];
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) roles.push(node.userData.surfaceRole);
    });
    expect(roles.sort()).toEqual(['asphalt', undefined]);
  });

  it('leaves excluded subtrees, hidden nodes, shader materials, multi-material and large meshes untouched', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const excluded = new THREE.Group();
    excluded.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat));
    const hidden = new THREE.Mesh(geo, mat);
    hidden.visible = false;
    const water = new THREE.Mesh(geo, new THREE.ShaderMaterial());
    const multi = new THREE.Mesh(geo, [mat, mat]);
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat);
    root.add(excluded, hidden, water, multi, terrain);

    const stats = batchStaticMeshes(root, {
      cellSizeMeters: 1000,
      exclude: [excluded],
      maxSourceRadiusMeters: 60,
    });

    expect(stats.batchMeshes).toBe(0);
    expect(countMeshes(root)).toBe(6);
    expect(excluded.children).toHaveLength(2);
  });

  it('turns off shadow casting on tiny details and keeps them in separate detail batches', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat);
    bolt.castShadow = true;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 1), mat);
    wall.castShadow = true;
    root.add(bolt, wall);

    const stats = batchStaticMeshes(root, {
      cellSizeMeters: 1000,
      detailRadiusMeters: 0.6,
    });

    expect(stats.batchMeshes).toBe(2);
    const detail = stats.detailBatches;
    expect(detail).toHaveLength(1);
    expect(detail[0]?.castShadow).toBe(false);
  });

  it('skips mirrored transforms whose winding would flip after baking', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mirrored = new THREE.Mesh(geo, mat);
    mirrored.scale.x = -1;
    const normal = new THREE.Mesh(geo, mat);
    root.add(mirrored, normal);

    const stats = batchStaticMeshes(root, { cellSizeMeters: 1000 });

    expect(stats.sourceMeshes).toBe(1);
    expect(countMeshes(root)).toBe(2);
  });
});

describe('updateDetailBatchCulling', () => {
  it('hides detail batches whose bounds lie beyond the draw distance from the camera', () => {
    const near = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const far = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    far.geometry.translate(300, 0, 0);
    near.geometry.computeBoundingSphere();
    far.geometry.computeBoundingSphere();

    updateDetailBatchCulling([near, far], 0, 0, 120);

    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);

    updateDetailBatchCulling([near, far], 250, 0, 120);
    expect(near.visible).toBe(false);
    expect(far.visible).toBe(true);
  });
});
