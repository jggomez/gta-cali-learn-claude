/**
 * Procedural 3D Santiago de Cali world builder:
 * - Displaced Andean hillside & valley terrain from getTerrainElevation()
 * - Animated GLSL Fresnel-reflective Río Cali corridor and neon-railed twin bridge decks
 * - Wet-sheen PBR asphalt roads with UV-scaled lane lines, zebra crosswalks, and raised sidewalks
 * - Cantilevered traffic signals, warm streetlamps with soft ground light pools, and Cali neon signs
 * - Cached PBR architectural buildings (colonial stucco, modern glass, downtown midrise) + rooftops
 * - 6 enhanced iconic named Cali landmarks + two-tier tropical palm trees
 * 100% procedural (zero network fetches; safe in headless Node tests).
 */

import * as THREE from 'three';
import { getTerrainElevation } from '../config/caliMap';
import type {
  AabbCollider,
  BridgeSpan,
  CaliMapConfig,
  LandmarkDef,
  RiverCorridor,
  Vec2,
} from '../types/game';
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

const TERRAIN_EXTENT = 520;
const TERRAIN_SEGMENTS = 104;
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
  return getTerrainElevation(x, z) + 0.08;
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

  const urbanDark = new THREE.Color(0x1b1530);
  const urbanAlt = new THREE.Color(0x231b3d);
  const parkGreen = new THREE.Color(0x1f4e3e);
  const hillsideGreen = new THREE.Color(0x246645);
  const crestGreen = new THREE.Color(0x4a8e4e);
  const colonialEarth = new THREE.Color(0x2f5446);
  const riverBed = new THREE.Color(0x0b253a);

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
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'cali_terrain';
  terrain.receiveShadow = true;
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

  const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
  waterMesh.name = 'rio_cali_water';
  waterMesh.position.set(riverCenterX, river.waterLevel, riverCenterZ);
  riverGroup.add(waterMesh);

  // River concrete embankments + golden promenade edge strip on Bulevar side
  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x342a4f,
    roughness: 0.84,
    metalness: 0.08,
  });
  const westBank = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.2, riverLength),
    bankMat,
  );
  westBank.position.set(river.minX - 0.55, -0.8, riverCenterZ);
  westBank.castShadow = true;
  westBank.receiveShadow = true;
  riverGroup.add(westBank);

  const eastBank = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.2, riverLength),
    bankMat,
  );
  eastBank.position.set(river.maxX + 0.55, -0.8, riverCenterZ);
  eastBank.castShadow = true;
  eastBank.receiveShadow = true;
  riverGroup.add(eastBank);

  const bulevarTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.24, 110),
    new THREE.MeshStandardMaterial({
      color: 0xffb800,
      emissive: 0xffb800,
      emissiveIntensity: 1.15,
      roughness: 0.3,
    }),
  );
  bulevarTrim.position.set(river.minX - 0.6, 0.36, 16);
  riverGroup.add(bulevarTrim);

  // Twin raised bridges with glowing neon-cyan railings
  const bridgesGroup = new THREE.Group();
  bridgesGroup.name = 'cali_bridges';

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x26213d,
    roughness: 0.82,
    metalness: 0.1,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x4b426b,
    roughness: 0.78,
    metalness: 0.08,
  });
  const neonRailMat = new THREE.MeshStandardMaterial({
    color: 0x3ef4ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.55,
    roughness: 0.18,
  });

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
      bridgeNode.add(pier);
    }

    // Raised concrete curbs & glowing neon-cyan railings on both bridge sides
    for (const sideSign of [-1, 1] as const) {
      const railZ = cz + sideSign * (spanZ * 0.5 - 0.45);
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(spanX, 0.75, 0.7),
        concreteMat,
      );
      curb.position.set(cx, bridge.deckElevation + 0.35, railZ);
      curb.castShadow = true;
      curb.receiveShadow = true;
      bridgeNode.add(curb);

      const neonRail = new THREE.Mesh(
        new THREE.BoxGeometry(spanX + 0.4, 0.22, 0.22),
        neonRailMat,
      );
      neonRail.position.set(cx, bridge.deckElevation + 0.92, railZ);
      bridgeNode.add(neonRail);

      // Glowing corner bridge pylons
      for (const endSign of [-1, 1] as const) {
        const pylonX = cx + endSign * (spanX * 0.5 - 0.8);
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(0.95, 3.4, 0.95),
          concreteMat,
        );
        pylon.position.set(pylonX, bridge.deckElevation + 1.6, railZ);
        pylon.castShadow = true;
        pylon.receiveShadow = true;
        bridgeNode.add(pylon);

        const pylonCap = new THREE.Mesh(
          new THREE.BoxGeometry(1.12, 0.38, 1.12),
          neonRailMat,
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
): THREE.BufferGeometry {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(length / 4));
  const dirX = dx / (length || 1);
  const dirZ = dz / (length || 1);
  const perpX = -dirZ;
  const perpZ = dirX;
  const halfW = width * 0.5;

  const positions = new Float32Array((steps + 1) * 2 * 3);
  const uvs = new Float32Array((steps + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const cx = start.x + dx * t;
    const cz = start.z + dz * t;

    const lx = cx - perpX * halfW;
    const lz = cz - perpZ * halfW;
    const rx = cx + perpX * halfW;
    const rz = cz + perpZ * halfW;

    const ly = getRoadSurfaceElevation(lx, lz, map) + yOffset;
    const ry = getRoadSurfaceElevation(rx, rz, map) + yOffset;

    const base = i * 6;
    positions[base] = lx;
    positions[base + 1] = ly;
    positions[base + 2] = lz;
    positions[base + 3] = rx;
    positions[base + 4] = ry;
    positions[base + 5] = rz;

    const vCoord = (t * length) / Math.max(1, uvTileLength);
    const uvBase = i * 4;
    uvs[uvBase] = 0;
    uvs[uvBase + 1] = vCoord;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = vCoord;

    if (i < steps) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
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
    roughness: 1.0,
    metalness: 0.14,
    envMapIntensity: 1.35,
  });
  const medianConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x4e4566,
    roughness: 0.84,
    metalness: 0.08,
  });
  const medianGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xff9f1a,
    emissiveIntensity: 0.95,
    roughness: 0.3,
  });
  const rampGuardMat = new THREE.MeshStandardMaterial({
    color: 0xff5e7e,
    emissive: 0xff5e7e,
    emissiveIntensity: 1.05,
    roughness: 0.28,
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
    const isNorthSouth = Math.abs(dz) > Math.abs(dx);
    const layerOffset = isNorthSouth ? 0.018 : 0;

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
      ),
      asphaltMat,
    );
    surfaceMesh.receiveShadow = true;
    segmentGroup.add(surfaceMesh);

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
        ),
        medianConcreteMat,
      );
      medianBase.receiveShadow = true;
      segmentGroup.add(medianBase);

      const medianStrip = new THREE.Mesh(
        createTerrainRibbonGeometry(
          road.start,
          road.end,
          0.34,
          layerOffset + 0.072,
          map,
          ROAD_TILE_LENGTH_METERS,
        ),
        medianGlowMat,
      );
      segmentGroup.add(medianStrip);
    }

    // Illuminated sunset coral guardrails along mountain ascent ramps
    if (road.isRamp) {
      const perpX = -dirZ;
      const perpZ = dirX;
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
          createTerrainRibbonGeometry(railStart, railEnd, 0.5, 0.72, map),
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
    map: sidewalkTex.map,
    bumpMap: sidewalkTex.bumpMap,
    bumpScale: 0.045,
    roughness: 0.86,
    metalness: 0.06,
    envMapIntensity: 0.72,
  });

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
    color: 0x1e2030,
    roughness: 0.45,
    metalness: 0.76,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe4a8,
    emissive: 0xffc663,
    emissiveIntensity: 2.25,
    roughness: 0.16,
  });
  const poolTex = createSoftGlowPoolTexture(
    'rgba(255, 210, 128, 0.72)',
    'rgba(255, 168, 92, 0.28)',
  );
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

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

