/**
 * AcaDevHack de IA roadside billboards: two steel posts, a framed panel with a neon trim bar,
 * and a canvas-painted Vice Sunset ad on both faces. Posts, frames and trims share materials
 * so the static batcher can merge them; the textured panels opt out of batching.
 */

import * as THREE from 'three';
import { getTerrainElevation } from '../config/caliMap';
import {
  DEVHACK_BILLBOARDS,
  DEVHACK_BILLBOARD_PANEL_BOTTOM,
  DEVHACK_BILLBOARD_PANEL_HEIGHT,
  DEVHACK_BILLBOARD_PANEL_WIDTH,
  DEVHACK_BILLBOARD_POST_OFFSET,
  type DevhackAdMessageId,
  type DevhackBillboardPlacement,
} from '../config/devhackAds';
import { LOCALE_CALI } from '../config/localeCali';

export const DEVHACK_BILLBOARDS_GROUP_NAME = 'cali_devhack_billboards';
/** Meshes per billboard: 2 posts, frame, neon trim, front panel, back panel. */
export const DEVHACK_BILLBOARD_MESH_COUNT = 6;

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;
const NAVY = '#120826';
const DEEP = '#05030f';
const MAGENTA = '#ff2e93';
const CYAN = '#00f0ff';
const TEXT = '#f8f7ff';
const DISPLAY_FONT = '"Arial Narrow", Impact, "Bahnschrift Condensed", system-ui, sans-serif';
const POST_BURY_METERS = 0.6;
const FRAME_DEPTH = 0.32;

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
): number {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
    if (ctx.measureText(text).width <= maxWidth) {
      break;
    }
    size -= 4;
  }
  return size;
}

/** Splits a long headline into at most two balanced lines. */
function splitHeadline(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  ctx.font = `900 112px ${DISPLAY_FONT}`;
  if (ctx.measureText(text).width <= maxWidth) {
    return [text];
  }
  const words = text.split(' ');
  if (words.length < 2) {
    return [text];
  }
  let best: string[] = [text];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(ctx.measureText(a).width - ctx.measureText(b).width);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [a, b];
    }
  }
  return best;
}

function paintAd(ctx: CanvasRenderingContext2D, messageId: DevhackAdMessageId): void {
  const copy = LOCALE_CALI.devhackAds;
  const message = copy.messages[messageId];
  const w = CANVAS_WIDTH;
  const h = CANVAS_HEIGHT;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, NAVY);
  bg.addColorStop(0.6, DEEP);
  bg.addColorStop(1, '#1d0e3d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Faint circuit grid for a techy backdrop
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.07)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Neon double border (magenta outer, cyan inner) with glow
  ctx.shadowBlur = 24;
  ctx.shadowColor = MAGENTA;
  ctx.strokeStyle = MAGENTA;
  ctx.lineWidth = 12;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.shadowColor = CYAN;
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 4;
  ctx.strokeRect(34, 34, w - 68, h - 68);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Brand tag
  ctx.shadowBlur = 12;
  ctx.shadowColor = CYAN;
  ctx.fillStyle = CYAN;
  ctx.font = `700 34px ${DISPLAY_FONT}`;
  ctx.fillText(copy.brandTag.toUpperCase(), w / 2, 78);

  // Headline
  const maxTextWidth = w - 120;
  const lines = splitHeadline(ctx, message.headline, maxTextWidth);
  const headlineSize = Math.min(
    ...lines.map((line) => fitFontSize(ctx, line, maxTextWidth, lines.length > 1 ? 96 : 124, 44)),
  );
  ctx.font = `900 ${headlineSize}px ${DISPLAY_FONT}`;
  ctx.shadowBlur = 28;
  ctx.shadowColor = MAGENTA;
  ctx.fillStyle = TEXT;
  const headlineCenter = lines.length > 1 ? 196 : 208;
  const lineGap = headlineSize * 1.02;
  lines.forEach((line, index) => {
    const offset = (index - (lines.length - 1) / 2) * lineGap;
    ctx.fillText(line, w / 2, headlineCenter + offset);
  });

  // Tagline
  const taglineSize = fitFontSize(ctx, message.tagline, maxTextWidth, 60, 28);
  ctx.font = `700 ${taglineSize}px ${DISPLAY_FONT}`;
  ctx.shadowBlur = 16;
  ctx.shadowColor = CYAN;
  ctx.fillStyle = CYAN;
  ctx.fillText(message.tagline, w / 2, 336);

  // Footer bar with the site
  ctx.shadowBlur = 0;
  const barY = h - 116;
  ctx.fillStyle = MAGENTA;
  ctx.fillRect(34, barY, w - 68, 82);
  ctx.fillStyle = NAVY;
  ctx.font = `900 54px ${DISPLAY_FONT}`;
  ctx.fillText(copy.footer, w / 2, barY + 43);
}

