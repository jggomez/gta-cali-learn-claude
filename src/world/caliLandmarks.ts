/**
 * Photorealistic 3D Santiago de Cali world builder:
 * - Displaced Andean hillside & valley terrain from getTerrainElevation()
 * - Animated GLSL Fresnel-reflective Río Cali corridor and architectural concrete/steel bridges
 * - Photographic 1K PBR asphalt roads with crisp road stripes, zebra crosswalks, and concrete sidewalks
 * - Cantilevered traffic signals, warm streetlamps, and boutique Cali signage
 * - Architectural buildings (San Antonio stucco + clay tile roofs, downtown masonry + reflective glass)
 * - 6 iconic named Cali landmarks + curved tropical palms & flowering Cali Jacarandas
 * - `applyPhotographicAssets()` in-place PBR texture upgrade (safe in headless Node tests).
 */

import * as THREE from 'three';
import { getTerrainElevation } from '../config/caliMap';
import type {
  AabbCollider,
  BridgeSpan,
  CaliMapConfig,
  LandmarkDef,
  RiverCorridor,
  TimeOfDay,
  Vec2,
} from '../types/game';
import type { LoadedWorldTextureSets, PhotoPbrMaterialMaps } from './assetLoader';
import {
  createAsphaltTextures,
  createBuildingFacadeTextures,
  createCrosswalkTexture,
  createNeonSignTexture,
  createSidewalkTextures,
  createWaterShaderMaterial,
  type BuildingFacadeStyle,
  type BuildingFacadeTextureSet,
  type SidewalkTextureSet,
} from './pbrTextures';

export type SurfaceRole =
  | 'asphalt'
  | 'sidewalk'
  | 'terrain'
  | 'plaster'
  | 'roof'
  | 'facade'
  | 'palm_bark'
  | 'palm_leaves'
  | 'jacaranda_bark'
  | 'jacaranda_leaves';

interface NightEmissiveSpec {
  readonly dayIntensity: number;
  readonly nightIntensity: number;
  readonly dayEmissiveHex?: number;
  readonly nightEmissiveHex?: number;
  readonly requireEmissiveMap?: boolean;
}

interface NightOpacitySpec {
  readonly dayOpacity: number;
  readonly nightOpacity: number;
}

interface NightLightSpec {
  readonly dayIntensity: number;
  readonly nightIntensity: number;
}

function tagNightEmissive(
  material: THREE.MeshStandardMaterial,
  spec: NightEmissiveSpec,
): THREE.MeshStandardMaterial {
  material.userData.nightEmissive = spec;
  return material;
}

function tagNightOpacity(
  material: THREE.MeshBasicMaterial,
  dayOpacity: number,
  nightOpacity: number,
): THREE.MeshBasicMaterial {
  material.userData.nightOpacity = {
    dayOpacity,
    nightOpacity,
  } satisfies NightOpacitySpec;
  return material;
}

function tagNightLight<T extends THREE.Light>(
  light: T,
  dayIntensity: number,
  nightIntensity: number,
): T {
  light.userData.nightLight = {
    dayIntensity,
    nightIntensity,
  } satisfies NightLightSpec;
  return light;
}

const TERRAIN_EXTENT = 520;
const TERRAIN_SEGMENTS = 208;
const ROAD_OFFSET = 0.08;
const NS_ROAD_TIER_OFFSET = 0.008;
const ROAD_TILE_LENGTH_METERS = 16;
const SIDEWALK_TILE_METERS = 8;

export interface CaliWorldBuildResult {
  readonly group: THREE.Group;
  readonly waterMesh: THREE.Mesh;
}

interface CrosswalkSpec {
  readonly x: number;
  readonly z: number;
  readonly spanWidth: number;
  readonly acrossAxis: 'ns_road' | 'ew_road';
}

interface SidewalkBlockSpec {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

interface TrafficIntersectionSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly halfWidthX: number;
  readonly halfWidthZ: number;
}

interface StreetlightSpec {
  readonly x: number;
  readonly z: number;
  readonly armYaw: number;
}

interface NeonSignSpec {
  readonly id: string;
  readonly buildingId: string;
  readonly label: string;
  readonly colorHex: number;
  readonly face: 'east' | 'west' | 'north' | 'south';
  readonly placement: 'rooftop' | 'facade';
  readonly width: number;
  readonly height: number;
}

function isInsideBridge(
  x: number,
  z: number,
  bridges: readonly BridgeSpan[],
): BridgeSpan | null {
  for (const bridge of bridges) {
    if (
      x >= bridge.minX &&
      x <= bridge.maxX &&
      z >= bridge.minZ &&
      z <= bridge.maxZ
    ) {
      return bridge;
    }
  }
  return null;
}

function isInsideRiver(x: number, z: number, river: RiverCorridor): boolean {
  return (
    x >= river.minX &&
    x <= river.maxX &&
    z >= river.minZ &&
    z <= river.maxZ
  );
}

function getRoadSurfaceElevation(
  x: number,
  z: number,
  map: CaliMapConfig,
): number {
  const bridge = isInsideBridge(x, z, map.river.bridges);
  if (bridge) {
    return bridge.deckElevation + 0.04;
  }
  return getTerrainElevation(x, z) + ROAD_OFFSET;
}

/**
 * Scales BoxGeometry face UVs in world meters so shared repeating PBR textures stay unstretched.
 * Face index groups in Three.js BoxGeometry: 0..3 (+X), 4..7 (-X), 8..11 (+Y), 12..15 (-Y), 16..19 (+Z), 20..23 (-Z).
 */
function createUvScaledBoxGeometry(
  width: number,
  height: number,
  depth: number,
  tileU: number,
  tileV: number,
  options?: {
    readonly integerSideRepeat?: boolean;
    readonly verticalRepeat?: number;
    readonly topBottomTile?: number;
  },
): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute('uv');
  const useInt = options?.integerSideRepeat ?? false;

  const xFaceU = useInt
    ? Math.max(1, Math.round(depth / tileU))
    : Math.max(0.25, depth / tileU);
  const zFaceU = useInt
    ? Math.max(1, Math.round(width / tileU))
    : Math.max(0.25, width / tileU);
  const sideV =
    options?.verticalRepeat ??
    (useInt ? Math.max(1, Math.round(height / tileV)) : Math.max(0.2, height / tileV));

  const topTile = options?.topBottomTile;
  const topU = topTile ? Math.max(0.5, width / topTile) : 1;
  const topV = topTile ? Math.max(0.5, depth / topTile) : 1;

  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (i < 8) {
      uv.setXY(i, u * xFaceU, v * sideV);
    } else if (i < 16) {
      uv.setXY(i, u * topU, v * topV);
    } else {
      uv.setXY(i, u * zFaceU, v * sideV);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

function createSoftGlowPoolTexture(
  innerRgba: string,
  midRgba: string,
): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, innerRgba);
      grad.addColorStop(0.45, midRgba);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
  }

  const data = new Uint8Array([
    255, 210, 128, 180, 255, 210, 128, 120,
    255, 210, 128, 120, 255, 210, 128, 60,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

function createStripedAwningTexture(
  primaryCss: string,
  stripeCss: string,
  primaryRgb: readonly [number, number, number],
  stripeRgb: readonly [number, number, number],
): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const stripeCount = 8;
      const stripeW = canvas.width / stripeCount;
      for (let i = 0; i < stripeCount; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? primaryCss : stripeCss;
        ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
      }
      // Subtle woven fabric shade gradient along slope + hem stitch
      const shade = ctx.createLinearGradient(0, 0, 0, canvas.height);
      shade.addColorStop(0, 'rgba(0, 0, 0, 0.14)');
      shade.addColorStop(0.55, 'rgba(255, 255, 255, 0.04)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = 'rgba(255, 245, 230, 0.32)';
      ctx.fillRect(0, canvas.height - 5, canvas.width, 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return texture;
    }
  }

  const data = new Uint8Array([
    primaryRgb[0], primaryRgb[1], primaryRgb[2], 255,
    stripeRgb[0], stripeRgb[1], stripeRgb[2], 255,
    primaryRgb[0], primaryRgb[1], primaryRgb[2], 255,
    stripeRgb[0], stripeRgb[1], stripeRgb[2], 255,
  ]);
  const fallback = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.wrapS = THREE.RepeatWrapping;
  fallback.needsUpdate = true;
  return fallback;
}

function createMioSignTexture(): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const bg = ctx.createLinearGradient(0, 0, 256, 96);
      bg.addColorStop(0, '#0a4eb8');
      bg.addColorStop(1, '#0f72e5');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 256, 96);

      ctx.fillStyle = '#38d3ff';
      ctx.fillRect(0, 74, 256, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(14, 16, 76, 48);

      ctx.fillStyle = '#0a4eb8';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MIO', 52, 41);

      ctx.fillStyle = '#f8fbff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('ESTACIÓN CALI', 102, 34);

      ctx.fillStyle = '#bfe8ff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('T31 • E21 • P27', 102, 56);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
  }

  const data = new Uint8Array([
    14, 102, 224, 255, 240, 248, 255, 255,
    14, 102, 224, 255, 56, 211, 255, 255,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

function createRoseWindowTexture(): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const cx = 128;
      const cy = 128;
      ctx.fillStyle = '#1b2748';
      ctx.fillRect(0, 0, 256, 256);

      const radial = ctx.createRadialGradient(cx, cy, 8, cx, cy, 122);
      radial.addColorStop(0, '#fff2b0');
      radial.addColorStop(0.28, '#ff9c47');
      radial.addColorStop(0.58, '#c93c4e');
      radial.addColorStop(0.84, '#2458a6');
      radial.addColorStop(1, '#121c36');
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(cx, cy, 122, 0, Math.PI * 2);
      ctx.fill();

      // Neo-gothic stained-glass petals & dark lead cames
      const petalColors = ['#ffd166', '#ef476f', '#38a3ff', '#ff9f43'] as const;
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const px = cx + Math.cos(a) * 76;
        const py = cy + Math.sin(a) * 76;
        ctx.fillStyle = petalColors[i % petalColors.length] ?? '#ffd166';
        ctx.beginPath();
        ctx.arc(px, py, 20, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#1a1724';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 122, cy + Math.sin(a) * 122);
        ctx.stroke();
      }

      ctx.strokeStyle = '#1a1724';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 102, 0, Math.PI * 2);
      ctx.stroke();

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
  }

  const data = new Uint8Array([
    255, 210, 110, 255, 220, 72, 92, 255,
    46, 110, 198, 255, 255, 160, 78, 255,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

function createHelipadTexture(): THREE.Texture {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#2d323a';
      ctx.fillRect(0, 0, 256, 256);

      // Subtle concrete tile seam cross
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 12, 232, 232);

      // High-visibility aviation yellow safety circle
      ctx.strokeStyle = '#f4c424';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(128, 128, 92, 0, Math.PI * 2);
      ctx.stroke();

      // Bold painted white H
      ctx.fillStyle = '#f4f6fa';
      ctx.fillRect(88, 76, 18, 104);
      ctx.fillRect(150, 76, 18, 104);
      ctx.fillRect(88, 119, 80, 18);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    }
  }

  const data = new Uint8Array([
    46, 50, 58, 255, 244, 196, 36, 255,
    244, 246, 250, 255, 46, 50, 58, 255,
  ]);
  const fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  fallback.colorSpace = THREE.SRGBColorSpace;
  fallback.needsUpdate = true;
  return fallback;
}

function enableSolidLandmarkShadows(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const mat = Array.isArray(node.material) ? node.material[0] : node.material;
    const isAdditiveOrTransparent =
      mat !== undefined &&
      (mat.transparent || mat.blending === THREE.AdditiveBlending);
    if (!isAdditiveOrTransparent) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

function buildTerrainMesh(map: CaliMapConfig): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_EXTENT,
    TERRAIN_EXTENT,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.getAttribute('position');
  const colors = new Float32Array(posAttr.count * 3);
  const color = new THREE.Color();

  const urbanDark = new THREE.Color(0x5d5b54);
  const urbanAlt = new THREE.Color(0x6b675d);
  const parkGreen = new THREE.Color(0x4b7441);
  const hillsideGreen = new THREE.Color(0x4c743d);
  const crestGreen = new THREE.Color(0x7d8e50);
  const colonialEarth = new THREE.Color(0x7a6c57);
  const riverBed = new THREE.Color(0x233834);

  const { river } = map;

  for (let i = 0; i < posAttr.count; i += 1) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    let y = getTerrainElevation(x, z);

    const inRiver = isInsideRiver(x, z, river);
    if (inRiver) {
      const edgeDist = Math.min(x - river.minX, river.maxX - x);
      const channelFactor = Math.min(1, Math.max(0, edgeDist / 2.2));
      y -= 2.0 * channelFactor;
      color.copy(riverBed);
    } else if (y > 3.8 || x < -116) {
      const crestMix = THREE.MathUtils.clamp((y - 4) / 18, 0, 1);
      color.copy(hillsideGreen).lerp(crestGreen, crestMix);
    } else if (y > 0.5 && x >= -116 && z >= 6 && z <= 64) {
      const terraceMix = THREE.MathUtils.clamp(y / 3.5, 0, 1);
      color.copy(urbanAlt).lerp(colonialEarth, terraceMix);
    } else if (x >= 4 && x < river.minX && z >= -30 && z <= 70) {
      color.copy(parkGreen);
    } else {
      const tileMix = (Math.sin(x * 0.06) * Math.cos(z * 0.06) + 1) * 0.5;
      color.copy(urbanDark).lerp(urbanAlt, tileMix * 0.65);
    }

    posAttr.setY(i, y);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: false,
  });
  material.userData.surfaceRole = 'terrain' satisfies SurfaceRole;

  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'cali_terrain';
  terrain.receiveShadow = true;
  terrain.userData.surfaceRole = 'terrain' satisfies SurfaceRole;
  return terrain;
}

function buildRiverAndBridges(map: CaliMapConfig): {
  riverGroup: THREE.Group;
  bridgesGroup: THREE.Group;
  waterMesh: THREE.Mesh;
} {
  const { river } = map;
  const riverWidth = river.maxX - river.minX;
  const riverLength = river.maxZ - river.minZ;
  const riverCenterX = (river.minX + river.maxX) * 0.5;
  const riverCenterZ = (river.minZ + river.maxZ) * 0.5;

  const riverGroup = new THREE.Group();
  riverGroup.name = 'cali_river';

  const waterGeometry = new THREE.PlaneGeometry(riverWidth, riverLength, 16, 80);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = createWaterShaderMaterial();
  // Tune Río Cali shader to realistic golden-hour Andean river & warm-sky Fresnel reflections
  const deepUniform = waterMaterial.uniforms.uDeepColor;
  if (deepUniform?.value instanceof THREE.Color) {
    deepUniform.value.setHex(0x10282c);
  }
  const shallowUniform = waterMaterial.uniforms.uShallowColor;
  if (shallowUniform?.value instanceof THREE.Color) {
    shallowUniform.value.setHex(0x234f4a);
  }
  const horizonUniform = waterMaterial.uniforms.uSkyHorizonColor;
  if (horizonUniform?.value instanceof THREE.Color) {
    horizonUniform.value.setHex(0xf2bc84);
  }
  const zenithUniform = waterMaterial.uniforms.uSkyZenithColor;
  if (zenithUniform?.value instanceof THREE.Color) {
    zenithUniform.value.setHex(0x2c4a76);
  }
  const sunUniform = waterMaterial.uniforms.uSunDirection;
  if (sunUniform?.value instanceof THREE.Vector3) {
    sunUniform.value.set(-0.94, 0.16, -0.14).normalize();
  }

  const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
  waterMesh.name = 'rio_cali_water';
  waterMesh.position.set(riverCenterX, river.waterLevel, riverCenterZ);
  riverGroup.add(waterMesh);

  // River concrete embankments + sandstone promenade coping along Bulevar del Río
  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x827d75,
    roughness: 0.9,
    metalness: 0.04,
  });
  bankMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const westBank = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.2, riverLength),
    bankMat,
  );
  westBank.position.set(river.minX - 0.55, -0.8, riverCenterZ);
  westBank.castShadow = true;
  westBank.receiveShadow = true;
  westBank.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
  riverGroup.add(westBank);

  const eastBank = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.2, riverLength),
    bankMat,
  );
  eastBank.position.set(river.maxX + 0.55, -0.8, riverCenterZ);
  eastBank.castShadow = true;
  eastBank.receiveShadow = true;
  eastBank.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
  riverGroup.add(eastBank);

  const bulevarTrimMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xc9b492,
      emissive: 0xffb35c,
      emissiveIntensity: 0.18,
      roughness: 0.65,
    }),
    { dayIntensity: 0.18, nightIntensity: 0.95 },
  );
  const bulevarTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.24, 110),
    bulevarTrimMat,
  );
  bulevarTrim.position.set(river.minX - 0.6, 0.36, 16);
  riverGroup.add(bulevarTrim);

  // Twin raised bridges with weathered concrete piers and architectural steel railings
  const bridgesGroup = new THREE.Group();
  bridgesGroup.name = 'cali_bridges';

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x3b3a38,
    roughness: 0.88,
    metalness: 0.05,
  });
  deckMat.userData.surfaceRole = 'asphalt' satisfies SurfaceRole;

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x8e887f,
    roughness: 0.88,
    metalness: 0.05,
  });
  concreteMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const steelRailMat = new THREE.MeshStandardMaterial({
    color: 0x282d36,
    roughness: 0.34,
    metalness: 0.72,
  });
  const warmLanternMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffd796,
      emissive: 0xffb95e,
      emissiveIntensity: 0.9,
      roughness: 0.24,
    }),
    { dayIntensity: 0.9, nightIntensity: 2.4 },
  );

  for (const bridge of river.bridges) {
    const bridgeNode = new THREE.Group();
    bridgeNode.name = `bridge_${bridge.id}`;

    const spanX = bridge.maxX - bridge.minX;
    const spanZ = bridge.maxZ - bridge.minZ;
    const cx = (bridge.minX + bridge.maxX) * 0.5;
    const cz = (bridge.minZ + bridge.maxZ) * 0.5;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(spanX, 0.5, spanZ),
      deckMat,
    );
    deck.position.set(cx, bridge.deckElevation - 0.25, cz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.userData.surfaceRole = 'asphalt' satisfies SurfaceRole;
    bridgeNode.add(deck);

    // Support piers down into riverbed
    for (const pierX of [river.minX + 4, river.maxX - 4]) {
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.6, spanZ - 2),
        concreteMat,
      );
      pier.position.set(pierX, bridge.deckElevation - 1.5, cz);
      pier.castShadow = true;
      pier.receiveShadow = true;
      pier.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
      bridgeNode.add(pier);
    }

    // Raised concrete curbs & dark architectural steel railings on both bridge sides
    for (const sideSign of [-1, 1] as const) {
      const railZ = cz + sideSign * (spanZ * 0.5 - 0.45);
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(spanX, 0.75, 0.7),
        concreteMat,
      );
      curb.position.set(cx, bridge.deckElevation + 0.35, railZ);
      curb.castShadow = true;
      curb.receiveShadow = true;
      curb.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
      bridgeNode.add(curb);

      const bridgeRail = new THREE.Mesh(
        new THREE.BoxGeometry(spanX + 0.4, 0.16, 0.16),
        steelRailMat,
      );
      bridgeRail.position.set(cx, bridge.deckElevation + 0.92, railZ);
      bridgeNode.add(bridgeRail);

      // Corner concrete bridge pylons with subtle warm amber lanterns
      for (const endSign of [-1, 1] as const) {
        const pylonX = cx + endSign * (spanX * 0.5 - 0.8);
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(0.95, 3.4, 0.95),
          concreteMat,
        );
        pylon.position.set(pylonX, bridge.deckElevation + 1.6, railZ);
        pylon.castShadow = true;
        pylon.receiveShadow = true;
        pylon.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
        bridgeNode.add(pylon);

        const pylonCap = new THREE.Mesh(
          new THREE.BoxGeometry(1.06, 0.34, 1.06),
          warmLanternMat,
        );
        pylonCap.position.set(pylonX, bridge.deckElevation + 3.45, railZ);
        bridgeNode.add(pylonCap);
      }
    }

    bridgesGroup.add(bridgeNode);
  }

  return { riverGroup, bridgesGroup, waterMesh };
}

