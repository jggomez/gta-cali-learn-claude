/**
 * Caleño wardrobe: Three.js helpers that dress rigged characters like real Caleños —
 * per-variant shared materials, recolored Valeria atlases, gorras / sombrero vueltiao /
 * sunglasses attached to the Head bone, and skinned-mesh frustum culling that stays safe
 * while animating.
 */

import * as THREE from 'three';
import type { CaliOutfitId } from '../types/game';
import {
  VALERIA_OUTFIT_PALETTES,
  recolorValeriaAtlasPixels,
  valeriaRecolorKey,
  type CalenoHeadAccessory,
} from './calenoPeople';

/** userData flag on materials/textures shared between many rigs (renderer must not dispose). */
export const SHARED_CHARACTER_ASSET_FLAG = 'sharedCharacterAsset';

function markShared<T extends { userData: Record<string, unknown> }>(asset: T): T {
  asset.userData[SHARED_CHARACTER_ASSET_FLAG] = true;
  return asset;
}

export function isSharedCharacterAsset(asset: { userData: Record<string, unknown> }): boolean {
  return asset.userData[SHARED_CHARACTER_ASSET_FLAG] === true;
}

// ---------------------------------------------------------------------------------------------
// Shared per-variant materials
// ---------------------------------------------------------------------------------------------

const variantMaterialCache = new WeakMap<THREE.Material, Map<string, THREE.Material>>();

/**
 * Returns one cloned material per (template material, look key), configured once and shared by
 * every rig wearing the same look, so N pedestrians cost N skeletons but not N materials/shaders.
 */
export function getSharedVariantMaterial(
  template: THREE.Material,
  variantKey: string,
  configure: (copy: THREE.Material) => void,
): THREE.Material {
  let byKey = variantMaterialCache.get(template);
  if (!byKey) {
    byKey = new Map<string, THREE.Material>();
    variantMaterialCache.set(template, byKey);
  }
  const cached = byKey.get(variantKey);
  if (cached) {
    return cached;
  }
  const copy = markShared(template.clone());
  configure(copy);
  byKey.set(variantKey, copy);
  return copy;
}

// ---------------------------------------------------------------------------------------------
// Skinned frustum culling
// ---------------------------------------------------------------------------------------------

const SKINNED_SPHERE_MARGIN = 1.6;
const skinnedSphereCache = new WeakMap<THREE.BufferGeometry, THREE.Sphere>();

/**
 * Re-enables frustum culling on every mesh under `root`. Skinned meshes get a bounding sphere
 * computed once per shared geometry in the rest pose and enlarged so walking, running and
 * dancing limbs never pop out (instead of the previous `frustumCulled = false` everywhere).
 * Call after the rig's world matrices are up to date.
 */
export function enableSafeFrustumCulling(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    node.frustumCulled = true;
    if (!(node instanceof THREE.SkinnedMesh)) {
      return;
    }
    let sphere = skinnedSphereCache.get(node.geometry);
    if (!sphere) {
      node.computeBoundingSphere();
      sphere = (node.boundingSphere ?? new THREE.Sphere()).clone();
      sphere.radius = Math.max(sphere.radius * SKINNED_SPHERE_MARGIN, 1e-3);
      skinnedSphereCache.set(node.geometry, sphere);
    }
    node.boundingSphere = sphere.clone();
  });
}

// ---------------------------------------------------------------------------------------------
// Garment trimming
// ---------------------------------------------------------------------------------------------

const trimmedGeometryCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Drops the triangles of a skinned garment that hang entirely below `cutWorldY` in the current
 * (rest) pose — turning caleno.glb's long wedding tailcoat into a waist-length jersey/shirt.
 * The trimmed geometry shares the template's vertex attributes and is cached per template.
 */