interface BuildingSharedMaterials {
  readonly roofMat: THREE.MeshStandardMaterial;
  readonly parapetMat: THREE.MeshStandardMaterial;
  readonly hvacMat: THREE.MeshStandardMaterial;
  readonly storefrontGlassMat: THREE.MeshPhysicalMaterial;
  readonly antennaMat: THREE.MeshStandardMaterial;
  readonly beaconRedMat: THREE.MeshStandardMaterial;
  readonly woodTrimMat: THREE.MeshStandardMaterial;
}

function createBuildingSharedMaterials(): BuildingSharedMaterials {
  return {
    roofMat: new THREE.MeshStandardMaterial({
      color: 0x241f35,
      roughness: 0.9,
      metalness: 0.08,
    }),
    parapetMat: new THREE.MeshStandardMaterial({
      color: 0x3b3354,
      roughness: 0.78,
      metalness: 0.16,
    }),
    hvacMat: new THREE.MeshStandardMaterial({
      color: 0x625d78,
      roughness: 0.56,
      metalness: 0.55,
    }),
    storefrontGlassMat: new THREE.MeshPhysicalMaterial({
      color: 0x10182d,
      roughness: 0.12,
      metalness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    }),
    antennaMat: new THREE.MeshStandardMaterial({
      color: 0x8b95ad,
      roughness: 0.4,
      metalness: 0.82,
    }),
    beaconRedMat: new THREE.MeshStandardMaterial({
      color: 0xff2b4a,
      emissive: 0xff1e3c,
      emissiveIntensity: 2.4,
      roughness: 0.15,
    }),
    woodTrimMat: new THREE.MeshStandardMaterial({
      color: 0x4d2d1c,
      roughness: 0.82,
    }),
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
  accentMat: THREE.Material,
  shared: BuildingSharedMaterials,
): void {
  const wallT = 0.45;
  const parapetH = 0.85;

  // Perimeter concrete roof parapet rim
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

  // Crisp glowing Vice-Sunset architectural crown line
  const crownLine = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.36, 0.28, depth + 0.36),
    accentMat,
  );
  crownLine.position.set(cx, roofY + parapetH + 0.1, cz);
  group.add(crownLine);

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
  const accentHex = bldg.accentHex ?? 0x00f0ff;
  const style = classifyBuildingStyle(bldg);

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

  const facadeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: facadeTex.map,
    roughnessMap: facadeTex.roughnessMap,
    roughness: 1.0,
    bumpMap: facadeTex.bumpMap,
    bumpScale: style === 'modern_glass' ? 0.045 : 0.085,
    emissive: 0xffffff,
    emissiveMap: facadeTex.emissiveMap,
    emissiveIntensity:
      style === 'modern_glass' ? 1.25 : style === 'colonial_stucco' ? 1.05 : 1.18,
    metalness:
      style === 'modern_glass' ? 0.46 : style === 'downtown_midrise' ? 0.16 : 0.06,
    envMapIntensity: style === 'modern_glass' ? 1.35 : 0.9,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 1.35,
    roughness: 0.22,
  });

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

  const roofY = centerY + bldg.height;

  if (style === 'colonial_stucco') {
    // Terracotta pitched colonial roof + timber eaves trim for San Antonio & Oeste houses
    const roofPeak = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(width, depth) * 0.75, 2.9, 4),
      new THREE.MeshStandardMaterial({
        color: accentHex,
        roughness: 0.74,
        flatShading: true,
      }),
    );
    roofPeak.rotation.y = Math.PI / 4;
    roofPeak.scale.set(
      width / Math.max(width, depth),
      1,
      depth / Math.max(width, depth),
    );
    roofPeak.position.set(cx, roofY + 1.45, cz);
    roofPeak.castShadow = true;
    roofPeak.receiveShadow = true;
    group.add(roofPeak);

    const eaves = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.7, 0.3, depth + 0.7),
      shared.woodTrimMat,
    );
    eaves.position.set(cx, roofY + 0.05, cz);
    eaves.castShadow = true;
    eaves.receiveShadow = true;
    group.add(eaves);
  } else {
    // Ground-floor architectural storefront trim & canopy awning
    const canopyY =
      style === 'downtown_midrise'
        ? centerY + Math.min(4.2, Math.max(2.9, bldg.height * 0.23))
        : centerY + 3.6;
    const storefrontCanopy = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.65, 0.24, depth + 0.65),
      shared.parapetMat,
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
      // Corner pilasters & low kickplate keep painted illuminated Cali shopfronts visible
      const pilasterHeight = canopyY - centerY;
      const pilasterGeo = new THREE.BoxGeometry(0.42, pilasterHeight, 0.42);
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const pilaster = new THREE.Mesh(pilasterGeo, shared.storefrontGlassMat);
          pilaster.position.set(
            cx + sx * (width * 0.5 - 0.12),
            centerY + pilasterHeight * 0.5,
            cz + sz * (depth * 0.5 - 0.12),
          );
          pilaster.castShadow = true;
          pilaster.receiveShadow = true;
          group.add(pilaster);
        }
      }
      const kickplate = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.16, 0.42, depth + 0.16),
        shared.storefrontGlassMat,
      );
      kickplate.position.set(cx, centerY + 0.22, cz);
      kickplate.receiveShadow = true;
      group.add(kickplate);
    }

    attachBuildingRooftopDetails(
      group,
      bldg,
      cx,
      cz,
      width,
      depth,
      roofY,
      accentMat,
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
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: signTexture,
      emissive: 0xffffff,
      emissiveMap: signTexture,
      emissiveIntensity: 1.9,
      roughness: 0.2,
      metalness: 0.1,
    });

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
    color: 0x3b3158,
    roughness: 0.84,
  });
  const terraceStoneMat = new THREE.MeshStandardMaterial({
    color: 0xb9b2d1,
    roughness: 0.72,
  });
  const pedestalMat = new THREE.MeshStandardMaterial({
    color: 0xe3def2,
    roughness: 0.62,
  });
  const statueMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0xffebd0,
    emissiveIntensity: 0.52,
    roughness: 0.34,
    flatShading: true,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: landmark.accentHex,
    emissiveIntensity: 1.4,
    roughness: 0.22,
  });
  const uplightBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffd275,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Multi-tier Mirador stone terraces & glowing golden balustrade
  const lowerTerrace = new THREE.Mesh(
    new THREE.CylinderGeometry(13.2, 15.2, 1.4, 20),
    plazaMat,
  );
  lowerTerrace.position.y = 0.4;
  group.add(lowerTerrace);

  const miradorDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(10.8, 12.2, 1.4, 20),
    terraceStoneMat,
  );
  miradorDeck.position.y = 1.65;
  group.add(miradorDeck);

  const miradorRing = new THREE.Mesh(
    new THREE.TorusGeometry(10.7, 0.22, 8, 28),
    goldMat,
  );
  miradorRing.rotation.x = Math.PI / 2;
  miradorRing.position.y = 2.65;
  group.add(miradorRing);

  // Illuminated pedestal terrace & grand front steps facing +X (downtown Cali)
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

  const steps = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 5.6), pedestalMat);
  steps.position.set(4.8, 2.5, 0);
  group.add(steps);

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

  // Warm golden architectural uplight cones around pedestal
  const beamGeo = new THREE.ConeGeometry(4.8, 24, 16, 1, true);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), goldMat);
    lamp.position.set(Math.cos(angle) * 6.4, 2.65, Math.sin(angle) * 6.4);
    group.add(lamp);

    const beam = new THREE.Mesh(beamGeo, uplightBeamMat);
    beam.position.set(Math.cos(angle) * 3.4, 14.5, Math.sin(angle) * 3.4);
    beam.rotation.z = Math.cos(angle) * 0.14;
    beam.rotation.x = -Math.sin(angle) * 0.14;
    group.add(beam);
  }

  enableSolidLandmarkShadows(group);
  return group;
}

function buildLaErmitaLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const ivoryMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0x3b4870,
    emissiveIntensity: 0.25,
    roughness: 0.52,
    flatShading: true,
  });
  const skyBlueMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: 0x2b6cb0,
    emissiveIntensity: 0.5,
    roughness: 0.36,
    metalness: 0.18,
    flatShading: true,
  });
  const roseGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff4fa8,
    emissive: 0xff2e93,
    emissiveIntensity: 1.75,
    roughness: 0.16,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffc83b,
    emissive: 0xffb800,
    emissiveIntensity: 1.35,
    roughness: 0.22,
  });

  // Stone sanctuary plinth
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(17.8, 1.2, 22.4),
    new THREE.MeshStandardMaterial({ color: 0x3a325c, roughness: 0.85 }),
  );
  plinth.position.y = 0.6;
  group.add(plinth);

  // Main ivory neo-gothic nave + flanking buttress piers
  const nave = new THREE.Mesh(new THREE.BoxGeometry(13.5, 12.5, 16.5), ivoryMat);
  nave.position.set(1.2, 7.2, 0);
  group.add(nave);

  for (const bx of [-3.2, 1.2, 5.6]) {
    for (const side of [-8.4, 8.4]) {
      const buttress = new THREE.Mesh(new THREE.BoxGeometry(1.1, 10.5, 1.1), ivoryMat);
      buttress.position.set(bx, 6.2, side);
      group.add(buttress);

      const pinnacle = new THREE.Mesh(new THREE.ConeGeometry(0.62, 3.2, 4), skyBlueMat);
      pinnacle.rotation.y = Math.PI / 4;
      pinnacle.position.set(bx, 13.0, side);
      group.add(pinnacle);
    }
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

  // Iconic twin neo-gothic spires facing west (-X) toward Río Cali
  for (const side of [-4.6, 4.6] as const) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 21, 3.6), ivoryMat);
    tower.position.set(-5.6, 11.4, side);
    group.add(tower);

    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.35, 11.8, 4), skyBlueMat);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(-5.6, 27.6, side);
    group.add(spire);

    const finial = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.4, 0.32), goldMat);
    finial.position.set(-5.6, 34.4, side);
    group.add(finial);
  }

  // Tall lacy central neo-gothic spire
  const centerTower = new THREE.Mesh(new THREE.BoxGeometry(4.4, 24.5, 4.4), ivoryMat);
  centerTower.position.set(-4.2, 13.2, 0);
  group.add(centerTower);

  const centerSpire = new THREE.Mesh(
    new THREE.ConeGeometry(2.95, 15.0, 4),
    ivoryMat,
  );
  centerSpire.rotation.y = Math.PI / 4;
  centerSpire.position.set(-4.2, 32.5, 0);
  group.add(centerSpire);

  const crossVertical = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.35), goldMat);
  crossVertical.position.set(-4.2, 41.0, 0);
  group.add(crossVertical);
  const crossArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1.9), goldMat);
  crossArm.position.set(-4.2, 41.5, 0);
  group.add(crossArm);

  // Luminous circular stained-glass rose window with concentric golden tracery
  const roseOuter = new THREE.Mesh(
    new THREE.TorusGeometry(2.3, 0.32, 8, 24),
    goldMat,
  );
  roseOuter.rotation.y = Math.PI / 2;
  roseOuter.position.set(-6.6, 13.5, 0);
  group.add(roseOuter);

  const roseInnerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.14, 8, 20),
    goldMat,
  );
  roseInnerRing.rotation.y = Math.PI / 2;
  roseInnerRing.position.set(-6.68, 13.5, 0);
  group.add(roseInnerRing);

  const roseGlass = new THREE.Mesh(
    new THREE.CircleGeometry(2.08, 20),
    roseGlowMat,
  );
  roseGlass.rotation.y = -Math.PI / 2;
  roseGlass.position.set(-6.66, 13.5, 0);
  group.add(roseGlass);

  // Illuminated gothic entrance portal
  const portal = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.4, 3.6), goldMat);
  portal.position.set(-6.5, 3.8, 0);
  group.add(portal);

  enableSolidLandmarkShadows(group);
  return group;
}

function buildTorreDeCaliLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const curtainTex = createBuildingFacadeTextures(
    'modern_glass',
    landmark.colorHex,
    landmark.accentHex,
  );
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: curtainTex.map,
    roughnessMap: curtainTex.roughnessMap,
    roughness: 1.0,
    bumpMap: curtainTex.bumpMap,
    bumpScale: 0.05,
    emissive: 0xffffff,
    emissiveMap: curtainTex.emissiveMap,
    emissiveIntensity: 1.35,
    metalness: 0.68,
    envMapIntensity: 1.5,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x1e1638,
    roughness: 0.72,
    metalness: 0.3,
  });
  const cyanMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: landmark.accentHex,
    emissiveIntensity: 1.65,
    roughness: 0.16,
  });
  const magentaMat = new THREE.MeshStandardMaterial({
    color: 0xff2e93,
    emissive: 0xff2e93,
    emissiveIntensity: 1.65,
    roughness: 0.16,
  });

  // Grand stepped plaza podium
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(21.4, 5.5, 21.4),
    new THREE.MeshStandardMaterial({ color: 0x261a45, roughness: 0.65, metalness: 0.25 }),
  );
  podium.position.y = 2.75;
  group.add(podium);

  // Three stepped reflective curtain-glass skyscraper tiers
  const tiers = [
    { size: 15.6, height: 30, y: 20.5 },
    { size: 12.6, height: 24, y: 47.5 },
    { size: 9.8, height: 17, y: 68.0 },
  ] as const;

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
      cyanMat,
    );
    ring.position.y = tier.y + tier.height * 0.5;
    group.add(ring);
  }

  // Vertical cyan corner edge fins
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 56, 0.62), cyanMat);
      fin.position.set(sx * 7.85, 33, sz * 7.85);
      group.add(fin);
    }
  }

  // Glowing cyan/magenta crown & twin telecom spires
  const crownLower = new THREE.Mesh(new THREE.BoxGeometry(10.8, 1.5, 10.8), magentaMat);
  crownLower.position.y = 77.2;
  group.add(crownLower);

  const crownUpper = new THREE.Mesh(new THREE.BoxGeometry(7.4, 2.3, 7.4), cyanMat);
  crownUpper.position.y = 79.0;
  group.add(crownUpper);

  for (const offset of [-1.8, 1.8] as const) {
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.34, 12.0, 8),
      cyanMat,
    );
    spire.position.set(offset, 86.0, 0);
    group.add(spire);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.54, 10, 10), magentaMat);
    tip.position.set(offset, 92.2, 0);
    group.add(tip);
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
    color: 0xd0c2df,
    map: sidewalkTex.map,
    bumpMap: sidewalkTex.bumpMap,
    bumpScale: 0.04,
    roughness: 0.78,
  });
  const archMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0xff2e93,
    emissiveIntensity: 1.05,
    roughness: 0.25,
  });
  const lampPostMat = new THREE.MeshStandardMaterial({
    color: 0x1d1433,
    roughness: 0.55,
    metalness: 0.65,
  });
  const lampGlobeMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: landmark.accentHex,
    emissiveIntensity: 1.7,
    roughness: 0.16,
  });
  const poolTex = createSoftGlowPoolTexture(
    'rgba(255, 200, 96, 0.72)',
    'rgba(255, 94, 126, 0.25)',
  );
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // Riverside tiled boardwalk promenade
  const boardwalk = new THREE.Mesh(
    createUvScaledBoxGeometry(11.6, 0.48, 28, 6, 2, { topBottomTile: 6 }),
    deckMat,
  );
  boardwalk.position.y = 0.24;
  group.add(boardwalk);

  // 5 Vice-Sunset architectural arches spanning the boulevard
  for (let i = -2; i <= 2; i += 1) {
    const zPos = i * 5.6;
    const archGroup = new THREE.Group();
    archGroup.position.set(0, 0.44, zPos);

    for (const side of [-4.4, 4.4] as const) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.4, 0.65), archMat);
      pillar.position.set(side, 2.7, 0);
      archGroup.add(pillar);
    }

    const archCurve = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.36, 8, 20, Math.PI),
      archMat,
    );
    archCurve.position.y = 5.2;
    archGroup.add(archCurve);

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
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf8f7ff,
    emissive: 0xf8f7ff,
    emissiveIntensity: 0.55,
  });
  const redBowlMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0x5c0e22,
    emissiveIntensity: 0.35,
    roughness: 0.52,
    flatShading: true,
  });
  const whiteRoofMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: 0x454166,
    emissiveIntensity: 0.32,
    roughness: 0.4,
  });
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x453b66,
    roughness: 0.65,
    metalness: 0.45,
  });
  const floodlightMat = new THREE.MeshStandardMaterial({
    color: 0xfffbe6,
    emissive: 0xfff3c4,
    emissiveIntensity: 2.35,
    roughness: 0.14,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff3cc,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

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
    color: landmark.colorHex,
    emissive: 0x3b2c20,
    emissiveIntensity: 0.2,
    roughness: 0.78,
  });
  const terracottaMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    roughness: 0.7,
    flatShading: true,
  });
  const warmGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xffb800,
    emissiveIntensity: 1.75,
    roughness: 0.2,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3420,
    roughness: 0.85,
  });
  const poolTex = createSoftGlowPoolTexture(
    'rgba(255, 206, 118, 0.7)',
    'rgba(255, 164, 82, 0.24)',
  );
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // Cobblestone hillside plaza base
  const plaza = new THREE.Mesh(
    new THREE.BoxGeometry(12.8, 1.4, 10.8),
    new THREE.MeshStandardMaterial({ color: 0x4b3f57, roughness: 0.88 }),
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

function buildPalmTreesGroup(): THREE.Group {
  const palmsGroup = new THREE.Group();
  palmsGroup.name = 'cali_palms';

  const trunkLowerGeo = new THREE.CylinderGeometry(0.24, 0.44, 4.2, 7);
  const trunkUpperGeo = new THREE.CylinderGeometry(0.16, 0.25, 3.8, 7);
  const frondGeo = new THREE.ConeGeometry(0.92, 4.4, 4);
  const coconutGeo = new THREE.SphereGeometry(0.22, 6, 6);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6e4730,
    roughness: 0.9,
    flatShading: true,
  });
  const coconutMat = new THREE.MeshStandardMaterial({
    color: 0x4b2f1c,
    roughness: 0.85,
  });
  const lowerFrondMat = new THREE.MeshStandardMaterial({
    color: 0x167c50,
    emissive: 0x09291e,
    emissiveIntensity: 0.2,
    roughness: 0.64,
    flatShading: true,
  });
  const upperFrondMat = new THREE.MeshStandardMaterial({
    color: 0x24a369,
    emissive: 0x0d3626,
    emissiveIntensity: 0.22,
    roughness: 0.58,
    flatShading: true,
  });

  PALM_LOCATIONS.forEach((loc, index) => {
    const palm = new THREE.Group();
    palm.name = `palm_${index}`;

    const groundY = getTerrainElevation(loc.x, loc.z);
    const scale = 0.9 + (index % 4) * 0.09;
    palm.position.set(loc.x, groundY, loc.z);
    palm.rotation.y = (index * 1.13) % (Math.PI * 2);
    palm.scale.setScalar(scale);

    const lowerTrunk = new THREE.Mesh(trunkLowerGeo, trunkMat);
    lowerTrunk.position.set(0, 2.0, 0);
    lowerTrunk.rotation.z = 0.06;
    lowerTrunk.castShadow = true;
    lowerTrunk.receiveShadow = true;
    palm.add(lowerTrunk);

    const upperTrunk = new THREE.Mesh(trunkUpperGeo, trunkMat);
    upperTrunk.position.set(-0.34, 5.75, 0);
    upperTrunk.rotation.z = 0.14;
    upperTrunk.castShadow = true;
    upperTrunk.receiveShadow = true;
    palm.add(upperTrunk);

    const crown = new THREE.Group();
    crown.position.set(-0.62, 7.55, 0);

    // Coconut cluster nestled beneath canopy
    for (let c = 0; c < 3; c += 1) {
      const ca = (c / 3) * Math.PI * 2;
      const nut = new THREE.Mesh(coconutGeo, coconutMat);
      nut.position.set(Math.cos(ca) * 0.26, -0.22, Math.sin(ca) * 0.26);
      crown.add(nut);
    }

    // Lower sweeping frond ring (7 fronds)
    for (let f = 0; f < 7; f += 1) {
      const frondPivot = new THREE.Group();
      frondPivot.rotation.y = (f / 7) * Math.PI * 2;

      const frond = new THREE.Mesh(frondGeo, lowerFrondMat);
      frond.scale.set(0.78, 1.04, 0.28);
      frond.position.set(0, 0.16, 1.85);
      frond.rotation.x = 1.28;
      frond.castShadow = true;
      frond.receiveShadow = true;
      frondPivot.add(frond);
      crown.add(frondPivot);
    }

    // Upper arched tropical canopy ring (5 fronds)
    for (let f = 0; f < 5; f += 1) {
      const frondPivot = new THREE.Group();
      frondPivot.rotation.y = (f / 5) * Math.PI * 2 + 0.35;

      const frond = new THREE.Mesh(frondGeo, upperFrondMat);
      frond.scale.set(0.68, 0.86, 0.24);
      frond.position.set(0, 0.62, 1.42);
      frond.rotation.x = 0.88;
      frond.castShadow = true;
      frond.receiveShadow = true;
      frondPivot.add(frond);
      crown.add(frondPivot);
    }

    palm.add(crown);
    palmsGroup.add(palm);
  });

  return palmsGroup;
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
  worldGroup.add(buildSidewalksGroup(map, sidewalkTextures));
  worldGroup.add(buildTrafficSignalsGroup());
  worldGroup.add(buildStreetlightsGroup());
  worldGroup.add(buildBuildingsGroup(map));
  worldGroup.add(buildNeonSignsGroup(map));

  for (const landmark of map.landmarks) {
    worldGroup.add(buildLandmarkGroup(landmark, sidewalkTextures));
  }

  worldGroup.add(buildPalmTreesGroup());

  return { group: worldGroup, waterMesh };
}