function createTerrainRibbonGeometry(
  start: Vec2,
  end: Vec2,
  width: number,
  yOffset: number,
  map: CaliMapConfig,
  uvTileLength = ROAD_TILE_LENGTH_METERS,
  minLengthSteps = 2,
): THREE.BufferGeometry {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const stepSizeMeters = width > 1.5 ? 2.0 : 3.0;
  const lengthSteps = Math.max(
    minLengthSteps,
    Math.ceil(length / stepSizeMeters),
  );
  const widthSteps = width > 1.5 ? Math.max(8, Math.ceil(width / 1.5)) : 1;
  const dirX = dx / (length || 1);
  const dirZ = dz / (length || 1);
  const perpX = -dirZ;
  const perpZ = dirX;

  const cols = widthSteps + 1;
  const vertexCount = (lengthSteps + 1) * cols;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  for (let i = 0; i <= lengthSteps; i += 1) {
    const t = i / lengthSteps;
    const cx = start.x + dx * t;
    const cz = start.z + dz * t;
    const vCoord = (t * length) / Math.max(1, uvTileLength);

    for (let j = 0; j <= widthSteps; j += 1) {
      const u = j / widthSteps;
      const lateral = (u - 0.5) * width;
      const px = cx + perpX * lateral;
      const pz = cz + perpZ * lateral;
      const py = getRoadSurfaceElevation(px, pz, map) + yOffset;

      const vertIdx = i * cols + j;
      const posBase = vertIdx * 3;
      positions[posBase] = px;
      positions[posBase + 1] = py;
      positions[posBase + 2] = pz;

      const uvBase = vertIdx * 2;
      uvs[uvBase] = u;
      uvs[uvBase + 1] = vCoord;

      if (i < lengthSteps && j < widthSteps) {
        const a = vertIdx;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRoadsGroup(map: CaliMapConfig): THREE.Group {
  const roadsGroup = new THREE.Group();
  roadsGroup.name = 'cali_roads';

  const asphaltTextures = createAsphaltTextures();
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltTextures.map,
    bumpMap: asphaltTextures.bumpMap,
    bumpScale: 0.055,
    roughnessMap: asphaltTextures.roughnessMap,
    roughness: 0.94,
    metalness: 0.06,
    envMapIntensity: 0.9,
  });
  asphaltMat.userData.surfaceRole = 'asphalt' satisfies SurfaceRole;

  const medianConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x8a857c,
    roughness: 0.88,
    metalness: 0.05,
  });
  medianConcreteMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const medianReflectorMat = new THREE.MeshStandardMaterial({
    color: 0xdca834,
    emissive: 0xc28a1d,
    emissiveIntensity: 0.28,
    roughness: 0.48,
  });
  const rampGuardMat = new THREE.MeshStandardMaterial({
    color: 0x868c94,
    roughness: 0.42,
    metalness: 0.65,
  });
  const whiteLaneMat = new THREE.MeshStandardMaterial({
    color: 0xe2dfd7,
    roughness: 0.78,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const yellowCenterMat = new THREE.MeshStandardMaterial({
    color: 0xdca52a,
    roughness: 0.74,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  for (const road of map.roads) {
    const segmentGroup = new THREE.Group();
    segmentGroup.name = `road_${road.id}`;

    const dx = road.end.x - road.start.x;
    const dz = road.end.z - road.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) {
      continue;
    }

    const dirX = dx / length;
    const dirZ = dz / length;
    const perpX = -dirZ;
    const perpZ = dirX;
    const isNorthSouth = Math.abs(dz) > Math.abs(dx);
    const layerOffset = isNorthSouth ? NS_ROAD_TIER_OFFSET : 0;

    // Slightly extend non-ramp ends to knit corners seamlessly without crossing into river
    const ext = road.isRamp ? 0 : Math.min(road.width * 0.42, 6);
    const extStart: Vec2 = {
      x: road.start.x - dirX * ext,
      z: road.start.z - dirZ * ext,
    };
    const extEnd: Vec2 = {
      x: road.end.x + dirX * ext,
      z: road.end.z + dirZ * ext,
    };
    const startPt =
      !isInsideRiver(extStart.x, extStart.z, map.river) ||
      isInsideBridge(extStart.x, extStart.z, map.river.bridges)
        ? extStart
        : road.start;
    const endPt =
      !isInsideRiver(extEnd.x, extEnd.z, map.river) ||
      isInsideBridge(extEnd.x, extEnd.z, map.river.bridges)
        ? extEnd
        : road.end;

    const surfaceMesh = new THREE.Mesh(
      createTerrainRibbonGeometry(
        startPt,
        endPt,
        road.width,
        layerOffset,
        map,
        ROAD_TILE_LENGTH_METERS,
        24,
      ),
      asphaltMat,
    );
    surfaceMesh.receiveShadow = true;
    surfaceMesh.userData.surfaceRole = 'asphalt' satisfies SurfaceRole;
    segmentGroup.add(surfaceMesh);

    // Subtle crisp road shoulder stripes & dashed Cali golden-yellow centerline
    const edgeInset = Math.max(1.2, road.width * 0.5 - 0.55);
    for (const side of [-1, 1] as const) {
      const lineStart: Vec2 = {
        x: road.start.x + perpX * edgeInset * side,
        z: road.start.z + perpZ * edgeInset * side,
      };
      const lineEnd: Vec2 = {
        x: road.end.x + perpX * edgeInset * side,
        z: road.end.z + perpZ * edgeInset * side,
      };
      const edgeLine = new THREE.Mesh(
        createTerrainRibbonGeometry(
          lineStart,
          lineEnd,
          0.18,
          layerOffset + 0.018,
          map,
          ROAD_TILE_LENGTH_METERS,
          24,
        ),
        whiteLaneMat,
      );
      edgeLine.receiveShadow = true;
      segmentGroup.add(edgeLine);
    }

    if (!road.hasMedian && length > 10) {
      const dashLen = 4.2;
      const dashStride = 9.0;
      for (let dist = 3.0; dist + dashLen < length - 2.0; dist += dashStride) {
        const dStart: Vec2 = {
          x: road.start.x + dirX * dist,
          z: road.start.z + dirZ * dist,
        };
        const dEnd: Vec2 = {
          x: road.start.x + dirX * (dist + dashLen),
          z: road.start.z + dirZ * (dist + dashLen),
        };
        const dashMesh = new THREE.Mesh(
          createTerrainRibbonGeometry(
            dStart,
            dEnd,
            0.22,
            layerOffset + 0.02,
            map,
            dashLen,
          ),
          yellowCenterMat,
        );
        dashMesh.receiveShadow = true;
        segmentGroup.add(dashMesh);
      }
    }

    // Concrete + warm amber reflector median strip for major Cali avenues
    if (road.hasMedian) {
      const medianBase = new THREE.Mesh(
        createTerrainRibbonGeometry(
          road.start,
          road.end,
          1.2,
          layerOffset + 0.055,
          map,
          ROAD_TILE_LENGTH_METERS,
          24,
        ),
        medianConcreteMat,
      );
      medianBase.receiveShadow = true;
      medianBase.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
      segmentGroup.add(medianBase);

      const medianStrip = new THREE.Mesh(
        createTerrainRibbonGeometry(
          road.start,
          road.end,
          0.26,
          layerOffset + 0.072,
          map,
          ROAD_TILE_LENGTH_METERS,
          24,
        ),
        medianReflectorMat,
      );
      segmentGroup.add(medianStrip);
    }

    // Galvanized steel safety guardrails along mountain ascent ramps
    if (road.isRamp) {
      const edgeOffset = road.width * 0.5 - 0.45;
      for (const side of [-1, 1] as const) {
        const railStart: Vec2 = {
          x: road.start.x + perpX * edgeOffset * side,
          z: road.start.z + perpZ * edgeOffset * side,
        };
        const railEnd: Vec2 = {
          x: road.end.x + perpX * edgeOffset * side,
          z: road.end.z + perpZ * edgeOffset * side,
        };
        const railMesh = new THREE.Mesh(
          createTerrainRibbonGeometry(
            railStart,
            railEnd,
            0.45,
            0.72,
            map,
            ROAD_TILE_LENGTH_METERS,
            24,
          ),
          rampGuardMat,
        );
        segmentGroup.add(railMesh);
      }
    }

    roadsGroup.add(segmentGroup);
  }

  return roadsGroup;
}

const MAJOR_CROSSWALKS: readonly CrosswalkSpec[] = [
  // Avenida Colombia x Calle 2 San Antonio (-4, 36)
  { x: -4, z: 26.5, spanWidth: 14.6, acrossAxis: 'ns_road' },
  { x: -4, z: 45.5, spanWidth: 14.6, acrossAxis: 'ns_road' },
  { x: -14.5, z: 36, spanWidth: 12.6, acrossAxis: 'ew_road' },
  // Avenida Colombia x Calle 13 (-4, -24)
  { x: -4, z: -34.5, spanWidth: 14.6, acrossAxis: 'ns_road' },
  { x: -4, z: -13.5, spanWidth: 14.6, acrossAxis: 'ns_road' },
  { x: -14.5, z: -24, spanWidth: 14.6, acrossAxis: 'ew_road' },
  { x: 6.5, z: -24, spanWidth: 14.6, acrossAxis: 'ew_road' },
  // Avenida Colombia x Calle 5 (-4, 77)
  { x: -4, z: 66.5, spanWidth: 14.6, acrossAxis: 'ns_road' },
  { x: -4, z: 87.5, spanWidth: 14.6, acrossAxis: 'ns_road' },
  { x: -14.5, z: 77, spanWidth: 14.6, acrossAxis: 'ew_road' },
  { x: 6.5, z: 77, spanWidth: 14.6, acrossAxis: 'ew_road' },
  // Carrera 1 x Calle 10 (58, 20)
  { x: 58, z: 10.5, spanWidth: 12.6, acrossAxis: 'ns_road' },
  { x: 58, z: 29.5, spanWidth: 12.6, acrossAxis: 'ns_road' },
  { x: 67.5, z: 20, spanWidth: 12.6, acrossAxis: 'ew_road' },
  // Carrera 1 x Calle 5 (58, 77)
  { x: 58, z: 66.5, spanWidth: 12.6, acrossAxis: 'ns_road' },
  { x: 58, z: 87.5, spanWidth: 12.6, acrossAxis: 'ns_road' },
  { x: 67.5, z: 77, spanWidth: 14.6, acrossAxis: 'ew_road' },
  // Carrera 1 x Calle 13 / Puente La Ermita (58, -24)
  { x: 58, z: -34.5, spanWidth: 12.6, acrossAxis: 'ns_road' },
  { x: 58, z: -13.5, spanWidth: 12.6, acrossAxis: 'ns_road' },
];

function buildCrosswalksGroup(map: CaliMapConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_crosswalks';

  const crosswalkTexture = createCrosswalkTexture();
  const crosswalkMat = new THREE.MeshStandardMaterial({
    map: crosswalkTexture,
    transparent: true,
    opacity: 0.92,
    roughness: 0.62,
    metalness: 0.06,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const crosswalkDepth = 4.2;
  const geomCache = new Map<number, THREE.PlaneGeometry>();

  MAJOR_CROSSWALKS.forEach((spec, index) => {
    let planeGeo = geomCache.get(spec.spanWidth);
    if (!planeGeo) {
      planeGeo = new THREE.PlaneGeometry(spec.spanWidth, crosswalkDepth);
      planeGeo.rotateX(-Math.PI / 2);
      geomCache.set(spec.spanWidth, planeGeo);
    }

    const mesh = new THREE.Mesh(planeGeo, crosswalkMat);
    mesh.name = `crosswalk_${index}`;
    const y = getRoadSurfaceElevation(spec.x, spec.z, map) + 0.055;
    mesh.position.set(spec.x, y, spec.z);
    mesh.rotation.y = spec.acrossAxis === 'ew_road' ? Math.PI / 2 : 0;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  });

  return group;
}

const URBAN_SIDEWALK_BLOCKS: readonly SidewalkBlockSpec[] = [
  // Flat city blocks neatly framing building colliders clear of every road & river edge
  { id: 'block_centro_nw', minX: -59, maxX: -13, minZ: -103, maxZ: -33 },
  { id: 'block_bulevar_adj', minX: -59, maxX: -13, minZ: -15, maxZ: 28 },
  { id: 'block_san_antonio_fringe', minX: -59, maxX: -13, minZ: 44, maxZ: 68 },
  { id: 'block_penon_sw', minX: -59, maxX: -13, minZ: 86, maxZ: 157 },
  { id: 'block_americas_n', minX: -64, maxX: -20, minZ: -160, maxZ: -122 },
  { id: 'block_granada_ne', minX: 104, maxX: 166, minZ: -60, maxZ: 12 },
  { id: 'block_oriente_w', minX: 66, maxX: 88, minZ: 28, maxZ: 68 },
  { id: 'block_oriente_e', minX: 104, maxX: 166, minZ: 28, maxZ: 68 },
  { id: 'block_versalles_w', minX: 66, maxX: 88, minZ: -116, maxZ: -76 },
  { id: 'block_san_fernando', minX: 66, maxX: 88, minZ: 86, maxZ: 157 },
  { id: 'block_versalles_e', minX: 104, maxX: 166, minZ: -116, maxZ: -76 },
  // Bulevar del Río continuous riverside promenade decks
  { id: 'promenade_bulevar_mid', minX: 4.5, maxX: 22.8, minZ: -15, maxZ: 65 },
  { id: 'promenade_bulevar_north', minX: 4.5, maxX: 22.8, minZ: -103, maxZ: -35 },
  { id: 'promenade_bulevar_south', minX: 4.5, maxX: 22.8, minZ: 89, maxZ: 157 },
];

function buildSidewalksGroup(
  map: CaliMapConfig,
  sidewalkTex: SidewalkTextureSet,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_sidewalks';

  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: 0xd9d4cb,
    map: sidewalkTex.map,
    bumpMap: sidewalkTex.bumpMap,
    bumpScale: 0.045,
    roughness: 0.9,
    metalness: 0.04,
    envMapIntensity: 0.65,
  });
  sidewalkMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const slabHeight = 0.28;
  for (const block of URBAN_SIDEWALK_BLOCKS) {
    const width = block.maxX - block.minX;
    const depth = block.maxZ - block.minZ;
    const cx = (block.minX + block.maxX) * 0.5;
    const cz = (block.minZ + block.maxZ) * 0.5;

    const geom = createUvScaledBoxGeometry(
      width,
      slabHeight,
      depth,
      SIDEWALK_TILE_METERS,
      2,
      { topBottomTile: SIDEWALK_TILE_METERS },
    );
    const slab = new THREE.Mesh(geom, sidewalkMat);
    slab.name = `sidewalk_${block.id}`;
    slab.position.set(cx, slabHeight * 0.5, cz);
    slab.receiveShadow = true;
    slab.castShadow = false;
    slab.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
    group.add(slab);
  }

  // Stepped colonial hillside sidewalk pads beneath San Antonio & Oeste hillside buildings
  for (const bldg of map.buildingColliders) {
    const isHillsidePad =
      bldg.id === 'bldg_san_antonio_3' ||
      bldg.id === 'bldg_san_antonio_4' ||
      bldg.id === 'bldg_san_antonio_5' ||
      bldg.id === 'bldg_oeste_1' ||
      bldg.id === 'bldg_oeste_2';
    if (!isHillsidePad) {
      continue;
    }

    const width = bldg.maxX - bldg.minX + 3.4;
    const depth = bldg.maxZ - bldg.minZ + 3.4;
    const cx = (bldg.minX + bldg.maxX) * 0.5;
    const cz = (bldg.minZ + bldg.maxZ) * 0.5;
    const groundY = getTerrainElevation(cx, cz);

    const padHeight = 0.7;
    const pad = new THREE.Mesh(
      createUvScaledBoxGeometry(width, padHeight, depth, SIDEWALK_TILE_METERS, 2, {
        topBottomTile: SIDEWALK_TILE_METERS,
      }),
      sidewalkMat,
    );
    pad.name = `sidewalk_pad_${bldg.id}`;
    pad.position.set(cx, groundY - padHeight * 0.5 + 0.22, cz);
    pad.receiveShadow = true;
    pad.castShadow = false;
    pad.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
    group.add(pad);
  }

  return group;
}

const TRAFFIC_INTERSECTIONS: readonly TrafficIntersectionSpec[] = [
  { id: 'av_colombia_san_antonio', x: -4, z: 36, halfWidthX: 8, halfWidthZ: 7 },
  { id: 'av_colombia_calle_13', x: -4, z: -24, halfWidthX: 8, halfWidthZ: 8 },
  { id: 'av_colombia_calle_5', x: -4, z: 77, halfWidthX: 8, halfWidthZ: 8 },
  { id: 'carrera_1_calle_10', x: 58, z: 20, halfWidthX: 7, halfWidthZ: 7 },
  { id: 'carrera_1_calle_5', x: 58, z: 77, halfWidthX: 7, halfWidthZ: 8 },
];

function createTrafficHeadMesh(
  housingMat: THREE.Material,
  redMat: THREE.Material,
  amberMat: THREE.Material,
  greenMat: THREE.Material,
): THREE.Group {
  const head = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.24, 0.34), housingMat);
  housing.castShadow = true;
  head.add(housing);

  const lensGeo = new THREE.CircleGeometry(0.13, 12);
  const lensSpecs: readonly [number, THREE.Material][] = [
    [0.36, redMat],
    [0, amberMat],
    [-0.36, greenMat],
  ];

  for (const [ly, mat] of lensSpecs) {
    for (const faceSign of [-1, 1] as const) {
      const lens = new THREE.Mesh(lensGeo, mat);
      lens.position.set(0, ly, faceSign * 0.175);
      if (faceSign < 0) {
        lens.rotation.y = Math.PI;
      }
      head.add(lens);
    }
  }
  return head;
}

function buildTrafficSignalsGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_traffic_signals';

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c2b,
    roughness: 0.42,
    metalness: 0.78,
  });
  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x11121c,
    roughness: 0.55,
    metalness: 0.45,
  });
  const redLitMat = new THREE.MeshStandardMaterial({
    color: 0xff2b3d,
    emissive: 0xff1e33,
    emissiveIntensity: 2.6,
    roughness: 0.16,
  });
  const redDimMat = new THREE.MeshStandardMaterial({
    color: 0x3b1218,
    emissive: 0x3b1218,
    emissiveIntensity: 0.15,
    roughness: 0.4,
  });
  const amberLitMat = new THREE.MeshStandardMaterial({
    color: 0xffbe2e,
    emissive: 0xffae00,
    emissiveIntensity: 1.9,
    roughness: 0.18,
  });
  const amberDimMat = new THREE.MeshStandardMaterial({
    color: 0x3d2e10,
    emissive: 0x3d2e10,
    emissiveIntensity: 0.15,
    roughness: 0.4,
  });
  const greenLitMat = new THREE.MeshStandardMaterial({
    color: 0x22ff99,
    emissive: 0x00ff88,
    emissiveIntensity: 2.6,
    roughness: 0.16,
  });
  const greenDimMat = new THREE.MeshStandardMaterial({
    color: 0x0f3825,
    emissive: 0x0f3825,
    emissiveIntensity: 0.15,
    roughness: 0.4,
  });

  const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 6.2, 8);
  const armGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8);
  armGeo.rotateZ(Math.PI / 2);

  TRAFFIC_INTERSECTIONS.forEach((inter, idx) => {
    const corners: readonly { sx: number; sz: number; yaw: number; greenActive: boolean }[] = [
      { sx: -1, sz: -1, yaw: 0, greenActive: idx % 2 === 0 },
      { sx: 1, sz: 1, yaw: Math.PI, greenActive: idx % 2 !== 0 },
    ];

    corners.forEach((corner, cIdx) => {
      const px = inter.x + corner.sx * (inter.halfWidthX + 1.25);
      const pz = inter.z + corner.sz * (inter.halfWidthZ + 1.25);
      const groundY = getTerrainElevation(px, pz);

      const gantry = new THREE.Group();
      gantry.name = `traffic_signal_${inter.id}_${cIdx}`;
      gantry.position.set(px, groundY, pz);
      gantry.rotation.y = corner.yaw;

      const pole = new THREE.Mesh(poleGeo, steelMat);
      pole.position.y = 3.1;
      pole.castShadow = true;
      pole.receiveShadow = true;
      gantry.add(pole);

      const arm = new THREE.Mesh(armGeo, steelMat);
      arm.position.set(2.65, 5.95, 0);
      arm.castShadow = true;
      gantry.add(arm);

      const redMat = corner.greenActive ? redDimMat : redLitMat;
      const amberMat = idx === 2 && cIdx === 1 ? amberLitMat : amberDimMat;
      const greenMat = corner.greenActive ? greenLitMat : greenDimMat;

      const primaryHead = createTrafficHeadMesh(housingMat, redMat, amberMat, greenMat);
      primaryHead.position.set(4.55, 5.45, 0);
      gantry.add(primaryHead);

      const midHead = createTrafficHeadMesh(housingMat, redMat, amberMat, greenMat);
      midHead.position.set(2.25, 5.45, 0);
      gantry.add(midHead);

      group.add(gantry);
    });
  });

  return group;
}

const STREETLIGHT_SPECS: readonly StreetlightSpec[] = [
  // Bulevar del Río promenade (west & east curbs)
  { x: 5.0, z: -8, armYaw: Math.PI },
  { x: 5.0, z: 10, armYaw: Math.PI },
  { x: 5.0, z: 28, armYaw: Math.PI },
  { x: 5.0, z: 48, armYaw: Math.PI },
  { x: 22.0, z: -4, armYaw: Math.PI },
  { x: 22.0, z: 16, armYaw: Math.PI },
  { x: 22.0, z: 38, armYaw: Math.PI },
  { x: 22.0, z: 56, armYaw: Math.PI },
  // Avenida Colombia west sidewalk
  { x: -13.2, z: -92, armYaw: 0 },
  { x: -13.2, z: -64, armYaw: 0 },
  { x: -13.2, z: -44, armYaw: 0 },
  { x: -13.2, z: -4, armYaw: 0 },
  { x: -13.2, z: 16, armYaw: 0 },
  { x: -13.2, z: 54, armYaw: 0 },
  { x: -13.2, z: 98, armYaw: 0 },
  { x: -13.2, z: 124, armYaw: 0 },
  { x: -13.2, z: 148, armYaw: 0 },
  // Calle 5 west & east curbs
  { x: -50, z: 67.6, armYaw: -Math.PI / 2 },
  { x: -26, z: 86.4, armYaw: Math.PI / 2 },
  { x: 76, z: 67.6, armYaw: -Math.PI / 2 },
  { x: 114, z: 86.4, armYaw: Math.PI / 2 },
  { x: 146, z: 67.6, armYaw: -Math.PI / 2 },
  // Barrio San Antonio hillside streetlamps along Calle 2 San Antonio
  { x: -78, z: 27.6, armYaw: -Math.PI / 2 },
  { x: -54, z: 44.4, armYaw: Math.PI / 2 },
  { x: -30, z: 27.6, armYaw: -Math.PI / 2 },
  // Carrera 1 / La Ermita corridor
  { x: 65.8, z: -56, armYaw: Math.PI },
  { x: 65.8, z: -4, armYaw: Math.PI },
  { x: 65.8, z: 44, armYaw: Math.PI },
  { x: 65.8, z: 112, armYaw: Math.PI },
];

function buildStreetlightsGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_streetlights';

  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e36,
    roughness: 0.45,
    metalness: 0.76,
  });
  const bulbMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffe4a8,
      emissive: 0xffc663,
      emissiveIntensity: 1.45,
      roughness: 0.18,
    }),
    { dayIntensity: 1.45, nightIntensity: 2.8 },
  );
  const poolTex = createSoftGlowPoolTexture(
    'rgba(255, 210, 128, 0.55)',
    'rgba(255, 168, 92, 0.18)',
  );
  const poolMat = tagNightOpacity(
    new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    0.18,
    0.56,
  );

  const poleGeo = new THREE.CylinderGeometry(0.09, 0.15, 6.6, 8);
  const armGeo = new THREE.BoxGeometry(1.7, 0.11, 0.11);
  const headGeo = new THREE.BoxGeometry(0.62, 0.14, 0.32);
  const lensGeo = new THREE.PlaneGeometry(0.54, 0.24);
  lensGeo.rotateX(Math.PI / 2);
  const poolGeo = new THREE.PlaneGeometry(9.2, 9.2);
  poolGeo.rotateX(-Math.PI / 2);

  STREETLIGHT_SPECS.forEach((spec, index) => {
    const lamp = new THREE.Group();
    lamp.name = `streetlight_${index}`;
    const groundY = getTerrainElevation(spec.x, spec.z);
    lamp.position.set(spec.x, groundY, spec.z);
    lamp.rotation.y = spec.armYaw;

    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3.3;
    pole.castShadow = true;
    pole.receiveShadow = true;
    lamp.add(pole);

    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0.82, 6.52, 0);
    arm.castShadow = true;
    lamp.add(arm);

    const head = new THREE.Mesh(headGeo, poleMat);
    head.position.set(1.56, 6.46, 0);
    lamp.add(head);

    const lens = new THREE.Mesh(lensGeo, bulbMat);
    lens.position.set(1.56, 6.38, 0);
    lamp.add(lens);

    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(1.56, 0.15, 0);
    pool.castShadow = false;
    pool.receiveShadow = false;
    lamp.add(pool);

    group.add(lamp);
  });

  return group;
}

function classifyBuildingStyle(bldg: AabbCollider): BuildingFacadeStyle {
  if (
    bldg.id.startsWith('bldg_san_antonio') ||
    bldg.id.startsWith('bldg_oeste') ||
    bldg.height <= 11
  ) {
    return 'colonial_stucco';
  }
  if (
    bldg.height >= 22 ||
    bldg.id.startsWith('bldg_americas') ||
    bldg.id.startsWith('bldg_granada')
  ) {
    return 'modern_glass';
  }
  return 'downtown_midrise';
}

type FacadeSide = 'east' | 'west' | 'north' | 'south';

interface BuildingSharedGeometries {
  readonly pilasterUnitGeo: THREE.BoxGeometry;
  readonly windowPaneGeo: THREE.BoxGeometry;
  readonly windowJambGeo: THREE.BoxGeometry;
  readonly windowSillGeo: THREE.BoxGeometry;
  readonly windowLintelGeo: THREE.BoxGeometry;
  readonly balconySlabGeo: THREE.BoxGeometry;
  readonly balconyFrontRailGeo: THREE.BoxGeometry;
  readonly balconySideRailGeo: THREE.BoxGeometry;
  readonly balconyPostGeo: THREE.BoxGeometry;
  readonly awningCanopyGeo: THREE.BoxGeometry;
  readonly awningValanceGeo: THREE.BoxGeometry;
  readonly awningBracketGeo: THREE.BoxGeometry;
  readonly storefrontBayGeo: THREE.BoxGeometry;
  readonly rafterTailGeo: THREE.BoxGeometry;
  readonly modernMullionGeo: THREE.BoxGeometry;
}

interface BuildingSharedMaterials {
  readonly roofMat: THREE.MeshStandardMaterial;
  readonly parapetMat: THREE.MeshStandardMaterial;
  readonly corniceMat: THREE.MeshStandardMaterial;
  readonly sillMat: THREE.MeshStandardMaterial;
  readonly hvacMat: THREE.MeshStandardMaterial;
  readonly storefrontGlassMat: THREE.MeshPhysicalMaterial;
  readonly storefrontWarmBayMat: THREE.MeshStandardMaterial;
  readonly reflectiveGlassMat: THREE.MeshPhysicalMaterial;
  readonly recessedWindowGlassMat: THREE.MeshStandardMaterial;
  readonly warmInteriorGlassMat: THREE.MeshStandardMaterial;
  readonly windowRevealMat: THREE.MeshStandardMaterial;
  readonly wroughtIronMat: THREE.MeshStandardMaterial;
  readonly colonialRoofMat: THREE.MeshStandardMaterial;
  readonly awningMats: readonly THREE.MeshStandardMaterial[];
  readonly antennaMat: THREE.MeshStandardMaterial;
  readonly beaconRedMat: THREE.MeshStandardMaterial;
  readonly woodTrimMat: THREE.MeshStandardMaterial;
  readonly geom: BuildingSharedGeometries;
}

function createBuildingSharedMaterials(): BuildingSharedMaterials {
  const colonialRoofMat = new THREE.MeshStandardMaterial({
    color: 0xc25d3c,
    roughness: 0.82,
    metalness: 0.04,
    flatShading: false,
  });
  colonialRoofMat.userData.surfaceRole = 'roof' satisfies SurfaceRole;

  const awningPalettes: readonly {
    readonly primaryCss: string;
    readonly stripeCss: string;
    readonly primaryRgb: readonly [number, number, number];
    readonly stripeRgb: readonly [number, number, number];
  }[] = [
    {
      primaryCss: '#c24d36',
      stripeCss: '#f3e7d4',
      primaryRgb: [194, 77, 54],
      stripeRgb: [243, 231, 212],
    },
    {
      primaryCss: '#18857f',
      stripeCss: '#f2ead9',
      primaryRgb: [24, 133, 127],
      stripeRgb: [242, 234, 217],
    },
    {
      primaryCss: '#d49a28',
      stripeCss: '#f5ecd8',
      primaryRgb: [212, 154, 40],
      stripeRgb: [245, 236, 216],
    },
  ];

  const awningMats = awningPalettes.map((palette) => {
    const tex = createStripedAwningTexture(
      palette.primaryCss,
      palette.stripeCss,
      palette.primaryRgb,
      palette.stripeRgb,
    );
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.84,
      metalness: 0.04,
    });
  });

  const geom: BuildingSharedGeometries = {
    pilasterUnitGeo: new THREE.BoxGeometry(0.56, 1.0, 0.56),
    windowPaneGeo: new THREE.BoxGeometry(1.26, 1.62, 0.06),
    windowJambGeo: new THREE.BoxGeometry(0.14, 1.76, 0.18),
    windowSillGeo: new THREE.BoxGeometry(1.74, 0.14, 0.28),
    windowLintelGeo: new THREE.BoxGeometry(1.7, 0.16, 0.24),
    balconySlabGeo: new THREE.BoxGeometry(2.54, 0.16, 0.86),
    balconyFrontRailGeo: new THREE.BoxGeometry(2.5, 0.055, 0.055),
    balconySideRailGeo: new THREE.BoxGeometry(0.055, 0.055, 0.84),
    balconyPostGeo: new THREE.BoxGeometry(0.048, 0.9, 0.048),
    awningCanopyGeo: new THREE.BoxGeometry(3.15, 0.08, 1.28),
    awningValanceGeo: new THREE.BoxGeometry(3.15, 0.24, 0.06),
    awningBracketGeo: new THREE.BoxGeometry(0.06, 0.06, 1.12),
    storefrontBayGeo: new THREE.BoxGeometry(2.74, 2.32, 0.08),
    rafterTailGeo: new THREE.BoxGeometry(0.16, 0.18, 0.78),
    modernMullionGeo: new THREE.BoxGeometry(0.14, 2.48, 0.22),
  };

  return {
    roofMat: new THREE.MeshStandardMaterial({
      color: 0x4e4b47,
      roughness: 0.92,
      metalness: 0.04,
    }),
    parapetMat: new THREE.MeshStandardMaterial({
      color: 0x807b73,
      roughness: 0.84,
      metalness: 0.08,
    }),
    corniceMat: new THREE.MeshStandardMaterial({
      color: 0xa69f94,
      roughness: 0.68,
      metalness: 0.22,
    }),
    sillMat: new THREE.MeshStandardMaterial({
      color: 0xc4baa9,
      roughness: 0.76,
      metalness: 0.08,
    }),
    hvacMat: new THREE.MeshStandardMaterial({
      color: 0x767470,
      roughness: 0.56,
      metalness: 0.52,
    }),
    storefrontGlassMat: tagNightEmissive(
      new THREE.MeshPhysicalMaterial({
        color: 0x15202e,
        roughness: 0.08,
        metalness: 0.38,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.55,
      }),
      {
        dayIntensity: 0,
        nightIntensity: 0.55,
        dayEmissiveHex: 0x000000,
        nightEmissiveHex: 0xffe0a8,
      },
    ) as THREE.MeshPhysicalMaterial,
    storefrontWarmBayMat: tagNightEmissive(
      new THREE.MeshStandardMaterial({
        color: 0xffdfab,
        emissive: 0xffb85c,
        emissiveIntensity: 0.36,
        roughness: 0.12,
        metalness: 0.45,
        envMapIntensity: 1.35,
      }),
      { dayIntensity: 0.36, nightIntensity: 1.72 },
    ),
    reflectiveGlassMat: tagNightEmissive(
      new THREE.MeshPhysicalMaterial({
        color: 0x162433,
        roughness: 0.07,
        metalness: 0.48,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.65,
      }),
      {
        dayIntensity: 0,
        nightIntensity: 0.28,
        dayEmissiveHex: 0x000000,
        nightEmissiveHex: 0x162442,
      },
    ) as THREE.MeshPhysicalMaterial,
    recessedWindowGlassMat: tagNightEmissive(
      new THREE.MeshStandardMaterial({
        color: 0x101c2a,
        roughness: 0.12,
        metalness: 0.45,
        envMapIntensity: 1.55,
      }),
      {
        dayIntensity: 0.04,
        nightIntensity: 0.36,
        dayEmissiveHex: 0x0a1424,
        nightEmissiveHex: 0x1f3557,
      },
    ),
    warmInteriorGlassMat: tagNightEmissive(
      new THREE.MeshStandardMaterial({
        color: 0xffd596,
        emissive: 0xffb866,
        emissiveIntensity: 0.58,
        roughness: 0.12,
        metalness: 0.45,
        envMapIntensity: 1.25,
      }),
      { dayIntensity: 0.58, nightIntensity: 1.85 },
    ),
    windowRevealMat: new THREE.MeshStandardMaterial({
      color: 0x242830,
      roughness: 0.72,
      metalness: 0.24,
    }),
    wroughtIronMat: new THREE.MeshStandardMaterial({
      color: 0x1b1e25,
      roughness: 0.36,
      metalness: 0.82,
    }),
    colonialRoofMat,
    awningMats,
    antennaMat: new THREE.MeshStandardMaterial({
      color: 0x8d939c,
      roughness: 0.4,
      metalness: 0.82,
    }),
    beaconRedMat: tagNightEmissive(
      new THREE.MeshStandardMaterial({
        color: 0xff2b4a,
        emissive: 0xff1e3c,
        emissiveIntensity: 1.65,
        roughness: 0.16,
      }),
      { dayIntensity: 1.65, nightIntensity: 2.6 },
    ),
    woodTrimMat: new THREE.MeshStandardMaterial({
      color: 0x573723,
      roughness: 0.84,
    }),
    geom,
  };
}

function attachBuildingRooftopDetails(
  group: THREE.Group,
  bldg: AabbCollider,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  roofY: number,
  shared: BuildingSharedMaterials,
): void {
  const wallT = 0.45;
  const parapetH = 0.85;

  // Perimeter architectural concrete roof parapet rim
  const northSouthGeo = new THREE.BoxGeometry(width + 0.25, parapetH, wallT);
  const eastWestGeo = new THREE.BoxGeometry(wallT, parapetH, depth + 0.25);

  for (const side of [-1, 1] as const) {
    const nsWall = new THREE.Mesh(northSouthGeo, shared.parapetMat);
    nsWall.position.set(cx, roofY + parapetH * 0.5, cz + side * (depth * 0.5 - wallT * 0.35));
    nsWall.castShadow = true;
    nsWall.receiveShadow = true;
    group.add(nsWall);

    const ewWall = new THREE.Mesh(eastWestGeo, shared.parapetMat);
    ewWall.position.set(cx + side * (width * 0.5 - wallT * 0.35), roofY + parapetH * 0.5, cz);
    ewWall.castShadow = true;
    ewWall.receiveShadow = true;
    group.add(ewWall);
  }

  // Stepped architectural stone/metal roof parapet cornice coping
  const corniceGroup = new THREE.Group();
  corniceGroup.name = `building_parapet_cornice_${bldg.id}`;

  const corniceLower = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.34, 0.18, depth + 0.34),
    shared.sillMat,
  );
  corniceLower.position.set(cx, roofY + 0.04, cz);
  corniceLower.castShadow = true;
  corniceLower.receiveShadow = true;
  corniceGroup.add(corniceLower);

  const corniceBand = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.52, 0.28, depth + 0.52),
    shared.corniceMat,
  );
  corniceBand.position.set(cx, roofY + parapetH + 0.12, cz);
  corniceBand.castShadow = true;
  corniceBand.receiveShadow = true;
  corniceGroup.add(corniceBand);
  group.add(corniceGroup);

  // Rooftop mechanical HVAC boxes
  const hvacA = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(3.2, width * 0.22), 1.35, Math.min(2.6, depth * 0.18)),
    shared.hvacMat,
  );
  hvacA.position.set(cx - width * 0.22, roofY + 0.68, cz + depth * 0.18);
  hvacA.castShadow = true;
  hvacA.receiveShadow = true;
  group.add(hvacA);

  const hvacB = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(2.2, width * 0.16), 0.95, Math.min(2.0, depth * 0.15)),
    shared.hvacMat,
  );
  hvacB.position.set(cx + width * 0.24, roofY + 0.48, cz - depth * 0.2);
  hvacB.castShadow = true;
  hvacB.receiveShadow = true;
  group.add(hvacB);

  // Elevator penthouse bulkhead on mid/high-rise buildings
  if (bldg.height >= 16) {
    const penthouse = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.4, 2.3, depth * 0.38),
      shared.parapetMat,
    );
    penthouse.position.set(cx + width * 0.04, roofY + 1.15, cz + depth * 0.04);
    penthouse.castShadow = true;
    penthouse.receiveShadow = true;
    group.add(penthouse);
  }

  // Rooftop communications mast + aviation beacon on tall towers
  if (bldg.height >= 20) {
    const mastHeight = bldg.height >= 25 ? 7.2 : 4.8;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.18, mastHeight, 6),
      shared.antennaMat,
    );
    mast.position.set(cx - width * 0.18, roofY + mastHeight * 0.5 + 0.5, cz - depth * 0.16);
    mast.castShadow = true;
    group.add(mast);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      shared.beaconRedMat,
    );
    beacon.position.set(cx - width * 0.18, roofY + mastHeight + 0.62, cz - depth * 0.16);
    group.add(beacon);
  }
}

const COLONIAL_WARM_TINTS = [0xf4ead8, 0xf0dfca, 0xead4b9, 0xf6efe2] as const;
const DOWNTOWN_STONE_TINTS = [0xdcd5c9, 0xd1c7b8, 0xc9c2b8, 0xd8cec2] as const;

function hashBuildingIndex(id: string): number {
  let acc = 0;
  for (let i = 0; i < id.length; i += 1) {
    acc = (acc * 31 + id.charCodeAt(i)) >>> 0;
  }
  return acc;
}

function hasFacadeSignConflict(
  buildingId: string,
  side: FacadeSide,
  yOffsetAboveGround: number,
): boolean {
  if (
    buildingId === 'bldg_bulevar_2' &&
    side === 'east' &&
    Math.abs(yOffsetAboveGround - 16.12) < 3.0
  ) {
    return true;
  }
  if (
    buildingId === 'bldg_bulevar_4' &&
    side === 'east' &&
    Math.abs(yOffsetAboveGround - 12.4) < 3.0
  ) {
    return true;
  }
  return false;
}

interface FacadePose {
  readonly x: number;
  readonly z: number;
  readonly rotY: number;
  readonly span: number;
}

function getFacadePose(
  side: FacadeSide,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  alongOffset: number,
): FacadePose {
  switch (side) {
    case 'east':
      return { x: cx + width * 0.5, z: cz + alongOffset, rotY: Math.PI / 2, span: depth };
    case 'west':
      return { x: cx - width * 0.5, z: cz + alongOffset, rotY: -Math.PI / 2, span: depth };
    case 'south':
      return { x: cx + alongOffset, z: cz + depth * 0.5, rotY: 0, span: width };
    case 'north':
      return { x: cx + alongOffset, z: cz - depth * 0.5, rotY: Math.PI, span: width };
  }
}

function getStreetFacingSides(bldg: AabbCollider): readonly FacadeSide[] {
  const cx = (bldg.minX + bldg.maxX) * 0.5;
  const cz = (bldg.minZ + bldg.maxZ) * 0.5;
  const sides: FacadeSide[] = [];

  // Primary X street orientation (Av. Colombia x=-4, Circunvalar x=-68, Carrera 1 x=58, Carrera 36 x=96, Carrera 39 x=174)
  if (cx < -35) {
    sides.push('west');
  } else if (cx < 0) {
    sides.push('east');
  } else if (cx < 90) {
    sides.push('west');
  } else if (cx < 135) {
    sides.push('west');
  } else {
    sides.push('east');
  }

  // Secondary Z street orientation (Las Américas z=-112, Calle 13 z=-24, San Antonio z=36, Calle 5 z=77, Roosevelt z=166)
  if (cz < -70 || (cz > -20 && cz < 24) || (cz > 85 && cz < 120)) {
    sides.push('north');
  } else {
    sides.push('south');
  }

  return sides;
}

function createRecessedWindowBay(
  bayName: string,
  isLit: boolean,
  jambMat: THREE.MeshStandardMaterial,
  shared: BuildingSharedMaterials,
): THREE.Group {
  const bay = new THREE.Group();
  bay.name = bayName;

  const pane = new THREE.Mesh(
    shared.geom.windowPaneGeo,
    isLit ? shared.warmInteriorGlassMat : shared.recessedWindowGlassMat,
  );
  pane.name = `${bayName}_window_pane`;
  pane.position.set(0, 0, 0.04);
  bay.add(pane);

  for (const sx of [-0.71, 0.71] as const) {
    const jamb = new THREE.Mesh(shared.geom.windowJambGeo, jambMat);
    jamb.position.set(sx, 0, 0.09);
    bay.add(jamb);
  }

  const sill = new THREE.Mesh(shared.geom.windowSillGeo, shared.sillMat);
  sill.position.set(0, -0.9, 0.14);
  sill.castShadow = true;
  sill.receiveShadow = true;
  bay.add(sill);

  const lintel = new THREE.Mesh(shared.geom.windowLintelGeo, shared.corniceMat);
  lintel.position.set(0, 0.9, 0.12);
  lintel.castShadow = true;
  bay.add(lintel);

  return bay;
}

function createProjectingBalcony(
  balconyName: string,
  slabMat: THREE.MeshStandardMaterial,
  shared: BuildingSharedMaterials,
): THREE.Group {
  const balcony = new THREE.Group();
  balcony.name = balconyName;

  const slab = new THREE.Mesh(shared.geom.balconySlabGeo, slabMat);
  slab.position.set(0, 0, 0.44);
  slab.castShadow = true;
  slab.receiveShadow = true;
  balcony.add(slab);

  const topRail = new THREE.Mesh(shared.geom.balconyFrontRailGeo, shared.wroughtIronMat);
  topRail.position.set(0, 0.94, 0.84);
  balcony.add(topRail);

  const midRail = new THREE.Mesh(shared.geom.balconyFrontRailGeo, shared.wroughtIronMat);
  midRail.position.set(0, 0.5, 0.84);
  balcony.add(midRail);

  for (const sx of [-1.23, 1.23] as const) {
    const sideRail = new THREE.Mesh(shared.geom.balconySideRailGeo, shared.wroughtIronMat);
    sideRail.position.set(sx, 0.94, 0.44);
    balcony.add(sideRail);
  }

  for (const px of [-1.22, -0.61, 0, 0.61, 1.22] as const) {
    const post = new THREE.Mesh(shared.geom.balconyPostGeo, shared.wroughtIronMat);
    post.position.set(px, 0.5, 0.84);
    balcony.add(post);
  }

  return balcony;
}

function createStripedShopfrontAwning(
  awningName: string,
  awningMat: THREE.MeshStandardMaterial,
  isLitStorefront: boolean,
  shared: BuildingSharedMaterials,
): THREE.Group {
  const awning = new THREE.Group();
  awning.name = awningName;

  const canopy = new THREE.Mesh(shared.geom.awningCanopyGeo, awningMat);
  canopy.position.set(0, 0.14, 0.62);
  canopy.rotation.x = 0.36;
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  awning.add(canopy);

  const valance = new THREE.Mesh(shared.geom.awningValanceGeo, awningMat);
  valance.position.set(0, -0.18, 1.22);
  awning.add(valance);

  for (const sx of [-1.45, 1.45] as const) {
    const bracket = new THREE.Mesh(shared.geom.awningBracketGeo, shared.wroughtIronMat);
    bracket.position.set(sx, -0.12, 0.56);
    awning.add(bracket);
  }

  const storefrontBay = new THREE.Mesh(
    shared.geom.storefrontBayGeo,
    isLitStorefront ? shared.storefrontWarmBayMat : shared.storefrontGlassMat,
  );
  storefrontBay.position.set(0, -1.65, 0.06);
  awning.add(storefrontBay);

  return awning;
}

function attachCornerPilasters(
  group: THREE.Group,
  bldg: AabbCollider,
  style: BuildingFacadeStyle,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  centerY: number,
  shared: BuildingSharedMaterials,
): void {
  const pilasterMat =
    style === 'colonial_stucco'
      ? shared.sillMat
      : style === 'modern_glass'
        ? shared.corniceMat
        : shared.parapetMat;
  let pilasterIdx = 0;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const pilaster = new THREE.Mesh(shared.geom.pilasterUnitGeo, pilasterMat);
      pilaster.name = `building_pilaster_${bldg.id}_${pilasterIdx}`;
      pilaster.scale.set(1, bldg.height, 1);
      pilaster.position.set(
        cx + sx * (width * 0.5 - 0.1),
        centerY + bldg.height * 0.5,
        cz + sz * (depth * 0.5 - 0.1),
      );
      pilaster.castShadow = true;
      pilaster.receiveShadow = true;
      group.add(pilaster);
      pilasterIdx += 1;
    }
  }
}