export function trimSkinnedGarmentBelow(mesh: THREE.SkinnedMesh, cutWorldY: number): void {
  const source = mesh.geometry;
  const cached = trimmedGeometryCache.get(source);
  if (cached) {
    mesh.geometry = cached;
    return;
  }
  const index = source.index;
  if (!index) {
    return;
  }
  mesh.updateMatrixWorld(true);
  const vertex = new THREE.Vector3();
  const aboveCut = new Map<number, boolean>();
  const isAbove = (vertexIndex: number): boolean => {
    let above = aboveCut.get(vertexIndex);
    if (above === undefined) {
      mesh.getVertexPosition(vertexIndex, vertex);
      above = vertex.applyMatrix4(mesh.matrixWorld).y >= cutWorldY;
      aboveCut.set(vertexIndex, above);
    }
    return above;
  };

  const kept: number[] = [];
  for (let i = 0; i + 2 < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    if (isAbove(a) || isAbove(b) || isAbove(c)) {
      kept.push(a, b, c);
    }
  }

  const trimmed = new THREE.BufferGeometry();
  trimmed.name = `${source.name}_waist_trimmed`;
  for (const [name, attribute] of Object.entries(source.attributes)) {
    trimmed.setAttribute(name, attribute);
  }
  trimmed.morphAttributes = source.morphAttributes;
  trimmed.morphTargetsRelative = source.morphTargetsRelative;
  trimmed.setIndex(kept);
  trimmedGeometryCache.set(source, trimmed);
  mesh.geometry = trimmed;
}

// ---------------------------------------------------------------------------------------------
// Valeria atlas recoloring
// ---------------------------------------------------------------------------------------------

interface SizedImage {
  readonly width: number;
  readonly height: number;
}

const recoloredAtlasCache = new WeakMap<object, Map<string, THREE.CanvasTexture>>();

function isSizedImage(image: unknown): image is SizedImage & CanvasImageSource {
  return (
    typeof image === 'object' &&
    image !== null &&
    typeof (image as SizedImage).width === 'number' &&
    typeof (image as SizedImage).height === 'number' &&
    (image as SizedImage).width > 0 &&
    (image as SizedImage).height > 0
  );
}

/**
 * Builds (once per outfit + skin tone) a CanvasTexture from Valeria's baked diffuse atlas with
 * garments recolored per pixel — yellow trousers to jeans, crop top to the jersey color, skin
 * shifted only on request — keeping her black curly hair and shading. Returns null headlessly
 * (no DOM, no decoded image, or no 2D pixel access) so callers keep the original map.
 */
export function createRecoloredValeriaMap(
  source: THREE.Texture | null,
  outfit: CaliOutfitId,
  skinHex: number | undefined,
): THREE.CanvasTexture | null {
  const image: unknown = source?.image;
  if (!source || typeof document === 'undefined' || !isSizedImage(image)) {
    return null;
  }
  const key = valeriaRecolorKey(outfit, skinHex);
  let byKey = recoloredAtlasCache.get(image);
  const cached = byKey?.get(key);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof ctx.getImageData !== 'function') {
    return null;
  }
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  recolorValeriaAtlasPixels(pixels.data, image.width, image.height, {
    ...VALERIA_OUTFIT_PALETTES[outfit],
    ...(skinHex !== undefined ? { skinHex } : {}),
  });
  ctx.putImageData(pixels, 0, 0);

  const texture = markShared(new THREE.CanvasTexture(canvas));
  texture.name = `valeria_atlas_${key}`;
  texture.flipY = source.flipY;
  texture.colorSpace = source.colorSpace;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.channel = source.channel;
  texture.anisotropy = 4;
  if (!byKey) {
    byKey = new Map<string, THREE.CanvasTexture>();
    recoloredAtlasCache.set(image, byKey);
  }
  byKey.set(key, texture);
  return texture;
}

// ---------------------------------------------------------------------------------------------
// Seated pose & hand props
// ---------------------------------------------------------------------------------------------

const SEATED_THIGH_DIRECTION = new THREE.Vector3(0, -0.06, 1).normalize();
const SEATED_SHIN_DIRECTION = new THREE.Vector3(0, -1, 0.08).normalize();

