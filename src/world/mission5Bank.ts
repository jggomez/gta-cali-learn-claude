/**
 * Mission 5 "El Golpe del Prompt" bank: a fictional ground-floor bank portico on Calle 13 Centro
 * with stone pilasters, glass doors, a glowing AI "eye" and a canvas-painted neon sign.
 * Structural meshes share materials so the static batcher can merge them; the textured sign
 * opts out of batching. Headless-safe like the AcaDevHack billboards.
 */

import * as THREE from 'three';
import { getTerrainElevation } from '../config/caliMap';
import { LOCALE_CALI } from '../config/localeCali';
import { MISSION5_LAYOUT, type Mission5BankFacade } from '../config/mission5Layout';

export const PROMPT_BANK_GROUP_NAME = 'cali_mission5_prompt_bank';
export const PROMPT_BANK_SIGN_NAME = 'cali_mission5_prompt_bank_sign';

const SIGN_CANVAS_WIDTH = 1024;
const SIGN_CANVAS_HEIGHT = 128;
const SIGN_WIDTH = 10;
const SIGN_HEIGHT = 1.25;
const NAVY = '#0b0720';
const CYAN = '#00f0ff';
const MAGENTA = '#ff2e93';
const TEXT = '#f8f7ff';
const DISPLAY_FONT = '"Arial Narrow", Impact, "Bahnschrift Condensed", system-ui, sans-serif';

function paintSign(ctx: CanvasRenderingContext2D): void {
  const copy = LOCALE_CALI.learningWorld;
  const w = SIGN_CANVAS_WIDTH;
  const h = SIGN_CANVAS_HEIGHT;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, w, h);

  ctx.shadowBlur = 16;
  ctx.shadowColor = MAGENTA;
  ctx.strokeStyle = MAGENTA;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 76;
  do {
    ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
    size -= 4;
  } while (size > 40 && ctx.measureText(copy.bankSign).width > w - 80);
  ctx.shadowBlur = 24;
  ctx.shadowColor = CYAN;
  ctx.fillStyle = TEXT;
  ctx.fillText(copy.bankSign, w / 2, 54);

  ctx.shadowBlur = 10;
  ctx.fillStyle = CYAN;
  ctx.font = `700 24px ${DISPLAY_FONT}`;
  ctx.fillText(copy.bankTagline.toUpperCase(), w / 2, 104);
}

/** Paints the neon bank sign; tiny DataTexture fallback when no 2D canvas exists. */
export function createPromptBankSignTexture(): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = SIGN_CANVAS_WIDTH;
    canvas.height = SIGN_CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintSign(ctx);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      return texture;
    }
  }
  const data = new Uint8Array([
    11, 7, 32, 255, 0, 240, 255, 255,
    255, 46, 147, 255, 11, 7, 32, 255,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

function glowMaterial(hex: number, dayIntensity: number, nightIntensity: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: dayIntensity,
    roughness: 0.25,
  });
  material.userData.nightEmissive = { dayIntensity, nightIntensity };
  return material;
}

function addBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  material: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Builds the bank portico at `MISSION5_LAYOUT.bankFacade` (entrance faces local +Z). */
export function buildPromptBank(facade: Mission5BankFacade = MISSION5_LAYOUT.bankFacade): THREE.Group {
  const group = new THREE.Group();
  group.name = PROMPT_BANK_GROUP_NAME;
  group.position.set(facade.x, getTerrainElevation(facade.x, facade.z), facade.z);
  group.rotation.y = facade.yaw;

  const stone = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.78, metalness: 0.02 });
  const granite = new THREE.MeshStandardMaterial({ color: 0x2b2a33, roughness: 0.5, metalness: 0.15 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0f2a3a,
    emissive: 0x0b4f6c,
    emissiveIntensity: 0.35,
    roughness: 0.08,
    metalness: 0.6,
  });
  glass.userData.nightEmissive = { dayIntensity: 0.35, nightIntensity: 0.9 };
  const signBacking = new THREE.MeshStandardMaterial({ color: 0x120a26, roughness: 0.5, metalness: 0.5 });
  const cyanTrim = glowMaterial(0x00f0ff, 1.2, 2.6);
  const magentaTrim = glowMaterial(0xff2e93, 1.2, 2.6);

  const { width: w, depth: d, height: h } = facade;
  const front = d / 2;
  const plinthH = 0.5;

  addBox(group, 'prompt_bank_body', [w, h, d], [0, h / 2, 0], stone);
  addBox(group, 'prompt_bank_plinth', [w + 0.2, plinthH, d + 0.1], [0, plinthH / 2, 0], granite);
  addBox(group, 'prompt_bank_cornice', [w + 0.4, 0.45, d + 0.3], [0, h - 0.1, 0], stone);

  const pilasterH = h - 1.4 - plinthH;
  for (const [index, px] of [-5.6, -2.0, 2.0, 5.6].entries()) {
    addBox(
      group,
      `prompt_bank_pilaster_${index}`,
      [0.55, pilasterH, 0.25],
      [px, plinthH + pilasterH / 2, front + 0.12],
      stone,
    );
  }

  addBox(group, 'prompt_bank_door', [3, 3.4, 0.08], [0, plinthH + 1.7, front + 0.04], glass, false);
  for (const [index, wx] of [-3.8, 3.8].entries()) {
    addBox(group, `prompt_bank_window_${index}`, [2.4, 2.6, 0.08], [wx, plinthH + 1.9, front + 0.04], glass, false);
  }

  const signY = h - 1.55;
  addBox(group, 'prompt_bank_sign_backing', [SIGN_WIDTH + 0.4, SIGN_HEIGHT + 0.3, 0.2], [0, signY, front + 0.1], signBacking);
  addBox(group, 'prompt_bank_trim_top', [SIGN_WIDTH + 0.6, 0.1, 0.25], [0, signY + SIGN_HEIGHT / 2 + 0.22, front + 0.12], cyanTrim, false);
  addBox(group, 'prompt_bank_trim_bottom', [SIGN_WIDTH + 0.6, 0.1, 0.25], [0, signY - SIGN_HEIGHT / 2 - 0.22, front + 0.12], magentaTrim, false);

  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 24), cyanTrim);
  eye.name = 'prompt_bank_ai_eye';
  eye.rotation.x = Math.PI / 2;
  eye.position.set(0, plinthH + 3.4 + 0.32, front + 0.06);
  group.add(eye);

  const signTexture = createPromptBankSignTexture();
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: signTexture,
    emissive: 0xffffff,
    emissiveMap: signTexture,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.05,
  });
  signMat.userData.nightEmissive = { dayIntensity: 0.6, nightIntensity: 0.9 };
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT), signMat);
  sign.name = PROMPT_BANK_SIGN_NAME;
  sign.position.set(0, signY, front + 0.21);
  sign.userData.noStaticBatch = true;
  group.add(sign);

  return group;
}