function attachColonialRoofAndEaves(
  group: THREE.Group,
  bldg: AabbCollider,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  roofY: number,
  shared: BuildingSharedMaterials,
): void {
  const overhang = cx < -15 ? 0.92 : 0.7;
  const maxSpan = Math.max(width + overhang, depth + overhang);

  const roofPeak = new THREE.Mesh(
    new THREE.ConeGeometry(maxSpan * 0.74, 3.1, 4),
    shared.colonialRoofMat,
  );
  roofPeak.rotation.y = Math.PI / 4;
  roofPeak.scale.set(
    (width + overhang) / maxSpan,
    1,
    (depth + overhang) / maxSpan,
  );
  roofPeak.position.set(cx, roofY + 1.5, cz);
  roofPeak.castShadow = true;
  roofPeak.receiveShadow = true;
  roofPeak.userData.surfaceRole = 'roof' satisfies SurfaceRole;
  group.add(roofPeak);

  const eavesGroup = new THREE.Group();
  eavesGroup.name = `building_colonial_eaves_${bldg.id}`;

  // Terracotta eaves drip skirt + dark timber fascia band
  const eavesSkirt = new THREE.Mesh(
    new THREE.BoxGeometry(width + overhang * 1.15, 0.22, depth + overhang * 1.15),
    shared.colonialRoofMat,
  );
  eavesSkirt.position.set(cx, roofY + 0.14, cz);
  eavesSkirt.castShadow = true;
  eavesSkirt.receiveShadow = true;
  eavesSkirt.userData.surfaceRole = 'roof' satisfies SurfaceRole;
  eavesGroup.add(eavesSkirt);

  const timberFascia = new THREE.Mesh(
    new THREE.BoxGeometry(width + overhang, 0.28, depth + overhang),
    shared.woodTrimMat,
  );
  timberFascia.position.set(cx, roofY - 0.08, cz);
  timberFascia.castShadow = true;
  timberFascia.receiveShadow = true;
  eavesGroup.add(timberFascia);

  // Exposed wooden rafter tails tucked beneath colonial roof overhangs
  const nsCount = Math.max(3, Math.min(6, Math.floor(width / 2.4)));
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < nsCount; i += 1) {
      const tx = ((i + 0.5) / nsCount - 0.5) * (width * 0.86);
      const rafter = new THREE.Mesh(shared.geom.rafterTailGeo, shared.woodTrimMat);
      rafter.position.set(cx + tx, roofY - 0.24, cz + side * (depth * 0.5 + 0.24));
      eavesGroup.add(rafter);
    }
  }

  const ewCount = Math.max(3, Math.min(6, Math.floor(depth / 2.4)));
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < ewCount; i += 1) {
      const tz = ((i + 0.5) / ewCount - 0.5) * (depth * 0.86);
      const rafter = new THREE.Mesh(shared.geom.rafterTailGeo, shared.woodTrimMat);
      rafter.rotation.y = Math.PI / 2;
      rafter.position.set(cx + side * (width * 0.5 + 0.24), roofY - 0.24, cz + tz);
      eavesGroup.add(rafter);
    }
  }

  group.add(eavesGroup);
}

function attachArchitecturalWindows(
  group: THREE.Group,
  bldg: AabbCollider,
  style: BuildingFacadeStyle,
  bldgHash: number,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  centerY: number,
  height: number,
  shared: BuildingSharedMaterials,
): void {
  const streetSides = getStreetFacingSides(bldg);
  let windowIdx = 0;
  let balconyIdx = 0;

  if (style === 'colonial_stucco') {
    // San Antonio & Oeste colonial recessed windows with timber jambs, stone sills & upper balconies
    const floorLevels = height >= 7.5 ? [centerY + 2.3, centerY + 5.7] : [centerY + 2.5];
    const allSides: readonly FacadeSide[] = ['east', 'west', 'north', 'south'];

    for (const side of allSides) {
      const isStreetFace = streetSides.includes(side);
      const faceSpan = side === 'east' || side === 'west' ? depth : width;
      const colCount = Math.max(1, Math.min(3, Math.floor(faceSpan / 4.2)));

      for (let flIdx = 0; flIdx < floorLevels.length; flIdx += 1) {
        const wy = floorLevels[flIdx] ?? centerY + 2.3;
        for (let col = 0; col < colCount; col += 1) {
          const offset = ((col + 0.5) / colCount - 0.5) * (faceSpan * 0.72);
          const pose = getFacadePose(side, cx, cz, width, depth, offset);
          const isLit = (bldgHash + flIdx + col + windowIdx) % 3 === 0;

          const bay = createRecessedWindowBay(
            `building_window_bay_${bldg.id}_${windowIdx}`,
            isLit,
            shared.woodTrimMat,
            shared,
          );
          bay.position.set(pose.x, wy, pose.z);
          bay.rotation.y = pose.rotY;
          group.add(bay);
          windowIdx += 1;

          // Projecting San Antonio colonial balconies with dark wrought-iron railings on upper street-facing bays
          if (isStreetFace && flIdx === 1 && (col + bldgHash) % 2 === 0) {
            const balcony = createProjectingBalcony(
              `building_balcony_${bldg.id}_${balconyIdx}`,
              shared.woodTrimMat,
              shared,
            );
            balcony.position.set(pose.x, wy - 0.98, pose.z);
            balcony.rotation.y = pose.rotY;
            group.add(balcony);
            balconyIdx += 1;
          }
        }
      }
    }
    return;
  }

  if (style === 'downtown_midrise') {
    // Rhythmic 3D recessed window bays, protruding ledges, and projecting Cali wrought-iron balconies
    const floorStep = 3.9;
    const startY = centerY + 5.4;
    const maxY = centerY + height - 1.5;

    let floorIdx = 0;
    for (let wy = startY; wy < maxY; wy += floorStep) {
      for (const side of streetSides) {
        const faceSpan = side === 'east' || side === 'west' ? depth : width;
        const colCount = Math.max(2, Math.min(4, Math.floor(faceSpan / 4.4)));

        for (let col = 0; col < colCount; col += 1) {
          const offset = ((col + 0.5) / colCount - 0.5) * (faceSpan * 0.74);
          const pose = getFacadePose(side, cx, cz, width, depth, offset);
          const isLit = (bldgHash + floorIdx * 2 + col) % 3 === 0;

          const bay = createRecessedWindowBay(
            `building_window_bay_${bldg.id}_${windowIdx}`,
            isLit,
            shared.windowRevealMat,
            shared,
          );
          bay.position.set(pose.x, wy, pose.z);
          bay.rotation.y = pose.rotY;
          group.add(bay);
          windowIdx += 1;

          // Projecting residential balconies on mid & upper alternating bays (clear of facade neon signs)
          if (
            (floorIdx + col + bldgHash) % 3 === 0 &&
            !hasFacadeSignConflict(bldg.id, side, wy - centerY)
          ) {
            const balcony = createProjectingBalcony(
              `building_balcony_${bldg.id}_${balconyIdx}`,
              shared.corniceMat,
              shared,
            );
            balcony.position.set(pose.x, wy - 0.98, pose.z);
            balcony.rotation.y = pose.rotY;
            group.add(balcony);
            balconyIdx += 1;
          }
        }
      }
      floorIdx += 1;
    }

    // Subtle concrete belt course ledge separating ground-floor retail from residential stories
    const beltCourse = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.34, 0.24, depth + 0.34),
      shared.sillMat,
    );
    beltCourse.position.set(cx, centerY + 4.0, cz);
    beltCourse.castShadow = true;
    beltCourse.receiveShadow = true;
    group.add(beltCourse);
    return;
  }

  // Modern downtown & Granada towers: reflective curtain-glass ribbon bands + 3D architectural window bays & mullion reliefs
  const floorStep = 4.1;
  const startY = centerY + 4.8;
  const maxY = centerY + height - 1.5;
  const bandHeight = 2.42;
  const glassBandGeo = new THREE.BoxGeometry(width + 0.14, bandHeight, depth + 0.14);
  const ledgeGeo = new THREE.BoxGeometry(width + 0.38, 0.24, depth + 0.38);

  let floorIndex = 0;
  for (let wy = startY; wy < maxY; wy += floorStep) {
    const glassBand = new THREE.Mesh(glassBandGeo, shared.reflectiveGlassMat);
    glassBand.position.set(cx, wy, cz);
    glassBand.receiveShadow = true;
    group.add(glassBand);

    const ledge = new THREE.Mesh(ledgeGeo, shared.corniceMat);
    ledge.position.set(cx, wy - bandHeight * 0.5 - 0.12, cz);
    ledge.castShadow = true;
    ledge.receiveShadow = true;
    group.add(ledge);

    // Street-facing architectural recessed window bay mullions & warm glowing office suites
    for (const side of streetSides) {
      const faceSpan = side === 'east' || side === 'west' ? depth : width;
      const colCount = Math.max(2, Math.min(3, Math.floor(faceSpan / 5.4)));
      for (let col = 0; col < colCount; col += 1) {
        const offset = ((col + 0.5) / colCount - 0.5) * (faceSpan * 0.72);
        const pose = getFacadePose(side, cx, cz, width, depth, offset);
        const isLit = (bldgHash + floorIndex + col) % 3 === 1;

        const bay = new THREE.Group();
        bay.name = `building_window_bay_${bldg.id}_${windowIdx}`;
        bay.position.set(pose.x, wy, pose.z);
        bay.rotation.y = pose.rotY;

        const pane = new THREE.Mesh(
          shared.geom.windowPaneGeo,
          isLit ? shared.warmInteriorGlassMat : shared.recessedWindowGlassMat,
        );
        pane.name = `building_window_bay_${bldg.id}_${windowIdx}_window_pane`;
        pane.position.set(0, 0, 0.1);
        bay.add(pane);

        for (const sx of [-0.72, 0.72] as const) {
          const mullion = new THREE.Mesh(shared.geom.modernMullionGeo, shared.windowRevealMat);
          mullion.position.set(sx, 0, 0.14);
          bay.add(mullion);
        }

        group.add(bay);
        windowIdx += 1;

        // Occasional sleek executive tower balcony on upper stories (clear of facade neon signs)
        if (
          floorIndex > 0 &&
          floorIndex % 2 === 1 &&
          col === 0 &&
          !hasFacadeSignConflict(bldg.id, side, wy - centerY)
        ) {
          const balcony = createProjectingBalcony(
            `building_balcony_${bldg.id}_${balconyIdx}`,
            shared.corniceMat,
            shared,
          );
          balcony.position.set(pose.x, wy - bandHeight * 0.5, pose.z);
          balcony.rotation.y = pose.rotY;
          group.add(balcony);
          balconyIdx += 1;
        }
      }
    }

    floorIndex += 1;
  }
}

function attachGroundFloorAwnings(
  group: THREE.Group,
  bldg: AabbCollider,
  bldgHash: number,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  centerY: number,
  shared: BuildingSharedMaterials,
): void {
  const streetSides = getStreetFacingSides(bldg);
  const awningMat =
    shared.awningMats[bldgHash % shared.awningMats.length] ?? shared.awningMats[0];
  if (!awningMat) {
    return;
  }

  let awningIdx = 0;
  for (const side of streetSides) {
    const faceSpan = side === 'east' || side === 'west' ? depth : width;
    const count = Math.max(1, Math.min(3, Math.floor((faceSpan - 2.2) / 4.4)));
    for (let i = 0; i < count; i += 1) {
      const offset = ((i + 0.5) / count - 0.5) * (faceSpan * 0.72);
      const pose = getFacadePose(side, cx, cz, width, depth, offset);
      const isLitStorefront = (bldgHash + i + awningIdx) % 2 === 0;

      const awning = createStripedShopfrontAwning(
        `building_awning_${bldg.id}_${awningIdx}`,
        awningMat,
        isLitStorefront,
        shared,
      );
      awning.position.set(pose.x, centerY + 3.05, pose.z);
      awning.rotation.y = pose.rotY;
      group.add(awning);
      awningIdx += 1;
    }
  }
}

function createSingleBuilding(
  bldg: AabbCollider,
  textureCache: Map<string, BuildingFacadeTextureSet>,
  shared: BuildingSharedMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.name = bldg.id;

  const width = bldg.maxX - bldg.minX;
  const depth = bldg.maxZ - bldg.minZ;
  const cx = (bldg.minX + bldg.maxX) * 0.5;
  const cz = (bldg.minZ + bldg.maxZ) * 0.5;
  const accentHex = bldg.accentHex ?? 0x8f887d;
  const style = classifyBuildingStyle(bldg);
  const bldgHash = hashBuildingIndex(bldg.id);

  const minCornerY = Math.min(
    getTerrainElevation(bldg.minX, bldg.minZ),
    getTerrainElevation(bldg.maxX, bldg.minZ),
    getTerrainElevation(bldg.minX, bldg.maxZ),
    getTerrainElevation(bldg.maxX, bldg.maxZ),
  );
  const centerY = getTerrainElevation(cx, cz);
  const foundationDrop = Math.max(0.8, centerY - minCornerY + 0.8);
  const totalHeight = bldg.height + foundationDrop;

  const cacheKey = `${style}_${bldg.colorHex}_${accentHex}`;
  let facadeTex = textureCache.get(cacheKey);
  if (!facadeTex) {
    facadeTex = createBuildingFacadeTextures(style, bldg.colorHex, accentHex);
    textureCache.set(cacheKey, facadeTex);
  }

  const dayFacadeEmissive =
    style === 'modern_glass' ? 0.42 : style === 'colonial_stucco' ? 0.26 : 0.36;
  const facadeMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: facadeTex.map,
      roughnessMap: facadeTex.roughnessMap,
      roughness: 1.0,
      bumpMap: facadeTex.bumpMap,
      bumpScale: style === 'modern_glass' ? 0.04 : 0.08,
      emissive: 0xffe4bc,
      emissiveMap: facadeTex.emissiveMap,
      emissiveIntensity: dayFacadeEmissive,
      metalness:
        style === 'modern_glass' ? 0.5 : style === 'downtown_midrise' ? 0.1 : 0.04,
      envMapIntensity: style === 'modern_glass' ? 1.55 : 0.8,
    }),
    {
      dayIntensity: dayFacadeEmissive,
      nightIntensity: 1.65,
      requireEmissiveMap: true,
    },
  );

  if (style === 'colonial_stucco') {
    facadeMat.userData.surfaceRole = 'plaster' satisfies SurfaceRole;
    facadeMat.userData.photoTintHex =
      COLONIAL_WARM_TINTS[bldgHash % COLONIAL_WARM_TINTS.length] ?? 0xf4ead8;
  } else {
    facadeMat.userData.surfaceRole = 'facade' satisfies SurfaceRole;
    facadeMat.userData.photoTintHex =
      style === 'modern_glass'
        ? 0xadb4be
        : (DOWNTOWN_STONE_TINTS[bldgHash % DOWNTOWN_STONE_TINTS.length] ?? 0xdcd5c9);
  }

  const verticalRepeat =
    style === 'modern_glass' ? Math.max(1, Math.round(totalHeight / 22)) : 1;
  const bodyGeo = createUvScaledBoxGeometry(width, totalHeight, depth, 12, 18, {
    integerSideRepeat: true,
    verticalRepeat,
  });
  const body = new THREE.Mesh(bodyGeo, [
    facadeMat,
    facadeMat,
    shared.roofMat,
    shared.roofMat,
    facadeMat,
    facadeMat,
  ]);
  body.position.set(cx, centerY + bldg.height - totalHeight * 0.5, cz);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  attachCornerPilasters(group, bldg, style, cx, cz, width, depth, centerY, shared);
  attachArchitecturalWindows(
    group,
    bldg,
    style,
    bldgHash,
    cx,
    cz,
    width,
    depth,
    centerY,
    bldg.height,
    shared,
  );

  const roofY = centerY + bldg.height;

  if (style === 'colonial_stucco') {
    attachColonialRoofAndEaves(group, bldg, cx, cz, width, depth, roofY, shared);
  } else {
    // Ground-floor architectural concrete canopy + striped Cali shopfront awnings & warm storefront bays
    const canopyY =
      style === 'downtown_midrise'
        ? centerY + Math.min(4.2, Math.max(3.65, bldg.height * 0.23))
        : centerY + 3.65;
    const storefrontCanopy = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.65, 0.24, depth + 0.65),
      shared.corniceMat,
    );
    storefrontCanopy.position.set(cx, canopyY, cz);
    storefrontCanopy.castShadow = true;
    storefrontCanopy.receiveShadow = true;
    group.add(storefrontCanopy);

    if (style === 'modern_glass') {
      const lobbyGlass = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.14, 3.2, depth + 0.14),
        shared.storefrontGlassMat,
      );
      lobbyGlass.position.set(cx, centerY + 1.8, cz);
      lobbyGlass.receiveShadow = true;
      group.add(lobbyGlass);
    } else {
      const kickplate = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.16, 0.42, depth + 0.16),
        shared.storefrontGlassMat,
      );
      kickplate.position.set(cx, centerY + 0.22, cz);
      kickplate.receiveShadow = true;
      group.add(kickplate);
    }

    attachGroundFloorAwnings(group, bldg, bldgHash, cx, cz, width, depth, centerY, shared);

    attachBuildingRooftopDetails(
      group,
      bldg,
      cx,
      cz,
      width,
      depth,
      roofY,
      shared,
    );
  }

  return group;
}

function buildBuildingsGroup(map: CaliMapConfig): THREE.Group {
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = 'cali_buildings';

  const textureCache = new Map<string, BuildingFacadeTextureSet>();
  const shared = createBuildingSharedMaterials();

  for (const collider of map.buildingColliders) {
    buildingsGroup.add(createSingleBuilding(collider, textureCache, shared));
  }

  return buildingsGroup;
}

const CALI_NEON_SIGNS: readonly NeonSignSpec[] = [
  {
    id: 'neon_salsa_bulevar',
    buildingId: 'bldg_bulevar_2',
    label: 'SALSA',
    colorHex: 0xff2e93,
    face: 'east',
    placement: 'facade',
    width: 10.5,
    height: 2.7,
  },
  {
    id: 'neon_cali_centro',
    buildingId: 'bldg_centro_2',
    label: 'CALI',
    colorHex: 0x00f0ff,
    face: 'east',
    placement: 'rooftop',
    width: 12.0,
    height: 3.1,
  },
  {
    id: 'neon_cafe_bulevar',
    buildingId: 'bldg_bulevar_4',
    label: 'CAFÉ',
    colorHex: 0xffb800,
    face: 'east',
    placement: 'facade',
    width: 9.0,
    height: 2.4,
  },
  {
    id: 'neon_cholado_penon',
    buildingId: 'bldg_penon_2',
    label: 'CHOLADO',
    colorHex: 0x00e699,
    face: 'north',
    placement: 'rooftop',
    width: 11.4,
    height: 2.8,
  },
  {
    id: 'neon_bulevar_centro',
    buildingId: 'bldg_centro_4',
    label: 'BULEVAR',
    colorHex: 0xff5e7e,
    face: 'east',
    placement: 'rooftop',
    width: 11.8,
    height: 2.9,
  },
  {
    id: 'neon_feria_granada',
    buildingId: 'bldg_granada_1',
    label: 'FERIA',
    colorHex: 0xffb800,
    face: 'west',
    placement: 'rooftop',
    width: 11.0,
    height: 2.8,
  },
  {
    id: 'neon_salsa_oriente',
    buildingId: 'bldg_oriente_1',
    label: 'SALSA',
    colorHex: 0xff2e93,
    face: 'west',
    placement: 'rooftop',
    width: 10.8,
    height: 2.7,
  },
];

function buildNeonSignsGroup(map: CaliMapConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_neon_signs';

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x151226,
    roughness: 0.5,
    metalness: 0.72,
  });

  const signTextureCache = new Map<string, THREE.Texture>();
  const buildingsById = new Map<string, AabbCollider>();
  for (const bldg of map.buildingColliders) {
    buildingsById.set(bldg.id, bldg);
  }

  for (const spec of CALI_NEON_SIGNS) {
    const bldg = buildingsById.get(spec.buildingId);
    if (!bldg) {
      continue;
    }

    const cx = (bldg.minX + bldg.maxX) * 0.5;
    const cz = (bldg.minZ + bldg.maxZ) * 0.5;
    const groundY = getTerrainElevation(cx, cz);
    const roofY = groundY + bldg.height;

    const signNode = new THREE.Group();
    signNode.name = spec.id;

    let posX = cx;
    let posZ = cz;
    let rotY = 0;

    if (spec.face === 'east') {
      posX = bldg.maxX + (spec.placement === 'facade' ? 0.35 : -0.6);
      rotY = Math.PI / 2;
    } else if (spec.face === 'west') {
      posX = bldg.minX - (spec.placement === 'facade' ? 0.35 : -0.6);
      rotY = -Math.PI / 2;
    } else if (spec.face === 'north') {
      posZ = bldg.minZ - (spec.placement === 'facade' ? 0.35 : -0.6);
      rotY = Math.PI;
    } else {
      posZ = bldg.maxZ + (spec.placement === 'facade' ? 0.35 : -0.6);
      rotY = 0;
    }

    const posY =
      spec.placement === 'rooftop'
        ? roofY + spec.height * 0.5 + 1.55
        : groundY + Math.max(7.2, bldg.height * 0.62);

    signNode.position.set(posX, posY, posZ);
    signNode.rotation.y = rotY;

    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.35, spec.height + 0.35, 0.36),
      frameMat,
    );
    backing.castShadow = true;
    signNode.add(backing);

    if (spec.placement === 'rooftop') {
      const strutH = 1.6;
      for (const sx of [-spec.width * 0.34, spec.width * 0.34]) {
        const strut = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, strutH, 0.24),
          frameMat,
        );
        strut.position.set(sx, -(spec.height * 0.5 + strutH * 0.5), 0);
        strut.castShadow = true;
        signNode.add(strut);
      }
    }

    const signCacheKey = `${spec.label}_${spec.colorHex}`;
    let signTexture = signTextureCache.get(signCacheKey);
    if (!signTexture) {
      signTexture = createNeonSignTexture(spec.label, spec.colorHex);
      signTextureCache.set(signCacheKey, signTexture);
    }
    const panelMat = tagNightEmissive(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: signTexture,
        emissive: 0xffffff,
        emissiveMap: signTexture,
        emissiveIntensity: 1.15,
        roughness: 0.24,
        metalness: 0.1,
      }),
      { dayIntensity: 1.15, nightIntensity: 1.8 },
    );

    const frontFace = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width, spec.height),
      panelMat,
    );
    frontFace.position.z = 0.19;
    signNode.add(frontFace);

    group.add(signNode);
  }

  return group;
}

function buildCristoReyLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const plazaMat = new THREE.MeshStandardMaterial({
    color: 0x867e73,
    roughness: 0.88,
  });
  plazaMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const terraceStoneMat = new THREE.MeshStandardMaterial({
    color: 0xc9c0b2,
    roughness: 0.78,
  });
  terraceStoneMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const carvedStepMat = new THREE.MeshStandardMaterial({
    color: 0xd8ccb8,
    roughness: 0.76,
    metalness: 0.04,
  });
  carvedStepMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const railingSteelMat = new THREE.MeshStandardMaterial({
    color: 0x242830,
    roughness: 0.36,
    metalness: 0.8,
  });

  const pedestalMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xe6dfd3,
      roughness: 0.68,
    }),
    {
      dayIntensity: 0,
      nightIntensity: 0.48,
      dayEmissiveHex: 0x000000,
      nightEmissiveHex: 0xffdca8,
    },
  );
  pedestalMat.userData.surfaceRole = 'plaster' satisfies SurfaceRole;

  const statueMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xede6da,
      emissive: 0xffe4bc,
      emissiveIntensity: 0.12,
      roughness: 0.48,
      flatShading: false,
    }),
    {
      dayIntensity: 0.12,
      nightIntensity: 1.35,
      dayEmissiveHex: 0xffe4bc,
      nightEmissiveHex: 0xfff3dc,
    },
  );
  const goldMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xc99c45,
      emissive: 0x997024,
      emissiveIntensity: 0.35,
      roughness: 0.32,
      metalness: 0.72,
    }),
    { dayIntensity: 0.35, nightIntensity: 1.95 },
  );
  const floodlightLensMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xfff2cc,
      emissive: 0xffcf70,
      emissiveIntensity: 0.65,
      roughness: 0.14,
      metalness: 0.15,
    }),
    { dayIntensity: 0.65, nightIntensity: 3.4 },
  );
  const uplightBeamMat = tagNightOpacity(
    new THREE.MeshBasicMaterial({
      color: 0xffd796,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    0.06,
    0.36,
  );

  // Terraced circular stone mirador observation deck
  const miradorDeckGroup = new THREE.Group();
  miradorDeckGroup.name = 'cristo_rey_mirador_deck';

  const lowerTerrace = new THREE.Mesh(
    new THREE.CylinderGeometry(13.4, 15.2, 1.4, 24),
    plazaMat,
  );
  lowerTerrace.position.y = 0.4;
  miradorDeckGroup.add(lowerTerrace);

  const miradorDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(11.2, 12.4, 1.4, 24),
    terraceStoneMat,
  );
  miradorDeck.position.y = 1.65;
  miradorDeckGroup.add(miradorDeck);

  const copingRing = new THREE.Mesh(
    new THREE.TorusGeometry(11.15, 0.22, 8, 36),
    carvedStepMat,
  );
  copingRing.rotation.x = Math.PI / 2;
  copingRing.position.y = 2.38;
  miradorDeckGroup.add(copingRing);

  const miradorRing = new THREE.Mesh(
    new THREE.TorusGeometry(8.4, 0.12, 8, 32),
    goldMat,
  );
  miradorRing.rotation.x = Math.PI / 2;
  miradorRing.position.y = 2.4;
  miradorDeckGroup.add(miradorRing);
  group.add(miradorDeckGroup);

  // Protective circular perimeter railings around mirador deck (open toward +X approach steps)
  const railingGroup = new THREE.Group();
  railingGroup.name = 'cristo_rey_mirador_railing';
  const entryHalfGapRad = 0.32;
  const railingArcRad = Math.PI * 2 - entryHalfGapRad * 2;
  const railingRadius = 11.05;

  for (const railY of [3.42, 2.94] as const) {
    const railTube = new THREE.Mesh(
      new THREE.TorusGeometry(railingRadius, 0.075, 8, 36, railingArcRad),
      railingSteelMat,
    );
    railTube.rotation.x = Math.PI / 2;
    railTube.rotation.z = entryHalfGapRad;
    railTube.position.y = railY;
    railingGroup.add(railTube);
  }

  const postGeo = new THREE.CylinderGeometry(0.055, 0.068, 1.12, 6);
  const postCount = 22;
  for (let i = 0; i <= postCount; i += 1) {
    const angle = entryHalfGapRad + (i / postCount) * railingArcRad;
    const post = new THREE.Mesh(postGeo, railingSteelMat);
    post.position.set(
      Math.cos(angle) * railingRadius,
      2.9,
      Math.sin(angle) * railingRadius,
    );
    railingGroup.add(post);
  }
  group.add(railingGroup);

  // Warm carved stone approach steps ascending from east (+X) mirador entrance to pedestal terrace
  const stepsGroup = new THREE.Group();
  stepsGroup.name = 'cristo_rey_approach_steps';
  const stepCount = 8;
  const stepWidthBase = 6.2;
  const stepGeo = new THREE.BoxGeometry(1.05, 0.34, 1.0);

  for (let s = 0; s < stepCount; s += 1) {
    const t = s / (stepCount - 1);
    const sx = 11.4 - t * 6.4;
    const sy = 1.25 + t * 2.55;
    const sw = stepWidthBase - t * 1.1;
    const step = new THREE.Mesh(stepGeo, carvedStepMat);
    step.scale.set(1, 1, sw);
    step.position.set(sx, sy, 0);
    stepsGroup.add(step);
  }

  // Carved stone cheek walls & glowing sandstone newel post lanterns flanking staircase
  const cheekWallGeo = new THREE.BoxGeometry(6.8, 1.45, 0.55);
  const newelPostGeo = new THREE.BoxGeometry(0.76, 1.8, 0.76);
  const newelLanternGeo = new THREE.SphereGeometry(0.32, 8, 8);
  for (const sideSign of [-1, 1] as const) {
    const cheek = new THREE.Mesh(cheekWallGeo, carvedStepMat);
    cheek.position.set(8.2, 2.55, sideSign * 3.15);
    cheek.rotation.z = 0.35;
    stepsGroup.add(cheek);

    const newel = new THREE.Mesh(newelPostGeo, carvedStepMat);
    newel.position.set(11.65, 2.05, sideSign * 3.25);
    stepsGroup.add(newel);

    const lantern = new THREE.Mesh(newelLanternGeo, floodlightLensMat);
    lantern.position.set(11.65, 3.15, sideSign * 3.25);
    stepsGroup.add(lantern);
  }
  group.add(stepsGroup);

  // Illuminated pedestal terrace & iconic monument plinth
  const pedestalBase = new THREE.Mesh(
    new THREE.CylinderGeometry(5.6, 6.6, 1.8, 12),
    terraceStoneMat,
  );
  pedestalBase.position.y = 3.1;
  group.add(pedestalBase);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 5.1, 6.8, 8),
    pedestalMat,
  );
  pedestal.position.y = 7.2;
  group.add(pedestal);

  // Giant illuminated ivory Cristo Rey statue facing +X (arms spread along Z)
  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(1.85, 3.1, 20, 8),
    statueMat,
  );
  robe.position.y = 19.6;
  group.add(robe);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5.2, 5.4), statueMat);
  chest.position.y = 27.0;
  group.add(chest);

  const outstretchedArms = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 2.1, 22.8),
    statueMat,
  );
  outstretchedArms.position.y = 28.4;
  group.add(outstretchedArms);

  const sleeveDrape = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 15.8),
    statueMat,
  );
  sleeveDrape.position.y = 27.0;
  group.add(sleeveDrape);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), statueMat);
  head.position.set(0.35, 31.9, 0);
  group.add(head);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.18, 8, 24), goldMat);
  halo.rotation.y = Math.PI / 2;
  halo.position.set(-0.3, 32.1, 0);
  group.add(halo);

  // 6 heavy-duty architectural ground floodlight housings + dramatic volumetric uplight cones
  const housingGeo = new THREE.BoxGeometry(0.74, 0.44, 0.56);
  const lensGeo = new THREE.PlaneGeometry(0.6, 0.34);
  const mountGeo = new THREE.BoxGeometry(0.92, 0.42, 0.92);
  const beamGeo = new THREE.ConeGeometry(4.6, 26, 16, 1, true);

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const fx = Math.cos(angle) * 7.2;
    const fz = Math.sin(angle) * 7.2;

    const fixture = new THREE.Group();
    fixture.name = `cristo_rey_floodlight_${i}`;
    fixture.position.set(fx, 2.45, fz);

    const mount = new THREE.Mesh(mountGeo, terraceStoneMat);
    mount.position.y = 0.12;
    fixture.add(mount);

    const housing = new THREE.Mesh(housingGeo, railingSteelMat);
    housing.position.y = 0.52;
    housing.lookAt(-fx, 18, -fz);

    const lens = new THREE.Mesh(lensGeo, floodlightLensMat);
    lens.position.set(0, 0, 0.29);
    housing.add(lens);
    fixture.add(housing);

    group.add(fixture);

    const beam = new THREE.Mesh(beamGeo, uplightBeamMat);
    beam.name = `cristo_rey_uplight_beam_${i}`;
    beam.position.set(Math.cos(angle) * 3.8, 15.2, Math.sin(angle) * 3.8);
    beam.rotation.z = Math.cos(angle) * 0.16;
    beam.rotation.x = -Math.sin(angle) * 0.16;
    group.add(beam);
  }

  // Dedicated warm night-boosted architectural monument uplight (no shadow pass overhead)
  const monumentUplight = tagNightLight(
    new THREE.PointLight(0xffd699, 0.25, 48, 1.5),
    0.25,
    3.6,
  );
  monumentUplight.name = 'cristo_rey_monument_uplight';
  monumentUplight.position.set(5.5, 16.5, 0);
  group.add(monumentUplight);

  enableSolidLandmarkShadows(group);
  return group;
}

function buildLaErmitaLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const ivoryMat = new THREE.MeshStandardMaterial({
    color: 0xeee8dd,
    roughness: 0.72,
    flatShading: false,
  });
  ivoryMat.userData.surfaceRole = 'plaster' satisfies SurfaceRole;

  const trimStoneMat = new THREE.MeshStandardMaterial({
    color: 0xd9d1c3,
    roughness: 0.78,
    metalness: 0.06,
  });

  const skyBlueMat = new THREE.MeshStandardMaterial({
    color: 0x7aa4c9,
    roughness: 0.52,
    metalness: 0.14,
    flatShading: false,
  });
  const roseTex = createRoseWindowTexture();
  const roseGlowMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: roseTex,
      emissive: 0xffa85c,
      emissiveMap: roseTex,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    }),
    { dayIntensity: 0.85, nightIntensity: 2.35 },
  );
  const lancetGlassMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0x264470,
      emissive: 0xffb35c,
      emissiveIntensity: 0.42,
      roughness: 0.14,
      metalness: 0.38,
    }),
    {
      dayIntensity: 0.42,
      nightIntensity: 1.85,
      dayEmissiveHex: 0x5c7aa6,
      nightEmissiveHex: 0xffb85e,
    },
  );
  const goldMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xd9a845,
      emissive: 0xb88424,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.68,
    }),
    { dayIntensity: 0.42, nightIntensity: 1.45 },
  );
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x452918,
    roughness: 0.84,
  });

  // Stone sanctuary plinth
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0x8f887d, roughness: 0.88 });
  plinthMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(17.8, 1.2, 22.4),
    plinthMat,
  );
  plinth.position.y = 0.6;
  group.add(plinth);

  // Main ivory neo-gothic nave
  const nave = new THREE.Mesh(new THREE.BoxGeometry(13.5, 12.5, 16.5), ivoryMat);
  nave.position.set(1.2, 7.2, 0);
  group.add(nave);

  // Stepped corner & nave buttresses with sky-blue gothic pinnacles & golden finials
  const buttressBaseGeo = new THREE.BoxGeometry(1.45, 4.6, 1.45);
  const buttressMidGeo = new THREE.BoxGeometry(1.12, 4.2, 1.12);
  const buttressTopGeo = new THREE.BoxGeometry(0.84, 3.0, 0.84);
  const buttressPinnacleGeo = new THREE.ConeGeometry(0.58, 3.4, 4);
  const miniFinialGeo = new THREE.BoxGeometry(0.14, 0.85, 0.14);

  const buttressCoords: readonly (readonly [number, number])[] = [
    [-3.2, -8.5],
    [1.2, -8.5],
    [5.6, -8.5],
    [8.0, -8.5],
    [-3.2, 8.5],
    [1.2, 8.5],
    [5.6, 8.5],
    [8.0, 8.5],
    [-7.3, -6.5],
    [-7.3, 6.5],
  ];

  buttressCoords.forEach(([bx, bz], idx) => {
    const buttressGroup = new THREE.Group();
    buttressGroup.name = `la_ermita_buttress_${idx}`;
    buttressGroup.position.set(bx, 1.2, bz);

    const base = new THREE.Mesh(buttressBaseGeo, trimStoneMat);
    base.position.y = 2.3;
    buttressGroup.add(base);

    const mid = new THREE.Mesh(buttressMidGeo, ivoryMat);
    mid.position.y = 6.5;
    buttressGroup.add(mid);

    const top = new THREE.Mesh(buttressTopGeo, ivoryMat);
    top.position.y = 10.0;
    buttressGroup.add(top);

    const pinnacle = new THREE.Mesh(buttressPinnacleGeo, skyBlueMat);
    pinnacle.rotation.y = Math.PI / 4;
    pinnacle.position.y = 13.1;
    buttressGroup.add(pinnacle);

    const finial = new THREE.Mesh(miniFinialGeo, goldMat);
    finial.position.y = 15.1;
    buttressGroup.add(finial);

    group.add(buttressGroup);
  });

  // Pointed neo-gothic lancet window cutouts/arches along nave walls & west facade towers
  const lancetPaneGeo = new THREE.BoxGeometry(1.15, 3.6, 0.14);
  const lancetPeakGeo = new THREE.ConeGeometry(0.67, 1.35, 3);
  const lancetJambGeo = new THREE.BoxGeometry(0.18, 3.85, 0.28);
  const lancetSillGeo = new THREE.BoxGeometry(1.56, 0.22, 0.36);

  const buildLancetWindow = (name: string): THREE.Group => {
    const lancet = new THREE.Group();
    lancet.name = name;

    const pane = new THREE.Mesh(lancetPaneGeo, lancetGlassMat);
    pane.position.set(0, 0, 0.05);
    lancet.add(pane);

    const archPeak = new THREE.Mesh(lancetPeakGeo, lancetGlassMat);
    archPeak.scale.set(1, 1, 0.22);
    archPeak.position.set(0, 2.35, 0.05);
    lancet.add(archPeak);

    const hoodPeak = new THREE.Mesh(lancetPeakGeo, trimStoneMat);
    hoodPeak.scale.set(1.24, 1.15, 0.34);
    hoodPeak.position.set(0, 2.48, 0.12);
    lancet.add(hoodPeak);

    for (const sx of [-0.66, 0.66] as const) {
      const jamb = new THREE.Mesh(lancetJambGeo, trimStoneMat);
      jamb.position.set(sx, 0, 0.12);
      lancet.add(jamb);
    }

    const sill = new THREE.Mesh(lancetSillGeo, trimStoneMat);
    sill.position.set(0, -1.96, 0.16);
    lancet.add(sill);

    return lancet;
  };

  let lancetIdx = 0;
  for (const lx of [-1.0, 3.4, 6.7] as const) {
    for (const side of [-1, 1] as const) {
      const win = buildLancetWindow(`la_ermita_lancet_window_${lancetIdx}`);
      win.position.set(lx, 7.6, side * 8.28);
      win.rotation.y = side > 0 ? 0 : Math.PI;
      group.add(win);
      lancetIdx += 1;
    }
  }
  for (const side of [-4.6, 4.6] as const) {
    const towerLancet = buildLancetWindow(`la_ermita_lancet_window_${lancetIdx}`);
    towerLancet.position.set(-7.42, 14.5, side);
    towerLancet.rotation.y = -Math.PI / 2;
    group.add(towerLancet);
    lancetIdx += 1;
  }
  for (const belfryY of [20.5, 25.4] as const) {
    const centerLancet = buildLancetWindow(`la_ermita_lancet_window_${lancetIdx}`);
    centerLancet.position.set(-6.45, belfryY, 0);
    centerLancet.rotation.y = -Math.PI / 2;
    centerLancet.scale.setScalar(0.82);
    group.add(centerLancet);
    lancetIdx += 1;
  }

  // Pitched nave roof in sky-blue gothic slate
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(10.5, 6.2, 4),
    skyBlueMat,
  );
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(0.95, 1, 1.15);
  roof.position.set(1.2, 16.4, 0);
  group.add(roof);

  // Twin flanking neo-gothic spires + corner mini-pinnacles + golden cross finials
  const cornerSpireletGeo = new THREE.ConeGeometry(0.46, 3.1, 4);
  const sideCrossVGeo = new THREE.BoxGeometry(0.24, 2.5, 0.24);
  const sideCrossHGeo = new THREE.BoxGeometry(0.24, 0.24, 1.35);

  const flankingSides = [
    { z: -4.6, tag: 'left' },
    { z: 4.6, tag: 'right' },
  ] as const;

  for (const flank of flankingSides) {
    const flankGroup = new THREE.Group();
    flankGroup.name = `la_ermita_flanking_pinnacle_${flank.tag}`;
    flankGroup.position.set(-5.6, 0, flank.z);

    const towerLower = new THREE.Mesh(new THREE.BoxGeometry(3.8, 16.0, 3.8), ivoryMat);
    towerLower.position.y = 9.0;
    flankGroup.add(towerLower);

    const towerSetback = new THREE.Mesh(new THREE.BoxGeometry(3.1, 6.2, 3.1), ivoryMat);
    towerSetback.position.y = 19.8;
    flankGroup.add(towerSetback);

    const towerCrown = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.65, 3.4), trimStoneMat);
    towerCrown.position.y = 22.9;
    flankGroup.add(towerCrown);

    for (const cx of [-1.45, 1.45] as const) {
      for (const cz of [-1.45, 1.45] as const) {
        const spirelet = new THREE.Mesh(cornerSpireletGeo, skyBlueMat);
        spirelet.rotation.y = Math.PI / 4;
        spirelet.position.set(cx, 24.7, cz);
        flankGroup.add(spirelet);
      }
    }

    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.15, 12.6, 8), skyBlueMat);
    spire.position.y = 29.4;
    flankGroup.add(spire);

    const crossGroup = new THREE.Group();
    crossGroup.name = `la_ermita_cross_finial_${flank.tag}`;
    crossGroup.position.y = 36.6;
    crossGroup.add(new THREE.Mesh(sideCrossVGeo, goldMat));
    const arm = new THREE.Mesh(sideCrossHGeo, goldMat);
    arm.position.y = 0.45;
    crossGroup.add(arm);
    flankGroup.add(crossGroup);

    group.add(flankGroup);
  }

  // Stepped multi-tier neo-gothic central spire with octagonal belfry drum & golden cross finial
  const centralSpireGroup = new THREE.Group();
  centralSpireGroup.name = 'la_ermita_central_spire';
  centralSpireGroup.position.set(-4.2, 0, 0);

  const centerTowerBase = new THREE.Mesh(new THREE.BoxGeometry(4.6, 21.0, 4.6), ivoryMat);
  centerTowerBase.position.y = 11.4;
  centralSpireGroup.add(centerTowerBase);

  const centerBelfryTier = new THREE.Mesh(new THREE.BoxGeometry(3.8, 6.4, 3.8), ivoryMat);
  centerBelfryTier.position.y = 24.8;
  centralSpireGroup.add(centerBelfryTier);

  const centerLanternDrum = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.25, 4.2, 8),
    trimStoneMat,
  );
  centerLanternDrum.position.y = 29.8;
  centralSpireGroup.add(centerLanternDrum);

  for (const cx of [-1.8, 1.8] as const) {
    for (const cz of [-1.8, 1.8] as const) {
      const crownPin = new THREE.Mesh(cornerSpireletGeo, ivoryMat);
      crownPin.rotation.y = Math.PI / 4;
      crownPin.position.set(cx, 29.4, cz);
      centralSpireGroup.add(crownPin);
    }
  }

  const centerSpire = new THREE.Mesh(
    new THREE.ConeGeometry(2.15, 14.5, 8),
    ivoryMat,
  );
  centerSpire.position.y = 39.0;
  centralSpireGroup.add(centerSpire);

  const centerCrossGroup = new THREE.Group();
  centerCrossGroup.name = 'la_ermita_cross_finial_center';
  centerCrossGroup.position.y = 47.4;
  centerCrossGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 3.4, 0.36), goldMat));
  const centerCrossArm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 2.1), goldMat);
  centerCrossArm.position.y = 0.55;
  centerCrossGroup.add(centerCrossArm);
  centralSpireGroup.add(centerCrossGroup);

  group.add(centralSpireGroup);

  // Layered glowing stained-glass rose window with concentric golden tracery & radial mullions
  const roseGroup = new THREE.Group();
  roseGroup.name = 'la_ermita_rose_window';
  roseGroup.position.set(-6.62, 13.5, 0);

  const roseStoneSurround = new THREE.Mesh(
    new THREE.TorusGeometry(2.55, 0.32, 8, 28),
    trimStoneMat,
  );
  roseStoneSurround.rotation.y = Math.PI / 2;
  roseGroup.add(roseStoneSurround);

  const roseOuter = new THREE.Mesh(
    new THREE.TorusGeometry(2.26, 0.18, 8, 24),
    goldMat,
  );
  roseOuter.rotation.y = Math.PI / 2;
  roseOuter.position.x = -0.06;
  roseGroup.add(roseOuter);

  const roseInnerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.12, 0.12, 8, 20),
    goldMat,
  );
  roseInnerRing.rotation.y = Math.PI / 2;
  roseInnerRing.position.x = -0.1;
  roseGroup.add(roseInnerRing);

  const roseGlass = new THREE.Mesh(
    new THREE.CircleGeometry(2.16, 24),
    roseGlowMat,
  );
  roseGlass.rotation.y = -Math.PI / 2;
  roseGlass.position.x = -0.04;
  roseGroup.add(roseGlass);

  const spokeGeo = new THREE.BoxGeometry(0.08, 4.2, 0.08);
  for (let s = 0; s < 4; s += 1) {
    const spoke = new THREE.Mesh(spokeGeo, goldMat);
    spoke.position.x = -0.11;
    spoke.rotation.x = (s / 4) * Math.PI;
    roseGroup.add(spoke);
  }

  const roseBoss = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), goldMat);
  roseBoss.position.x = -0.14;
  roseGroup.add(roseBoss);
  group.add(roseGroup);

  // Stepped gothic entrance portal with carved wooden double doors & gable hood
  const portalGroup = new THREE.Group();
  portalGroup.name = 'la_ermita_portal';
  portalGroup.position.set(-6.55, 3.8, 0);

  const portalFrame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 5.6, 4.1), trimStoneMat);
  portalGroup.add(portalFrame);

  const portalDoors = new THREE.Mesh(new THREE.BoxGeometry(0.84, 4.6, 3.0), darkWoodMat);
  portalDoors.position.set(-0.08, -0.3, 0);
  portalGroup.add(portalDoors);

  const portalGable = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.4, 3), goldMat);
  portalGable.rotation.y = Math.PI / 2;
  portalGable.scale.set(1, 1, 0.32);
  portalGable.position.set(-0.12, 3.85, 0);
  portalGroup.add(portalGable);
  group.add(portalGroup);

  enableSolidLandmarkShadows(group);
  return group;
}

function buildTorreDeCaliLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const curtainTex = createBuildingFacadeTextures(
    'modern_glass',
    0x1e2c3d,
    0xd6c7a8,
  );
  const glassMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: curtainTex.map,
      roughnessMap: curtainTex.roughnessMap,
      roughness: 0.82,
      bumpMap: curtainTex.bumpMap,
      bumpScale: 0.045,
      emissive: 0xffe2b5,
      emissiveMap: curtainTex.emissiveMap,
      emissiveIntensity: 0.45,
      metalness: 0.65,
      envMapIntensity: 1.7,
    }),
    { dayIntensity: 0.45, nightIntensity: 1.65, requireEmissiveMap: true },
  );
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x524f4b,
    roughness: 0.8,
    metalness: 0.2,
  });
  const concreteRibMat = new THREE.MeshStandardMaterial({
    color: 0xddd7cc,
    roughness: 0.72,
    metalness: 0.1,
  });
  concreteRibMat.userData.surfaceRole = 'facade' satisfies SurfaceRole;

  const mullionFinMat = new THREE.MeshStandardMaterial({
    color: 0x162230,
    roughness: 0.18,
    metalness: 0.78,
    envMapIntensity: 1.6,
  });
  const crownSteelMat = new THREE.MeshStandardMaterial({
    color: 0x343a44,
    roughness: 0.32,
    metalness: 0.8,
  });
  const crownGlowMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffe6b3,
      emissive: 0xffc668,
      emissiveIntensity: 0.35,
      roughness: 0.22,
    }),
    { dayIntensity: 0.35, nightIntensity: 1.95 },
  );
  const helipadTex = createHelipadTexture();
  const helipadSurfaceMat = new THREE.MeshStandardMaterial({
    map: helipadTex,
    roughness: 0.74,
    metalness: 0.08,
  });
  const helipadYellowMat = new THREE.MeshStandardMaterial({
    color: 0xf4c424,
    roughness: 0.42,
    metalness: 0.15,
  });
  const helipadWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf4f6fa,
    roughness: 0.48,
  });
  const helipadLightMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0x4cff9b,
      emissive: 0x22ee7a,
      emissiveIntensity: 0.7,
      roughness: 0.18,
    }),
    { dayIntensity: 0.7, nightIntensity: 2.5 },
  );
  const aviationBeaconMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xff3b3b,
      emissive: 0xff2222,
      emissiveIntensity: 1.4,
      roughness: 0.16,
    }),
    { dayIntensity: 1.4, nightIntensity: 3.6 },
  );
  const beaconHaloTex = createSoftGlowPoolTexture(
    'rgba(255, 48, 48, 0.85)',
    'rgba(255, 24, 24, 0.28)',
  );
  const beaconHaloMat = tagNightOpacity(
    new THREE.MeshBasicMaterial({
      map: beaconHaloTex,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    0.16,
    0.74,
  );

  // Grand stepped architectural stone plaza podium
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(21.4, 5.5, 21.4),
    concreteRibMat,
  );
  podium.position.y = 2.75;
  group.add(podium);

  // Three stepped reflective curtain-glass skyscraper tiers with vertical dark-glass mullion fins on all 4 sides
  const tiers = [
    { size: 15.6, height: 30, y: 20.5, finsPerFace: 5 },
    { size: 12.6, height: 24, y: 47.5, finsPerFace: 4 },
    { size: 9.8, height: 17, y: 68.0, finsPerFace: 3 },
  ] as const;

  let mullionIdx = 0;
  for (const tier of tiers) {
    const shaftGeo = createUvScaledBoxGeometry(tier.size, tier.height, tier.size, 8, 16, {
      integerSideRepeat: true,
    });
    const shaft = new THREE.Mesh(shaftGeo, [
      glassMat,
      glassMat,
      roofMat,
      roofMat,
      glassMat,
      glassMat,
    ]);
    shaft.position.y = tier.y;
    group.add(shaft);

    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(tier.size + 0.55, 0.78, tier.size + 0.55),
      concreteRibMat,
    );
    ring.position.y = tier.y + tier.height * 0.5;
    group.add(ring);

    // Crisp vertical dark-glass curtain-wall mullion fins rising along all 4 sides
    const finGeoNS = new THREE.BoxGeometry(0.18, tier.height, 0.36);
    const finGeoEW = new THREE.BoxGeometry(0.36, tier.height, 0.18);
    const halfSpan = tier.size * 0.5 + 0.12;

    for (let i = 0; i < tier.finsPerFace; i += 1) {
      const along =
        ((i + 1) / (tier.finsPerFace + 1) - 0.5) * (tier.size * 0.88);
      for (const side of [-1, 1] as const) {
        const nsFin = new THREE.Mesh(finGeoNS, mullionFinMat);
        nsFin.name = `torre_mullion_fin_${mullionIdx}`;
        nsFin.position.set(along, tier.y, side * halfSpan);
        group.add(nsFin);
        mullionIdx += 1;

        const ewFin = new THREE.Mesh(finGeoEW, mullionFinMat);
        ewFin.name = `torre_mullion_fin_${mullionIdx}`;
        ewFin.position.set(side * halfSpan, tier.y, along);
        group.add(ewFin);
        mullionIdx += 1;
      }
    }
  }

  // Iconic vertical white-concrete modernist structural corner fins
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 56, 0.62), concreteRibMat);
      fin.position.set(sx * 7.85, 33, sz * 7.85);
      group.add(fin);
    }
  }

  // Stepped upper mechanical crown with steel louvers & architectural crown illumination
  const crownGroup = new THREE.Group();
  crownGroup.name = 'torre_mechanical_crown';

  const crownLower = new THREE.Mesh(new THREE.BoxGeometry(10.8, 1.5, 10.8), concreteRibMat);
  crownLower.position.y = 77.2;
  crownGroup.add(crownLower);

  const crownGlowBand = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.34, 10.2), crownGlowMat);
  crownGlowBand.position.y = 78.12;
  crownGroup.add(crownGlowBand);

  const crownUpper = new THREE.Mesh(new THREE.BoxGeometry(9.0, 2.2, 9.0), crownSteelMat);
  crownUpper.position.y = 79.35;
  crownGroup.add(crownUpper);

  const crownParapetNS = new THREE.BoxGeometry(9.4, 0.55, 0.35);
  const crownParapetEW = new THREE.BoxGeometry(0.35, 0.55, 9.4);
  for (const side of [-1, 1] as const) {
    const nsWall = new THREE.Mesh(crownParapetNS, concreteRibMat);
    nsWall.position.set(0, 80.7, side * 4.5);
    crownGroup.add(nsWall);

    const ewWall = new THREE.Mesh(crownParapetEW, concreteRibMat);
    ewWall.position.set(side * 4.5, 80.7, 0);
    crownGroup.add(ewWall);
  }
  group.add(crownGroup);

  // Painted rooftop helipad (H circle) deck & perimeter approach lights
  const helipadGroup = new THREE.Group();
  helipadGroup.name = 'torre_helipad';
  helipadGroup.position.set(0, 80.56, 0);

  const helipadDeck = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 0.22, 6.8),
    [
      crownSteelMat,
      crownSteelMat,
      helipadSurfaceMat,
      crownSteelMat,
      crownSteelMat,
      crownSteelMat,
    ],
  );
  helipadGroup.add(helipadDeck);

  const helipadRing = new THREE.Mesh(
    new THREE.RingGeometry(2.35, 2.75, 28),
    helipadYellowMat,
  );
  helipadRing.rotation.x = -Math.PI / 2;
  helipadRing.position.y = 0.13;
  helipadGroup.add(helipadRing);

  const hBarGeo = new THREE.BoxGeometry(0.38, 0.04, 2.4);
  for (const hx of [-0.75, 0.75] as const) {
    const leg = new THREE.Mesh(hBarGeo, helipadWhiteMat);
    leg.position.set(hx, 0.13, 0);
    helipadGroup.add(leg);
  }
  const hCross = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.38), helipadWhiteMat);
  hCross.position.y = 0.13;
  helipadGroup.add(hCross);

  const cornerLightGeo = new THREE.SphereGeometry(0.16, 8, 8);
  for (const cx of [-3.1, 3.1] as const) {
    for (const cz of [-3.1, 3.1] as const) {
      const lightBulb = new THREE.Mesh(cornerLightGeo, helipadLightMat);
      lightBulb.position.set(cx, 0.22, cz);
      helipadGroup.add(lightBulb);
    }
  }
  group.add(helipadGroup);

  // Twin telecom spires with glowing red aviation warning beacons (intensified at night)
  const spireGeo = new THREE.CylinderGeometry(0.14, 0.34, 12.6, 8);
  const beaconTipGeo = new THREE.SphereGeometry(0.46, 10, 10);
  const haloPlaneGeo = new THREE.PlaneGeometry(3.4, 3.4);

  const beaconOffsets = [
    { offset: -3.25, idx: 1 },
    { offset: 3.25, idx: 2 },
  ] as const;

  for (const b of beaconOffsets) {
    const beaconGroup = new THREE.Group();
    beaconGroup.name = `torre_aviation_beacon_${b.idx}`;
    beaconGroup.position.set(b.offset, 80.5, 0);

    const spire = new THREE.Mesh(spireGeo, crownSteelMat);
    spire.position.y = 6.3;
    beaconGroup.add(spire);

    const tip = new THREE.Mesh(beaconTipGeo, aviationBeaconMat);
    tip.position.y = 12.8;
    beaconGroup.add(tip);

    for (const rotY of [0, Math.PI / 2] as const) {
      const halo = new THREE.Mesh(haloPlaneGeo, beaconHaloMat);
      halo.position.y = 12.8;
      halo.rotation.y = rotY;
      beaconGroup.add(halo);
    }

    group.add(beaconGroup);
  }

  enableSolidLandmarkShadows(group);
  return group;
}

function buildBulevarDelRioLandmark(
  landmark: LandmarkDef,
  sidewalkTex: SidewalkTextureSet,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c6,
    map: sidewalkTex.map,
    bumpMap: sidewalkTex.bumpMap,
    bumpScale: 0.04,
    roughness: 0.88,
  });
  deckMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  // Sleek modern architectural dark-steel arches with warm-amber cove lighting
  const archSteelMat = new THREE.MeshStandardMaterial({
    color: 0x292d34,
    roughness: 0.32,
    metalness: 0.74,
  });
  const archAmberCoveMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffd08a,
      emissive: 0xffae4a,
      emissiveIntensity: 0.95,
      roughness: 0.22,
    }),
    { dayIntensity: 0.95, nightIntensity: 2.2 },
  );
  const lampPostMat = new THREE.MeshStandardMaterial({
    color: 0x262a31,
    roughness: 0.45,
    metalness: 0.72,
  });
  const lampGlobeMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffe4b0,
      emissive: 0xffbf66,
      emissiveIntensity: 1.35,
      roughness: 0.18,
    }),
    { dayIntensity: 1.35, nightIntensity: 2.6 },
  );
  const poolTex = createSoftGlowPoolTexture(
    'rgba(255, 206, 124, 0.5)',
    'rgba(255, 168, 86, 0.16)',
  );
  const poolMat = tagNightOpacity(
    new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    0.2,
    0.55,
  );

  // Riverside stone-tiled boardwalk promenade
  const boardwalk = new THREE.Mesh(
    createUvScaledBoxGeometry(11.6, 0.48, 28, 6, 2, { topBottomTile: 6 }),
    deckMat,
  );
  boardwalk.position.y = 0.24;
  boardwalk.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
  group.add(boardwalk);

  // 5 modern architectural dark-steel & warm-amber illuminated promenade arches
  for (let i = -2; i <= 2; i += 1) {
    const zPos = i * 5.6;
    const archGroup = new THREE.Group();
    archGroup.position.set(0, 0.44, zPos);

    for (const side of [-4.4, 4.4] as const) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 5.4, 0.58), archSteelMat);
      pillar.position.set(side, 2.7, 0);
      archGroup.add(pillar);

      const accentInlay = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 4.4, 0.14),
        archAmberCoveMat,
      );
      accentInlay.position.set(side > 0 ? side - 0.3 : side + 0.3, 2.7, 0);
      archGroup.add(accentInlay);
    }

    const archCurve = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.34, 8, 24, Math.PI),
      archSteelMat,
    );
    archCurve.position.y = 5.2;
    archGroup.add(archCurve);

    const innerGlowCove = new THREE.Mesh(
      new THREE.TorusGeometry(4.06, 0.08, 6, 24, Math.PI),
      archAmberCoveMat,
    );
    innerGlowCove.position.y = 5.2;
    archGroup.add(innerGlowCove);

    group.add(archGroup);
  }

  const poolGeo = new THREE.PlaneGeometry(6.4, 6.4);
  poolGeo.rotateX(-Math.PI / 2);

  // Warm golden boardwalk lamps along both edges
  for (const zPos of [-10, -3.5, 3.5, 10]) {
    for (const xPos of [-5.2, 5.2]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.16, 3.8, 8),
        lampPostMat,
      );
      pole.position.set(xPos, 2.25, zPos);
      group.add(pole);

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 10, 10),
        lampGlobeMat,
      );
      globe.position.set(xPos, 4.3, zPos);
      group.add(globe);

      const glowPool = new THREE.Mesh(poolGeo, poolMat);
      glowPool.position.set(xPos, 0.51, zPos);
      group.add(glowPool);
    }
  }

  enableSolidLandmarkShadows(group);
  return group;
}

function buildEstadioPascualLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const pitchMat = new THREE.MeshStandardMaterial({
    color: 0x168d52,
    roughness: 0.82,
  });
  const pitchStripeMat = new THREE.MeshStandardMaterial({
    color: 0x1ea35f,
    roughness: 0.82,
  });
  const lineMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xf8f7ff,
      emissive: 0xf8f7ff,
      emissiveIntensity: 0.55,
    }),
    { dayIntensity: 0.55, nightIntensity: 1.05 },
  );
  const redBowlMat = new THREE.MeshStandardMaterial({
    color: 0xa6202a,
    roughness: 0.72,
    flatShading: false,
  });
  redBowlMat.userData.surfaceRole = 'facade' satisfies SurfaceRole;
  redBowlMat.userData.photoTintHex = 0xb8353c;

  const whiteRoofMat = new THREE.MeshStandardMaterial({
    color: 0xe6e2da,
    roughness: 0.56,
  });
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x62666e,
    roughness: 0.54,
    metalness: 0.52,
  });
  const floodlightMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xfff8e0,
      emissive: 0xffe8b0,
      emissiveIntensity: 1.55,
      roughness: 0.16,
    }),
    { dayIntensity: 1.55, nightIntensity: 3.4 },
  );
  const beamMat = tagNightOpacity(
    new THREE.MeshBasicMaterial({
      color: 0xfff0c8,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    0.055,
    0.26,
  );

  // Emerald pitch + mowed turf stripes + crisp white soccer markings
  const pitch = new THREE.Mesh(new THREE.BoxGeometry(25, 0.4, 31), pitchMat);
  pitch.position.y = 0.2;
  group.add(pitch);

  for (let s = -2; s <= 2; s += 1) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(24.6, 0.04, 3.0),
      pitchStripeMat,
    );
    stripe.position.set(0, 0.42, s * 6.0);
    group.add(stripe);
  }

  const halfway = new THREE.Mesh(new THREE.BoxGeometry(23, 0.08, 0.35), lineMat);
  halfway.position.y = 0.46;
  group.add(halfway);

  const centerCircle = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.85, 24),
    lineMat,
  );
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.y = 0.47;
  group.add(centerCircle);

  // Curved red/white stadium bowl constructed from 12 radial grandstands
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const sx = Math.cos(angle) * 18.0;
    const sz = Math.sin(angle) * 20.5;

    const stand = new THREE.Group();
    stand.position.set(sx, 0, sz);
    stand.lookAt(0, 0, 0);

    const wall = new THREE.Mesh(new THREE.BoxGeometry(10.5, 11.5, 6.2), redBowlMat);
    wall.position.y = 5.75;
    stand.add(wall);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.85, 7.8), whiteRoofMat);
    canopy.position.set(0, 12.1, 1.2);
    canopy.rotation.x = 0.18;
    stand.add(canopy);

    group.add(stand);
  }

  // 4 bright stadium floodlight towers at corners with downward glare cones
  const corners: readonly [number, number][] = [
    [-19.5, -21.5],
    [19.5, -21.5],
    [-19.5, 21.5],
    [19.5, 21.5],
  ];
  const glareGeo = new THREE.ConeGeometry(8.5, 28, 12, 1, true);
  for (const [cx, cz] of corners) {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.0, 32, 8),
      towerMat,
    );
    tower.position.set(cx, 16, cz);
    group.add(tower);

    const bank = new THREE.Mesh(new THREE.BoxGeometry(5.8, 3.3, 1.0), floodlightMat);
    bank.position.set(cx, 32.5, cz);
    bank.lookAt(0, 2, 0);
    group.add(bank);

    const glare = new THREE.Mesh(glareGeo, beamMat);
    glare.position.set(cx * 0.56, 19.5, cz * 0.56);
    glare.lookAt(0, 0, 0);
    glare.rotateX(-Math.PI / 2);
    group.add(glare);
  }

  enableSolidLandmarkShadows(group);
  return group;
}

function buildSanAntonioLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const stuccoMat = new THREE.MeshStandardMaterial({
    color: 0xf4ead8,
    roughness: 0.86,
  });
  stuccoMat.userData.surfaceRole = 'plaster' satisfies SurfaceRole;
  stuccoMat.userData.photoTintHex = 0xf4ead8;

  const terracottaMat = new THREE.MeshStandardMaterial({
    color: 0xc25e3c,
    roughness: 0.82,
    flatShading: false,
  });
  terracottaMat.userData.surfaceRole = 'roof' satisfies SurfaceRole;

  const warmGlowMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffd57a,
      emissive: 0xffb347,
      emissiveIntensity: 1.25,
      roughness: 0.24,
    }),
    { dayIntensity: 1.25, nightIntensity: 2.4 },
  );
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3620,
    roughness: 0.85,
  });
  const poolTex = createSoftGlowPoolTexture(
    'rgba(255, 206, 118, 0.55)',
    'rgba(255, 164, 82, 0.18)',
  );
  const poolMat = tagNightOpacity(
    new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    0.22,
    0.55,
  );

  // Cobblestone hillside plaza base
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.9 });
  plazaMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
  const plaza = new THREE.Mesh(
    new THREE.BoxGeometry(12.8, 1.4, 10.8),
    plazaMat,
  );
  plaza.position.set(0, -0.35, 0);
  group.add(plaza);

  // Whitewashed colonial chapel nave
  const chapelBody = new THREE.Mesh(new THREE.BoxGeometry(8.6, 5.2, 6.2), stuccoMat);
  chapelBody.position.set(-0.5, 2.95, 0);
  group.add(chapelBody);

  // Terracotta tiled pitched gable roof + ridge beam
  for (const side of [-1, 1] as const) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.45, 4.2), terracottaMat);
    slope.position.set(-0.5, 6.45, side * 1.72);
    slope.rotation.x = side * 0.48;
    group.add(slope);
  }
  const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.36, 0.42), terracottaMat);
  ridgeBeam.position.set(-0.5, 7.45, 0);
  group.add(ridgeBeam);

  // Stepped colonial bell gable facing +X toward Cali valley
  const bellGable = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.4, 4.0), stuccoMat);
  bellGable.position.set(3.5, 6.9, 0);
  group.add(bellGable);

  const bellTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 2.2), stuccoMat);
  bellTop.position.set(3.5, 9.6, 0);
  group.add(bellTop);

  const bell = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 8), warmGlowMat);
  bell.position.set(3.5, 8.2, 0);
  group.add(bell);

  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.2), woodMat);
  crossV.position.set(3.5, 11.1, 0);
  group.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), woodMat);
  crossH.position.set(3.5, 11.4, 0);
  group.add(crossH);

  // Wooden colonial chapel doorway & warm glowing lanterns + ground glow pools
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.0, 1.8), woodMat);
  door.position.set(3.85, 1.9, 0);
  group.add(door);

  const poolGeo = new THREE.PlaneGeometry(4.8, 4.8);
  poolGeo.rotateX(-Math.PI / 2);

  for (const side of [-2.4, 2.4] as const) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 8), warmGlowMat);
    lantern.position.set(4.1, 3.6, side);
    group.add(lantern);

    const glowPool = new THREE.Mesh(poolGeo, poolMat);
    glowPool.position.set(4.2, 0.4, side);
    group.add(glowPool);
  }

  enableSolidLandmarkShadows(group);
  return group;
}

