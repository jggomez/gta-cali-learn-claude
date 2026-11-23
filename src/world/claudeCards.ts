/**
 * Claude card collectibles: floating, glowing cards with an orange sparkle, a soft vertical
 * light beam and a ground halo so players spot them from ~30 m, day or night.
 * Cards spin and bob in `update(dt)`; collected cards hide via `setCollected`.
 * Headless-safe: falls back to a DataTexture when no 2D canvas exists.
 */

import * as THREE from 'three';
import { CLAUDE_CARD_SPOTS, type ClaudeCardSpot } from '../config/claudeCardSpots';
import { getWalkableGroundHeight } from '../config/caliMap';
import { LOCALE_CALI } from '../config/localeCali';

export const CLAUDE_CARDS_GROUP_NAME = 'cali_claude_cards';
export const CLAUDE_CARD_NAME_PREFIX = 'claude_card_';
/** Meshes per card: frame, front face, back face, light beam, ground halo. */
export const CLAUDE_CARD_MESH_COUNT = 5;

export const CLAUDE_CARD_WIDTH = 0.9;
export const CLAUDE_CARD_HEIGHT = 1.25;
/** Height of the card center above the walkable ground. */
export const CLAUDE_CARD_HOVER_HEIGHT = 1.4;

const BEAM_HEIGHT = 16;
const SPIN_RAD_PER_SEC = 1.6;
const BOB_AMPLITUDE = 0.12;
const BOB_RAD_PER_SEC = 2.2;
const CANVAS_WIDTH = 288;
const CANVAS_HEIGHT = 400;
const CLAUDE_ORANGE = '#d97757';
const CLAUDE_ORANGE_HEX = 0xd97757;
const CARD_INK = '#1f1410';
const CARD_CREAM = '#fbf3e8';
const DISPLAY_FONT = '"Arial Narrow", Impact, "Bahnschrift Condensed", system-ui, sans-serif';

export interface ClaudeCardsHandle {
  readonly group: THREE.Group;
  setCollected(ids: ReadonlySet<string>): void;
  update(dt: number): void;
  dispose(): void;
}

/** Draws the rounded-ray sparkle glyph centered at (cx, cy). */
function paintSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  const rays = 12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = CLAUDE_ORANGE;
  ctx.lineCap = 'round';
  ctx.shadowBlur = 18;
  ctx.shadowColor = CLAUDE_ORANGE;
  for (let i = 0; i < rays; i += 1) {
    const angle = (i / rays) * Math.PI * 2;
    const length = i % 2 === 0 ? radius : radius * 0.72;
    ctx.lineWidth = i % 2 === 0 ? 16 : 12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.16, Math.sin(angle) * radius * 0.16);
    ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
    ctx.stroke();
  }
  ctx.restore();
}

function paintCard(ctx: CanvasRenderingContext2D, index: number, total: number): void {
  const w = CANVAS_WIDTH;
  const h = CANVAS_HEIGHT;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a1a14');
  bg.addColorStop(1, CARD_INK);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.shadowBlur = 20;
  ctx.shadowColor = CLAUDE_ORANGE;
  ctx.strokeStyle = CLAUDE_ORANGE;
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(251, 243, 232, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, w - 56, h - 56);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CARD_CREAM;
  ctx.font = `700 26px ${DISPLAY_FONT}`;
  ctx.fillText(LOCALE_CALI.learningWorld.cardTag, w / 2, 60);

  paintSparkle(ctx, w / 2, 176, 78);

  ctx.shadowBlur = 14;
  ctx.shadowColor = CLAUDE_ORANGE;
  ctx.fillStyle = CARD_CREAM;
  ctx.font = `900 84px ${DISPLAY_FONT}`;
  ctx.fillText(`${index + 1}/${total}`, w / 2, 318);
}