/** Rotates `bone` (in world space) so the segment toward `child` points along `direction`. */
function aimBoneAt(bone: THREE.Object3D, child: THREE.Object3D, direction: THREE.Vector3): void {
  if (!bone.parent) {
    return;
  }
  const from = child
    .getWorldPosition(new THREE.Vector3())
    .sub(bone.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(from, direction);
  const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const parentInverse = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentInverse.multiply(delta.multiply(worldQ)));
  bone.updateMatrixWorld(true);
}

/**
 * Bends a standing rig (facing +Z, feet at y = 0, current animation pose) into a bench-seated
 * pose: thighs forward, shins down, and lifts the model so the hips rest at `hipHeight` meters.
 * The pose is static, so the rig needs no AnimationMixer updates afterwards.
 */
export function applySeatedPose(rigGroup: THREE.Object3D, modelRoot: THREE.Object3D, hipHeight: number): void {
  rigGroup.updateMatrixWorld(true);
  let hipY: number | null = null;
  for (const side of ['Left', 'Right'] as const) {
    const thigh = findNode(rigGroup, `${side}UpLeg`);
    const knee = findNode(rigGroup, `${side}Leg`);
    const ankle = findNode(rigGroup, `${side}Foot`);
    if (!thigh || !knee || !ankle) {
      continue;
    }
    aimBoneAt(thigh, knee, SEATED_THIGH_DIRECTION);
    aimBoneAt(knee, ankle, SEATED_SHIN_DIRECTION);
    hipY ??= thigh.getWorldPosition(new THREE.Vector3()).y;
  }
  if (hipY === null) {
    return;
  }
  modelRoot.position.y += hipHeight - hipY;
  // Shift back so the thighs rest on the seat rather than floating in front of it
  modelRoot.position.z -= 0.18;
  rigGroup.updateMatrixWorld(true);
}

let thermosKit: { readonly body: THREE.CylinderGeometry; readonly cap: THREE.CylinderGeometry; readonly bodyMat: THREE.MeshStandardMaterial; readonly capMat: THREE.MeshStandardMaterial } | null = null;

/** Puts a red tinto thermos in the rig's right hand (follows the hand bone). */
export function attachTintoThermos(rigGroup: THREE.Object3D): THREE.Object3D | null {
  const hand = findNode(rigGroup, 'RightHand');
  if (!hand) {
    return null;
  }
  thermosKit ??= {
    body: new THREE.CylinderGeometry(0.055, 0.055, 0.26, 14),
    cap: new THREE.CylinderGeometry(0.045, 0.05, 0.06, 14),
    bodyMat: markShared(new THREE.MeshStandardMaterial({ name: 'termo_rojo', color: 0xc21f2a, roughness: 0.38, metalness: 0.25 })),
    capMat: markShared(new THREE.MeshStandardMaterial({ name: 'termo_tapa', color: 0xe9e4da, roughness: 0.5 })),
  };
  rigGroup.updateMatrixWorld(true);
  const thermos = new THREE.Group();
  thermos.name = 'prop_termo_tinto';
  const body = new THREE.Mesh(thermosKit.body, thermosKit.bodyMat);
  const cap = new THREE.Mesh(thermosKit.cap, thermosKit.capMat);
  cap.position.y = 0.16;
  thermos.add(body, cap);
  const handPos = hand.getWorldPosition(new THREE.Vector3());
  thermos.position.set(handPos.x, handPos.y - 0.1, handPos.z + 0.02);
  rigGroup.add(thermos);
  thermos.updateMatrixWorld(true);
  hand.attach(thermos);
  return thermos;
}

// ---------------------------------------------------------------------------------------------
// Head accessories (gorra, sombrero vueltiao, gafas)
// ---------------------------------------------------------------------------------------------