function buildLandmarkGroup(
  landmark: LandmarkDef,
  sidewalkTex: SidewalkTextureSet,
): THREE.Group {
  switch (landmark.id) {
    case 'cristo_rey':
      return buildCristoReyLandmark(landmark);
    case 'la_ermita':
      return buildLaErmitaLandmark(landmark);
    case 'torre_de_cali':
      return buildTorreDeCaliLandmark(landmark);
    case 'bulevar_del_rio':
      return buildBulevarDelRioLandmark(landmark, sidewalkTex);
    case 'estadio_pascual':
      return buildEstadioPascualLandmark(landmark);
    case 'san_antonio':
      return buildSanAntonioLandmark(landmark);
  }
}

const PALM_LOCATIONS: readonly Vec2[] = [
  // Bulevar del Río riverside palms
  { x: 20.5, z: -4 },
  { x: 20.5, z: 6 },
  { x: 20.5, z: 16 },
  { x: 20.5, z: 28 },
  { x: 20.5, z: 40 },
  { x: 20.5, z: 52 },
  // Avenida Colombia palms
  { x: 5.5, z: -96 },
  { x: 5.5, z: -78 },
  { x: 5.5, z: -60 },
  { x: 5.5, z: -44 },
  { x: 5.5, z: 34 },
  { x: 5.5, z: 52 },
  { x: 5.5, z: 96 },
  { x: 5.5, z: 118 },
  { x: 5.5, z: 140 },
  // Barrio San Antonio hillside palms (clear of player/car spawns and chapel)
  { x: -105, z: 22 },
  { x: -105, z: 44 },
  { x: -86, z: 20 },
  { x: -78, z: 22 },
  { x: -78, z: 46 },
  { x: -96, z: 44 },
  // Estadio Pascual Guerrero perimeter palms
  { x: 106, z: 94 },
  { x: 106, z: 126 },
  { x: 106, z: 154 },
  { x: 158, z: 94 },
  { x: 158, z: 126 },
  { x: 158, z: 154 },
  { x: 120, z: 94 },
  { x: 144, z: 94 },
];

const JACARANDA_LOCATIONS: readonly Vec2[] = [
  // Bulevar del Río riverside flowering Jacarandas
  { x: 8.5, z: -2 },
  { x: 19.5, z: 24 },
  { x: 8.5, z: 46 },
  { x: 19.5, z: 60 },
  { x: 9.0, z: -48 },
  { x: 19.5, z: -64 },
  { x: 9.0, z: 108 },
  { x: 19.5, z: 132 },
  // Barrio San Antonio hillside shade Jacarandas
  { x: -112, z: 12 },
  { x: -110, z: 50 },
  { x: -82, z: 16 },
  { x: -72, z: 50 },
  // Estadio Pascual Guerrero & park perimeter Jacarandas
  { x: 108, z: 110 },
  { x: 156, z: 110 },
  { x: 108, z: 142 },
  { x: 156, z: 142 },
];

function buildPalmTreesGroup(): THREE.Group {
  const palmsGroup = new THREE.Group();
  palmsGroup.name = 'cali_palms';

  // Multi-segment gracefully curved palm trunk geometries
  const trunkSegGeos = [
    new THREE.CylinderGeometry(0.32, 0.44, 2.3, 9),
    new THREE.CylinderGeometry(0.26, 0.33, 2.2, 9),
    new THREE.CylinderGeometry(0.2, 0.27, 2.1, 9),
    new THREE.CylinderGeometry(0.15, 0.21, 1.9, 9),
  ] as const;

  // Curved two-piece arched frond blades (inner arch + drooping tip)
  const frondInnerGeo = new THREE.ConeGeometry(0.68, 2.5, 5);
  const frondTipGeo = new THREE.ConeGeometry(0.56, 2.4, 5);
  const coconutGeo = new THREE.SphereGeometry(0.21, 7, 7);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x7b5c43,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false,
  });
  trunkMat.userData.surfaceRole = 'palm_bark' satisfies SurfaceRole;

  const coconutMat = new THREE.MeshStandardMaterial({
    color: 0x523620,
    roughness: 0.86,
  });

  const lowerFrondMat = new THREE.MeshStandardMaterial({
    color: 0x3b6e32,
    roughness: 0.72,
    metalness: 0.02,
    flatShading: false,
  });
  lowerFrondMat.userData.surfaceRole = 'palm_leaves' satisfies SurfaceRole;

  const upperFrondMat = new THREE.MeshStandardMaterial({
    color: 0x4d823b,
    roughness: 0.68,
    metalness: 0.02,
    flatShading: false,
  });
  upperFrondMat.userData.surfaceRole = 'palm_leaves' satisfies SurfaceRole;

  PALM_LOCATIONS.forEach((loc, index) => {
    const palm = new THREE.Group();
    palm.name = `palm_${index}`;

    const groundY = getTerrainElevation(loc.x, loc.z);
    const scale = 0.92 + (index % 4) * 0.09;
    palm.position.set(loc.x, groundY, loc.z);
    palm.rotation.y = (index * 1.13) % (Math.PI * 2);
    palm.scale.setScalar(scale);

    // 4-segment smoothly curved palm trunk
    const curveSpecs = [
      { x: 0, y: 1.1, rotZ: 0.04 },
      { x: -0.13, y: 3.18, rotZ: 0.09 },
      { x: -0.37, y: 5.18, rotZ: 0.14 },
      { x: -0.68, y: 7.0, rotZ: 0.19 },
    ] as const;

    curveSpecs.forEach((seg, segIdx) => {
      const geo = trunkSegGeos[segIdx];
      if (!geo) {
        return;
      }
      const mesh = new THREE.Mesh(geo, trunkMat);
      mesh.position.set(seg.x, seg.y, 0);
      mesh.rotation.z = seg.rotZ;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.surfaceRole = 'palm_bark' satisfies SurfaceRole;
      palm.add(mesh);
    });

    const crown = new THREE.Group();
    crown.position.set(-0.88, 7.9, 0);

    // Coconut cluster nestled beneath canopy
    for (let c = 0; c < 4; c += 1) {
      const ca = (c / 4) * Math.PI * 2;
      const nut = new THREE.Mesh(coconutGeo, coconutMat);
      nut.position.set(Math.cos(ca) * 0.28, -0.22, Math.sin(ca) * 0.28);
      crown.add(nut);
    }

    // Lush lower sweeping arched frond ring (9 multi-segment fronds)
    for (let f = 0; f < 9; f += 1) {
      const frondPivot = new THREE.Group();
      frondPivot.rotation.y = (f / 9) * Math.PI * 2;

      const innerBlade = new THREE.Mesh(frondInnerGeo, lowerFrondMat);
      innerBlade.scale.set(0.86, 1.0, 0.22);
      innerBlade.position.set(0, 0.34, 1.15);
      innerBlade.rotation.x = 1.16;
      innerBlade.castShadow = true;
      innerBlade.receiveShadow = true;
      innerBlade.userData.surfaceRole = 'palm_leaves' satisfies SurfaceRole;
      frondPivot.add(innerBlade);

      const outerTip = new THREE.Mesh(frondTipGeo, lowerFrondMat);
      outerTip.scale.set(0.74, 1.0, 0.18);
      outerTip.position.set(0, -0.18, 2.95);
      outerTip.rotation.x = 1.78;
      outerTip.castShadow = true;
      outerTip.receiveShadow = true;
      outerTip.userData.surfaceRole = 'palm_leaves' satisfies SurfaceRole;
      frondPivot.add(outerTip);

      crown.add(frondPivot);
    }

    // Upper arched tropical canopy ring (6 fronds)
    for (let f = 0; f < 6; f += 1) {
      const frondPivot = new THREE.Group();
      frondPivot.rotation.y = (f / 6) * Math.PI * 2 + 0.32;

      const innerBlade = new THREE.Mesh(frondInnerGeo, upperFrondMat);
      innerBlade.scale.set(0.74, 0.9, 0.2);
      innerBlade.position.set(0, 0.78, 0.92);
      innerBlade.rotation.x = 0.78;
      innerBlade.castShadow = true;
      innerBlade.receiveShadow = true;
      innerBlade.userData.surfaceRole = 'palm_leaves' satisfies SurfaceRole;
      frondPivot.add(innerBlade);

      const outerTip = new THREE.Mesh(frondTipGeo, upperFrondMat);
      outerTip.scale.set(0.62, 0.85, 0.16);
      outerTip.position.set(0, 0.65, 2.38);
      outerTip.rotation.x = 1.48;
      outerTip.castShadow = true;
      outerTip.receiveShadow = true;
      outerTip.userData.surfaceRole = 'palm_leaves' satisfies SurfaceRole;
      frondPivot.add(outerTip);

      crown.add(frondPivot);
    }

    palm.add(crown);
    palmsGroup.add(palm);
  });

  // Cali Jacaranda & tropical shade trees with forked woody trunks & rounded flowering canopies
  const jacTrunkGeo = new THREE.CylinderGeometry(0.28, 0.44, 3.6, 8);
  const jacBranchGeo = new THREE.CylinderGeometry(0.14, 0.24, 2.6, 7);
  const canopyGeo = new THREE.IcosahedronGeometry(1.85, 1);

  const jacBarkMat = new THREE.MeshStandardMaterial({
    color: 0x6b5342,
    roughness: 0.94,
    metalness: 0.02,
    flatShading: false,
  });
  jacBarkMat.userData.surfaceRole = 'jacaranda_bark' satisfies SurfaceRole;

  const jacBlossomMat = new THREE.MeshStandardMaterial({
    color: 0x9b82c7,
    roughness: 0.82,
    metalness: 0.02,
    flatShading: false,
  });
  jacBlossomMat.userData.surfaceRole = 'jacaranda_leaves' satisfies SurfaceRole;
  jacBlossomMat.userData.photoTintHex = 0xbaa4df;

  const jacGreenMat = new THREE.MeshStandardMaterial({
    color: 0x4b783c,
    roughness: 0.8,
    metalness: 0.02,
    flatShading: false,
  });
  jacGreenMat.userData.surfaceRole = 'jacaranda_leaves' satisfies SurfaceRole;
  jacGreenMat.userData.photoTintHex = 0x7ca662;

  const clusterOffsets: readonly { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [
    { x: 0, y: 5.7, z: 0, sx: 1.35, sy: 0.92, sz: 1.35 },
    { x: 1.55, y: 5.05, z: 0.85, sx: 1.05, sy: 0.82, sz: 1.05 },
    { x: -1.48, y: 5.15, z: 0.72, sx: 1.08, sy: 0.84, sz: 1.02 },
    { x: 0.38, y: 5.0, z: -1.52, sx: 1.05, sy: 0.8, sz: 1.05 },
    { x: -0.65, y: 6.25, z: -0.35, sx: 0.96, sy: 0.76, sz: 0.96 },
  ];

  JACARANDA_LOCATIONS.forEach((loc, index) => {
    const tree = new THREE.Group();
    tree.name = `jacaranda_${index}`;
    const groundY = getTerrainElevation(loc.x, loc.z);
    const scale = 0.88 + (index % 3) * 0.11;
    tree.position.set(loc.x, groundY, loc.z);
    tree.rotation.y = (index * 1.47) % (Math.PI * 2);
    tree.scale.setScalar(scale);

    const trunk = new THREE.Mesh(jacTrunkGeo, jacBarkMat);
    trunk.position.set(0, 1.8, 0);
    trunk.rotation.z = 0.04;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    trunk.userData.surfaceRole = 'jacaranda_bark' satisfies SurfaceRole;
    tree.add(trunk);

    for (let b = 0; b < 3; b += 1) {
      const ba = (b / 3) * Math.PI * 2 + 0.4;
      const branch = new THREE.Mesh(jacBranchGeo, jacBarkMat);
      branch.position.set(Math.cos(ba) * 0.58, 3.85, Math.sin(ba) * 0.58);
      branch.rotation.z = -Math.cos(ba) * 0.46;
      branch.rotation.x = Math.sin(ba) * 0.46;
      branch.castShadow = true;
      branch.receiveShadow = true;
      branch.userData.surfaceRole = 'jacaranda_bark' satisfies SurfaceRole;
      tree.add(branch);
    }

    const leafMat = index % 2 === 0 ? jacBlossomMat : jacGreenMat;
    for (const cluster of clusterOffsets) {
      const puff = new THREE.Mesh(canopyGeo, leafMat);
      puff.position.set(cluster.x, cluster.y, cluster.z);
      puff.scale.set(cluster.sx, cluster.sy, cluster.sz);
      puff.castShadow = true;
      puff.receiveShadow = true;
      puff.userData.surfaceRole = 'jacaranda_leaves' satisfies SurfaceRole;
      tree.add(puff);
    }

    palmsGroup.add(tree);
  });

  return palmsGroup;
}

interface PhotoRoleProfile {
  readonly textureSet: PhotoPbrMaterialMaps | null;
  readonly repeatX: number;
  readonly repeatY: number;
  readonly defaultTintHex: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly normalScale: number;
  readonly envMapIntensity: number;
  readonly clearEmissive?: boolean;
}

function buildPhotoRoleProfiles(
  textures: LoadedWorldTextureSets,
): Record<SurfaceRole, PhotoRoleProfile> {
  return {
    asphalt: {
      textureSet: textures.asphalt,
      repeatX: 2.0,
      repeatY: 2.0,
      defaultTintHex: 0xd4d2ce,
      roughness: 0.92,
      metalness: 0.05,
      normalScale: 0.85,
      envMapIntensity: 0.85,
    },
    sidewalk: {
      textureSet: textures.sidewalk,
      repeatX: 1.25,
      repeatY: 1.25,
      defaultTintHex: 0xdedbd4,
      roughness: 0.94,
      metalness: 0.04,
      normalScale: 0.8,
      envMapIntensity: 0.65,
    },
    terrain: {
      textureSet: textures.terrain,
      repeatX: 24,
      repeatY: 24,
      defaultTintHex: 0xd8d6cc,
      roughness: 1.0,
      metalness: 0.02,
      normalScale: 1.0,
      envMapIntensity: 0.55,
    },
    plaster: {
      textureSet: textures.plaster,
      repeatX: 1.5,
      repeatY: 1.5,
      defaultTintHex: 0xf4ead8,
      roughness: 0.95,
      metalness: 0.02,
      normalScale: 0.75,
      envMapIntensity: 0.6,
      clearEmissive: true,
    },
    roof: {
      textureSet: textures.roof,
      repeatX: 3.0,
      repeatY: 2.0,
      defaultTintHex: 0xc96644,
      roughness: 0.88,
      metalness: 0.04,
      normalScale: 1.0,
      envMapIntensity: 0.6,
    },
    facade: {
      textureSet: textures.facade,
      repeatX: 1.5,
      repeatY: 1.5,
      defaultTintHex: 0xdad4ca,
      roughness: 0.92,
      metalness: 0.06,
      normalScale: 0.85,
      envMapIntensity: 0.75,
      clearEmissive: true,
    },
    palm_bark: {
      textureSet: textures.palmBark,
      repeatX: 1.0,
      repeatY: 3.0,
      defaultTintHex: 0xc8b29b,
      roughness: 0.95,
      metalness: 0.02,
      normalScale: 1.1,
      envMapIntensity: 0.5,
    },
    palm_leaves: {
      textureSet: textures.palmLeaves,
      repeatX: 1.5,
      repeatY: 1.5,
      defaultTintHex: 0x8ab86e,
      roughness: 0.78,
      metalness: 0.02,
      normalScale: 0.7,
      envMapIntensity: 0.65,
    },
    jacaranda_bark: {
      textureSet: textures.jacarandaBark,
      repeatX: 1.0,
      repeatY: 2.0,
      defaultTintHex: 0xb89f88,
      roughness: 0.96,
      metalness: 0.02,
      normalScale: 1.0,
      envMapIntensity: 0.5,
    },
    jacaranda_leaves: {
      textureSet: textures.jacarandaLeaves,
      repeatX: 2.0,
      repeatY: 2.0,
      defaultTintHex: 0xa090c8,
      roughness: 0.82,
      metalness: 0.02,
      normalScale: 0.8,
      envMapIntensity: 0.6,
    },
  };
}

function isSurfaceRole(value: unknown): value is SurfaceRole {
  return (
    value === 'asphalt' ||
    value === 'sidewalk' ||
    value === 'terrain' ||
    value === 'plaster' ||
    value === 'roof' ||
    value === 'facade' ||
    value === 'palm_bark' ||
    value === 'palm_leaves' ||
    value === 'jacaranda_bark' ||
    value === 'jacaranda_leaves'
  );
}

/**
 * Upgrades tagged Cali world meshes in-place with loaded 1K photographic PBR texture sets
 * (albedo + OpenGL normal + roughness). Any `null` texture slot is skipped safely while
 * retaining its procedural fallback; obsolete replaced procedural textures are disposed cleanly.
 */
export function applyPhotographicAssets(
  worldGroup: THREE.Group,
  textures: LoadedWorldTextureSets,
): void {
  const profiles = buildPhotoRoleProfiles(textures);

  // Configure per-role tiling repeats on each loaded photographic PBR set
  for (const profile of Object.values(profiles)) {
    const texSet = profile.textureSet;
    if (!texSet) {
      continue;
    }
    for (const tex of [texSet.map, texSet.normalMap, texSet.roughnessMap]) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(profile.repeatX, profile.repeatY);
      tex.needsUpdate = true;
    }
  }

  const upgradedMaterials = new Set<THREE.Material>();
  const replacedProceduralTextures = new Set<THREE.Texture>();
  const loadedPhotoTextures = new Set<THREE.Texture>();
  for (const profile of Object.values(profiles)) {
    if (profile.textureSet) {
      loadedPhotoTextures.add(profile.textureSet.map);
      loadedPhotoTextures.add(profile.textureSet.normalMap);
      loadedPhotoTextures.add(profile.textureSet.roughnessMap);
    }
  }

  worldGroup.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const meshRole = isSurfaceRole(node.userData.surfaceRole)
      ? node.userData.surfaceRole
      : undefined;
    const materials = Array.isArray(node.material) ? node.material : [node.material];

    for (const mat of materials) {
      if (!(mat instanceof THREE.MeshStandardMaterial) || upgradedMaterials.has(mat)) {
        continue;
      }

      const role = isSurfaceRole(mat.userData.surfaceRole)
        ? mat.userData.surfaceRole
        : meshRole;
      if (!role) {
        continue;
      }

      const profile = profiles[role];
      const texSet = profile.textureSet;
      if (!texSet) {
        continue;
      }

      // Collect previous procedural textures for safe orphan cleanup
      for (const prevTex of [mat.map, mat.bumpMap, mat.roughnessMap, mat.normalMap]) {
        if (prevTex && !loadedPhotoTextures.has(prevTex)) {
          replacedProceduralTextures.add(prevTex);
        }
      }

      mat.map = texSet.map;
      mat.normalMap = texSet.normalMap;
      mat.normalScale.set(profile.normalScale, profile.normalScale);
      mat.bumpMap = null;
      mat.roughnessMap = texSet.roughnessMap;
      mat.roughness = profile.roughness;
      mat.metalness = profile.metalness;
      mat.envMapIntensity = profile.envMapIntensity;
      mat.flatShading = false;

      if (profile.clearEmissive && mat.emissiveMap) {
        if (!loadedPhotoTextures.has(mat.emissiveMap)) {
          replacedProceduralTextures.add(mat.emissiveMap);
        }
        mat.emissiveMap = null;
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }

      const customTint = mat.userData.photoTintHex;
      if (typeof customTint === 'number') {
        mat.color.setHex(customTint);
      } else {
        mat.color.setHex(profile.defaultTintHex);
      }

      mat.needsUpdate = true;
      upgradedMaterials.add(mat);
    }
  });

  // Dispose only replaced procedural textures that are no longer referenced anywhere in worldGroup
  const stillReferenced = new Set<THREE.Texture>();
  worldGroup.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) {
        continue;
      }
      if (mat.map) stillReferenced.add(mat.map);
      if (mat.bumpMap) stillReferenced.add(mat.bumpMap);
      if (mat.roughnessMap) stillReferenced.add(mat.roughnessMap);
      if (mat.normalMap) stillReferenced.add(mat.normalMap);
      if (mat.emissiveMap) stillReferenced.add(mat.emissiveMap);
    }
  });

  for (const oldTex of replacedProceduralTextures) {
    if (!stillReferenced.has(oldTex)) {
      oldTex.dispose();
    }
  }
}

interface MioShelterSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