/** Paints one ad into a CanvasTexture; falls back to a tiny DataTexture when no 2D canvas exists. */
export function createDevhackAdTexture(messageId: DevhackAdMessageId): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintAd(ctx, messageId);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      return texture;
    }
  }

  const data = new Uint8Array([
    18, 8, 38, 255, 255, 46, 147, 255,
    0, 240, 255, 255, 18, 8, 38, 255,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

interface SharedBillboardMaterials {
  readonly steel: THREE.MeshStandardMaterial;
  readonly frame: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
}

function createSharedMaterials(): SharedBillboardMaterials {
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2a2e36,
    roughness: 0.45,
    metalness: 0.78,
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x151226,
    roughness: 0.5,
    metalness: 0.72,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.2,
    roughness: 0.25,
  });
  trim.userData.nightEmissive = { dayIntensity: 1.2, nightIntensity: 2.6 };
  return { steel, frame, trim };
}

function createPanelMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.55,
    roughness: 0.3,
    metalness: 0.05,
  });
  // Same spec shape setWorldNightLighting reads for the neon signs.
  material.userData.nightEmissive = { dayIntensity: 0.55, nightIntensity: 0.8 };
  return material;
}

function buildBillboard(
  placement: DevhackBillboardPlacement,
  materials: SharedBillboardMaterials,
  panelMaterial: THREE.MeshStandardMaterial,
): THREE.Group {
  const node = new THREE.Group();
  node.name = placement.id;
  node.userData.devhackMessageId = placement.messageId;
  node.position.set(placement.x, getTerrainElevation(placement.x, placement.z), placement.z);
  node.rotation.y = placement.yaw;

  const panelW = DEVHACK_BILLBOARD_PANEL_WIDTH;
  const panelH = DEVHACK_BILLBOARD_PANEL_HEIGHT;
  const panelCenterY = DEVHACK_BILLBOARD_PANEL_BOTTOM + panelH / 2;

  const postHeight = panelCenterY + POST_BURY_METERS;
  const postGeo = new THREE.BoxGeometry(0.3, postHeight, 0.3);
  for (const sx of [-DEVHACK_BILLBOARD_POST_OFFSET, DEVHACK_BILLBOARD_POST_OFFSET]) {
    const post = new THREE.Mesh(postGeo, materials.steel);
    post.name = `${placement.id}_post`;
    post.position.set(sx, postHeight / 2 - POST_BURY_METERS, 0);
    post.castShadow = true;
    post.receiveShadow = true;
    node.add(post);
  }

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(panelW + 0.36, panelH + 0.36, FRAME_DEPTH),
    materials.frame,
  );
  frame.name = `${placement.id}_frame`;
  frame.position.y = panelCenterY;
  frame.castShadow = true;
  frame.receiveShadow = true;
  node.add(frame);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(panelW + 0.36, 0.12, FRAME_DEPTH + 0.12),
    materials.trim,
  );
  trim.name = `${placement.id}_trim`;
  trim.position.y = panelCenterY + panelH / 2 + 0.24;
  node.add(trim);

  const panelGeo = new THREE.PlaneGeometry(panelW, panelH);
  const front = new THREE.Mesh(panelGeo, panelMaterial);
  front.name = `${placement.id}_panel_front`;
  front.position.set(0, panelCenterY, FRAME_DEPTH / 2 + 0.01);
  front.userData.noStaticBatch = true;
  node.add(front);

  const back = new THREE.Mesh(panelGeo, panelMaterial);
  back.name = `${placement.id}_panel_back`;
  back.position.set(0, panelCenterY, -FRAME_DEPTH / 2 - 0.01);
  back.rotation.y = Math.PI;
  back.userData.noStaticBatch = true;
  node.add(back);

  return node;
}

/** Builds every AcaDevHack de IA billboard as children of one named group. */
export function buildDevhackBillboards(
  placements: readonly DevhackBillboardPlacement[] = DEVHACK_BILLBOARDS,
): THREE.Group {
  const group = new THREE.Group();
  group.name = DEVHACK_BILLBOARDS_GROUP_NAME;

  const materials = createSharedMaterials();
  const panelMaterials = new Map<DevhackAdMessageId, THREE.MeshStandardMaterial>();

  for (const placement of placements) {
    let panelMaterial = panelMaterials.get(placement.messageId);
    if (!panelMaterial) {
      panelMaterial = createPanelMaterial(createDevhackAdTexture(placement.messageId));
      panelMaterials.set(placement.messageId, panelMaterial);
    }
    group.add(buildBillboard(placement, materials, panelMaterial));
  }
  return group;
}
