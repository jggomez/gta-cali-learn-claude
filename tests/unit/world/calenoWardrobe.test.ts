import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRealGlbForHeadlessTest } from '../../helpers/headlessGlb';
import type { LoadedCharacterAsset } from '../../../src/world/assetLoader';
import {
  SHARED_CHARACTER_ASSET_FLAG,
  createRecoloredValeriaMap,
} from '../../../src/world/calenoWardrobe';
import {
  createCalenoCharacterRig,
  createCivilianPedestrianRig,
  createValeriaPlayerMesh,
} from '../../../src/world/vehicleMeshes';

let caleno: LoadedCharacterAsset;
let valeria: LoadedCharacterAsset;
let donor: LoadedCharacterAsset;

beforeAll(async () => {
  [caleno, valeria, donor] = await Promise.all([
    loadRealGlbForHeadlessTest('public/models/caleno.glb'),
    loadRealGlbForHeadlessTest('public/models/valeria.glb'),
    loadRealGlbForHeadlessTest('public/models/character.glb'),
  ]);
}, 30000);

afterEach(() => {
  vi.unstubAllGlobals();
});

function worldPos(obj: THREE.Object3D): THREE.Vector3 {
  return obj.getWorldPosition(new THREE.Vector3());
}

function meshMaterial(root: THREE.Object3D, name: string): THREE.Material {
  const mesh = root.getObjectByName(name);
  if (!(mesh instanceof THREE.Mesh) || Array.isArray(mesh.material)) {
    throw new Error(`mesh ${name} missing`);
  }
  return mesh.material;
}

describe('Caleño wardrobe: no cowboy hat, Cali accessories on the Head bone', () => {
  it('hides the Ready Player Me cowboy hat by default', () => {
    const rig = createCalenoCharacterRig(caleno, donor);
    expect(rig.group.getObjectByName('Wolf3D_Headwear')?.visible).toBe(false);
    expect(rig.group.getObjectByName('accessory_gorra')).toBeUndefined();
  });

  it('puts a gorra and sunglasses on the head that follow the Head bone', () => {
    const rig = createCalenoCharacterRig(caleno, donor, {
      headAccessory: 'gorra',
      sunglasses: true,
    });
    rig.group.updateMatrixWorld(true);
    const cap = rig.group.getObjectByName('accessory_gorra');
    const glasses = rig.group.getObjectByName('accessory_gafas');
    const head = rig.group.getObjectByName('Head');
    expect(cap?.parent?.name).toBe('Head');
    expect(glasses?.parent?.name).toBe('Head');
    if (!cap || !glasses || !head) throw new Error('accessories missing');
    expect(worldPos(cap).y).toBeGreaterThan(1.55);
    expect(worldPos(cap).y).toBeLessThan(1.85);
    // Glasses sit in front of the face (character faces +Z) around eye height
    expect(worldPos(glasses).z).toBeGreaterThan(worldPos(head).z + 0.05);
    expect(worldPos(glasses).y).toBeGreaterThan(1.55);
    expect(worldPos(glasses).y).toBeLessThan(1.75);
  });

  it('wears the cap backwards and offers a rare sombrero vueltiao', () => {
    const reversed = createCalenoCharacterRig(caleno, donor, { headAccessory: 'gorra_reversa' });
    const cap = reversed.group.getObjectByName('accessory_gorra');
    expect(cap?.userData.reversed).toBe(true);
    const vueltiao = createCalenoCharacterRig(caleno, donor, { headAccessory: 'sombrero_vueltiao' });
    expect(vueltiao.group.getObjectByName('accessory_sombrero_vueltiao')).toBeDefined();
  });

  it('trims the GLB wedding tailcoat into a waist-length jersey (no long coat tails)', () => {
    const rig = createCalenoCharacterRig(caleno, donor, { outfit: 'camiseta_seleccion' });
    rig.group.updateMatrixWorld(true);
    const top = rig.group.getObjectByName('Wolf3D_Outfit_Top');
    const hips = rig.group.getObjectByName('Hips');
    if (!(top instanceof THREE.SkinnedMesh) || !hips) throw new Error('top missing');
    const templateTop = caleno.scene.getObjectByName('Wolf3D_Outfit_Top') as THREE.SkinnedMesh;
    expect(top.geometry).not.toBe(templateTop.geometry);
    expect(top.geometry.index?.count ?? 0).toBeLessThan(templateTop.geometry.index?.count ?? 0);
    expect(top.geometry.index?.count ?? 0).toBeGreaterThan((templateTop.geometry.index?.count ?? 0) * 0.4);

    const hipY = hips.getWorldPosition(new THREE.Vector3()).y;
    const v = new THREE.Vector3();
    const index = top.geometry.index;
    let lowest = Infinity;
    for (let i = 0; i < (index?.count ?? 0); i += 1) {
      top.getVertexPosition(index?.getX(i) ?? 0, v);
      v.applyMatrix4(top.matrixWorld);
      lowest = Math.min(lowest, v.y);
    }
    // Hem ends around the belt instead of hanging down to the thighs
    expect(lowest).toBeGreaterThan(hipY - 0.12);
    // Shared trimmed geometry across rigs
    const twin = createCalenoCharacterRig(caleno, donor, { outfit: 'escarlata' });
    expect((twin.group.getObjectByName('Wolf3D_Outfit_Top') as THREE.Mesh).geometry).toBe(top.geometry);
  });

  it('never renders the cowboy hat on any civilian Caleño', () => {
    for (let index = 0; index < 32; index += 1) {
      const rig = createCivilianPedestrianRig(valeria, caleno, donor, index, 0xff5e7e, 0x1e3a5f);
      const hat = rig?.group.getObjectByName('Wolf3D_Headwear');
      if (hat) {
        expect(hat.visible, `civilian ${index}`).toBe(false);
      }
    }
  });
});