export interface CalenoAccessoryOptions {
  readonly headAccessory: CalenoHeadAccessory;
  readonly sunglasses: boolean;
  readonly capHex: number;
}

interface AccessoryKit {
  readonly capDome: THREE.SphereGeometry;
  readonly capBrim: THREE.CylinderGeometry;
  readonly hatCrown: THREE.CylinderGeometry;
  readonly hatBrim: THREE.CylinderGeometry;
  readonly hatStripe: THREE.RingGeometry;
  readonly lens: THREE.BoxGeometry;
  readonly bridge: THREE.BoxGeometry;
  readonly strawMat: THREE.MeshStandardMaterial;
  readonly stripeMat: THREE.MeshStandardMaterial;
  readonly lensMat: THREE.MeshStandardMaterial;
}

let accessoryKit: AccessoryKit | null = null;
const capMaterials = new Map<number, THREE.MeshStandardMaterial>();

function getAccessoryKit(): AccessoryKit {
  if (accessoryKit) {
    return accessoryKit;
  }
  accessoryKit = {
    // Unit-radius pieces scaled per head size
    capDome: new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    // Front half-disc visor (theta from -90deg to +90deg spans local +Z)
    capBrim: new THREE.CylinderGeometry(1, 1, 0.08, 18, 1, false, -Math.PI / 2, Math.PI),
    hatCrown: new THREE.CylinderGeometry(0.82, 1, 1, 20, 1),
    hatBrim: new THREE.CylinderGeometry(1, 1, 0.05, 28, 1),
    hatStripe: new THREE.RingGeometry(0.62, 0.7, 28),
    lens: new THREE.BoxGeometry(1, 0.62, 0.16),
    bridge: new THREE.BoxGeometry(1, 0.12, 0.12),
    strawMat: markShared(
      new THREE.MeshStandardMaterial({ name: 'vueltiao_cana_flecha', color: 0xeadfc4, roughness: 0.92 }),
    ),
    stripeMat: markShared(
      new THREE.MeshStandardMaterial({ name: 'vueltiao_black_weave', color: 0x1a1612, roughness: 0.9 }),
    ),
    lensMat: markShared(
      new THREE.MeshStandardMaterial({
        name: 'gafas_lens',
        color: 0x0d0f12,
        roughness: 0.12,
        metalness: 0.4,
      }),
    ),
  };
  return accessoryKit;
}

function getCapMaterial(hex: number): THREE.MeshStandardMaterial {
  const safeHex = Number.isFinite(hex) ? hex : 0x1f232e;
  let mat = capMaterials.get(safeHex);
  if (!mat) {
    mat = markShared(
      new THREE.MeshStandardMaterial({ name: 'gorra_twill', color: safeHex, roughness: 0.82 }),
    );
    capMaterials.set(safeHex, mat);
  }
  return mat;
}

function findNode(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return root.getObjectByName(name) ?? root.getObjectByName(`mixamorig${name}`);
}

function buildGorra(kit: AccessoryKit, radius: number, hex: number, reversed: boolean): THREE.Group {
  const cap = new THREE.Group();
  cap.name = 'accessory_gorra';
  cap.userData.reversed = reversed;
  const mat = getCapMaterial(hex);
  const dome = new THREE.Mesh(kit.capDome, mat);
  dome.scale.set(radius * 1.14, radius * 0.86, radius * 1.2);
  cap.add(dome);
  const brim = new THREE.Mesh(kit.capBrim, mat);
  brim.scale.set(radius * 0.95, radius, radius * 1.6);
  brim.position.set(0, radius * 0.03, radius * 0.1);
  brim.rotation.x = 0.12;
  cap.add(brim);
  if (reversed) {
    cap.rotation.y = Math.PI;
  }
  return cap;
}

