/**
 * Static scene batching for the procedural Cali city.
 * Bakes the world transform of every static mesh, then merges meshes that share a material,
 * shadow flags, surface role and vertex layout inside the same spatial cell into a single
 * BufferGeometry draw call. Materials are kept by reference, so in-place material updates
 * (night emissive, traffic lenses, photographic PBR upgrades) keep working on the batches.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface StaticBatchOptions {
  /** Edge length of the square XZ cells used to group meshes (keeps frustum culling useful). */
  readonly cellSizeMeters: number;
  /** Subtrees that must stay as authored (animated, toggled or referenced at runtime). */
  readonly exclude?: readonly THREE.Object3D[];
  /** Meshes with a larger world bounding radius are left alone (terrain, roads, water). */
  readonly maxSourceRadiusMeters?: number;
  /** Meshes at or below this world radius stop casting shadows and go to detail batches. */
  readonly detailRadiusMeters?: number;
}

export interface StaticBatchStats {
  readonly sourceMeshes: number;
  readonly batchMeshes: number;
  /** Batches made of small props that callers may distance-cull. */
  readonly detailBatches: readonly THREE.Mesh[];
}

interface BatchBucket {
  readonly material: THREE.Material;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly renderOrder: number;
  readonly surfaceRole: unknown;
  readonly isDetail: boolean;
  readonly geometries: THREE.BufferGeometry[];
  readonly sources: THREE.Mesh[];
}

const DEFAULT_MAX_SOURCE_RADIUS_METERS = 48;
const DEFAULT_DETAIL_RADIUS_METERS = 0;
const BATCH_GROUP_NAME = 'cali_static_batches';

function describeVertexLayout(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort();
  const parts = names.map((name) => {
    const attr = geometry.getAttribute(name);
    const arrayType =
      attr instanceof THREE.BufferAttribute ? attr.array.constructor.name : 'interleaved';
    return `${name}:${attr.itemSize}:${attr.normalized ? 1 : 0}:${arrayType}`;
  });
  return `${geometry.index ? 'i' : 'n'}|${parts.join(',')}`;
}

function isBatchableMesh(node: THREE.Object3D): node is THREE.Mesh {
  if (!(node instanceof THREE.Mesh)) {
    return false;
  }
  if (
    node instanceof THREE.InstancedMesh ||
    node instanceof THREE.SkinnedMesh ||
    Array.isArray(node.material) ||
    node.material instanceof THREE.ShaderMaterial ||
    node.userData.noStaticBatch === true
  ) {
    return false;
  }
  const geometry = node.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return false;
  }
  if (Object.keys(geometry.morphAttributes).length > 0) {
    return false;
  }
  for (const name of Object.keys(geometry.attributes)) {
    if (!(geometry.getAttribute(name) instanceof THREE.BufferAttribute)) {
      return false;
    }
  }
  return true;
}