/** Paints one numbered card face; tiny DataTexture fallback when no 2D canvas exists. */
export function createClaudeCardTexture(index: number, total: number): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintCard(ctx, index, total);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return texture;
    }
  }
  const data = new Uint8Array([
    217, 119, 87, 255, 31, 20, 16, 255,
    31, 20, 16, 255, 217, 119, 87, 255,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

interface CardRuntime {
  readonly id: string;
  readonly node: THREE.Group;
  readonly spinner: THREE.Group;
  readonly phase: number;
}

/** Builds every Claude card as a named child of one group plus its animation controller. */
export function buildClaudeCards(
  spots: readonly ClaudeCardSpot[] = CLAUDE_CARD_SPOTS,
): ClaudeCardsHandle {
  const group = new THREE.Group();
  group.name = CLAUDE_CARDS_GROUP_NAME;

  const frameGeo = new THREE.BoxGeometry(CLAUDE_CARD_WIDTH + 0.08, CLAUDE_CARD_HEIGHT + 0.08, 0.04);
  const faceGeo = new THREE.PlaneGeometry(CLAUDE_CARD_WIDTH, CLAUDE_CARD_HEIGHT);
  const beamGeo = new THREE.CylinderGeometry(0.28, 0.55, BEAM_HEIGHT, 16, 1, true);
  beamGeo.translate(0, BEAM_HEIGHT / 2, 0);
  const haloGeo = new THREE.RingGeometry(0.75, 1.25, 32);
  haloGeo.rotateX(-Math.PI / 2);

  const frameMat = new THREE.MeshStandardMaterial({
    color: CLAUDE_ORANGE_HEX,
    emissive: CLAUDE_ORANGE_HEX,
    emissiveIntensity: 1.6,
    roughness: 0.35,
    metalness: 0.2,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: CLAUDE_ORANGE_HEX,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffb38f,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const textures: THREE.Texture[] = [];
  const faceMats: THREE.MeshStandardMaterial[] = [];
  const cards: CardRuntime[] = [];

  spots.forEach((spot, index) => {
    const texture = createClaudeCardTexture(index, spots.length);
    textures.push(texture);
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.05,
    });
    faceMats.push(faceMat);

    const node = new THREE.Group();
    node.name = `${CLAUDE_CARD_NAME_PREFIX}${spot.id}`;
    node.userData.claudeCardId = spot.id;
    node.userData.noStaticBatch = true;
    node.position.set(spot.x, getWalkableGroundHeight(spot.x, spot.z), spot.z);

    const spinner = new THREE.Group();
    spinner.name = `${node.name}_spinner`;
    spinner.position.y = CLAUDE_CARD_HOVER_HEIGHT;
    spinner.rotation.y = index * 0.7;
    node.add(spinner);

    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.name = `${node.name}_frame`;
    spinner.add(frame);

    const front = new THREE.Mesh(faceGeo, faceMat);
    front.name = `${node.name}_front`;
    front.position.z = 0.025;
    spinner.add(front);

    const back = new THREE.Mesh(faceGeo, faceMat);
    back.name = `${node.name}_back`;
    back.position.z = -0.025;
    back.rotation.y = Math.PI;
    spinner.add(back);

    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.name = `${node.name}_beam`;
    beam.renderOrder = 2;
    node.add(beam);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.name = `${node.name}_halo`;
    halo.position.y = 0.06;
    halo.renderOrder = 2;
    node.add(halo);

    for (const mesh of [frame, front, back, beam, halo]) {
      mesh.userData.noStaticBatch = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }

    group.add(node);
    cards.push({ id: spot.id, node, spinner, phase: index * 1.3 });
  });

  let elapsed = 0;

  return {
    group,
    setCollected(ids: ReadonlySet<string>): void {
      for (const card of cards) {
        card.node.visible = !ids.has(card.id);
      }
    },
    update(dt: number): void {
      if (!Number.isFinite(dt) || dt <= 0) {
        return;
      }
      elapsed += dt;
      const pulse = 0.18 + 0.08 * Math.sin(elapsed * 3);
      beamMat.opacity = pulse;
      for (const card of cards) {
        if (!card.node.visible) {
          continue;
        }
        card.spinner.rotation.y += SPIN_RAD_PER_SEC * dt;
        card.spinner.position.y =
          CLAUDE_CARD_HOVER_HEIGHT + Math.sin(elapsed * BOB_RAD_PER_SEC + card.phase) * BOB_AMPLITUDE;
      }
    },
    dispose(): void {
      group.removeFromParent();
      for (const geometry of [frameGeo, faceGeo, beamGeo, haloGeo]) {
        geometry.dispose();
      }
      for (const material of [frameMat, beamMat, haloMat, ...faceMats]) {
        material.dispose();
      }
      for (const texture of textures) {
        texture.dispose();
      }
    },
  };
}