function buildSombreroVueltiao(kit: AccessoryKit, radius: number): THREE.Group {
  const hat = new THREE.Group();
  hat.name = 'accessory_sombrero_vueltiao';
  const crown = new THREE.Mesh(kit.hatCrown, kit.strawMat);
  crown.scale.set(radius * 1.02, radius * 1.05, radius * 1.02);
  crown.position.y = radius * 0.42;
  hat.add(crown);
  const brim = new THREE.Mesh(kit.hatBrim, kit.strawMat);
  brim.scale.setScalar(radius * 2.7);
  brim.position.y = -radius * 0.08;
  hat.add(brim);
  // Black woven cana flecha rings around the brim
  for (const ringScale of [1.55, 2.05, 2.5] as const) {
    const stripe = new THREE.Mesh(kit.hatStripe, kit.stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.scale.setScalar(radius * ringScale);
    stripe.position.y = -radius * 0.05;
    hat.add(stripe);
  }
  return hat;
}

function buildGafas(kit: AccessoryKit, left: THREE.Vector3, right: THREE.Vector3): THREE.Group {
  const glasses = new THREE.Group();
  glasses.name = 'accessory_gafas';
  const center = left.clone().add(right).multiplyScalar(0.5);
  const spacing = Math.max(0.04, left.distanceTo(right));
  glasses.position.set(center.x, center.y, center.z + 0.035);
  for (const eye of [left, right] as const) {
    const lens = new THREE.Mesh(kit.lens, kit.lensMat);
    lens.scale.setScalar(spacing * 0.78);
    lens.position.set(eye.x - center.x, 0, 0);
    glasses.add(lens);
  }
  const bridge = new THREE.Mesh(kit.bridge, kit.lensMat);
  bridge.scale.setScalar(spacing * 0.3);
  bridge.position.y = spacing * 0.08;
  glasses.add(bridge);
  return glasses;
}

/**
 * Attaches procedural Caleño head accessories to the rig's Head bone (so they follow every
 * animation): a gorra (optionally backwards), a rare sombrero vueltiao, and dark sunglasses
 * in front of the eye bones. `root` must be at rest pose with up-to-date world matrices.
 */
export function attachCalenoAccessories(
  root: THREE.Object3D,
  options: CalenoAccessoryOptions,
): THREE.Object3D[] {
  const head = findNode(root, 'Head');
  if (!head) {
    return [];
  }
  root.updateMatrixWorld(true);
  const kit = getAccessoryKit();
  const headBase = head.getWorldPosition(new THREE.Vector3());
  const topNode = findNode(root, 'HeadTop_End');
  const headTop = topNode
    ? topNode.getWorldPosition(new THREE.Vector3())
    : headBase.clone().add(new THREE.Vector3(0, 0.2, 0));
  const radius = THREE.MathUtils.clamp(headTop.distanceTo(headBase) * 0.5, 0.08, 0.14);
  const attached: THREE.Object3D[] = [];

  const mount = (accessory: THREE.Object3D): void => {
    root.add(accessory);
    accessory.updateMatrixWorld(true);
    head.attach(accessory);
    accessory.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
      }
    });
    attached.push(accessory);
  };

  if (options.headAccessory === 'gorra' || options.headAccessory === 'gorra_reversa') {
    const cap = buildGorra(kit, radius, options.capHex, options.headAccessory === 'gorra_reversa');
    cap.position.set(headTop.x, headTop.y - radius * 0.5, headTop.z + radius * 0.06);
    mount(cap);
  } else if (options.headAccessory === 'sombrero_vueltiao') {
    const hat = buildSombreroVueltiao(kit, radius);
    hat.position.set(headTop.x, headTop.y - radius * 0.35, headTop.z);
    mount(hat);
  }

  if (options.sunglasses) {
    const leftEye = findNode(root, 'LeftEye');
    const rightEye = findNode(root, 'RightEye');
    if (leftEye && rightEye) {
      mount(
        buildGafas(
          kit,
          leftEye.getWorldPosition(new THREE.Vector3()),
          rightEye.getWorldPosition(new THREE.Vector3()),
        ),
      );
    }
  }
  return attached;
}
