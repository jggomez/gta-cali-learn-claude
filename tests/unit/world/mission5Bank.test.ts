import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CALI_MAP } from '../../../src/config/caliMap';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import { MISSION5_LAYOUT, getBankFacadeFootprint } from '../../../src/config/mission5Layout';
import { buildCaliWorld, setWorldNightLighting } from '../../../src/world/caliLandmarks';
import {
  PROMPT_BANK_GROUP_NAME,
  PROMPT_BANK_SIGN_NAME,
  buildPromptBank,
  createPromptBankSignTexture,
} from '../../../src/world/mission5Bank';
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

describe('buildPromptBank (headless)', () => {
  it('uses a fictional Español Caleño sign from the locale', () => {
    expect(LOCALE_CALI.learningWorld.bankSign).toBe('BANCO SUCURSAL IA');
    expect(LOCALE_CALI.learningWorld.cardTag.length).toBeGreaterThan(0);
    expect(createPromptBankSignTexture()).toBeInstanceOf(THREE.Texture);
  });

  it('builds the portico at the layout facade, within its collider footprint', () => {
    const bank = buildPromptBank();
    const facade = MISSION5_LAYOUT.bankFacade;
    expect(bank.name).toBe(PROMPT_BANK_GROUP_NAME);
    expect(bank.position.x).toBeCloseTo(facade.x);
    expect(bank.position.z).toBeCloseTo(facade.z);
    expect(meshes(bank).length).toBeGreaterThanOrEqual(10);

    bank.updateMatrixWorld(true);
    const body = bank.getObjectByName('prompt_bank_body')!;
    const box = new THREE.Box3().setFromObject(body);
    const footprint = getBankFacadeFootprint(facade);
    expect(box.min.x).toBeCloseTo(footprint.minX);
    expect(box.max.x).toBeCloseTo(footprint.maxX);
    expect(box.min.z).toBeCloseTo(footprint.minZ);
    expect(box.max.z).toBeCloseTo(footprint.maxZ);

    const sign = bank.getObjectByName(PROMPT_BANK_SIGN_NAME) as THREE.Mesh;
    expect(sign.userData.noStaticBatch).toBe(true);
    const signPos = sign.getWorldPosition(new THREE.Vector3());
    expect(signPos.z).toBeGreaterThan(footprint.maxZ);
    expect(signPos.y).toBeGreaterThan(4);
  });

  it('is part of the Cali world, brightens at night and batches its stonework', () => {
    const world = buildCaliWorld(CALI_MAP);
    const bank = world.group.getObjectByName(PROMPT_BANK_GROUP_NAME);
    expect(bank).toBeDefined();
    const sign = bank!.getObjectByName(PROMPT_BANK_SIGN_NAME) as THREE.Mesh;
    const material = sign.material as THREE.MeshStandardMaterial;
    setWorldNightLighting(world.group, world.waterMesh, 'night');
    expect(material.emissiveIntensity).toBeCloseTo(0.9);
    setWorldNightLighting(world.group, world.waterMesh, 'golden_hour');
    expect(material.emissiveIntensity).toBeCloseTo(0.6);

    const root = new THREE.Group();
    const standalone = buildPromptBank();
    root.add(standalone);
    const before = meshes(root).length;
    batchStaticMeshes(root, { cellSizeMeters: 400 });
    const remaining = meshes(root);
    expect(remaining.length).toBeLessThan(before);
    expect(remaining.some((mesh) => mesh.name === PROMPT_BANK_SIGN_NAME)).toBe(true);
  });
});