interface BenchSpec {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

interface RoadPuddleSpec {
  readonly x: number;
  readonly z: number;
  readonly scaleX: number;
  readonly scaleZ: number;
  readonly rotationY: number;
  readonly variant: 0 | 1 | 2;
}

const MIO_SHELTER_SPECS: readonly MioShelterSpec[] = [
  { id: 'av_colombia_centro', x: -15.4, z: -54, yaw: Math.PI / 2 },
  { id: 'av_colombia_bulevar', x: -15.4, z: 4, yaw: Math.PI / 2 },
  { id: 'calle_5_penon', x: -42, z: 89.2, yaw: Math.PI },
  { id: 'calle_5_estadio', x: 126, z: 65.2, yaw: 0 },
];

const BULEVAR_BENCH_SPECS: readonly BenchSpec[] = [
  { x: 21.0, z: 1.0, yaw: Math.PI / 2 },
  { x: 21.0, z: 11.0, yaw: Math.PI / 2 },
  { x: 21.0, z: 34.0, yaw: Math.PI / 2 },
  { x: 21.0, z: 46.0, yaw: Math.PI / 2 },
  { x: 11.5, z: 32.0, yaw: Math.PI / 2 },
  { x: 15.5, z: 42.0, yaw: -Math.PI / 2 },
  { x: 11.5, z: 54.0, yaw: Math.PI / 2 },
  { x: 15.5, z: -9.5, yaw: -Math.PI / 2 },
  { x: 14.0, z: -42.0, yaw: Math.PI / 2 },
  { x: 14.0, z: -58.0, yaw: Math.PI / 2 },
  { x: 14.0, z: 102.0, yaw: Math.PI / 2 },
  { x: 14.0, z: 122.0, yaw: Math.PI / 2 },
];

const SIDEWALK_BOLLARD_COORDS: readonly Vec2[] = [
  // Bulevar del Río west curb along Avenida Colombia (clear of free_roam spawn at 6, 14)
  { x: 5.2, z: -13 },
  { x: 5.2, z: -4 },
  { x: 5.2, z: 0 },
  { x: 5.2, z: 4 },
  { x: 5.2, z: 20 },
  { x: 5.2, z: 24 },
  { x: 5.2, z: 39 },
  { x: 5.2, z: 43 },
  { x: 5.2, z: 57 },
  { x: 5.2, z: 61 },
  // Bulevar del Río riverside embankment edge
  { x: 22.3, z: -11 },
  { x: 22.3, z: 1 },
  { x: 22.3, z: 11 },
  { x: 22.3, z: 21 },
  { x: 22.3, z: 33 },
  { x: 22.3, z: 45 },
  { x: 22.3, z: 51 },
  { x: 22.3, z: 61 },
  // Avenida Colombia downtown west sidewalk safety curb
  { x: -13.6, z: -72 },
  { x: -13.6, z: -50 },
  { x: -13.6, z: -38 },
  { x: -13.6, z: -10 },
  { x: -13.6, z: 10 },
  { x: -13.6, z: 22 },
  { x: -13.6, z: 48 },
  { x: -13.6, z: 60 },
];

const BULEVAR_PLANTER_COORDS: readonly Vec2[] = [
  // Grounding the riverside promenade palms
  { x: 20.5, z: -4 },
  { x: 20.5, z: 6 },
  { x: 20.5, z: 16 },
  { x: 20.5, z: 28 },
  { x: 20.5, z: 40 },
  { x: 20.5, z: 52 },
  // Decorative promenade planter islands
  { x: 12.0, z: 38.0 },
  { x: 12.0, z: 50.0 },
  { x: 12.0, z: -10.5 },
  { x: 12.0, z: -52.0 },
];

const ROAD_PUDDLE_SPECS: readonly RoadPuddleSpec[] = [
  // Bulevar del Río / Avenida Colombia flat stretch
  { x: -7.2, z: 6.0, scaleX: 2.9, scaleZ: 2.1, rotationY: 0.4, variant: 0 },
  { x: -1.2, z: 18.5, scaleX: 3.4, scaleZ: 2.3, rotationY: 1.1, variant: 1 },
  { x: -6.8, z: 30.0, scaleX: 2.6, scaleZ: 1.9, rotationY: 2.2, variant: 2 },
  { x: -0.8, z: 48.0, scaleX: 3.6, scaleZ: 2.4, rotationY: 0.7, variant: 0 },
  // Iglesia La Ermita plaza roadway (Carrera 1)
  { x: 56.5, z: -26.5, scaleX: 3.2, scaleZ: 2.5, rotationY: 0.25, variant: 1 },
  { x: 60.8, z: -19.5, scaleX: 2.8, scaleZ: 2.0, rotationY: 1.65, variant: 2 },
  { x: 55.8, z: -8.0, scaleX: 3.1, scaleZ: 2.2, rotationY: 2.8, variant: 0 },
  { x: 60.2, z: 6.5, scaleX: 2.5, scaleZ: 1.8, rotationY: 0.9, variant: 1 },
  // Downtown Calle 5 x Avenida Colombia & Calle 13 x Avenida Colombia intersections
  { x: -6.5, z: 74.5, scaleX: 3.8, scaleZ: 2.6, rotationY: 0.35, variant: 2 },
  { x: 0.8, z: 80.2, scaleX: 3.1, scaleZ: 2.2, rotationY: 1.9, variant: 0 },
  { x: -18.5, z: 75.5, scaleX: 2.9, scaleZ: 2.0, rotationY: 2.4, variant: 1 },
  { x: 14.0, z: 79.0, scaleX: 2.7, scaleZ: 1.9, rotationY: 0.6, variant: 2 },
  { x: -7.4, z: -21.5, scaleX: 3.5, scaleZ: 2.5, rotationY: 1.2, variant: 0 },
  { x: 1.2, z: -26.5, scaleX: 2.8, scaleZ: 2.1, rotationY: 2.1, variant: 1 },
  { x: -2.0, z: -52.0, scaleX: 3.2, scaleZ: 2.2, rotationY: 0.85, variant: 2 },
  { x: 59.5, z: 75.2, scaleX: 3.4, scaleZ: 2.4, rotationY: 1.5, variant: 0 },
];

function createMioCurvedCanopyGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.92, 0.0);
  shape.quadraticCurveTo(0.0, 0.44, 0.96, 0.08);
  shape.lineTo(0.96, 0.2);
  shape.quadraticCurveTo(0.0, 0.56, -0.92, 0.12);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 4.6,
    bevelEnabled: false,
    curveSegments: 10,
  });
  // Rotate so length runs along X (-2.3..+2.3) and front edge (+0.96) aligns with +Z fascia
  geo.translate(0, 0, -2.3);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

function createOrganicPuddleGeometry(variant: 0 | 1 | 2): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const points = 28;
  const phaseA = variant * 1.35;
  const phaseB = variant * 2.1 + 0.7;

  for (let i = 0; i <= points; i += 1) {
    const theta = (i / points) * Math.PI * 2;
    const radius =
      1.0 +
      0.22 * Math.sin(theta * 2 + phaseA) +
      0.14 * Math.cos(theta * 3 - phaseB) +
      0.08 * Math.sin(theta * 5 + phaseA * 0.6);
    const px = Math.cos(theta) * radius;
    const py = Math.sin(theta) * radius;
    if (i === 0) {
      shape.moveTo(px, py);
    } else {
      shape.lineTo(px, py);
    }
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function buildStreetPropsGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_street_props';

  const sidewalkTopY = 0.28;

  // Shared materials for MIO shelters, benches, bollards, and planters
  const steelFrameMat = new THREE.MeshStandardMaterial({
    color: 0x252e3b,
    roughness: 0.36,
    metalness: 0.78,
  });
  const mioWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf0f4f8,
    roughness: 0.44,
    metalness: 0.14,
  });
  const mioBlueMat = new THREE.MeshStandardMaterial({
    color: 0x0c5cc8,
    roughness: 0.38,
    metalness: 0.22,
  });
  const tintedGlassMat = new THREE.MeshStandardMaterial({
    color: 0x16293d,
    roughness: 0.08,
    metalness: 0.36,
    transparent: true,
    opacity: 0.54,
    envMapIntensity: 1.5,
  });
  const mioSignTex = createMioSignTexture();
  const mioSignMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: mioSignTex,
      emissive: 0x5cc8ff,
      emissiveMap: mioSignTex,
      emissiveIntensity: 0.9,
      roughness: 0.22,
    }),
    { dayIntensity: 0.9, nightIntensity: 2.35 },
  );
  const benchWoodMat = new THREE.MeshStandardMaterial({
    color: 0x8b5531,
    roughness: 0.74,
    metalness: 0.04,
  });
  const brushedAlumMat = new THREE.MeshStandardMaterial({
    color: 0xbac2cc,
    roughness: 0.32,
    metalness: 0.84,
  });
  const bollardReflectorMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffd066,
      emissive: 0xffb338,
      emissiveIntensity: 0.35,
      roughness: 0.28,
    }),
    { dayIntensity: 0.35, nightIntensity: 1.75 },
  );
  const planterConcreteMat = new THREE.MeshStandardMaterial({
    color: 0xa49c90,
    roughness: 0.88,
    metalness: 0.04,
  });
  planterConcreteMat.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;

  const soilMat = new THREE.MeshStandardMaterial({
    color: 0x3b2c20,
    roughness: 0.96,
  });
  const shrubLeafMat = new THREE.MeshStandardMaterial({
    color: 0x3d7335,
    roughness: 0.74,
    metalness: 0.02,
  });

  // 1. Four iconic Cali MIO Bus Stop Shelters along Avenida Colombia & Calle 5
  const canopyGeo = createMioCurvedCanopyGeometry();
  const shelterPadGeo = new THREE.BoxGeometry(4.8, 0.1, 1.9);
  const shelterPostGeo = new THREE.CylinderGeometry(0.065, 0.075, 2.52, 8);
  const backGlassGeo = new THREE.BoxGeometry(4.2, 2.05, 0.06);
  const sideGlassGeo = new THREE.BoxGeometry(0.06, 2.05, 1.32);
  const mioFasciaGeo = new THREE.BoxGeometry(4.65, 0.22, 0.14);
  const signHousingGeo = new THREE.BoxGeometry(2.55, 0.72, 0.18);
  const signFaceGeo = new THREE.PlaneGeometry(2.42, 0.62);
  const shelterSeatGeo = new THREE.BoxGeometry(2.8, 0.09, 0.44);
  const shelterBenchLegGeo = new THREE.BoxGeometry(0.08, 0.44, 0.38);

  for (const spec of MIO_SHELTER_SPECS) {
    const shelter = new THREE.Group();
    shelter.name = `mio_shelter_${spec.id}`;
    const groundY = getTerrainElevation(spec.x, spec.z) + sidewalkTopY;
    shelter.position.set(spec.x, groundY, spec.z);
    shelter.rotation.y = spec.yaw;

    const pad = new THREE.Mesh(shelterPadGeo, planterConcreteMat);
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    shelter.add(pad);

    for (const px of [-2.1, 0, 2.1] as const) {
      const post = new THREE.Mesh(shelterPostGeo, steelFrameMat);
      post.position.set(px, 1.32, -0.78);
      post.castShadow = true;
      shelter.add(post);
    }

    const backGlass = new THREE.Mesh(backGlassGeo, tintedGlassMat);
    backGlass.position.set(0, 1.36, -0.72);
    shelter.add(backGlass);

    for (const sx of [-2.12, 2.12] as const) {
      const sideGlass = new THREE.Mesh(sideGlassGeo, tintedGlassMat);
      sideGlass.position.set(sx, 1.36, -0.06);
      shelter.add(sideGlass);
    }

    const canopy = new THREE.Mesh(canopyGeo, mioWhiteMat);
    canopy.position.set(0, 2.48, 0.06);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    shelter.add(canopy);

    const fascia = new THREE.Mesh(mioFasciaGeo, mioBlueMat);
    fascia.position.set(0, 2.6, 0.96);
    fascia.castShadow = true;
    shelter.add(fascia);

    const signGroup = new THREE.Group();
    signGroup.name = `mio_shelter_sign_${spec.id}`;
    signGroup.position.set(0, 3.02, 0.88);
    const housing = new THREE.Mesh(signHousingGeo, mioBlueMat);
    housing.castShadow = true;
    signGroup.add(housing);

    const frontSign = new THREE.Mesh(signFaceGeo, mioSignMat);
    frontSign.position.z = 0.095;
    signGroup.add(frontSign);

    const backSign = new THREE.Mesh(signFaceGeo, mioSignMat);
    backSign.position.z = -0.095;
    backSign.rotation.y = Math.PI;
    signGroup.add(backSign);
    shelter.add(signGroup);

    const waitSeat = new THREE.Mesh(shelterSeatGeo, benchWoodMat);
    waitSeat.position.set(0, 0.5, -0.38);
    waitSeat.castShadow = true;
    shelter.add(waitSeat);

    for (const lx of [-1.1, 1.1] as const) {
      const leg = new THREE.Mesh(shelterBenchLegGeo, steelFrameMat);
      leg.position.set(lx, 0.26, -0.38);
      shelter.add(leg);
    }

    group.add(shelter);
  }

  // 2. Bulevar del Río wooden promenade benches
  const benchSeatGeo = new THREE.BoxGeometry(2.1, 0.08, 0.46);
  const benchBackGeo = new THREE.BoxGeometry(2.1, 0.4, 0.07);
  const benchLegGeo = new THREE.BoxGeometry(0.08, 0.46, 0.44);
  const benchArmGeo = new THREE.BoxGeometry(0.07, 0.24, 0.44);

  BULEVAR_BENCH_SPECS.forEach((spec, idx) => {
    const bench = new THREE.Group();
    bench.name = `bulevar_bench_${idx}`;
    const groundY = getTerrainElevation(spec.x, spec.z) + sidewalkTopY;
    bench.position.set(spec.x, groundY, spec.z);
    bench.rotation.y = spec.yaw;

    const seat = new THREE.Mesh(benchSeatGeo, benchWoodMat);
    seat.position.set(0, 0.46, 0);
    seat.castShadow = true;
    seat.receiveShadow = true;
    bench.add(seat);

    const back = new THREE.Mesh(benchBackGeo, benchWoodMat);
    back.position.set(0, 0.76, -0.2);
    back.rotation.x = -0.18;
    back.castShadow = true;
    bench.add(back);

    for (const lx of [-0.88, 0.88] as const) {
      const leg = new THREE.Mesh(benchLegGeo, steelFrameMat);
      leg.position.set(lx, 0.23, 0);
      leg.castShadow = true;
      bench.add(leg);

      const arm = new THREE.Mesh(benchArmGeo, steelFrameMat);
      arm.position.set(lx, 0.62, -0.02);
      bench.add(arm);
    }

    group.add(bench);
  });

  // 3. Architectural metal sidewalk bollards with night-reflective bands
  const bollardBodyGeo = new THREE.CylinderGeometry(0.095, 0.11, 0.88, 8);
  const bollardCollarGeo = new THREE.CylinderGeometry(0.104, 0.104, 0.08, 8);
  const bollardCapGeo = new THREE.SphereGeometry(0.095, 8, 6);

  SIDEWALK_BOLLARD_COORDS.forEach((coord, idx) => {
    const bollard = new THREE.Group();
    bollard.name = `sidewalk_bollard_${idx}`;
    const groundY = getTerrainElevation(coord.x, coord.z) + sidewalkTopY;
    bollard.position.set(coord.x, groundY, coord.z);

    const body = new THREE.Mesh(bollardBodyGeo, steelFrameMat);
    body.position.y = 0.44;
    body.castShadow = true;
    body.receiveShadow = true;
    bollard.add(body);

    const reflector = new THREE.Mesh(bollardCollarGeo, bollardReflectorMat);
    reflector.position.y = 0.74;
    bollard.add(reflector);

    const cap = new THREE.Mesh(bollardCapGeo, brushedAlumMat);
    cap.position.y = 0.88;
    bollard.add(cap);

    group.add(bollard);
  });

  // 4. Concrete urban palm planters lining Bulevar del Río promenade
  const planterBoxGeo = new THREE.BoxGeometry(1.72, 0.56, 1.72);
  const planterRimGeo = new THREE.BoxGeometry(1.88, 0.12, 1.88);
  const planterSoilGeo = new THREE.BoxGeometry(1.48, 0.08, 1.48);
  const fernTuftGeo = new THREE.ConeGeometry(0.32, 0.52, 5);

  BULEVAR_PLANTER_COORDS.forEach((coord, idx) => {
    const planter = new THREE.Group();
    planter.name = `bulevar_planter_${idx}`;
    const groundY = getTerrainElevation(coord.x, coord.z) + sidewalkTopY;
    planter.position.set(coord.x, groundY, coord.z);

    const box = new THREE.Mesh(planterBoxGeo, planterConcreteMat);
    box.position.y = 0.28;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
    planter.add(box);

    const rim = new THREE.Mesh(planterRimGeo, planterConcreteMat);
    rim.position.y = 0.58;
    rim.castShadow = true;
    rim.receiveShadow = true;
    rim.userData.surfaceRole = 'sidewalk' satisfies SurfaceRole;
    planter.add(rim);

    const soil = new THREE.Mesh(planterSoilGeo, soilMat);
    soil.position.y = 0.54;
    planter.add(soil);

    for (let f = 0; f < 4; f += 1) {
      const angle = (f / 4) * Math.PI * 2 + 0.4;
      const tuft = new THREE.Mesh(fernTuftGeo, shrubLeafMat);
      tuft.position.set(Math.cos(angle) * 0.46, 0.72, Math.sin(angle) * 0.46);
      tuft.rotation.z = -Math.cos(angle) * 0.35;
      tuft.rotation.x = Math.sin(angle) * 0.35;
      planter.add(tuft);
    }

    group.add(planter);
  });

  return group;
}

function buildRoadPuddlesGroup(map: CaliMapConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_road_puddles';

  const puddleGeometries: readonly THREE.BufferGeometry[] = [
    createOrganicPuddleGeometry(0),
    createOrganicPuddleGeometry(1),
    createOrganicPuddleGeometry(2),
  ];

  const puddleMat = tagNightEmissive(
    new THREE.MeshStandardMaterial({
      color: 0x1e252e,
      roughness: 0.04,
      metalness: 0.28,
      envMapIntensity: 2.2,
      transparent: true,
      opacity: 0.44,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    }),
    {
      dayIntensity: 0,
      nightIntensity: 0.08,
      dayEmissiveHex: 0x000000,
      nightEmissiveHex: 0x18263d,
    },
  );

  ROAD_PUDDLE_SPECS.forEach((spec, idx) => {
    const geo = puddleGeometries[spec.variant] ?? puddleGeometries[0];
    if (!geo) {
      return;
    }
    const mesh = new THREE.Mesh(geo, puddleMat);
    mesh.name = `road_puddle_${idx}`;
    const surfaceY =
      getRoadSurfaceElevation(spec.x, spec.z, map) + NS_ROAD_TIER_OFFSET + 0.02;
    mesh.position.set(spec.x, surfaceY, spec.z);
    mesh.scale.set(spec.scaleX, 1, spec.scaleZ);
    mesh.rotation.y = spec.rotationY;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  });

  return group;
}

function isNightEmissiveSpec(value: unknown): value is NightEmissiveSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.dayIntensity === 'number' && typeof rec.nightIntensity === 'number'
  );
}

function isNightOpacitySpec(value: unknown): value is NightOpacitySpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.dayOpacity === 'number' && typeof rec.nightOpacity === 'number'
  );
}

function isNightLightSpec(value: unknown): value is NightLightSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.dayIntensity === 'number' && typeof rec.nightIntensity === 'number'
  );
}

/**
 * Switches Cali world emissive architectural lighting, neon signs, streetlamps & road light pools,
 * Estadio Pascual Guerrero floodlights, Cristo Rey monument uplight glow, and Río Cali GLSL water
 * uniforms seamlessly between golden hour and starlit midnight Cali.
 */
export function setWorldNightLighting(
  worldGroup: THREE.Group,
  waterMesh: THREE.Mesh,
  timeOfDay: TimeOfDay,
): void {
  const isNight = timeOfDay === 'night';
  const visited = new Set<THREE.Material>();

  worldGroup.traverse((node) => {
    if (node instanceof THREE.Light) {
      const lightSpec = node.userData.nightLight;
      if (isNightLightSpec(lightSpec)) {
        node.intensity = isNight ? lightSpec.nightIntensity : lightSpec.dayIntensity;
      }
      return;
    }
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const mat of materials) {
      if (!mat || visited.has(mat)) {
        continue;
      }
      visited.add(mat);

      if (mat instanceof THREE.MeshStandardMaterial) {
        const spec = mat.userData.nightEmissive;
        if (isNightEmissiveSpec(spec)) {
          if (spec.requireEmissiveMap && !mat.emissiveMap) {
            continue;
          }
          mat.emissiveIntensity = isNight
            ? spec.nightIntensity
            : spec.dayIntensity;
          if (isNight && typeof spec.nightEmissiveHex === 'number') {
            mat.emissive.setHex(spec.nightEmissiveHex);
          } else if (!isNight && typeof spec.dayEmissiveHex === 'number') {
            mat.emissive.setHex(spec.dayEmissiveHex);
          }
        }
      } else if (mat instanceof THREE.MeshBasicMaterial) {
        const spec = mat.userData.nightOpacity;
        if (isNightOpacitySpec(spec)) {
          mat.opacity = isNight ? spec.nightOpacity : spec.dayOpacity;
        }
      }
    }
  });

  const waterMat = waterMesh.material;
  if (waterMat instanceof THREE.ShaderMaterial) {
    const uniforms = waterMat.uniforms;
    if (uniforms.uDeepColor?.value instanceof THREE.Color) {
      uniforms.uDeepColor.value.setHex(isNight ? 0x040917 : 0x10282c);
    }
    if (uniforms.uShallowColor?.value instanceof THREE.Color) {
      uniforms.uShallowColor.value.setHex(isNight ? 0x0c1b36 : 0x234f4a);
    }
    if (uniforms.uSkyHorizonColor?.value instanceof THREE.Color) {
      uniforms.uSkyHorizonColor.value.setHex(isNight ? 0x4a2f5c : 0xf2bc84);
    }
    if (uniforms.uSkyZenithColor?.value instanceof THREE.Color) {
      uniforms.uSkyZenithColor.value.setHex(isNight ? 0x060b1d : 0x2c4a76);
    }
    if (uniforms.uSunDirection?.value instanceof THREE.Vector3) {
      if (isNight) {
        uniforms.uSunDirection.value.set(-0.78, 0.38, -0.22).normalize();
      } else {
        uniforms.uSunDirection.value.set(-0.94, 0.16, -0.14).normalize();
      }
    }
  }
}

/**
 * Builds the complete procedural 3D Santiago de Cali world graph from a CaliMapConfig.
 * Returns the root world group and a direct reference to the animated GLSL Río Cali water mesh.
 */
export function buildCaliWorld(map: CaliMapConfig): CaliWorldBuildResult {
  const worldGroup = new THREE.Group();
  worldGroup.name = 'cali_world';

  const sidewalkTextures = createSidewalkTextures();

  worldGroup.add(buildTerrainMesh(map));

  const { riverGroup, bridgesGroup, waterMesh } = buildRiverAndBridges(map);
  worldGroup.add(riverGroup);
  worldGroup.add(bridgesGroup);

  worldGroup.add(buildRoadsGroup(map));
  worldGroup.add(buildCrosswalksGroup(map));
  worldGroup.add(buildRoadPuddlesGroup(map));
  worldGroup.add(buildSidewalksGroup(map, sidewalkTextures));
  worldGroup.add(buildTrafficSignalsGroup());
  worldGroup.add(buildStreetlightsGroup());
  worldGroup.add(buildStreetPropsGroup());
  worldGroup.add(buildBuildingsGroup(map));
  worldGroup.add(buildNeonSignsGroup(map));

  for (const landmark of map.landmarks) {
    worldGroup.add(buildLandmarkGroup(landmark, sidewalkTextures));
  }

  worldGroup.add(buildPalmTreesGroup());

  return { group: worldGroup, waterMesh };
}