function collectCandidates(
  root: THREE.Object3D,
  excluded: ReadonlySet<THREE.Object3D>,
): THREE.Mesh[] {
  const candidates: THREE.Mesh[] = [];
  const visit = (node: THREE.Object3D): void => {
    if (excluded.has(node) || !node.visible) {
      return;
    }
    if (isBatchableMesh(node)) {
      candidates.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return candidates;
}

/**
 * Merges static meshes under `root` in place. Returns batching statistics and the detail batches.
 */
export function batchStaticMeshes(
  root: THREE.Object3D,
  options: StaticBatchOptions,
): StaticBatchStats {
  const maxRadius = options.maxSourceRadiusMeters ?? DEFAULT_MAX_SOURCE_RADIUS_METERS;
  const detailRadius = options.detailRadiusMeters ?? DEFAULT_DETAIL_RADIUS_METERS;
  const cell = Math.max(1, options.cellSizeMeters);

  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const candidates = collectCandidates(root, new Set(options.exclude ?? []));

  const buckets = new Map<string, BatchBucket>();
  const localMatrix = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  for (const mesh of candidates) {
    const material = mesh.material;
    if (Array.isArray(material)) {
      continue;
    }
    localMatrix.multiplyMatrices(rootInverse, mesh.matrixWorld);
    if (localMatrix.determinant() <= 0) {
      continue;
    }
    if (!mesh.geometry.boundingSphere) {
      mesh.geometry.computeBoundingSphere();
    }
    sphere.copy(mesh.geometry.boundingSphere ?? sphere).applyMatrix4(localMatrix);
    if (!Number.isFinite(sphere.radius) || sphere.radius > maxRadius) {
      continue;
    }

    const isDetail = sphere.radius <= detailRadius;
    const castShadow = mesh.castShadow && !isDetail;
    const cellX = Math.floor(sphere.center.x / cell);
    const cellZ = Math.floor(sphere.center.z / cell);
    const role: unknown = mesh.userData.surfaceRole;
    const key = [
      cellX,
      cellZ,
      material.uuid,
      castShadow ? 1 : 0,
      mesh.receiveShadow ? 1 : 0,
      mesh.renderOrder,
      String(role),
      isDetail ? 'd' : 's',
      describeVertexLayout(mesh.geometry),
    ].join('|');

    const bucket = buckets.get(key) ?? {
        material,
        castShadow,
        receiveShadow: mesh.receiveShadow,
        renderOrder: mesh.renderOrder,
        surfaceRole: role,
        isDetail,
        geometries: [],
        sources: [],
      };
    buckets.set(key, bucket);
    const baked = mesh.geometry.clone().applyMatrix4(localMatrix);
    baked.clearGroups();
    bucket.geometries.push(baked);
    bucket.sources.push(mesh);
  }

  const batchGroup = new THREE.Group();
  batchGroup.name = BATCH_GROUP_NAME;
  const detailBatches: THREE.Mesh[] = [];
  let sourceMeshes = 0;

  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false);
    for (const geometry of bucket.geometries) {
      geometry.dispose();
    }
    if (!merged) {
      continue;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();

    const batch = new THREE.Mesh(merged, bucket.material);
    batch.name = `static_batch_${bucket.sources[0]?.name ?? ''}`;
    batch.castShadow = bucket.castShadow;
    batch.receiveShadow = bucket.receiveShadow;
    batch.renderOrder = bucket.renderOrder;
    batch.matrixAutoUpdate = false;
    if (bucket.surfaceRole !== undefined) {
      batch.userData.surfaceRole = bucket.surfaceRole;
    }
    batchGroup.add(batch);
    if (bucket.isDetail) {
      detailBatches.push(batch);
    }

    for (const source of bucket.sources) {
      source.removeFromParent();
    }
    sourceMeshes += bucket.sources.length;
  }

  if (batchGroup.children.length > 0) {
    root.add(batchGroup);
    batchGroup.updateMatrixWorld(true);
  }
  disposeOrphanedGeometries(candidates, root);

  return { sourceMeshes, batchMeshes: batchGroup.children.length, detailBatches };
}

function disposeOrphanedGeometries(candidates: readonly THREE.Mesh[], root: THREE.Object3D): void {
  const stillUsed = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry instanceof THREE.BufferGeometry) {
      stillUsed.add(node.geometry);
    }
  });
  for (const mesh of candidates) {
    if (!mesh.parent && !stillUsed.has(mesh.geometry)) {
      mesh.geometry.dispose();
    }
  }
}

/**
 * Distance-culls small-prop batches (bollards, bolts, window trims) beyond `drawDistance`.
 */
export function updateDetailBatchCulling(
  batches: readonly THREE.Mesh[],
  cameraX: number,
  cameraZ: number,
  drawDistance: number,
): void {
  for (const batch of batches) {
    const bounds = batch.geometry.boundingSphere;
    if (!bounds) {
      continue;
    }
    const dx = bounds.center.x - cameraX;
    const dz = bounds.center.z - cameraZ;
    const reach = drawDistance + bounds.radius;
    batch.visible = dx * dx + dz * dz <= reach * reach;
  }
}