describe('Shared variant materials and safe frustum culling', () => {
  it('shares cloned materials between rigs of the same look, never the template', () => {
    const a = createCalenoCharacterRig(caleno, donor, { outfit: 'escarlata', skinToneHex: 0x8c5a3c });
    const b = createCalenoCharacterRig(caleno, donor, { outfit: 'escarlata', skinToneHex: 0x8c5a3c });
    const c = createCalenoCharacterRig(caleno, donor, { outfit: 'azucarero', skinToneHex: 0x8c5a3c });
    const topA = meshMaterial(a.group, 'Wolf3D_Outfit_Top');
    expect(meshMaterial(b.group, 'Wolf3D_Outfit_Top')).toBe(topA);
    expect(meshMaterial(c.group, 'Wolf3D_Outfit_Top')).not.toBe(topA);
    expect(meshMaterial(caleno.scene, 'Wolf3D_Outfit_Top')).not.toBe(topA);
    expect(topA.userData[SHARED_CHARACTER_ASSET_FLAG]).toBe(true);
  });

  it('keeps skinned meshes frustum culled with a precomputed, enlarged bounding sphere', () => {
    const rig = createValeriaPlayerMesh(valeria, donor);
    let skinned = 0;
    rig.group.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) {
        skinned += 1;
        expect(node.frustumCulled).toBe(true);
        expect(node.boundingSphere).not.toBeNull();
        expect(node.boundingSphere?.radius ?? 0).toBeGreaterThan(0);
      }
    });
    expect(skinned).toBeGreaterThan(0);
  });
});

describe('Valeria: no whole-material muddy tint', () => {
  it('keeps the template albedo color instead of lerping it toward skin/outfit', () => {
    const template = meshMaterial(valeria.scene, 'Ch03') as THREE.MeshStandardMaterial;
    const rig = createValeriaPlayerMesh(valeria, donor, { outfit: 'escarlata' });
    const mat = meshMaterial(rig.group, 'Ch03') as THREE.MeshStandardMaterial;
    expect(mat).not.toBe(template);
    expect(mat.color.getHex()).toBe(template.color.getHex());
    expect(mat.metalness).toBeLessThanOrEqual(0.05);
    const twin = createValeriaPlayerMesh(valeria, donor, { outfit: 'escarlata' });
    expect(meshMaterial(twin.group, 'Ch03')).toBe(mat);
  });
});

describe('createRecoloredValeriaMap', () => {
  function stubCanvasDocument(): { putCalls: Uint8ClampedArray[] } {
    const putCalls: Uint8ClampedArray[] = [];
    let pixels = new Uint8ClampedArray(0);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (_img: unknown, _x: number, _y: number) => {
            // A yellow-trouser pixel followed by a black curly-hair pixel
            pixels = new Uint8ClampedArray([251, 216, 90, 255, 26, 24, 22, 255]);
          },
          getImageData: () => ({ data: pixels, width: 2, height: 1 }),
          putImageData: (img: { data: Uint8ClampedArray }) => {
            putCalls.push(new Uint8ClampedArray(img.data));
          },
        }),
      }),
    });
    return { putCalls };
  }

  it('is headless-safe and returns null without a DOM or source image', () => {
    expect(createRecoloredValeriaMap(null, 'urbano_cali', undefined)).toBeNull();
    const source = new THREE.Texture({ width: 2, height: 1 } as unknown as HTMLImageElement);
    expect(createRecoloredValeriaMap(source, 'urbano_cali', undefined)).toBeNull();
  });

  it('recolors the atlas into a cached CanvasTexture that keeps the glTF UV orientation', () => {
    const { putCalls } = stubCanvasDocument();
    const source = new THREE.Texture({ width: 2, height: 1 } as unknown as HTMLImageElement);
    source.flipY = false;
    source.colorSpace = THREE.SRGBColorSpace;
    const tex = createRecoloredValeriaMap(source, 'urbano_cali', undefined);
    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex?.flipY).toBe(false);
    expect(tex?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(createRecoloredValeriaMap(source, 'urbano_cali', undefined)).toBe(tex);
    expect(createRecoloredValeriaMap(source, 'escarlata', undefined)).not.toBe(tex);

    const [first] = putCalls;
    if (!first) throw new Error('no putImageData');
    // Yellow trousers became denim blue; the curly hair pixel is untouched
    expect(first[2] ?? 0).toBeGreaterThan(first[0] ?? 0);
    expect(Array.from(first.slice(4, 8))).toEqual([26, 24, 22, 255]);
  });
});
