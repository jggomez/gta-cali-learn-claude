/**
 * Procedural 3D Santiago de Cali world builder:
 * - Displaced Andean hillside & valley terrain from getTerrainElevation()
 * - Shimmering Río Cali corridor and neon-railed twin bridge decks
 * - Terrain-conforming roads with dashed centerlines and warm golden medians
 * - Vice-Sunset buildings with lit window bands and glowing roof accents
 * - 6 iconic named Cali landmarks + tropical low-poly palm trees
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

const TERRAIN_EXTENT = 520;
const TERRAIN_SEGMENTS = 104;

export interface CaliWorldBuildResult {
  readonly group: THREE.Group;
  readonly waterMesh: THREE.Mesh;
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

function createWaterShimmerTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#09345c');
  grad.addColorStop(0.5, '#0e74a8');
  grad.addColorStop(1, '#09345c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);

  for (let i = 0; i < 42; i += 1) {
    const y = (i * 29) % 256;
    const x = (i * 47) % 92;
    const w = 18 + (i % 4) * 8;
    ctx.fillStyle =
      i % 3 === 0 ? 'rgba(255, 184, 0, 0.24)' : 'rgba(0, 240, 255, 0.28)';
    ctx.fillRect(x, y, w, 3);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 18);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBuildingFacadeTexture(
  baseHex: number,
  accentHex: number,
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const baseColor = new THREE.Color(baseHex);
  const accentColor = new THREE.Color(accentHex);

  ctx.fillStyle = `#${baseColor.getHexString()}`;
  ctx.fillRect(0, 0, 128, 128);

  // Subtle architectural vertical piers
  ctx.fillStyle = 'rgba(18, 8, 38, 0.26)';
  for (let x = 0; x < 128; x += 32) {
    ctx.fillRect(x, 0, 5, 128);
  }

  // Lit Vice-Sunset window grid
  for (let row = 0; row < 8; row += 1) {
    const y = 8 + row * 15;
    for (let col = 0; col < 4; col += 1) {
      const x = 9 + col * 30;
      const hash = (row * 17 + col * 31) % 7;
      if (hash === 0 || hash === 3) {
        ctx.fillStyle = 'rgba(255, 214, 102, 0.85)';
      } else if (hash === 2) {
        ctx.fillStyle = `#${accentColor.getHexString()}`;
      } else {
        ctx.fillStyle = 'rgba(18, 10, 38, 0.72)';
      }
      ctx.fillRect(x, y, 18, 7);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

  const waterGeometry = new THREE.PlaneGeometry(riverWidth, riverLength, 6, 80);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterTexture = createWaterShimmerTexture();
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x0e77ad,
    emissive: 0x093a66,
    emissiveIntensity: 0.55,
    roughness: 0.16,
    metalness: 0.68,
    transparent: true,
    opacity: 0.88,
    ...(waterTexture ? { map: waterTexture } : {}),
  });

  const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
  waterMesh.name = 'rio_cali_water';
  waterMesh.position.set(riverCenterX, river.waterLevel, riverCenterZ);
  riverGroup.add(waterMesh);

  // River concrete embankments + golden promenade edge strip on Bulevar side
  const bankMat = new THREE.MeshStandardMaterial({
    color: 0x31264f,
    roughness: 0.85,
  });
  const westBank = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.2, riverLength),
    bankMat,
  );
  westBank.position.set(river.minX - 0.5, -0.8, riverCenterZ);
  riverGroup.add(westBank);

  const eastBank = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.2, riverLength),
    bankMat,
  );
  eastBank.position.set(river.maxX + 0.5, -0.8, riverCenterZ);
  riverGroup.add(eastBank);

  const bulevarTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.22, 110),
    new THREE.MeshStandardMaterial({
      color: 0xffb800,
      emissive: 0xffb800,
      emissiveIntensity: 0.65,
      roughness: 0.35,
    }),
  );
  bulevarTrim.position.set(river.minX - 0.6, 0.35, 16);
  riverGroup.add(bulevarTrim);

  // Twin raised bridges with glowing neon-cyan railings
  const bridgesGroup = new THREE.Group();
  bridgesGroup.name = 'cali_bridges';

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x26213d,
    roughness: 0.82,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x453b66,
    roughness: 0.78,
  });
  const neonRailMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
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
    deck.receiveShadow = true;
    bridgeNode.add(deck);

    // Support piers down into riverbed
    for (const pierX of [river.minX + 4, river.maxX - 4]) {
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.6, spanZ - 2),
        concreteMat,
      );
      pier.position.set(pierX, bridge.deckElevation - 1.5, cz);
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
          new THREE.BoxGeometry(0.9, 3.4, 0.9),
          concreteMat,
        );
        pylon.position.set(pylonX, bridge.deckElevation + 1.6, railZ);
        bridgeNode.add(pylon);

        const pylonCap = new THREE.Mesh(
          new THREE.BoxGeometry(1.05, 0.35, 1.05),
          neonRailMat,
        );
        pylonCap.position.set(pylonX, bridge.deckElevation + 3.4, railZ);
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
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRoadsGroup(map: CaliMapConfig): THREE.Group {
  const roadsGroup = new THREE.Group();
  roadsGroup.name = 'cali_roads';

  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x221d36,
    roughness: 0.88,
    metalness: 0.08,
  });
  const dashMat = new THREE.MeshStandardMaterial({
    color: 0xffe49e,
    emissive: 0xffb800,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const medianMat = new THREE.MeshStandardMaterial({
    color: 0xffb800,
    emissive: 0xff9500,
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });
  const rampGuardMat = new THREE.MeshStandardMaterial({
    color: 0xff5e7e,
    emissive: 0xff5e7e,
    emissiveIntensity: 0.75,
    roughness: 0.3,
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
      createTerrainRibbonGeometry(startPt, endPt, road.width, layerOffset, map),
      asphaltMat,
    );
    surfaceMesh.receiveShadow = true;
    segmentGroup.add(surfaceMesh);

    // Dashed centerline following terrain elevation
    const dashStep = 8;
    const dashLen = 3.8;
    for (let dist = 4; dist < length - 4; dist += dashStep) {
      const segStart: Vec2 = {
        x: road.start.x + dirX * dist,
        z: road.start.z + dirZ * dist,
      };
      const segEnd: Vec2 = {
        x: road.start.x + dirX * Math.min(dist + dashLen, length - 2),
        z: road.start.z + dirZ * Math.min(dist + dashLen, length - 2),
      };
      const dashMesh = new THREE.Mesh(
        createTerrainRibbonGeometry(
          segStart,
          segEnd,
          0.42,
          layerOffset + 0.04,
          map,
        ),
        dashMat,
      );
      segmentGroup.add(dashMesh);
    }

    // Warm golden median strip for major Cali avenues
    if (road.hasMedian) {
      const medianMesh = new THREE.Mesh(
        createTerrainRibbonGeometry(
          road.start,
          road.end,
          0.9,
          layerOffset + 0.07,
          map,
        ),
        medianMat,
      );
      segmentGroup.add(medianMesh);
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

function buildBuildingsGroup(map: CaliMapConfig): THREE.Group {
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = 'cali_buildings';

  const textureCache = new Map<string, THREE.CanvasTexture | null>();
  const bandGoldMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xffb800,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });
  const penthouseMat = new THREE.MeshStandardMaterial({
    color: 0x1d1238,
    roughness: 0.8,
  });

  for (const collider of map.buildingColliders) {
    buildingsGroup.add(
      createSingleBuilding(collider, textureCache, bandGoldMat, penthouseMat),
    );
  }

  return buildingsGroup;
}

function createSingleBuilding(
  bldg: AabbCollider,
  textureCache: Map<string, THREE.CanvasTexture | null>,
  bandGoldMat: THREE.Material,
  penthouseMat: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  group.name = bldg.id;

  const width = bldg.maxX - bldg.minX;
  const depth = bldg.maxZ - bldg.minZ;
  const cx = (bldg.minX + bldg.maxX) * 0.5;
  const cz = (bldg.minZ + bldg.maxZ) * 0.5;
  const accentHex = bldg.accentHex ?? 0x00f0ff;

  const minCornerY = Math.min(
    getTerrainElevation(bldg.minX, bldg.minZ),
    getTerrainElevation(bldg.maxX, bldg.minZ),
    getTerrainElevation(bldg.minX, bldg.maxZ),
    getTerrainElevation(bldg.maxX, bldg.maxZ),
  );
  const centerY = getTerrainElevation(cx, cz);
  const foundationDrop = Math.max(0.8, centerY - minCornerY + 0.8);
  const totalHeight = bldg.height + foundationDrop;

  const cacheKey = `${bldg.colorHex}_${accentHex}`;
  let facadeTex = textureCache.get(cacheKey);
  if (facadeTex === undefined) {
    facadeTex = createBuildingFacadeTexture(bldg.colorHex, accentHex);
    textureCache.set(cacheKey, facadeTex);
  }

  const bodyMat = new THREE.MeshStandardMaterial({
    color: facadeTex ? 0xffffff : bldg.colorHex,
    ...(facadeTex ? { map: facadeTex } : {}),
    roughness: 0.72,
    metalness: 0.12,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.75,
    roughness: 0.28,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, totalHeight, depth),
    bodyMat,
  );
  body.position.set(cx, centerY + bldg.height - totalHeight * 0.5, cz);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roofY = centerY + bldg.height;
  const isColonial = bldg.id.startsWith('bldg_san_antonio') || bldg.height <= 11;

  if (isColonial) {
    // Terracotta pitched colonial roof for San Antonio houses
    const roofPeak = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(width, depth) * 0.74, 2.8, 4),
      new THREE.MeshStandardMaterial({
        color: accentHex,
        roughness: 0.75,
        flatShading: true,
      }),
    );
    roofPeak.rotation.y = Math.PI / 4;
    roofPeak.scale.set(
      width / Math.max(width, depth),
      1,
      depth / Math.max(width, depth),
    );
    roofPeak.position.set(cx, roofY + 1.4, cz);
    group.add(roofPeak);

    // Warm glowing colonial window band
    const warmBand = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.16, 0.75, depth + 0.16),
      bandGoldMat,
    );
    warmBand.position.set(cx, centerY + bldg.height * 0.52, cz);
    group.add(warmBand);
  } else {
    // Lit sunset & neon window bands around modern towers
    const bandCount = Math.min(4, Math.max(2, Math.floor(bldg.height / 6)));
    for (let i = 1; i <= bandCount; i += 1) {
      const bandY = centerY + (bldg.height * i) / (bandCount + 1);
      const bandMat = i % 2 === 0 ? accentMat : bandGoldMat;
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.18, 0.55, depth + 0.18),
        bandMat,
      );
      band.position.set(cx, bandY, cz);
      group.add(band);
    }

    // Glowing roof parapet trim
    const roofTrim = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.35, 0.55, depth + 0.35),
      accentMat,
    );
    roofTrim.position.set(cx, roofY + 0.25, cz);
    group.add(roofTrim);

    // Rooftop mechanical penthouse on taller structures
    if (bldg.height >= 18) {
      const penthouse = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.45, 2.4, depth * 0.45),
        penthouseMat,
      );
      penthouse.position.set(cx, roofY + 1.4, cz);
      group.add(penthouse);
    }
  }

  return group;
}

function buildCristoReyLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const plazaMat = new THREE.MeshStandardMaterial({
    color: 0x3b3158,
    roughness: 0.85,
  });
  const pedestalMat = new THREE.MeshStandardMaterial({
    color: 0xd9d4eb,
    roughness: 0.7,
  });
  const statueMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0xfff0d1,
    emissiveIntensity: 0.42,
    roughness: 0.38,
    flatShading: true,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: landmark.accentHex,
    emissiveIntensity: 0.85,
    roughness: 0.25,
  });

  // Circular Mirador terrace & glowing gold balustrade
  const miradorDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(11.5, 13.5, 2.2, 16),
    plazaMat,
  );
  miradorDeck.position.y = 0.6;
  group.add(miradorDeck);

  const miradorRing = new THREE.Mesh(
    new THREE.TorusGeometry(11.2, 0.22, 8, 24),
    goldMat,
  );
  miradorRing.rotation.x = Math.PI / 2;
  miradorRing.position.y = 2.0;
  group.add(miradorRing);

  // Tapered pedestal + illuminated front steps facing +X (downtown Cali)
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 5.2, 7.5, 8),
    pedestalMat,
  );
  pedestal.position.y = 5.2;
  group.add(pedestal);

  const steps = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 5.4), pedestalMat);
  steps.position.set(4.5, 2.4, 0);
  group.add(steps);

  // Giant illuminated white Cristo Rey statue facing +X (arms spread along Z)
  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(1.85, 3.1, 20, 8),
    statueMat,
  );
  robe.position.y = 18.8;
  robe.castShadow = true;
  group.add(robe);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5.2, 5.4), statueMat);
  chest.position.y = 26.2;
  group.add(chest);

  const outstretchedArms = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 2.1, 22.5),
    statueMat,
  );
  outstretchedArms.position.y = 27.6;
  outstretchedArms.castShadow = true;
  group.add(outstretchedArms);

  // Draped sleeve folds under outstretched arms
  const sleeveDrape = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 15.5),
    statueMat,
  );
  sleeveDrape.position.y = 26.2;
  group.add(sleeveDrape);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), statueMat);
  head.position.set(0.35, 31.1, 0);
  group.add(head);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.16, 8, 20), goldMat);
  halo.rotation.y = Math.PI / 2;
  halo.position.set(-0.3, 31.3, 0);
  group.add(halo);

  return group;
}

function buildLaErmitaLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const ivoryMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0x3b4870,
    emissiveIntensity: 0.22,
    roughness: 0.55,
    flatShading: true,
  });
  const skyBlueMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: 0x2b6cb0,
    emissiveIntensity: 0.45,
    roughness: 0.4,
    flatShading: true,
  });
  const roseGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff2e93,
    emissive: 0xff2e93,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffb800,
    emissive: 0xffb800,
    emissiveIntensity: 0.85,
    roughness: 0.25,
  });

  // Stone sanctuary plinth
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(17.5, 1.2, 22),
    new THREE.MeshStandardMaterial({ color: 0x3a325c, roughness: 0.85 }),
  );
  plinth.position.y = 0.6;
  group.add(plinth);

  // Main ivory neo-gothic nave
  const nave = new THREE.Mesh(new THREE.BoxGeometry(13.5, 12.5, 16.5), ivoryMat);
  nave.position.set(1.2, 7.2, 0);
  nave.castShadow = true;
  group.add(nave);

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
    tower.castShadow = true;
    group.add(tower);

    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.3, 11.5, 4), skyBlueMat);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(-5.6, 27.5, side);
    group.add(spire);

    const finial = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), goldMat);
    finial.position.set(-5.6, 34.0, side);
    group.add(finial);
  }

  // Tall lacy central neo-gothic spire
  const centerTower = new THREE.Mesh(new THREE.BoxGeometry(4.4, 24, 4.4), ivoryMat);
  centerTower.position.set(-4.2, 13, 0);
  group.add(centerTower);

  const centerSpire = new THREE.Mesh(
    new THREE.ConeGeometry(2.9, 14.5, 4),
    ivoryMat,
  );
  centerSpire.rotation.y = Math.PI / 4;
  centerSpire.position.set(-4.2, 32.0, 0);
  group.add(centerSpire);

  const crossVertical = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.0, 0.35), goldMat);
  crossVertical.position.set(-4.2, 40.2, 0);
  group.add(crossVertical);
  const crossArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1.8), goldMat);
  crossArm.position.set(-4.2, 40.7, 0);
  group.add(crossArm);

  // Glowing circular stained-glass rose window on west facade (-X)
  const roseOuter = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.32, 8, 20),
    goldMat,
  );
  roseOuter.rotation.y = Math.PI / 2;
  roseOuter.position.set(-6.6, 13.5, 0);
  group.add(roseOuter);

  const roseGlass = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 18),
    roseGlowMat,
  );
  roseGlass.rotation.y = -Math.PI / 2;
  roseGlass.position.set(-6.68, 13.5, 0);
  group.add(roseGlass);

  // Illuminated gothic entrance portal
  const portal = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.2, 3.4), goldMat);
  portal.position.set(-6.5, 3.8, 0);
  group.add(portal);

  return group;
}

function buildTorreDeCaliLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const glassMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0x1e1545,
    emissiveIntensity: 0.35,
    roughness: 0.22,
    metalness: 0.65,
  });
  const cyanMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: landmark.accentHex,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const magentaMat = new THREE.MeshStandardMaterial({
    color: 0xff2e93,
    emissive: 0xff2e93,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  // Grand stepped plaza podium
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(21, 5.5, 21),
    new THREE.MeshStandardMaterial({ color: 0x261a45, roughness: 0.7 }),
  );
  podium.position.y = 2.75;
  group.add(podium);

  // Three stepped glass skyscraper tiers
  const tiers = [
    { size: 15.5, height: 30, y: 20.5 },
    { size: 12.6, height: 24, y: 47.5 },
    { size: 9.8, height: 17, y: 68.0 },
  ] as const;

  for (const tier of tiers) {
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(tier.size, tier.height, tier.size),
      glassMat,
    );
    shaft.position.y = tier.y;
    shaft.castShadow = true;
    group.add(shaft);

    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(tier.size + 0.5, 0.75, tier.size + 0.5),
      cyanMat,
    );
    ring.position.y = tier.y + tier.height * 0.5;
    group.add(ring);
  }

  // Vertical cyan corner edge fins
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 56, 0.6), cyanMat);
      fin.position.set(sx * 7.8, 33, sz * 7.8);
      group.add(fin);
    }
  }

  // Glowing cyan/magenta crown & twin telecom spires
  const crownLower = new THREE.Mesh(new THREE.BoxGeometry(10.6, 1.4, 10.6), magentaMat);
  crownLower.position.y = 77.2;
  group.add(crownLower);

  const crownUpper = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.2, 7.2), cyanMat);
  crownUpper.position.y = 79.0;
  group.add(crownUpper);

  for (const offset of [-1.8, 1.8] as const) {
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.32, 11.5, 6),
      cyanMat,
    );
    spire.position.set(offset, 85.8, 0);
    group.add(spire);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 8), magentaMat);
    tip.position.set(offset, 91.6, 0);
    group.add(tip);
  }

  return group;
}

function buildBulevarDelRioLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x3b2754,
    roughness: 0.78,
  });
  const archMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0xff2e93,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });
  const lampPostMat = new THREE.MeshStandardMaterial({
    color: 0x1d1433,
    roughness: 0.7,
  });
  const lampGlobeMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: landmark.accentHex,
    emissiveIntensity: 0.95,
    roughness: 0.2,
  });

  // Riverside tiled boardwalk promenade
  const boardwalk = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.45, 28), deckMat);
  boardwalk.position.y = 0.22;
  boardwalk.receiveShadow = true;
  group.add(boardwalk);

  // 5 Vice-Sunset architectural arches spanning the boulevard
  for (let i = -2; i <= 2; i += 1) {
    const zPos = i * 5.6;
    const archGroup = new THREE.Group();
    archGroup.position.set(0, 0.4, zPos);

    for (const side of [-4.4, 4.4] as const) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.4, 0.65), archMat);
      pillar.position.set(side, 2.7, 0);
      archGroup.add(pillar);
    }

    const archCurve = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.36, 8, 18, Math.PI),
      archMat,
    );
    archCurve.position.y = 5.2;
    archGroup.add(archCurve);

    group.add(archGroup);
  }

  // Warm golden boardwalk lamps along both edges
  for (const zPos of [-10, -3.5, 3.5, 10]) {
    for (const xPos of [-5.2, 5.2]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.16, 3.8, 6),
        lampPostMat,
      );
      pole.position.set(xPos, 2.2, zPos);
      group.add(pole);

      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 8, 8),
        lampGlobeMat,
      );
      globe.position.set(xPos, 4.25, zPos);
      group.add(globe);
    }
  }

  return group;
}

function buildEstadioPascualLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const pitchMat = new THREE.MeshStandardMaterial({
    color: 0x16804b,
    roughness: 0.85,
  });
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf8f7ff,
    emissive: 0xf8f7ff,
    emissiveIntensity: 0.35,
  });
  const redBowlMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0x5c0e22,
    emissiveIntensity: 0.32,
    roughness: 0.55,
    flatShading: true,
  });
  const whiteRoofMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    emissive: 0x3b3859,
    emissiveIntensity: 0.25,
    roughness: 0.45,
  });
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x453b66,
    roughness: 0.7,
  });
  const floodlightMat = new THREE.MeshStandardMaterial({
    color: 0xfffbe6,
    emissive: 0xfff3c4,
    emissiveIntensity: 1.2,
    roughness: 0.15,
  });

  // Emerald pitch + crisp white soccer markings
  const pitch = new THREE.Mesh(new THREE.BoxGeometry(25, 0.4, 31), pitchMat);
  pitch.position.y = 0.2;
  group.add(pitch);

  const halfway = new THREE.Mesh(new THREE.BoxGeometry(23, 0.08, 0.35), lineMat);
  halfway.position.y = 0.45;
  group.add(halfway);

  const centerCircle = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.85, 24),
    lineMat,
  );
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.y = 0.46;
  group.add(centerCircle);

  // Curved red/white stadium bowl constructed from 12 radial grandstands
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const rx = 18.0;
    const rz = 20.5;
    const sx = Math.cos(angle) * rx;
    const sz = Math.sin(angle) * rz;

    const stand = new THREE.Group();
    stand.position.set(sx, 0, sz);
    stand.lookAt(0, 0, 0);

    const wall = new THREE.Mesh(new THREE.BoxGeometry(10.5, 11.5, 6.2), redBowlMat);
    wall.position.y = 5.75;
    wall.castShadow = true;
    stand.add(wall);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.85, 7.8), whiteRoofMat);
    canopy.position.set(0, 12.1, 1.2);
    canopy.rotation.x = 0.18;
    stand.add(canopy);

    group.add(stand);
  }

  // 4 bright stadium floodlight towers at corners
  const corners: readonly [number, number][] = [
    [-19.5, -21.5],
    [19.5, -21.5],
    [-19.5, 21.5],
    [19.5, 21.5],
  ];
  for (const [cx, cz] of corners) {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.0, 32, 6),
      towerMat,
    );
    tower.position.set(cx, 16, cz);
    group.add(tower);

    const bank = new THREE.Mesh(new THREE.BoxGeometry(5.6, 3.2, 1.0), floodlightMat);
    bank.position.set(cx, 32.5, cz);
    bank.lookAt(0, 2, 0);
    group.add(bank);
  }

  return group;
}

function buildSanAntonioLandmark(landmark: LandmarkDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `landmark_${landmark.id}`;
  group.position.set(landmark.position.x, landmark.elevation, landmark.position.z);

  const stuccoMat = new THREE.MeshStandardMaterial({
    color: landmark.colorHex,
    emissive: 0x3b2c20,
    emissiveIntensity: 0.18,
    roughness: 0.78,
  });
  const terracottaMat = new THREE.MeshStandardMaterial({
    color: landmark.accentHex,
    roughness: 0.72,
    flatShading: true,
  });
  const warmGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xffb800,
    emissiveIntensity: 0.85,
    roughness: 0.25,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3420,
    roughness: 0.85,
  });

  // Cobblestone hillside plaza base
  const plaza = new THREE.Mesh(
    new THREE.BoxGeometry(12.5, 1.4, 10.5),
    new THREE.MeshStandardMaterial({ color: 0x4b3f57, roughness: 0.88 }),
  );
  plaza.position.set(0, -0.35, 0);
  plaza.receiveShadow = true;
  group.add(plaza);

  // Whitewashed colonial chapel nave
  const chapelBody = new THREE.Mesh(new THREE.BoxGeometry(8.6, 5.2, 6.2), stuccoMat);
  chapelBody.position.set(-0.5, 2.95, 0);
  chapelBody.castShadow = true;
  group.add(chapelBody);

  // Terracotta tiled pitched gable roof (two angled slabs)
  for (const side of [-1, 1] as const) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.45, 4.2), terracottaMat);
    slope.position.set(-0.5, 6.45, side * 1.72);
    slope.rotation.x = side * 0.48;
    group.add(slope);
  }

  // Stepped colonial facade (bell gable) facing +X toward Cali valley
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

  // Wooden colonial chapel doorway & warm glowing lanterns
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.0, 1.8), woodMat);
  door.position.set(3.85, 1.9, 0);
  group.add(door);

  for (const side of [-2.4, 2.4] as const) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), warmGlowMat);
    lantern.position.set(4.1, 3.6, side);
    group.add(lantern);
  }

  return group;
}

function buildLandmarkGroup(landmark: LandmarkDef): THREE.Group {
  switch (landmark.id) {
    case 'cristo_rey':
      return buildCristoReyLandmark(landmark);
    case 'la_ermita':
      return buildLaErmitaLandmark(landmark);
    case 'torre_de_cali':
      return buildTorreDeCaliLandmark(landmark);
    case 'bulevar_del_rio':
      return buildBulevarDelRioLandmark(landmark);
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

  const trunkLowerGeo = new THREE.CylinderGeometry(0.24, 0.42, 4.2, 6);
  const trunkUpperGeo = new THREE.CylinderGeometry(0.16, 0.25, 3.8, 6);
  const frondGeo = new THREE.ConeGeometry(0.85, 4.2, 4);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6e4730,
    roughness: 0.9,
    flatShading: true,
  });
  const frondMat = new THREE.MeshStandardMaterial({
    color: 0x1b8a5a,
    emissive: 0x0a2e22,
    emissiveIntensity: 0.22,
    roughness: 0.65,
    flatShading: true,
  });

  PALM_LOCATIONS.forEach((loc, index) => {
    const palm = new THREE.Group();
    palm.name = `palm_${index}`;

    const groundY = getTerrainElevation(loc.x, loc.z);
    const scale = 0.88 + (index % 4) * 0.09;
    palm.position.set(loc.x, groundY, loc.z);
    palm.rotation.y = (index * 1.13) % (Math.PI * 2);
    palm.scale.setScalar(scale);

    const lowerTrunk = new THREE.Mesh(trunkLowerGeo, trunkMat);
    lowerTrunk.position.set(0, 2.0, 0);
    lowerTrunk.rotation.z = 0.06;
    palm.add(lowerTrunk);

    const upperTrunk = new THREE.Mesh(trunkUpperGeo, trunkMat);
    upperTrunk.position.set(-0.34, 5.75, 0);
    upperTrunk.rotation.z = 0.14;
    palm.add(upperTrunk);

    const crown = new THREE.Group();
    crown.position.set(-0.62, 7.55, 0);

    for (let f = 0; f < 6; f += 1) {
      const frondPivot = new THREE.Group();
      frondPivot.rotation.y = (f / 6) * Math.PI * 2;

      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.scale.set(0.75, 1, 0.28);
      frond.position.set(0, 0.3, 1.75);
      frond.rotation.x = 1.18;
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
 * Returns the root world group and a direct reference to the Río Cali water mesh for shimmer animation.
 */
export function buildCaliWorld(map: CaliMapConfig): CaliWorldBuildResult {
  const worldGroup = new THREE.Group();
  worldGroup.name = 'cali_world';

  worldGroup.add(buildTerrainMesh(map));

  const { riverGroup, bridgesGroup, waterMesh } = buildRiverAndBridges(map);
  worldGroup.add(riverGroup);
  worldGroup.add(bridgesGroup);

  worldGroup.add(buildRoadsGroup(map));
  worldGroup.add(buildBuildingsGroup(map));

  for (const landmark of map.landmarks) {
    worldGroup.add(buildLandmarkGroup(landmark));
  }

  worldGroup.add(buildPalmTreesGroup());

  return { group: worldGroup, waterMesh };
}
