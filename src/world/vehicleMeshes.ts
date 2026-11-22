/**
 * Photorealistic real GLB vehicle/character rigs (Ferrari 458 Italia & rigged Soldier character)
 * plus naturalistic golden-hour procedural PBR 3D fallback vehicles (all 5 Cali kinds), Valeria
 * fallback mesh, and holographic mission objective beacon. Safe in headless Node tests.
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ObjectivePropKind, VehicleKind } from '../types/game';
import type { LoadedCharacterAsset } from './assetLoader';

export type MissionPropKey = Exclude<ObjectivePropKind, 'none'>;

export type FerrariLiveryKind = 'banshee' | 'police' | 'taxi';

export interface HeadlightConeMaterials {
  readonly outerBeamMat: THREE.MeshBasicMaterial;
  readonly coreBeamMat: THREE.MeshBasicMaterial;
  readonly roadPoolMat: THREE.MeshBasicMaterial;
}

export interface RiggedCharacterActions {
  readonly idle?: THREE.AnimationAction;
  readonly walk?: THREE.AnimationAction;
  readonly run?: THREE.AnimationAction;
}

export interface RiggedCharacterRig {
  readonly group: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: RiggedCharacterActions;
}

export interface RiggedCharacterOptions {
  readonly tintHex?: number;
  readonly heightMeters?: number;
}

const FERRARI_TARGET_LENGTH_METERS = 4.55;
const CHARACTER_TARGET_HEIGHT_METERS = 1.78;

interface WheelSpec {
  readonly x: number;
  readonly z: number;
  readonly isFront: boolean;
}

interface WheelRig {
  readonly wheels: THREE.Object3D[];
  readonly frontWheels: THREE.Object3D[];
}

interface MeshPlacement {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly sz?: number;
  readonly name?: string;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

const DEFAULT_BRAKE_EMISSIVE_INTENSITY = 1.45;
const BANSHEE_BRAKE_EMISSIVE_INTENSITY = 1.65;

function createCarPaintMaterial(
  colorHex: number,
  overrides?: THREE.MeshPhysicalMaterialParameters,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    metalness: 0.72,
    roughness: 0.24,
    ...overrides,
  });
}

function createTintedGlassMaterial(
  colorHex = 0x0f1224,
  overrides?: THREE.MeshPhysicalMaterialParameters,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.25,
    roughness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    ...overrides,
  });
}

function createChromeMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe6edf8,
    metalness: 0.94,
    roughness: 0.12,
    clearcoat: 0.65,
    clearcoatRoughness: 0.08,
  });
}

function createCarbonMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x161724,
    metalness: 0.42,
    roughness: 0.38,
  });
}

function createXenonHeadlightMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xfff8e6,
    emissive: 0xfff1cc,
    emissiveIntensity: 1.75,
    roughness: 0.12,
    metalness: 0.1,
  });
}

function createBrakeLightMaterial(
  emissiveIntensity = DEFAULT_BRAKE_EMISSIVE_INTENSITY,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xff1e3c,
    emissive: 0xff1534,
    emissiveIntensity,
    roughness: 0.16,
    metalness: 0.15,
  });
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placement: MeshPlacement = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(placement.x ?? 0, placement.y ?? 0, placement.z ?? 0);
  if (placement.rx !== undefined || placement.ry !== undefined || placement.rz !== undefined) {
    mesh.rotation.set(placement.rx ?? 0, placement.ry ?? 0, placement.rz ?? 0);
  }
  if (placement.sx !== undefined || placement.sy !== undefined || placement.sz !== undefined) {
    mesh.scale.set(placement.sx ?? 1, placement.sy ?? 1, placement.sz ?? 1);
  }
  if (placement.name) {
    mesh.name = placement.name;
  }
  mesh.castShadow = placement.castShadow ?? true;
  mesh.receiveShadow = placement.receiveShadow ?? true;
  parent.add(mesh);
  return mesh;
}

/**
 * Extrudes a 2D side silhouette specified as [z, y] pairs symmetrically across [-width/2, +width/2].
 */
function createProfileGeometry(
  points: readonly (readonly [number, number])[],
  width: number,
  bevel = 0.06,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const first = points[0];
  if (first) {
    shape.moveTo(first[0], first[1]);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (point) {
        shape.lineTo(point[0], point[1]);
      }
    }
    shape.closePath();
  }

  const clampedBevel = Math.max(0, Math.min(bevel, width * 0.25));
  const innerWidth = Math.max(0.04, width - clampedBevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: innerWidth,
    bevelEnabled: clampedBevel > 0,
    bevelThickness: clampedBevel,
    bevelSize: clampedBevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(innerWidth / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Extrudes a curved 2D side silhouette drawn in (z, y) symmetrically across [-width/2, +width/2]
 * with smooth multi-segment bevels (zero sharp box corners).
 */
function createCurvedSideExtrude(
  buildShape: (shape: THREE.Shape) => void,
  width: number,
  bevel = 0.08,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  buildShape(shape);
  const clampedBevel = Math.max(0, Math.min(bevel, width * 0.28));
  const innerWidth = Math.max(0.04, width - clampedBevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: innerWidth,
    bevelEnabled: clampedBevel > 0,
    bevelThickness: clampedBevel,
    bevelSize: clampedBevel,
    bevelSegments: 4,
    curveSegments: 14,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(innerWidth / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Extrudes a curved 2D cross-section drawn in (x, y) symmetrically along [-length/2, +length/2]
 * for arched roofs, contoured bellows, curved windshields, and aerodynamic roof domes.
 */
function createCurvedCrossExtrude(
  buildShape: (shape: THREE.Shape) => void,
  length: number,
  bevel = 0.05,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  buildShape(shape);
  const clampedBevel = Math.max(0, Math.min(bevel, length * 0.25));
  const innerLength = Math.max(0.04, length - clampedBevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: innerLength,
    bevelEnabled: clampedBevel > 0,
    bevelThickness: clampedBevel,
    bevelSize: clampedBevel,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geometry.translate(0, 0, -innerLength / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds a rounded beveled pod (width along X, height along Y, length along Z) using quadratic curves.
 */
function createRoundedPodGeometry(
  width: number,
  height: number,
  length: number,
  cornerRadius: number,
  bevel = 0.04,
): THREE.ExtrudeGeometry {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const r = Math.min(cornerRadius, hw * 0.8, hh * 0.8);
  return createCurvedCrossExtrude(
    (shape) => {
      shape.moveTo(-hw + r, -hh);
      shape.lineTo(hw - r, -hh);
      shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
      shape.lineTo(hw, hh - r);
      shape.quadraticCurveTo(hw, hh, hw - r, hh);
      shape.lineTo(-hw + r, hh);
      shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
      shape.lineTo(-hw, -hh + r);
      shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      shape.closePath();
    },
    length,
    bevel,
  );
}

/**
 * Builds a smooth semi-circular flared wheel arch fender centered at its wheel hub (z=0, y=0).
 */
function createFlaredWheelArchGeometry(
  innerRadius: number,
  thickness: number,
  flareWidth: number,
): THREE.ExtrudeGeometry {
  const outerRadius = innerRadius + thickness;
  return createCurvedSideExtrude(
    (shape) => {
      shape.absarc(0, 0, outerRadius, 0, Math.PI, false);
      shape.lineTo(-innerRadius, 0);
      shape.absarc(0, 0, innerRadius, Math.PI, 0, true);
      shape.closePath();
    },
    flareWidth,
    Math.min(0.03, flareWidth * 0.2),
  );
}

function createTaxiSignTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = '#ffe047';
  ctx.fillRect(0, 0, 128, 48);
  ctx.strokeStyle = '#120826';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 44);
  ctx.fillStyle = '#120826';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TAXI', 64, 25);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCheckerTrimTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const cell = 16;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 16; col += 1) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#11121d' : '#f7f8fc';
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Procedural axial fade texture for open headlight beam cones:
 * bright at UV v = 1 (canvas top, headlight lens) and fully transparent well before v = 0 (far rim).
 */
function createHeadlightBeamTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, 64, 256);
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.65)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.26)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.06)');
  gradient.addColorStop(0.88, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Procedural soft radial alpha glow texture fading cleanly to transparent well inside the edges,
 * eliminating sharp rectangular corners on asphalt headlight pools.
 */
function createSoftRadialGlowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, 256, 256);
  const gradient = ctx.createRadialGradient(128, 128, 6, 128, 128, 114);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.36, 'rgba(255, 255, 255, 0.58)');
  gradient.addColorStop(0.68, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(0.9, 'rgba(255, 255, 255, 0.02)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Procedural soft radial dark ambient-occlusion contact shadow texture for grounding vehicles
 * and characters realistically onto sunlit Cali asphalt without harsh rectangle edges.
 */
function createContactShadowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, 256, 256);
  const gradient = ctx.createRadialGradient(128, 128, 16, 128, 128, 118);
  gradient.addColorStop(0.0, 'rgba(6, 8, 12, 0.92)');
  gradient.addColorStop(0.45, 'rgba(6, 8, 12, 0.68)');
  gradient.addColorStop(0.78, 'rgba(6, 8, 12, 0.22)');
  gradient.addColorStop(1.0, 'rgba(6, 8, 12, 0.0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function attachContactShadow(
  parent: THREE.Group,
  width: number,
  length: number,
  opacity = 0.62,
  y = 0.03,
): THREE.Mesh {
  const shadowTex = createContactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x050608,
    ...(shadowTex ? { map: shadowTex } : {}),
    transparent: true,
    opacity: shadowTex ? opacity : opacity * 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shadowPlane = addMesh(
    parent,
    new THREE.PlaneGeometry(width, length),
    shadowMat,
    {
      y,
      rx: -Math.PI / 2,
      name: 'contact_shadow',
      castShadow: false,
      receiveShadow: false,
    },
  );
  shadowPlane.renderOrder = 1;
  return shadowPlane;
}

/**
 * Attaches realistic multi-part wheels (rubber tire, barrel, silver 5-spoke alloy rim, brake rotor,
 * and steering-mounted caliper) preserving spinHub (`wheels`) and steerPivot (`frontWheels`).
 */
function attachWheels(
  parent: THREE.Group,
  specs: readonly WheelSpec[],
  radius: number,
  width: number,
  caliperColorHex = 0xd91c38,
): WheelRig {
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 18);
  tireGeo.rotateZ(Math.PI / 2);

  const shoulderTubeRadius = Math.min(width * 0.14, radius * 0.11);
  const shoulderGeo = new THREE.TorusGeometry(
    radius - shoulderTubeRadius,
    shoulderTubeRadius,
    8,
    18,
  );
  shoulderGeo.rotateY(Math.PI / 2);

  const barrelGeo = new THREE.CylinderGeometry(
    radius * 0.64,
    radius * 0.64,
    width * 0.88,
    14,
  );
  barrelGeo.rotateZ(Math.PI / 2);

  const rimLipGeo = new THREE.TorusGeometry(radius * 0.63, radius * 0.055, 6, 18);
  rimLipGeo.rotateY(Math.PI / 2);

  const hubCapGeo = new THREE.CylinderGeometry(
    radius * 0.17,
    radius * 0.17,
    width * 0.24,
    10,
  );
  hubCapGeo.rotateZ(Math.PI / 2);

  const spokeGeo = new THREE.BoxGeometry(width * 0.14, radius * 0.56, radius * 0.11);
  const rotorGeo = new THREE.CylinderGeometry(
    radius * 0.46,
    radius * 0.46,
    width * 0.12,
    14,
  );
  rotorGeo.rotateZ(Math.PI / 2);
  const caliperGeo = new THREE.BoxGeometry(width * 0.34, radius * 0.36, radius * 0.22);

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x15141e,
    roughness: 0.88,
    metalness: 0.06,
  });
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x202332,
    roughness: 0.48,
    metalness: 0.6,
  });
  const alloyMat = new THREE.MeshPhysicalMaterial({
    color: 0xd9e1f2,
    roughness: 0.2,
    metalness: 0.9,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
  });
  const rotorMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3b5,
    roughness: 0.36,
    metalness: 0.82,
  });
  const caliperMat = new THREE.MeshPhysicalMaterial({
    color: caliperColorHex,
    roughness: 0.26,
    metalness: 0.45,
    clearcoat: 0.85,
  });

  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];

  for (const spec of specs) {
    const sideSign = spec.x >= 0 ? 1 : -1;
    const outerFaceX = sideSign * (width * 0.44);

    const steerPivot = new THREE.Group();
    steerPivot.position.set(spec.x, radius, spec.z);

    // Non-spinning brake caliper mounted to the steering knuckle
    addMesh(steerPivot, caliperGeo, caliperMat, {
      x: sideSign * (width * 0.14),
      y: radius * 0.14,
      z: -radius * 0.34,
      castShadow: false,
      receiveShadow: false,
    });

    const spinHub = new THREE.Group();
    addMesh(spinHub, tireGeo, tireMat);
    addMesh(spinHub, shoulderGeo, tireMat, {
      x: sideSign * (width * 0.5 - shoulderTubeRadius),
      castShadow: false,
    });
    addMesh(spinHub, barrelGeo, barrelMat, { castShadow: false });
    addMesh(spinHub, rotorGeo, rotorMat, {
      x: sideSign * (width * 0.1),
      castShadow: false,
    });
    addMesh(spinHub, rimLipGeo, alloyMat, {
      x: outerFaceX,
      castShadow: false,
    });
    addMesh(spinHub, hubCapGeo, alloyMat, {
      x: outerFaceX - sideSign * (width * 0.04),
      castShadow: false,
    });

    // 5-spoke silver alloy face
    for (let s = 0; s < 5; s += 1) {
      const angle = (s / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, alloyMat);
      spoke.position.set(
        outerFaceX - sideSign * 0.015,
        Math.cos(angle) * (radius * 0.31),
        Math.sin(angle) * (radius * 0.31),
      );
      spoke.rotation.x = angle;
      spoke.castShadow = false;
      spoke.receiveShadow = true;
      spinHub.add(spoke);
    }

    steerPivot.add(spinHub);
    parent.add(steerPivot);

    wheels.push(spinHub);
    if (spec.isFront) {
      frontWheels.push(steerPivot);
    }
  }

  return { wheels, frontWheels };
}

function attachSideMirrors(
  parent: THREE.Group,
  xPos: number,
  yPos: number,
  zPos: number,
  capMat: THREE.Material,
  stalkMat: THREE.Material,
  scale = 1,
): void {
  const stalkGeo = new THREE.BoxGeometry(0.14 * scale, 0.06 * scale, 0.08 * scale);
  const capGeo = new THREE.BoxGeometry(0.18 * scale, 0.1 * scale, 0.14 * scale);

  for (const side of [-1, 1] as const) {
    addMesh(parent, stalkGeo, stalkMat, {
      x: side * xPos,
      y: yPos,
      z: zPos,
    });
    addMesh(parent, capGeo, capMat, {
      x: side * (xPos + 0.08 * scale),
      y: yPos + 0.03 * scale,
      z: zPos - 0.02 * scale,
    });
  }
}

/**
 * Attaches low-profile, edge-faded additive headlight beams and a soft asphalt light pool
 * fanning forward from the xenon lenses (zero shadows, zero hard circular rim).
 */
function attachHeadlightCones(
  parent: THREE.Group,
  xOffset: number,
  lightY: number,
  frontZ: number,
  coneLength: number,
  coneRadius: number,
): THREE.Group {
  const conesGroup = new THREE.Group();
  conesGroup.name = 'headlight_cones';

  const beamTex = createHeadlightBeamTexture();
  const roadPoolTex = createSoftRadialGlowTexture();

  const outerBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffecc2,
    ...(beamTex ? { map: beamTex } : {}),
    transparent: true,
    opacity: 0.045,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const coreBeamMat = new THREE.MeshBasicMaterial({
    color: 0xfff7dc,
    ...(beamTex ? { map: beamTex } : {}),
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const roadPoolMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c8,
    ...(roadPoolTex ? { map: roadPoolTex } : {}),
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const outerGeo = new THREE.ConeGeometry(coneRadius, coneLength, 16, 1, true);
  const coreGeo = new THREE.ConeGeometry(coneRadius * 0.48, coneLength * 0.8, 12, 1, true);

  // ConeGeometry apex (+y, v=1) maps to headlight lens (-z); open base (-y, v=0) fans forward (+z).
  // Flattening local z (world y after -PI/2 X rotation) keeps the beam skimming low along the road.
  const pitchDown = 0.09;
  const centerDrop = Math.sin(pitchDown) * (coneLength * 0.5);
  const centerForward = Math.cos(pitchDown) * (coneLength * 0.5);

  for (const side of [-1, 1] as const) {
    addMesh(conesGroup, outerGeo, outerBeamMat, {
      x: side * xOffset,
      y: lightY - centerDrop,
      z: frontZ + centerForward,
      rx: -Math.PI / 2 + pitchDown,
      sz: 0.24,
      castShadow: false,
      receiveShadow: false,
    });
    addMesh(conesGroup, coreGeo, coreBeamMat, {
      x: side * xOffset,
      y: lightY - centerDrop * 0.8,
      z: frontZ + centerForward * 0.8,
      rx: -Math.PI / 2 + pitchDown,
      sz: 0.24,
      castShadow: false,
      receiveShadow: false,
    });
  }

  // Soft elliptical road-surface illumination ahead of the headlights
  const roadPool = addMesh(
    conesGroup,
    new THREE.PlaneGeometry(xOffset * 3.5, coneLength * 1.1),
    roadPoolMat,
    {
      y: 0.09,
      z: frontZ + coneLength * 0.52,
      rx: -Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    },
  );
  roadPool.renderOrder = 1;

  conesGroup.userData.coneMaterials = {
    outerBeamMat,
    coreBeamMat,
    roadPoolMat,
  } satisfies HeadlightConeMaterials;

  parent.add(conesGroup);
  return conesGroup;
}

function attachStandardLampPairs(
  parent: THREE.Group,
  halfWidth: number,
  frontZ: number,
  rearZ: number,
  lightY: number,
): THREE.MeshStandardMaterial[] {
  const headlightMat = createXenonHeadlightMaterial();
  const brakeLightMat = createBrakeLightMaterial();

  const xOffset = halfWidth * 0.68;
  const headGeo = new THREE.CapsuleGeometry(0.085, 0.22, 6, 10);
  headGeo.rotateZ(Math.PI / 2);
  const tailGeo = new THREE.CapsuleGeometry(0.085, 0.28, 6, 10);
  tailGeo.rotateZ(Math.PI / 2);

  for (const side of [-1, 1] as const) {
    addMesh(parent, headGeo, headlightMat, {
      x: side * xOffset,
      y: lightY,
      z: frontZ,
      sz: 0.72,
      castShadow: false,
    });
    addMesh(parent, tailGeo, brakeLightMat, {
      x: side * xOffset,
      y: lightY + 0.04,
      z: rearZ,
      sz: 0.72,
      castShadow: false,
    });
  }

  return [brakeLightMat];
}

function buildBansheeMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_banshee';

  const realisticBodyHex = colorHex === 0xff2e93 ? 0xb80e24 : colorHex;
  const bodyMat = createCarPaintMaterial(realisticBodyHex, {
    metalness: 0.65,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3,
  });
  const trimHex = accentHex === 0x00f0ff ? 0x262930 : accentHex;
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: trimHex,
    roughness: 0.28,
    metalness: 0.62,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
  });
  const glassMat = createTintedGlassMaterial(0x0c1118, {
    envMapIntensity: 1.4,
  });
  const carbonMat = createCarbonMaterial();
  const chromeMat = createChromeMaterial();
  const headlightMat = createXenonHeadlightMaterial();
  const brakeLightMat = createBrakeLightMaterial(BANSHEE_BRAKE_EMISSIVE_INTENSITY);

  // Sculpted low-slung wedge supercar lower chassis
  const hullGeo = createProfileGeometry(
    [
      [-2.18, 0.34],
      [2.12, 0.3],
      [2.26, 0.48],
      [2.14, 0.68],
      [1.46, 0.87],
      [0.74, 0.94],
      [-1.56, 0.98],
      [-2.16, 0.88],
      [-2.24, 0.54],
    ],
    2.04,
    0.07,
  );
  addMesh(group, hullGeo, bodyMat, { name: 'banshee_chassis' });

  // Aggressive carbon front splitter & recessed nose intake
  addMesh(group, new THREE.BoxGeometry(2.08, 0.07, 0.48), carbonMat, {
    y: 0.28,
    z: 2.08,
  });
  addMesh(group, new THREE.BoxGeometry(1.36, 0.2, 0.14), carbonMat, {
    y: 0.43,
    z: 2.22,
  });

  // Tapered hood air vent & racing accent strip
  addMesh(group, new THREE.BoxGeometry(0.76, 0.06, 0.62), carbonMat, {
    y: 0.87,
    z: 1.24,
    rx: 0.14,
  });
  for (let i = 0; i < 3; i += 1) {
    addMesh(group, new THREE.BoxGeometry(0.68, 0.03, 0.08), bodyMat, {
      y: 0.9 - i * 0.025,
      z: 1.06 + i * 0.18,
      rx: 0.2,
    });
  }
  addMesh(group, new THREE.BoxGeometry(0.24, 0.035, 1.45), accentMat, {
    y: 0.84,
    z: 1.44,
    rx: 0.16,
    castShadow: false,
  });

  // Sculpted wide-body wheel arches, side skirts, and flank aero intakes
  const frontArchGeo = createProfileGeometry(
    [
      [0.86, 0.34],
      [1.86, 0.34],
      [1.76, 0.88],
      [0.98, 0.92],
    ],
    0.16,
    0.03,
  );
  const rearArchGeo = createProfileGeometry(
    [
      [-1.92, 0.38],
      [-0.78, 0.34],
      [-0.86, 0.98],
      [-1.88, 0.95],
    ],
    0.2,
    0.035,
  );
  const skirtGeo = new THREE.BoxGeometry(0.14, 0.12, 1.92);
  const scoopGeo = new THREE.BoxGeometry(0.12, 0.32, 0.54);

  for (const side of [-1, 1] as const) {
    addMesh(group, frontArchGeo, bodyMat, { x: side * 0.98 });
    addMesh(group, rearArchGeo, bodyMat, { x: side * 1.0 });
    addMesh(group, skirtGeo, carbonMat, { x: side * 1.03, y: 0.31, z: 0.02 });
    addMesh(group, scoopGeo, carbonMat, { x: side * 1.02, y: 0.66, z: -0.64 });
  }

  // Sleek fastback cabin greenhouse + painted roof cap + rear louvered engine bay
  const cabinGeo = createProfileGeometry(
    [
      [-1.44, 0.95],
      [0.82, 0.91],
      [0.24, 1.34],
      [-0.62, 1.36],
      [-1.44, 1.0],
    ],
    1.58,
    0.05,
  );
  addMesh(group, cabinGeo, glassMat, { name: 'banshee_cabin_glass' });

  const roofCapGeo = createProfileGeometry(
    [
      [-0.64, 1.33],
      [0.22, 1.31],
      [0.14, 1.38],
      [-0.58, 1.39],
    ],
    1.34,
    0.025,
  );
  addMesh(group, roofCapGeo, bodyMat);

  // Rear fastback carbon louvers over mid-mounted engine bay
  for (let i = 0; i < 4; i += 1) {
    const t = i / 3;
    addMesh(group, new THREE.BoxGeometry(1.22, 0.045, 0.15), carbonMat, {
      y: 1.27 - t * 0.24,
      z: -0.74 - t * 0.56,
      rx: -0.38,
    });
  }

  // Aerodynamic side wing mirrors
  attachSideMirrors(group, 0.96, 1.02, 0.46, bodyMat, carbonMat, 1.0);

  // Raised carbon-fiber GT rear wing with swan-neck struts & glowing accent endplates
  for (const sx of [-0.62, 0.62] as const) {
    addMesh(group, new THREE.BoxGeometry(0.08, 0.38, 0.22), carbonMat, {
      x: sx,
      y: 1.08,
      z: -1.96,
      rx: -0.18,
    });
  }
  addMesh(group, new THREE.BoxGeometry(2.04, 0.08, 0.36), carbonMat, {
    y: 1.28,
    z: -2.06,
    rx: 0.08,
  });
  for (const sx of [-1.03, 1.03] as const) {
    addMesh(group, new THREE.BoxGeometry(0.05, 0.24, 0.42), accentMat, {
      x: sx,
      y: 1.26,
      z: -2.06,
      castShadow: false,
    });
  }

  // Rear carbon diffuser with vertical aero strakes
  addMesh(group, new THREE.BoxGeometry(1.88, 0.24, 0.24), carbonMat, {
    y: 0.4,
    z: -2.18,
  });
  for (const fx of [-0.72, -0.24, 0.24, 0.72] as const) {
    addMesh(group, new THREE.BoxGeometry(0.05, 0.22, 0.32), carbonMat, {
      x: fx,
      y: 0.36,
      z: -2.2,
    });
  }

  // Full-width glowing crimson LED taillight bar (bloom-ready)
  addMesh(group, new THREE.BoxGeometry(1.88, 0.11, 0.1), brakeLightMat, {
    y: 0.76,
    z: -2.22,
    name: 'banshee_taillight_bar',
    castShadow: false,
  });
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.32, 0.16, 0.11), brakeLightMat, {
      x: side * 0.82,
      y: 0.76,
      z: -2.21,
      castShadow: false,
    });
  }

  // Swept xenon headlights + cyan DRL brows + forward road beam cones
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.42, 0.14, 0.22), headlightMat, {
      x: side * 0.72,
      y: 0.62,
      z: 2.12,
      ry: side * 0.2,
      castShadow: false,
    });
    addMesh(group, new THREE.BoxGeometry(0.46, 0.04, 0.2), accentMat, {
      x: side * 0.73,
      y: 0.71,
      z: 2.1,
      ry: side * 0.2,
      castShadow: false,
    });
  }
  const headlightCones = attachHeadlightCones(group, 0.72, 0.62, 2.22, 4.6, 0.95);

  // Realistic dark contact shadow beneath chassis (no cartoon neon underglow)
  attachContactShadow(group, 2.35, 4.85, 0.62, 0.03);

  // Twin chrome exhaust tips & subtle afterburner nitro flames
  const nitroFlames = new THREE.Group();
  nitroFlames.name = 'nitro_flames';
  nitroFlames.visible = false;

  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: 0x62b8ff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const boreMat = new THREE.MeshStandardMaterial({
    color: 0x09080e,
    roughness: 0.9,
  });

  for (const ex of [-0.46, 0.46] as const) {
    addMesh(group, new THREE.CylinderGeometry(0.11, 0.11, 0.26, 12), chromeMat, {
      x: ex,
      y: 0.4,
      z: -2.26,
      rx: Math.PI / 2,
    });
    addMesh(group, new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10), boreMat, {
      x: ex,
      y: 0.4,
      z: -2.37,
      rx: Math.PI / 2,
      castShadow: false,
    });

    addMesh(nitroFlames, new THREE.ConeGeometry(0.19, 1.4, 10), outerFlameMat, {
      x: ex,
      y: 0.4,
      z: -3.04,
      rx: -Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
    addMesh(nitroFlames, new THREE.ConeGeometry(0.11, 0.9, 10), innerFlameMat, {
      x: ex,
      y: 0.4,
      z: -2.78,
      rx: -Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
  }
  group.add(nitroFlames);

  const rig = attachWheels(
    group,
    [
      { x: -0.98, z: 1.36, isFront: true },
      { x: 0.98, z: 1.36, isFront: true },
      { x: -0.98, z: -1.36, isFront: false },
      { x: 0.98, z: -1.36, isFront: false },
    ],
    0.37,
    0.31,
    0xe81e3c,
  );

  group.userData.nitroFlames = nitroFlames;
  group.userData.headlightCones = headlightCones;
  group.userData.brakeLightMaterials = [brakeLightMat];
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildTaxiMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_taxi';

  const bodyMat = createCarPaintMaterial(colorHex);
  const trimMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.45,
    metalness: 0.25,
  });
  const glassMat = createTintedGlassMaterial(0x14172b);
  const chromeMat = createChromeMaterial();

  // Metallic yellow sculpted sedan silhouette
  const lowerHullGeo = createProfileGeometry(
    [
      [-2.06, 0.34],
      [2.06, 0.34],
      [2.12, 0.68],
      [1.96, 0.9],
      [1.06, 1.02],
      [-1.18, 1.04],
      [-2.04, 0.98],
      [-2.12, 0.56],
    ],
    1.94,
    0.06,
  );
  addMesh(group, lowerHullGeo, bodyMat, { name: 'taxi_chassis' });

  // Sculpted sedan tinted greenhouse & clearcoat roof
  const cabinGeo = createProfileGeometry(
    [
      [-1.24, 1.0],
      [1.02, 0.99],
      [0.54, 1.56],
      [-0.78, 1.56],
    ],
    1.68,
    0.04,
  );
  addMesh(group, cabinGeo, glassMat);

  const roofGeo = createProfileGeometry(
    [
      [-0.82, 1.53],
      [0.56, 1.53],
      [0.48, 1.62],
      [-0.74, 1.62],
    ],
    1.56,
    0.025,
  );
  addMesh(group, roofGeo, bodyMat);

  // Black/white checkered side trim along both flanks
  const checkerTex = createCheckerTrimTexture();
  const checkerMat = new THREE.MeshStandardMaterial({
    color: checkerTex ? 0xffffff : 0x161622,
    ...(checkerTex ? { map: checkerTex } : {}),
    roughness: 0.4,
    metalness: 0.15,
  });
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.04, 0.15, 3.35), checkerMat, {
      x: side * 0.975,
      y: 0.68,
      z: -0.02,
      castShadow: false,
    });
  }

  // Chrome front grille, front/rear bumpers & side wing mirrors
  addMesh(group, new THREE.BoxGeometry(0.92, 0.24, 0.1), chromeMat, {
    y: 0.62,
    z: 2.11,
  });
  addMesh(group, new THREE.BoxGeometry(1.9, 0.14, 0.16), trimMat, {
    y: 0.4,
    z: 2.1,
  });
  addMesh(group, new THREE.BoxGeometry(1.9, 0.14, 0.16), trimMat, {
    y: 0.42,
    z: -2.1,
  });
  attachSideMirrors(group, 0.94, 1.08, 0.56, bodyMat, trimMat, 0.95);

  // Illuminated yellow TAXI roof sign (subtle golden-hour glow)
  const taxiSignTex = createTaxiSignTexture();
  const taxiSignMat = new THREE.MeshStandardMaterial({
    color: 0xf0c94a,
    emissive: 0xe6ad14,
    emissiveIntensity: 0.72,
    ...(taxiSignTex ? { map: taxiSignTex } : {}),
    roughness: 0.24,
  });
  addMesh(group, new THREE.BoxGeometry(0.76, 0.26, 0.34), taxiSignMat, {
    y: 1.74,
    z: -0.04,
    name: 'taxi_roof_sign',
  });

  attachContactShadow(group, 2.25, 4.55, 0.58, 0.03);

  const rig = attachWheels(
    group,
    [
      { x: -0.92, z: 1.28, isFront: true },
      { x: 0.92, z: 1.28, isFront: true },
      { x: -0.92, z: -1.28, isFront: false },
      { x: 0.92, z: -1.28, isFront: false },
    ],
    0.35,
    0.26,
    0x4a4f62,
  );
  const brakeLightMaterials = attachStandardLampPairs(group, 0.96, 2.11, -2.11, 0.68);

  group.userData.brakeLightMaterials = brakeLightMaterials;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildMioBusMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_mio_bus';

  const blueMat = createCarPaintMaterial(colorHex, {
    metalness: 0.48,
    roughness: 0.2,
    clearcoat: 0.95,
  });
  const whiteMat = createCarPaintMaterial(accentHex, {
    metalness: 0.34,
    roughness: 0.22,
    clearcoat: 0.92,
  });
  const glassMat = createTintedGlassMaterial(0x0c162b, {
    emissive: 0x0b223d,
    emissiveIntensity: 0.28,
  });
  const bellowsMat = new THREE.MeshStandardMaterial({
    color: 0x1c1a2a,
    roughness: 0.88,
    metalness: 0.08,
  });
  const trimMat = createCarbonMaterial();
  const liveryAccentMat = createCarPaintMaterial(0x1f82c9, {
    metalness: 0.45,
    roughness: 0.22,
  });
  const routeBoardMat = new THREE.MeshStandardMaterial({
    color: 0xffcf6b,
    emissive: 0xffb338,
    emissiveIntensity: 1.15,
    roughness: 0.18,
  });
  const acPodMat = createCarPaintMaterial(0xdde4f2, {
    metalness: 0.3,
    roughness: 0.26,
  });

  // Smooth curved aerodynamic front articulated coach (quadraticCurveTo nose, windshield & roofline)
  const frontLowerGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-0.08, 0.46);
      shape.lineTo(4.24, 0.46);
      shape.quadraticCurveTo(4.56, 0.5, 4.58, 0.84);
      shape.quadraticCurveTo(4.56, 1.24, 4.46, 1.46);
      shape.lineTo(-0.08, 1.46);
      shape.closePath();
    },
    2.44,
    0.1,
  );
  addMesh(group, frontLowerGeo, blueMat, { name: 'mio_front_lower' });

  const frontUpperGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-0.08, 1.42);
      shape.lineTo(4.46, 1.42);
      shape.quadraticCurveTo(4.42, 2.26, 4.24, 2.7);
      shape.quadraticCurveTo(4.1, 2.94, 3.68, 2.94);
      shape.lineTo(0.18, 2.94);
      shape.quadraticCurveTo(-0.08, 2.94, -0.08, 2.72);
      shape.closePath();
    },
    2.4,
    0.1,
  );
  addMesh(group, frontUpperGeo, whiteMat, { name: 'mio_front_upper' });

  // Smooth curved panoramic tinted glazing wrapping sides & aerodynamic swept front windshield
  const frontGlassGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(0.12, 1.56);
      shape.lineTo(4.44, 1.56);
      shape.quadraticCurveTo(4.42, 2.18, 4.26, 2.54);
      shape.lineTo(0.12, 2.54);
      shape.closePath();
    },
    2.45,
    0.05,
  );
  addMesh(group, frontGlassGeo, glassMat, {
    name: 'mio_front_glass',
    castShadow: false,
  });

  // Contoured front bumper skirt & aerodynamic livery accent strip
  addMesh(group, createRoundedPodGeometry(2.44, 0.28, 0.34, 0.11, 0.04), trimMat, {
    y: 0.54,
    z: 4.48,
  });
  addMesh(group, createRoundedPodGeometry(2.48, 0.12, 4.38, 0.05, 0.02), liveryAccentMat, {
    y: 1.45,
    z: 2.16,
    castShadow: false,
  });

  // Rounded articulated accordion bellows connector (zero sharp corners)
  const bellowsGeo = createRoundedPodGeometry(2.18, 2.24, 0.92, 0.32, 0.04);
  addMesh(group, bellowsGeo, bellowsMat, { y: 1.68, z: -0.52 });
  const bellowsRibGeo = createRoundedPodGeometry(2.26, 2.3, 0.1, 0.34, 0.025);
  for (let rib = -1; rib <= 1; rib += 1) {
    addMesh(group, bellowsRibGeo, trimMat, {
      y: 1.68,
      z: -0.52 + rib * 0.26,
      castShadow: false,
    });
  }

  // Smooth curved rear articulated coach with beveled transom & rounded roof edge
  const rearLowerGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-4.38, 0.46);
      shape.lineTo(-0.94, 0.46);
      shape.lineTo(-0.94, 1.46);
      shape.lineTo(-4.56, 1.46);
      shape.quadraticCurveTo(-4.62, 0.86, -4.38, 0.46);
      shape.closePath();
    },
    2.44,
    0.1,
  );
  addMesh(group, rearLowerGeo, blueMat, { name: 'mio_rear_lower' });

  const rearUpperGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-4.56, 1.42);
      shape.lineTo(-0.94, 1.42);
      shape.lineTo(-0.94, 2.94);
      shape.lineTo(-4.18, 2.94);
      shape.quadraticCurveTo(-4.54, 2.92, -4.56, 2.52);
      shape.closePath();
    },
    2.4,
    0.1,
  );
  addMesh(group, rearUpperGeo, whiteMat, { name: 'mio_rear_upper' });

  const rearGlassGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-4.48, 1.56);
      shape.lineTo(-1.12, 1.56);
      shape.lineTo(-1.12, 2.54);
      shape.lineTo(-4.36, 2.54);
      shape.quadraticCurveTo(-4.48, 2.38, -4.48, 2.18);
      shape.closePath();
    },
    2.45,
    0.05,
  );
  addMesh(group, rearGlassGeo, glassMat, {
    name: 'mio_rear_glass',
    castShadow: false,
  });

  addMesh(group, createRoundedPodGeometry(2.44, 0.26, 0.32, 0.1, 0.04), trimMat, {
    y: 0.54,
    z: -4.48,
  });
  addMesh(group, createRoundedPodGeometry(2.48, 0.12, 3.48, 0.05, 0.02), liveryAccentMat, {
    y: 1.45,
    z: -2.76,
    castShadow: false,
  });

  // Curved flared wheel arches over all 6 MIO bus axles
  const archGeo = createFlaredWheelArchGeometry(0.49, 0.14, 0.18);
  for (const wz of [3.15, 0.75, -3.25] as const) {
    for (const side of [-1, 1] as const) {
      addMesh(group, archGeo, trimMat, {
        x: side * 1.18,
        y: 0.44,
        z: wz,
      });
    }
  }

  // Curved illuminated front LED destination route board
  addMesh(group, createRoundedPodGeometry(1.74, 0.28, 0.16, 0.08, 0.03), routeBoardMat, {
    y: 2.66,
    z: 4.3,
    name: 'mio_route_board',
    castShadow: false,
  });

  // Twin sleek streamlined aerodynamic roof AC pods (curved airfoil cowlings)
  const frontAcPodGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-1.05, 0);
      shape.lineTo(1.05, 0);
      shape.quadraticCurveTo(0.88, 0.29, 0.42, 0.3);
      shape.lineTo(-0.56, 0.3);
      shape.quadraticCurveTo(-0.96, 0.28, -1.05, 0);
      shape.closePath();
    },
    1.62,
    0.07,
  );
  addMesh(group, frontAcPodGeo, acPodMat, {
    y: 2.91,
    z: 1.9,
    name: 'mio_ac_pod_front',
  });
  addMesh(group, frontAcPodGeo, acPodMat, {
    y: 2.91,
    z: -2.65,
    sz: 0.88,
    name: 'mio_ac_pod_rear',
  });

  // Streamlined tubular bus side mirrors (zero sharp boxes)
  const mirrorArmGeo = new THREE.CylinderGeometry(0.028, 0.032, 0.32, 8);
  mirrorArmGeo.rotateZ(Math.PI / 2);
  const mirrorHeadGeo = new THREE.CapsuleGeometry(0.085, 0.26, 6, 10);
  for (const side of [-1, 1] as const) {
    addMesh(group, mirrorArmGeo, trimMat, {
      x: side * 1.32,
      y: 2.18,
      z: 4.18,
    });
    addMesh(group, mirrorHeadGeo, trimMat, {
      x: side * 1.46,
      y: 2.02,
      z: 4.22,
      sx: 0.72,
    });
  }

  attachContactShadow(group, 2.75, 9.45, 0.6, 0.03);

  const rig = attachWheels(
    group,
    [
      { x: -1.16, z: 3.15, isFront: true },
      { x: 1.16, z: 3.15, isFront: true },
      { x: -1.16, z: 0.75, isFront: false },
      { x: 1.16, z: 0.75, isFront: false },
      { x: -1.16, z: -3.25, isFront: false },
      { x: 1.16, z: -3.25, isFront: false },
    ],
    0.44,
    0.32,
    0x3a4052,
  );
  const brakeLightMaterials = attachStandardLampPairs(group, 1.12, 4.54, -4.54, 0.84);
  const headlightCones = attachHeadlightCones(group, 0.84, 0.84, 4.58, 4.6, 0.92);

  group.userData.brakeLightMaterials = brakeLightMaterials;
  group.userData.headlightCones = headlightCones;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildChivaMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_chiva';

  const primaryMat = createCarPaintMaterial(colorHex, {
    metalness: 0.35,
    roughness: 0.26,
  });
  const accentMat = createCarPaintMaterial(accentHex, {
    metalness: 0.32,
    roughness: 0.26,
  });
  const emeraldMat = createCarPaintMaterial(0x00d98b, {
    metalness: 0.3,
    roughness: 0.28,
  });
  const cyanMat = createCarPaintMaterial(0x00d8f0, {
    metalness: 0.3,
    roughness: 0.28,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x7b4722,
    roughness: 0.76,
    metalness: 0.05,
  });
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x522d14,
    roughness: 0.82,
    metalness: 0.04,
  });
  const chromeMat = createChromeMaterial();
  const windshieldMat = createTintedGlassMaterial(0x161d33);
  const garlandWireMat = new THREE.MeshStandardMaterial({
    color: 0x1b1922,
    roughness: 0.7,
    metalness: 0.2,
  });

  // Classic curved bulbous vintage Chiva front engine hood (quadraticCurveTo silhouette)
  const noseGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(1.98, 0.54);
      shape.lineTo(3.26, 0.56);
      shape.quadraticCurveTo(3.48, 0.72, 3.46, 1.16);
      shape.quadraticCurveTo(3.42, 1.48, 3.04, 1.54);
      shape.quadraticCurveTo(2.48, 1.6, 1.98, 1.58);
      shape.closePath();
    },
    1.76,
    0.1,
  );
  addMesh(group, noseGeo, accentMat, { name: 'chiva_nose' });

  // Curved flared wheel-arch fenders over front and rear wheels
  const frontFenderGeo = createFlaredWheelArchGeometry(0.5, 0.16, 0.42);
  const rearFenderGeo = createFlaredWheelArchGeometry(0.5, 0.14, 0.22);
  for (const side of [-1, 1] as const) {
    addMesh(group, frontFenderGeo, primaryMat, {
      x: side * 0.98,
      y: 0.44,
      z: 2.15,
    });
    addMesh(group, rearFenderGeo, accentMat, {
      x: side * 1.14,
      y: 0.44,
      z: -1.85,
    });
  }

  // Gleaming curved wrap-around chrome front bumper & rounded chrome radiator grille slats
  addMesh(group, createRoundedPodGeometry(2.04, 0.2, 0.22, 0.08, 0.04), chromeMat, {
    y: 0.6,
    z: 3.48,
  });
  const grilleSlatGeo = new THREE.CapsuleGeometry(0.035, 1.06, 6, 10);
  grilleSlatGeo.rotateZ(Math.PI / 2);
  for (let slat = 0; slat < 4; slat += 1) {
    addMesh(group, grilleSlatGeo, chromeMat, {
      y: 0.86 + slat * 0.14,
      z: 3.45,
    });
  }

  // Contoured curved front cab windshield brow
  addMesh(group, createRoundedPodGeometry(2.18, 0.92, 0.16, 0.12, 0.03), windshieldMat, {
    y: 2.02,
    z: 2.1,
    rx: -0.08,
  });

  // Sculpted curved multi-colored lower wooden-slat Chiva coach hull (zero flat box edges)
  const chivaHullGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-2.88, 0.52);
      shape.lineTo(2.04, 0.52);
      shape.quadraticCurveTo(2.14, 0.56, 2.14, 0.72);
      shape.lineTo(2.14, 1.44);
      shape.quadraticCurveTo(2.14, 1.54, 1.98, 1.54);
      shape.lineTo(-2.84, 1.54);
      shape.quadraticCurveTo(-3.08, 1.52, -3.1, 1.18);
      shape.quadraticCurveTo(-3.12, 0.62, -2.88, 0.52);
      shape.closePath();
    },
    2.34,
    0.09,
  );
  addMesh(group, chivaHullGeo, primaryMat, { name: 'chiva_hull' });

  // Contoured vibrant fiesta horizontal livery ribbons & rounded wooden slat rub rails
  addMesh(group, createRoundedPodGeometry(2.4, 0.2, 5.04, 0.07, 0.025), cyanMat, {
    y: 1.2,
    z: -0.46,
  });
  addMesh(group, createRoundedPodGeometry(2.4, 0.17, 5.04, 0.06, 0.025), emeraldMat, {
    y: 0.84,
    z: -0.46,
  });

  const runningBoardGeo = createRoundedPodGeometry(0.18, 0.09, 4.78, 0.04, 0.02);
  const slatRailGeo = new THREE.CapsuleGeometry(0.036, 4.9, 6, 10);
  slatRailGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1] as const) {
    addMesh(group, runningBoardGeo, woodMat, {
      x: side * 1.22,
      y: 0.56,
      z: -0.46,
    });
    for (let slat = 0; slat < 3; slat += 1) {
      addMesh(group, slatRailGeo, woodMat, {
        x: side * 1.21,
        y: 0.74 + slat * 0.27,
        z: -0.46,
        castShadow: false,
      });
    }
  }

  // Open-air rounded wooden passenger benches & turned cylindrical canopy pillars
  const benchMats = [woodMat, accentMat, emeraldMat] as const;
  const benchSeatGeo = createRoundedPodGeometry(2.06, 0.16, 0.46, 0.06, 0.025);
  const benchBackGeo = createRoundedPodGeometry(2.06, 0.4, 0.12, 0.05, 0.02);
  const pillarGeo = new THREE.CylinderGeometry(0.062, 0.072, 1.18, 10);
  for (let i = 0; i < 4; i += 1) {
    const zPos = 1.42 - i * 1.26;
    const benchMat = benchMats[i % benchMats.length] ?? woodMat;
    addMesh(group, benchSeatGeo, benchMat, { y: 1.24, z: zPos });
    addMesh(group, benchBackGeo, woodMat, { y: 1.5, z: zPos - 0.21 });

    for (const side of [-1.08, 1.08] as const) {
      addMesh(group, pillarGeo, accentMat, {
        x: side,
        y: 2.02,
        z: zPos,
      });
    }
  }

  // Curved traditional arched wooden canopy roof (barrel-vaulted cross-section)
  const archedRoofGeo = createCurvedCrossExtrude(
    (shape) => {
      shape.moveTo(-1.26, 2.54);
      shape.quadraticCurveTo(0, 2.98, 1.26, 2.54);
      shape.quadraticCurveTo(1.3, 2.66, 1.2, 2.74);
      shape.quadraticCurveTo(0, 3.16, -1.2, 2.74);
      shape.quadraticCurveTo(-1.3, 2.66, -1.26, 2.54);
      shape.closePath();
    },
    5.48,
    0.07,
  );
  addMesh(group, archedRoofGeo, primaryMat, {
    z: -0.42,
    name: 'chiva_arched_roof',
  });

  // Curved traditional arched wooden roof ribs spanning across the barrel ceiling
  const ribCurvePoints = [
    new THREE.Vector3(-1.22, 2.56, 0),
    new THREE.Vector3(-0.62, 2.8, 0),
    new THREE.Vector3(0, 2.89, 0),
    new THREE.Vector3(0.62, 2.8, 0),
    new THREE.Vector3(1.22, 2.56, 0),
  ];
  const ribCurve = new THREE.CatmullRomCurve3(ribCurvePoints);
  const ribGeo = new THREE.TubeGeometry(ribCurve, 14, 0.052, 8, false);
  for (let r = 0; r < 6; r += 1) {
    const rz = 2.0 - r * 0.98;
    addMesh(group, ribGeo, darkWoodMat, { z: rz, castShadow: false });
  }

  // Tubular wooden rooftop luggage rack railing
  const longRailGeo = new THREE.CylinderGeometry(0.036, 0.036, 4.9, 8);
  longRailGeo.rotateX(Math.PI / 2);
  const crossRailGeo = new THREE.CylinderGeometry(0.036, 0.036, 2.16, 8);
  crossRailGeo.rotateZ(Math.PI / 2);
  const rackPostGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.34, 8);
  for (const side of [-1.06, 1.06] as const) {
    addMesh(group, longRailGeo, woodMat, { x: side, y: 3.1, z: -0.46 });
    for (const pz of [-2.86, -1.24, 0.38, 1.94] as const) {
      addMesh(group, rackPostGeo, woodMat, { x: side, y: 2.94, z: pz });
    }
  }
  for (const endZ of [-2.88, 1.96] as const) {
    addMesh(group, crossRailGeo, woodMat, { y: 3.1, z: endZ });
  }

  // Organic rounded colorful rooftop luggage bundles & rolled woven sacks (zero boxy cubes)
  addMesh(group, new THREE.CapsuleGeometry(0.28, 0.62, 8, 12), accentMat, {
    x: -0.46,
    y: 3.16,
    z: 0.84,
    rx: Math.PI / 2,
  });
  addMesh(group, new THREE.CapsuleGeometry(0.25, 0.52, 8, 12), cyanMat, {
    x: 0.44,
    y: 3.14,
    z: 0.7,
    rx: Math.PI / 2,
  });
  addMesh(group, new THREE.SphereGeometry(0.46, 12, 10), emeraldMat, {
    x: 0.0,
    y: 3.22,
    z: -0.68,
    sx: 1.45,
    sy: 0.72,
    sz: 1.25,
  });
  addMesh(group, new THREE.CapsuleGeometry(0.26, 0.64, 8, 12), accentMat, {
    x: -0.18,
    y: 3.14,
    z: -1.96,
    rz: Math.PI / 2,
  });

  // Draped catenary party bulb garlands along both curved roof eaves (glows warmly at night!)
  const bulbPalette = [0xffcf54, 0xff9e3d, 0xffe680, 0xff5c8a] as const;
  const bulbGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const bulbMats = bulbPalette.map(
    (hex) =>
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 1.45,
        roughness: 0.16,
      }),
  );

  for (const side of [-1.27, 1.27] as const) {
    const garlandPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const gz = 2.16 - t * 5.16;
      const sag = Math.abs(Math.sin(t * Math.PI * 3)) * 0.14;
      garlandPoints.push(new THREE.Vector3(side, 2.58 - sag, gz));
    }
    const garlandCurve = new THREE.CatmullRomCurve3(garlandPoints);
    addMesh(
      group,
      new THREE.TubeGeometry(garlandCurve, 24, 0.018, 6, false),
      garlandWireMat,
      { castShadow: false, receiveShadow: false },
    );

    for (let i = 0; i < 8; i += 1) {
      const pt = garlandCurve.getPoint(i / 7);
      const bulbMat = bulbMats[i % bulbMats.length];
      if (!bulbMat) {
        continue;
      }
      addMesh(group, bulbGeo, bulbMat, {
        x: pt.x,
        y: pt.y - 0.07,
        z: pt.z,
        castShadow: false,
        receiveShadow: false,
      });
    }
  }

  // Front & rear arched brow party bulbs framing the Chiva silhouette
  for (const browZ of [2.32, -3.14] as const) {
    for (let i = 0; i < 5; i += 1) {
      const t = i / 4;
      const bx = -1.04 + t * 2.08;
      const archLift = Math.sin(t * Math.PI) * 0.24;
      const bulbMat = bulbMats[i % bulbMats.length];
      if (!bulbMat) {
        continue;
      }
      addMesh(group, bulbGeo, bulbMat, {
        x: bx,
        y: 2.6 + archLift,
        z: browZ,
        castShadow: false,
        receiveShadow: false,
      });
    }
  }

  attachContactShadow(group, 2.75, 6.95, 0.58, 0.03);

  const rig = attachWheels(
    group,
    [
      { x: -1.12, z: 2.15, isFront: true },
      { x: 1.12, z: 2.15, isFront: true },
      { x: -1.12, z: -1.85, isFront: false },
      { x: 1.12, z: -1.85, isFront: false },
    ],
    0.44,
    0.32,
    0x4a423a,
  );
  const brakeLightMaterials = attachStandardLampPairs(group, 0.94, 3.44, -3.08, 0.88);
  const headlightCones = attachHeadlightCones(group, 0.68, 0.88, 3.48, 4.4, 0.88);

  group.userData.brakeLightMaterials = brakeLightMaterials;
  group.userData.headlightCones = headlightCones;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildPoliceMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_police';

  const bodyMat = createCarPaintMaterial(colorHex);
  const emeraldMat = createCarPaintMaterial(accentHex);
  const glassMat = createTintedGlassMaterial(0x101324);
  const bumperMat = createCarbonMaterial();
  const safetyStripeMat = new THREE.MeshStandardMaterial({
    color: 0xc2e636,
    emissive: 0x7da318,
    emissiveIntensity: 0.22,
    roughness: 0.3,
  });

  // Muscular white & emerald-green Policía Nacional patrol SUV silhouette
  const lowerHullGeo = createProfileGeometry(
    [
      [-2.24, 0.4],
      [2.22, 0.4],
      [2.32, 0.72],
      [2.2, 1.06],
      [1.22, 1.14],
      [-2.18, 1.16],
      [-2.28, 0.7],
    ],
    2.08,
    0.06,
  );
  addMesh(group, lowerHullGeo, bodyMat, { name: 'police_chassis' });

  // Emerald-green Policía Nacional tactical hood & side livery panels
  addMesh(group, new THREE.BoxGeometry(1.88, 0.08, 1.18), emeraldMat, {
    y: 1.13,
    z: 1.56,
    rx: 0.08,
  });
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.05, 0.34, 3.92), emeraldMat, {
      x: side * 1.045,
      y: 0.78,
      z: -0.02,
      castShadow: false,
    });
    addMesh(group, new THREE.BoxGeometry(0.06, 0.08, 3.86), safetyStripeMat, {
      x: side * 1.055,
      y: 0.94,
      z: -0.02,
      castShadow: false,
    });
  }

  // Tinted SUV greenhouse cabin & white roof cap
  const cabinGeo = createProfileGeometry(
    [
      [-2.04, 1.14],
      [1.18, 1.12],
      [0.64, 1.78],
      [-1.82, 1.78],
    ],
    1.84,
    0.045,
  );
  addMesh(group, cabinGeo, glassMat);

  const roofGeo = createProfileGeometry(
    [
      [-1.86, 1.74],
      [0.68, 1.74],
      [0.58, 1.84],
      [-1.78, 1.84],
    ],
    1.76,
    0.03,
  );
  addMesh(group, roofGeo, bodyMat);

  // Heavy tactical tubular bullbar bumper
  addMesh(group, new THREE.BoxGeometry(1.54, 0.1, 0.14), bumperMat, {
    y: 0.56,
    z: 2.42,
  });
  addMesh(group, new THREE.BoxGeometry(1.44, 0.09, 0.12), bumperMat, {
    y: 0.92,
    z: 2.4,
  });
  for (const bx of [-0.54, 0.54] as const) {
    addMesh(group, new THREE.BoxGeometry(0.11, 0.54, 0.2), bumperMat, {
      x: bx,
      y: 0.74,
      z: 2.38,
    });
  }

  // Roof rack rails & side mirrors
  for (const side of [-0.74, 0.74] as const) {
    addMesh(group, new THREE.BoxGeometry(0.08, 0.09, 1.98), bumperMat, {
      x: side,
      y: 1.89,
      z: -0.58,
    });
  }
  attachSideMirrors(group, 1.0, 1.24, 0.68, emeraldMat, bumperMat, 1.05);

  // High-emissive red/blue lightbar pods + optional dynamic siren PointLight
  addMesh(group, new THREE.BoxGeometry(1.42, 0.1, 0.34), bumperMat, {
    y: 1.9,
    z: 0.08,
  });

  const redBeacon = addMesh(
    group,
    new THREE.BoxGeometry(0.56, 0.2, 0.28),
    new THREE.MeshStandardMaterial({
      color: 0xff294d,
      emissive: 0xff1c42,
      emissiveIntensity: 2.2,
      roughness: 0.12,
    }),
    {
      x: -0.36,
      y: 2.02,
      z: 0.08,
      name: 'police_red_beacon',
      castShadow: false,
    },
  );

  const blueBeacon = addMesh(
    group,
    new THREE.BoxGeometry(0.56, 0.2, 0.28),
    new THREE.MeshStandardMaterial({
      color: 0x2684ff,
      emissive: 0x1a75ff,
      emissiveIntensity: 2.2,
      roughness: 0.12,
    }),
    {
      x: 0.36,
      y: 2.02,
      z: 0.08,
      name: 'police_blue_beacon',
      castShadow: false,
    },
  );

  const sirenLight = new THREE.PointLight(0xff294d, 0, 14, 2);
  sirenLight.name = 'police_siren_light';
  sirenLight.position.set(0, 2.32, 0.08);
  sirenLight.castShadow = false;
  group.add(sirenLight);

  const rig = attachWheels(
    group,
    [
      { x: -1.0, z: 1.44, isFront: true },
      { x: 1.0, z: 1.44, isFront: true },
      { x: -1.0, z: -1.44, isFront: false },
      { x: 1.0, z: -1.44, isFront: false },
    ],
    0.4,
    0.3,
    0xd91c38,
  );
  const brakeLightMaterials = attachStandardLampPairs(group, 1.02, 2.31, -2.29, 0.78);
  const headlightCones = attachHeadlightCones(group, 0.7, 0.78, 2.35, 4.4, 0.9);
  attachContactShadow(group, 2.45, 4.95, 0.62, 0.03);

  group.userData.redBeacon = redBeacon;
  group.userData.blueBeacon = blueBeacon;
  group.userData.sirenLight = sirenLight;
  group.userData.headlightCones = headlightCones;
  group.userData.brakeLightMaterials = brakeLightMaterials;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

/**
 * Constructs a distinct sculpted PBR 3D vehicle mesh for any of the 5 Cali VehicleKind values.
 */
export function createVehicleMesh(
  kind: VehicleKind,
  colorHex: number,
  accentHex?: number,
): THREE.Group {
  switch (kind) {
    case 'banshee':
      return buildBansheeMesh(colorHex, accentHex ?? 0x00f0ff);
    case 'taxi':
      return buildTaxiMesh(colorHex, accentHex ?? 0x1a1a2e);
    case 'mio_bus':
      return buildMioBusMesh(colorHex, accentHex ?? 0xf8f7ff);
    case 'chiva':
      return buildChivaMesh(colorHex, accentHex ?? 0xffb800);
    case 'police':
      return buildPoliceMesh(colorHex, accentHex ?? 0x14532d);
  }
}

function attachOrganicSunglasses(
  parent: THREE.Object3D,
  shadesMat: THREE.Material,
  y: number,
  z: number,
  halfSpacing: number,
  lensRadius: number,
): void {
  const lensGeo = new THREE.SphereGeometry(lensRadius, 10, 8);
  for (const sx of [-halfSpacing, halfSpacing] as const) {
    addMesh(parent, lensGeo, shadesMat, {
      x: sx,
      y,
      z,
      sx: 1.18,
      sy: 0.72,
      sz: 0.42,
      castShadow: false,
    });
  }
  addMesh(
    parent,
    new THREE.CylinderGeometry(
      lensRadius * 0.2,
      lensRadius * 0.2,
      halfSpacing * 1.1,
      6,
    ),
    shadesMat,
    {
      y: y + 0.007,
      z: z + 0.006,
      rz: Math.PI / 2,
      castShadow: false,
    },
  );
}

/**
 * Creates a smooth organic 3D fallback mesh for Valeria (zero BoxGeometry, feet at y = 0, facing +Z).
 */
export function createPlayerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'player_valeria';

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd99b72,
    roughness: 0.62,
  });
  const jacketMat = new THREE.MeshPhysicalMaterial({
    color: 0x9e1c2e,
    roughness: 0.42,
    metalness: 0.12,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xd9cbb8,
    roughness: 0.45,
  });
  const innerTopMat = new THREE.MeshStandardMaterial({
    color: 0xf0ece4,
    roughness: 0.56,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x222736,
    roughness: 0.82,
    metalness: 0.04,
  });
  const sneakerMat = new THREE.MeshStandardMaterial({
    color: 0xeae8e3,
    roughness: 0.48,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x1b1412,
    roughness: 0.76,
    metalness: 0.08,
  });
  const shadesMat = createTintedGlassMaterial(0x11151d);

  const hipGeo = new THREE.SphereGeometry(0.085, 10, 8);
  const thighGeo = new THREE.CylinderGeometry(0.088, 0.072, 0.34, 12);
  const kneeGeo = new THREE.SphereGeometry(0.068, 10, 8);
  const calfGeo = new THREE.CapsuleGeometry(0.058, 0.25, 6, 12);
  const sneakerGeo = new THREE.CapsuleGeometry(0.058, 0.135, 6, 12);
  sneakerGeo.rotateX(Math.PI / 2);

  const buildLegPivot = (xPos: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(xPos, 0.8, 0);
    addMesh(pivot, hipGeo, pantsMat);
    addMesh(pivot, thighGeo, pantsMat, { y: -0.18 });
    addMesh(pivot, kneeGeo, pantsMat, { y: -0.35 });
    addMesh(pivot, calfGeo, pantsMat, { y: -0.52 });
    addMesh(pivot, sneakerGeo, sneakerMat, { y: -0.752, z: 0.045, sy: 0.82 });
    return pivot;
  };

  const leftLegPivot = buildLegPivot(0.115);
  const rightLegPivot = buildLegPivot(-0.115);
  group.add(leftLegPivot, rightLegPivot);

  // Rounded hips, sculpted tapered bomber jacket torso, collar & trim rings (zero BoxGeometry)
  addMesh(group, new THREE.SphereGeometry(0.185, 14, 10), pantsMat, {
    y: 0.84,
    sx: 1.08,
    sy: 0.68,
    sz: 0.76,
  });
  addMesh(group, new THREE.CylinderGeometry(0.2, 0.165, 0.48, 14), jacketMat, {
    y: 1.13,
    sx: 1.08,
    sz: 0.78,
  });
  addMesh(group, new THREE.SphereGeometry(0.195, 14, 10), jacketMat, {
    y: 1.34,
    sx: 1.08,
    sy: 0.56,
    sz: 0.78,
  });
  addMesh(group, new THREE.CylinderGeometry(0.11, 0.095, 0.44, 10), innerTopMat, {
    y: 1.12,
    z: 0.08,
    sx: 0.9,
    sz: 0.45,
  });
  addMesh(group, new THREE.CylinderGeometry(0.135, 0.155, 0.1, 12), jacketMat, {
    y: 1.39,
    z: -0.01,
  });
  addMesh(group, new THREE.TorusGeometry(0.168, 0.025, 8, 18), trimMat, {
    y: 0.9,
    rx: Math.PI / 2,
    sx: 1.06,
    sy: 0.78,
    castShadow: false,
  });

  // Rounded shoulder joints & articulated capsule arms with hands
  const shoulderGeo = new THREE.SphereGeometry(0.08, 10, 8);
  const sleeveGeo = new THREE.CapsuleGeometry(0.062, 0.22, 6, 10);
  const cuffGeo = new THREE.TorusGeometry(0.062, 0.015, 6, 12);
  cuffGeo.rotateX(Math.PI / 2);
  const forearmGeo = new THREE.CapsuleGeometry(0.048, 0.18, 6, 10);
  const handGeo = new THREE.SphereGeometry(0.05, 8, 8);

  const buildArmPivot = (xPos: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(xPos, 1.32, 0);
    addMesh(pivot, shoulderGeo, jacketMat);
    addMesh(pivot, sleeveGeo, jacketMat, { y: -0.14 });
    addMesh(pivot, cuffGeo, trimMat, { y: -0.28, castShadow: false });
    addMesh(pivot, forearmGeo, skinMat, { y: -0.39 });
    addMesh(pivot, handGeo, skinMat, { y: -0.52, sx: 0.88, sy: 1.12, sz: 0.78 });
    return pivot;
  };

  const leftArmPivot = buildArmPivot(0.255);
  const rightArmPivot = buildArmPivot(-0.255);
  group.add(leftArmPivot, rightArmPivot);

  // Neck, sculpted oval head, sleek rounded shades, hair cap & sweeping ponytail
  addMesh(group, new THREE.CylinderGeometry(0.058, 0.068, 0.12, 10), skinMat, { y: 1.44 });
  addMesh(group, new THREE.SphereGeometry(0.142, 14, 12), skinMat, {
    y: 1.58,
    sx: 0.86,
    sy: 1.05,
    sz: 0.92,
  });
  addMesh(
    group,
    new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMat,
    { y: 1.6, z: -0.015, sx: 0.89, sy: 1.06, sz: 0.95 },
  );
  attachOrganicSunglasses(group, shadesMat, 1.595, 0.118, 0.046, 0.044);

  // Sculpted two-segment ponytail sweeping back
  addMesh(group, new THREE.SphereGeometry(0.072, 10, 8), hairMat, { y: 1.61, z: -0.15 });
  addMesh(group, new THREE.ConeGeometry(0.085, 0.4, 10), hairMat, {
    y: 1.44,
    z: -0.23,
    rx: -0.44,
  });

  attachContactShadow(group, 0.85, 0.85, 0.45, 0.025);

  group.userData.leftLeg = leftLegPivot;
  group.userData.rightLeg = rightLegPivot;
  group.userData.leftArm = leftArmPivot;
  group.userData.rightArm = rightArmPivot;
  return group;
}

function cloneGroupWithMaterials(template: THREE.Group): THREE.Group {
  const cloned = template.clone(true);
  const clonedMaterials = new Map<THREE.Material, THREE.Material>();
  const clonedGeometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();

  const cloneMat = (mat: THREE.Material): THREE.Material => {
    const existing = clonedMaterials.get(mat);
    if (existing) {
      return existing;
    }
    const copy = mat.clone();
    clonedMaterials.set(mat, copy);
    return copy;
  };

  const cloneGeo = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
    const existing = clonedGeometries.get(geo);
    if (existing) {
      return existing;
    }
    const copy = geo.clone();
    clonedGeometries.set(geo, copy);
    return copy;
  };

  cloned.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    if (node.geometry instanceof THREE.BufferGeometry) {
      node.geometry = cloneGeo(node.geometry);
    }
    if (Array.isArray(node.material)) {
      node.material = node.material.map(cloneMat);
    } else if (node.material instanceof THREE.Material) {
      node.material = cloneMat(node.material);
    }
  });

  return cloned;
}

function attachFerrariNitroFlames(parent: THREE.Group): THREE.Group {
  const nitroFlames = new THREE.Group();
  nitroFlames.name = 'nitro_flames';
  nitroFlames.visible = false;

  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: 0x62b8ff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  for (const ex of [-0.26, 0.26] as const) {
    addMesh(nitroFlames, new THREE.ConeGeometry(0.12, 0.95, 10), outerFlameMat, {
      x: ex,
      y: 0.36,
      z: -2.74,
      rx: -Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
    addMesh(nitroFlames, new THREE.ConeGeometry(0.065, 0.58, 10), innerFlameMat, {
      x: ex,
      y: 0.36,
      z: -2.56,
      rx: -Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
  }

  parent.add(nitroFlames);
  return nitroFlames;
}

function attachFerrariPoliceKit(
  group: THREE.Group,
  roofY: number,
  halfWidth: number,
): void {
  const emeraldTrimMat = createCarPaintMaterial(0x0b7a45, {
    metalness: 0.54,
    roughness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
  });
  const railMat = createCarbonMaterial();

  // Contoured aerodynamic Policía Nacional emerald-green side-skirt blades & rear aero trim
  const sideBladeGeo = createRoundedPodGeometry(0.06, 0.14, 2.24, 0.03, 0.015);
  for (const side of [-1, 1] as const) {
    addMesh(group, sideBladeGeo, emeraldTrimMat, {
      x: side * (halfWidth * 0.98),
      y: 0.44,
      z: -0.08,
      castShadow: false,
    });
  }
  addMesh(group, createRoundedPodGeometry(1.38, 0.06, 0.22, 0.025, 0.012), emeraldTrimMat, {
    y: 0.84,
    z: -2.14,
    castShadow: false,
  });

  // Low-profile aerodynamic LED police lightbar mounted cleanly on the Ferrari roofline
  const barY = roofY + 0.04;
  const barZ = -0.14;
  addMesh(group, createRoundedPodGeometry(1.16, 0.065, 0.24, 0.03, 0.015), railMat, {
    y: barY,
    z: barZ,
  });
  addMesh(group, createRoundedPodGeometry(0.32, 0.09, 0.22, 0.035, 0.015), emeraldTrimMat, {
    y: barY + 0.045,
    z: barZ,
  });

  const beaconGeo = new THREE.CapsuleGeometry(0.062, 0.34, 8, 12);
  beaconGeo.rotateZ(Math.PI / 2);

  const redBeacon = addMesh(
    group,
    beaconGeo,
    new THREE.MeshStandardMaterial({
      color: 0xff294d,
      emissive: 0xff1c42,
      emissiveIntensity: 2.5,
      roughness: 0.12,
    }),
    {
      x: -0.34,
      y: barY + 0.055,
      z: barZ,
      sy: 0.72,
      name: 'police_red_beacon',
      castShadow: false,
    },
  );

  const blueBeacon = addMesh(
    group,
    beaconGeo,
    new THREE.MeshStandardMaterial({
      color: 0x2684ff,
      emissive: 0x1a75ff,
      emissiveIntensity: 2.5,
      roughness: 0.12,
    }),
    {
      x: 0.34,
      y: barY + 0.055,
      z: barZ,
      sy: 0.72,
      name: 'police_blue_beacon',
      castShadow: false,
    },
  );

  const sirenLight = new THREE.PointLight(0xff294d, 0, 16, 2);
  sirenLight.name = 'police_siren_light';
  sirenLight.position.set(0, barY + 0.36, barZ);
  sirenLight.castShadow = false;
  group.add(sirenLight);

  group.userData.redBeacon = redBeacon;
  group.userData.blueBeacon = blueBeacon;
  group.userData.sirenLight = sirenLight;
}

function attachFerrariTaxiKit(
  group: THREE.Group,
  roofY: number,
  halfWidth: number,
): void {
  const baseMat = createCarbonMaterial();
  const taxiSignTex = createTaxiSignTexture();
  const taxiDomeMat = new THREE.MeshStandardMaterial({
    color: 0xffe066,
    emissive: 0xffb800,
    emissiveIntensity: 1.35,
    ...(taxiSignTex ? { map: taxiSignTex } : {}),
    roughness: 0.18,
    metalness: 0.08,
  });

  // Sleek curved backlit TAXI roof dome mounted flush onto the Ferrari roofline
  const domeZ = -0.14;
  addMesh(group, createRoundedPodGeometry(0.78, 0.05, 0.32, 0.025, 0.012), baseMat, {
    y: roofY + 0.02,
    z: domeZ,
  });

  const domeGeo = createCurvedCrossExtrude(
    (shape) => {
      shape.moveTo(-0.36, 0);
      shape.lineTo(0.36, 0);
      shape.quadraticCurveTo(0.38, 0.21, 0.16, 0.23);
      shape.lineTo(-0.16, 0.23);
      shape.quadraticCurveTo(-0.38, 0.21, -0.36, 0);
      shape.closePath();
    },
    0.28,
    0.03,
  );
  addMesh(group, domeGeo, taxiDomeMat, {
    y: roofY + 0.035,
    z: domeZ,
    name: 'taxi_roof_sign',
    castShadow: false,
  });

  // Subtle checkered Amarillito accent stripe along the lower door sills
  const checkerTex = createCheckerTrimTexture();
  const checkerMat = new THREE.MeshStandardMaterial({
    color: checkerTex ? 0xffffff : 0x161622,
    ...(checkerTex ? { map: checkerTex } : {}),
    roughness: 0.38,
    metalness: 0.18,
  });
  const sillStripGeo = createRoundedPodGeometry(0.05, 0.11, 2.05, 0.02, 0.01);
  for (const side of [-1, 1] as const) {
    addMesh(group, sillStripGeo, checkerMat, {
      x: side * (halfWidth * 0.98),
      y: 0.42,
      z: -0.06,
      castShadow: false,
    });
  }
}

/**
 * Builds a sculpted Ferrari 458 Italia livery rig from the loaded GLB template:
 * - 'banshee': glossy metallic Rosso Corsa Red (0xb80e24) with afterburner nitro flames
 * - 'police': glossy metallic pearl-white (0xf2f5f8) Policía Nacional Interceptor with emerald
 *   accents (0x0b7a45) and sleek aerodynamic glowing red/blue roof LED lightbar + siren PointLight
 * - 'taxi': glossy metallic Cali Yellow (0xe5ad00) Amarillito Sports Taxi with curved backlit TAXI dome
 * Deep-clones all materials/geometries so the shared template remains strictly untouched.
 */
export function createFerrariLiveryMesh(
  ferrariTemplate: THREE.Group,
  kind: FerrariLiveryKind,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `vehicle_${kind}_ferrari`;

  const clonedModel = cloneGroupWithMaterials(ferrariTemplate);
  const innerGroup = new THREE.Group();
  innerGroup.name = 'ferrari_model_root';
  innerGroup.rotation.y = Math.PI;
  innerGroup.add(clonedModel);
  group.add(innerGroup);

  const paintSpec: Record<
    FerrariLiveryKind,
    { readonly color: number; readonly metalness: number; readonly roughness: number }
  > = {
    banshee: { color: 0xb80e24, metalness: 0.65, roughness: 0.15 },
    police: { color: 0xf2f5f8, metalness: 0.52, roughness: 0.14 },
    taxi: { color: 0xe5ad00, metalness: 0.56, roughness: 0.16 },
  };
  const chosenPaint = paintSpec[kind];

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: chosenPaint.color,
    metalness: chosenPaint.metalness,
    roughness: chosenPaint.roughness,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.35,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1017,
    metalness: 0.25,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.45,
  });
  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0xd90b24,
    emissive: 0xff1628,
    emissiveIntensity: 1.35,
    roughness: 0.14,
    metalness: 0.2,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff8ea,
    emissive: 0xffecc8,
    emissiveIntensity: 1.7,
    roughness: 0.1,
    metalness: 0.15,
  });

  const replacedMaterials = new Set<THREE.Material>();
  const activeMaterials = new Set<THREE.Material>();

  const upgradeMaterial = (
    nodeName: string,
    mat: THREE.Material,
  ): THREE.Material => {
    const matName = mat.name;
    if (nodeName === 'body' || matName === 'Body_Color') {
      replacedMaterials.add(mat);
      return bodyMat;
    }
    if (nodeName === 'glass' || matName === 'Glass_Gray') {
      replacedMaterials.add(mat);
      return glassMat;
    }
    if (nodeName === 'lights_red' || matName === 'Taillight_Glass') {
      replacedMaterials.add(mat);
      return brakeLightMat;
    }
    if (
      nodeName === 'lights' ||
      nodeName === 'leds' ||
      matName === 'Projector_Glass'
    ) {
      replacedMaterials.add(mat);
      return headlightMat;
    }
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.envMapIntensity = Math.max(mat.envMapIntensity, 1.15);
    }
    return mat;
  };

  innerGroup.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    node.castShadow = true;
    node.receiveShadow = true;

    if (Array.isArray(node.material)) {
      node.material = node.material.map((m) => upgradeMaterial(node.name, m));
      for (const m of node.material) {
        activeMaterials.add(m);
      }
    } else if (node.material instanceof THREE.Material) {
      const upgraded = upgradeMaterial(node.name, node.material);
      node.material = upgraded;
      activeMaterials.add(upgraded);
    }
  });

  for (const oldMat of replacedMaterials) {
    if (!activeMaterials.has(oldMat)) {
      oldMat.dispose();
    }
  }
  for (const upgradedMat of [bodyMat, glassMat, brakeLightMat, headlightMat]) {
    if (!activeMaterials.has(upgradedMat)) {
      upgradedMat.dispose();
    }
  }

  // Normalize length to ~4.55m and seat tires cleanly on y = 0
  innerGroup.updateMatrixWorld(true);
  let roofY = 1.22;
  let halfWidth = 0.98;
  const rawBox = new THREE.Box3().setFromObject(innerGroup);
  if (!rawBox.isEmpty()) {
    const rawSize = rawBox.getSize(new THREE.Vector3());
    if (rawSize.z > 0.01) {
      const scaleFactor = FERRARI_TARGET_LENGTH_METERS / rawSize.z;
      innerGroup.scale.setScalar(scaleFactor);
    }
    innerGroup.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(innerGroup);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    innerGroup.position.set(
      -scaledCenter.x,
      -scaledBox.min.y,
      -scaledCenter.z,
    );
    innerGroup.updateMatrixWorld(true);
    const normBox = new THREE.Box3().setFromObject(innerGroup);
    if (!normBox.isEmpty()) {
      roofY = Math.max(1.0, normBox.max.y);
      halfWidth = Math.max(0.82, (normBox.max.x - normBox.min.x) * 0.5);
    }
  }

  // Rig front steering pivots and all 4 spinning wheels
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wheelSpecs: readonly { readonly name: string; readonly isFront: boolean }[] = [
    { name: 'wheel_fl', isFront: true },
    { name: 'wheel_fr', isFront: true },
    { name: 'wheel_rl', isFront: false },
    { name: 'wheel_rr', isFront: false },
  ];

  for (const spec of wheelSpecs) {
    const wheelNode = innerGroup.getObjectByName(spec.name);
    if (!wheelNode) {
      continue;
    }
    wheelNode.userData.spinSign = -1;
    wheels.push(wheelNode);

    if (spec.isFront && wheelNode.parent) {
      const originalParent = wheelNode.parent;
      const steerPivot = new THREE.Group();
      steerPivot.name = `${spec.name}_steer_pivot`;
      steerPivot.position.copy(wheelNode.position);
      wheelNode.position.set(0, 0, 0);
      originalParent.remove(wheelNode);
      steerPivot.add(wheelNode);
      originalParent.add(steerPivot);
      frontWheels.push(steerPivot);
    }
  }

  const headlightCones = attachHeadlightCones(
    group,
    0.72,
    0.62,
    2.22,
    kind === 'police' ? 5.2 : 4.8,
    kind === 'police' ? 0.94 : 0.88,
  );
  attachContactShadow(group, 2.35, 4.9, 0.64, 0.03);

  if (kind === 'banshee') {
    group.userData.nitroFlames = attachFerrariNitroFlames(group);
  } else if (kind === 'police') {
    attachFerrariPoliceKit(group, roofY, halfWidth);
  } else if (kind === 'taxi') {
    attachFerrariTaxiKit(group, roofY, halfWidth);
  }

  group.userData.liveryKind = kind;
  group.userData.wheels = wheels;
  group.userData.frontWheels = frontWheels;
  group.userData.brakeLightMaterials = [brakeLightMat];
  group.userData.headlightCones = headlightCones;
  return group;
}

/**
 * Builds the player Ferrari 458 Italia ('banshee' Rosso Corsa Red livery).
 */
export function createFerrariPlayerMesh(ferrariTemplate: THREE.Group): THREE.Group {
  return createFerrariLiveryMesh(ferrariTemplate, 'banshee');
}

function findAnimationClip(
  clips: readonly THREE.AnimationClip[],
  expectedName: string,
): THREE.AnimationClip | undefined {
  const exact = clips.find((clip) => clip.name === expectedName);
  if (exact) {
    return exact;
  }
  const lower = expectedName.toLowerCase();
  return clips.find((clip) => clip.name.toLowerCase() === lower);
}

/**
 * Builds an independent rigged, animated 3D human from the loaded GLB asset via SkeletonUtils.clone,
 * rotated +180° around Y to walk facing +Z, normalized to target height resting at y = 0, with
 * cloned independent materials (optional subtle 35% clothing/accent tint) and Idle/Walk/Run actions.
 */
export function createRiggedCharacterMesh(
  characterAsset: LoadedCharacterAsset,
  options?: RiggedCharacterOptions,
): RiggedCharacterRig {
  const group = new THREE.Group();
  group.name = 'player_rigged_character';

  const clonedScene = SkeletonUtils.clone(characterAsset.scene);
  const innerGroup = new THREE.Group();
  innerGroup.name = 'character_model_root';
  innerGroup.rotation.y = Math.PI;
  innerGroup.add(clonedScene);
  group.add(innerGroup);

  const tintColor =
    options?.tintHex !== undefined && Number.isFinite(options.tintHex)
      ? new THREE.Color(options.tintHex)
      : null;
  const targetHeight =
    options?.heightMeters !== undefined &&
    Number.isFinite(options.heightMeters) &&
    options.heightMeters > 0.5
      ? options.heightMeters
      : CHARACTER_TARGET_HEIGHT_METERS;

  const clonedMaterials = new Map<THREE.Material, THREE.Material>();
  const cloneCharacterMaterial = (mat: THREE.Material): THREE.Material => {
    const existing = clonedMaterials.get(mat);
    if (existing) {
      return existing;
    }
    const copy = mat.clone();
    if (copy instanceof THREE.MeshStandardMaterial) {
      copy.envMapIntensity = Math.max(copy.envMapIntensity, 0.9);
      if (tintColor) {
        copy.color.lerp(tintColor, 0.35);
      }
    }
    clonedMaterials.set(mat, copy);
    return copy;
  };

  innerGroup.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false;

    if (Array.isArray(node.material)) {
      node.material = node.material.map(cloneCharacterMaterial);
    } else if (node.material instanceof THREE.Material) {
      node.material = cloneCharacterMaterial(node.material);
    }
  });

  innerGroup.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(innerGroup);
  if (!rawBox.isEmpty()) {
    const rawSize = rawBox.getSize(new THREE.Vector3());
    if (rawSize.y > 0.01) {
      const scaleFactor = targetHeight / rawSize.y;
      innerGroup.scale.setScalar(scaleFactor);
    }
    innerGroup.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(innerGroup);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    innerGroup.position.set(
      -scaledCenter.x,
      -scaledBox.min.y,
      -scaledCenter.z,
    );
  }

  attachContactShadow(group, 0.85, 0.85, 0.45, 0.025);

  const mixer = new THREE.AnimationMixer(clonedScene);
  const idleClip = findAnimationClip(characterAsset.animations, 'Idle');
  const walkClip = findAnimationClip(characterAsset.animations, 'Walk');
  const runClip = findAnimationClip(characterAsset.animations, 'Run');

  const idle = idleClip ? mixer.clipAction(idleClip) : undefined;
  const walk = walkClip ? mixer.clipAction(walkClip) : undefined;
  const run = runClip ? mixer.clipAction(runClip) : undefined;

  if (idle) {
    idle.play();
  }

  return {
    group,
    mixer,
    actions: {
      ...(idle ? { idle } : {}),
      ...(walk ? { walk } : {}),
      ...(run ? { run } : {}),
    },
  };
}

/**
 * Creates a bold 2D-to-3D extruded downward arrow geometry centered on Z = 0.
 */
function createDownwardArrowGeometry(
  scale = 1,
  depth = 0.48,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.55 * scale);
  shape.lineTo(1.42 * scale, 0.04 * scale);
  shape.lineTo(0.6 * scale, 0.04 * scale);
  shape.lineTo(0.6 * scale, 1.32 * scale);
  shape.lineTo(-0.6 * scale, 1.32 * scale);
  shape.lineTo(-0.6 * scale, 0.04 * scale);
  shape.lineTo(-1.42 * scale, 0.04 * scale);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.06 * scale,
    bevelSize: 0.05 * scale,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Creates a flat road-hugging 3D V-chevron geometry lying in the XZ plane pointing toward +Z.
 */
function createRoadChevronGeometry(
  halfWidth: number,
  length: number,
  thickness: number,
  height: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, length * 0.5);
  shape.lineTo(halfWidth, -length * 0.5);
  shape.lineTo(halfWidth - thickness, -length * 0.5);
  shape.lineTo(0, length * 0.5 - thickness * 1.15);
  shape.lineTo(-(halfWidth - thickness), -length * 0.5);
  shape.lineTo(-halfWidth, -length * 0.5);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  // Rotate so shape +Y maps to world +Z and extrusion depth goes along +Y
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height * 0.5, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Creates a high-contrast daylight-visible GTA mission checkpoint beacon:
 * vivid ground ring with dark contrasting trim, 12m translucent glowing cylinder wall,
 * sky light pillar, and a giant 3D floating downward chevron arrow bobbing 7-9m overhead.
 */
export function createObjectiveBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'objective_beacon';

  const darkTrimMat = new THREE.MeshBasicMaterial({
    color: 0x0b0d14,
    side: THREE.DoubleSide,
  });
  const outerBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffc400,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const innerBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffc400,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0xffc400,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc400,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const arrowMat = new THREE.MeshStandardMaterial({
    color: 0xffc400,
    emissive: 0xffc400,
    emissiveIntensity: 1.15,
    roughness: 0.22,
    metalness: 0.18,
  });

  // Tall daylight-visible sky beacon pillar
  const lightBeam = new THREE.Group();
  lightBeam.name = 'objective_light_beam';

  addMesh(lightBeam, new THREE.CylinderGeometry(0.95, 1.38, 64, 18, 1, true), outerBeamMat, {
    y: 32,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(lightBeam, new THREE.CylinderGeometry(0.36, 0.54, 64, 14, 1, true), innerBeamMat, {
    y: 32,
    castShadow: false,
    receiveShadow: false,
  });
  for (const ringY of [15, 25, 36] as const) {
    addMesh(lightBeam, new THREE.TorusGeometry(1.42, 0.08, 8, 28), ringMat, {
      y: ringY,
      rx: Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
  }
  group.add(lightBeam);

  // High-contrast GTA ground checkpoint ring + 12m glowing vertical cylinder wall
  const targetRing = new THREE.Group();
  targetRing.name = 'objective_target_ring';
  targetRing.position.y = 0.22;

  // Dark contrasting outer trim ring so golden/cyan ring pops cleanly over bright sunlit asphalt
  addMesh(targetRing, new THREE.TorusGeometry(3.56, 0.22, 10, 36), darkTrimMat, {
    rx: Math.PI / 2,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(targetRing, new THREE.TorusGeometry(3.2, 0.25, 12, 36), ringMat, {
    rx: Math.PI / 2,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(targetRing, new THREE.RingGeometry(2.05, 2.56, 36), ringMat, {
    rx: -Math.PI / 2,
    castShadow: false,
    receiveShadow: false,
  });

  // Translucent glowing 12m vertical GTA checkpoint cylinder wall
  addMesh(targetRing, new THREE.CylinderGeometry(3.18, 3.18, 12, 32, 1, true), wallMat, {
    y: 6.0,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(targetRing, new THREE.TorusGeometry(3.18, 0.09, 8, 32), ringMat, {
    y: 12.0,
    rx: Math.PI / 2,
    castShadow: false,
    receiveShadow: false,
  });

  // Bold perimeter diamond markers with contrasting bases
  const markerGeo = new THREE.OctahedronGeometry(0.45, 0);
  const markerRimGeo = new THREE.TorusGeometry(0.36, 0.07, 6, 16);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const mx = Math.cos(angle) * 3.2;
    const mz = Math.sin(angle) * 3.2;
    addMesh(targetRing, markerGeo, ringMat, {
      x: mx,
      y: 0.9,
      z: mz,
      castShadow: false,
      receiveShadow: false,
    });
    addMesh(targetRing, markerRimGeo, darkTrimMat, {
      x: mx,
      y: 0.3,
      z: mz,
      rx: Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
  }
  group.add(targetRing);

  // Giant bold 3D floating downward GTA chevron arrow (bobbing 7-9m above ground)
  const floatingArrow = new THREE.Group();
  floatingArrow.name = 'objective_floating_arrow';
  floatingArrow.position.y = 8.0;

  addMesh(floatingArrow, createDownwardArrowGeometry(1.0, 0.5), arrowMat, {
    name: 'floating_arrow_core',
    castShadow: false,
    receiveShadow: false,
  });
  // Dark high-contrast silhouette outline frame for instant readability against bright HDRI sky
  addMesh(floatingArrow, createDownwardArrowGeometry(1.1, 0.32), darkTrimMat, {
    name: 'floating_arrow_trim',
    castShadow: false,
    receiveShadow: false,
  });
  // Secondary upper chevron wing accentuating the downward pointer
  const upperWingGeo = new THREE.BoxGeometry(1.55, 0.34, 0.36);
  for (const side of [-1, 1] as const) {
    addMesh(floatingArrow, upperWingGeo, arrowMat, {
      x: side * 0.56,
      y: 1.95,
      rz: side * (Math.PI / 5),
      castShadow: false,
      receiveShadow: false,
    });
  }
  group.add(floatingArrow);

  group.userData.lightBeam = lightBeam;
  group.userData.targetRing = targetRing;
  group.userData.floatingArrow = floatingArrow;
  group.userData.beamMaterials = [
    outerBeamMat,
    innerBeamMat,
    wallMat,
    ringMat,
    arrowMat,
  ];
  return group;
}

function buildVinylBriefcaseProp(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mission_prop_vinyl_briefcase';

  const pedestalMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c26,
    roughness: 0.38,
    metalness: 0.55,
  });
  const goldGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffc400,
    emissive: 0xffb300,
    emissiveIntensity: 1.15,
    roughness: 0.24,
    metalness: 0.65,
  });
  const aluminumMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8e0ec,
    metalness: 0.9,
    roughness: 0.2,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
  });
  const velvetMat = new THREE.MeshStandardMaterial({
    color: 0x2b0c18,
    roughness: 0.92,
    metalness: 0.04,
  });
  const goldVinylMat = new THREE.MeshPhysicalMaterial({
    color: 0xffc830,
    emissive: 0xd48c00,
    emissiveIntensity: 0.45,
    metalness: 0.88,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const grooveMat = new THREE.MeshStandardMaterial({
    color: 0x6b4500,
    metalness: 0.7,
    roughness: 0.3,
  });
  const labelMat = new THREE.MeshStandardMaterial({
    color: 0xe61c45,
    emissive: 0x8f0d28,
    emissiveIntensity: 0.55,
    roughness: 0.32,
  });
  const chromeMat = createChromeMaterial();

  // Stepped obsidian pedestal with glowing gold collar rings
  addMesh(group, new THREE.CylinderGeometry(1.05, 1.2, 0.24, 24), pedestalMat, { y: 0.12 });
  addMesh(group, new THREE.CylinderGeometry(0.68, 0.84, 0.66, 20), pedestalMat, { y: 0.57 });
  addMesh(group, new THREE.CylinderGeometry(0.86, 0.78, 0.1, 24), pedestalMat, { y: 0.94 });
  addMesh(group, new THREE.TorusGeometry(1.08, 0.045, 8, 28), goldGlowMat, {
    y: 0.24,
    rx: Math.PI / 2,
    castShadow: false,
  });
  addMesh(group, new THREE.TorusGeometry(0.84, 0.04, 8, 28), goldGlowMat, {
    y: 0.96,
    rx: Math.PI / 2,
    castShadow: false,
  });

  // Open brushed metallic aluminum heist briefcase resting atop pedestal
  const briefcase = new THREE.Group();
  briefcase.name = 'heist_briefcase';
  briefcase.position.set(0, 1.0, 0);

  // Lower case shell + velvet interior + front handle & clasps
  addMesh(briefcase, new THREE.BoxGeometry(1.1, 0.16, 0.76), aluminumMat, { y: 0.08 });
  addMesh(briefcase, new THREE.BoxGeometry(0.98, 0.05, 0.64), velvetMat, { y: 0.15 });
  addMesh(briefcase, new THREE.BoxGeometry(0.32, 0.06, 0.08), chromeMat, { y: 0.08, z: 0.42 });
  for (const sx of [-0.36, 0.36] as const) {
    addMesh(briefcase, new THREE.BoxGeometry(0.1, 0.08, 0.04), goldGlowMat, {
      x: sx,
      y: 0.12,
      z: 0.39,
      castShadow: false,
    });
  }

  // Hinged open upper lid tilted back ~102 deg
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.16, -0.37);
  lidPivot.rotation.x = -1.78;
  addMesh(lidPivot, new THREE.BoxGeometry(1.1, 0.11, 0.76), aluminumMat, { y: 0.055, z: 0.37 });
  addMesh(lidPivot, new THREE.BoxGeometry(0.98, 0.04, 0.64), velvetMat, { y: 0.01, z: 0.37 });
  briefcase.add(lidPivot);
  group.add(briefcase);

  // Hovering spinning golden Salsa vinyl LP record above the open briefcase
  const spinningRecord = new THREE.Group();
  spinningRecord.name = 'golden_salsa_vinyl';
  const recordBaseY = 1.95;
  spinningRecord.position.set(0, recordBaseY, 0.04);

  addMesh(spinningRecord, new THREE.CylinderGeometry(0.56, 0.56, 0.035, 32), goldVinylMat, {
    rx: Math.PI / 2,
  });
  for (const grooveR of [0.34, 0.44, 0.51] as const) {
    addMesh(spinningRecord, new THREE.TorusGeometry(grooveR, 0.012, 6, 28), grooveMat, {
      z: 0.02,
      castShadow: false,
    });
    addMesh(spinningRecord, new THREE.TorusGeometry(grooveR, 0.012, 6, 28), grooveMat, {
      z: -0.02,
      castShadow: false,
    });
  }
  addMesh(spinningRecord, new THREE.CylinderGeometry(0.19, 0.19, 0.046, 20), labelMat, {
    rx: Math.PI / 2,
    castShadow: false,
  });
  addMesh(spinningRecord, new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10), pedestalMat, {
    rx: Math.PI / 2,
    castShadow: false,
  });
  addMesh(spinningRecord, new THREE.TorusGeometry(0.68, 0.025, 8, 32), goldGlowMat, {
    castShadow: false,
  });
  group.add(spinningRecord);

  attachContactShadow(group, 2.7, 2.7, 0.5, 0.025);

  group.userData.spinningRecord = spinningRecord;
  group.userData.recordBaseY = recordBaseY;
  return group;
}

function buildMateoSpeakersProp(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mission_prop_mateo_speakers';

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9885c, roughness: 0.64 });
  const jacketMat = new THREE.MeshStandardMaterial({
    color: 0x167a8a,
    roughness: 0.48,
    metalness: 0.08,
  });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.62 });
  const jeansMat = new THREE.MeshStandardMaterial({ color: 0x24344d, roughness: 0.84 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xd62d28, roughness: 0.52 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.5 });
  const shadesMat = createTintedGlassMaterial(0x10131c);

  const cabinetMat = new THREE.MeshStandardMaterial({
    color: 0x161720,
    roughness: 0.72,
    metalness: 0.18,
  });
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xffb800,
    emissive: 0xd98a00,
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.78,
  });
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d3a,
    roughness: 0.45,
    metalness: 0.25,
  });
  const dustCapMat = new THREE.MeshStandardMaterial({
    color: 0xffc400,
    roughness: 0.25,
    metalness: 0.75,
  });

  // Articulated organic Mateo NPC standing beside the DJ speaker stacks (zero BoxGeometry, grounded at y = 0)
  const mateo = new THREE.Group();
  mateo.name = 'npc_mateo';
  mateo.position.set(-1.15, 0, 0.25);

  const hipGeo = new THREE.SphereGeometry(0.088, 10, 8);
  const thighGeo = new THREE.CylinderGeometry(0.092, 0.075, 0.34, 12);
  const kneeGeo = new THREE.SphereGeometry(0.072, 10, 8);
  const calfGeo = new THREE.CapsuleGeometry(0.06, 0.25, 6, 12);
  const shoeGeo = new THREE.CapsuleGeometry(0.06, 0.14, 6, 12);
  shoeGeo.rotateX(Math.PI / 2);

  for (const sx of [-0.12, 0.12] as const) {
    addMesh(mateo, hipGeo, jeansMat, { x: sx, y: 0.8 });
    addMesh(mateo, thighGeo, jeansMat, { x: sx, y: 0.62 });
    addMesh(mateo, kneeGeo, jeansMat, { x: sx, y: 0.45 });
    addMesh(mateo, calfGeo, jeansMat, { x: sx, y: 0.28 });
    addMesh(mateo, shoeGeo, shoeMat, { x: sx, y: 0.05, z: 0.045, sy: 0.82 });
  }

  // Rounded hips + tapered athletic torso (white tee + open turquoise Cali jacket + gold hem ring)
  addMesh(mateo, new THREE.SphereGeometry(0.19, 14, 10), jeansMat, {
    y: 0.84,
    sx: 1.08,
    sy: 0.68,
    sz: 0.78,
  });
  addMesh(mateo, new THREE.CylinderGeometry(0.215, 0.175, 0.48, 14), jacketMat, {
    y: 1.13,
    sx: 1.12,
    sz: 0.8,
  });
  addMesh(mateo, new THREE.SphereGeometry(0.21, 14, 10), jacketMat, {
    y: 1.34,
    sx: 1.12,
    sy: 0.56,
    sz: 0.8,
  });
  addMesh(mateo, new THREE.CylinderGeometry(0.12, 0.105, 0.44, 10), shirtMat, {
    y: 1.12,
    z: 0.09,
    sx: 0.92,
    sz: 0.45,
  });
  addMesh(mateo, new THREE.TorusGeometry(0.18, 0.024, 8, 18), goldTrimMat, {
    y: 0.9,
    rx: Math.PI / 2,
    sx: 1.1,
    sy: 0.8,
    castShadow: false,
  });

  // Rounded shoulder joints + articulated capsule arms
  const shoulderGeo = new THREE.SphereGeometry(0.084, 10, 8);
  const upperArmGeo = new THREE.CapsuleGeometry(0.064, 0.2, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.052, 0.2, 6, 10);
  const handGeo = new THREE.SphereGeometry(0.056, 8, 8);

  // Resting left arm
  const leftArm = new THREE.Group();
  leftArm.position.set(0.275, 1.32, 0);
  addMesh(leftArm, shoulderGeo, jacketMat);
  addMesh(leftArm, upperArmGeo, jacketMat, { y: -0.14 });
  addMesh(leftArm, forearmGeo, skinMat, { y: -0.37 });
  addMesh(leftArm, handGeo, skinMat, { y: -0.52, sx: 0.88, sy: 1.12, sz: 0.78 });
  mateo.add(leftArm);

  // Raised enthusiastic waving right arm (animated in WorldRenderer)
  const wavingArm = new THREE.Group();
  wavingArm.name = 'mateo_waving_arm';
  wavingArm.position.set(-0.275, 1.33, 0);
  wavingArm.rotation.z = -2.35;
  addMesh(wavingArm, shoulderGeo, jacketMat);
  addMesh(wavingArm, upperArmGeo, jacketMat, { y: -0.14 });
  addMesh(wavingArm, forearmGeo, skinMat, { y: -0.38 });
  addMesh(wavingArm, handGeo, skinMat, { y: -0.53, sx: 0.9, sy: 1.15, sz: 0.8 });
  mateo.add(wavingArm);

  // Rounded neck, sculpted oval head, rounded oval sunglasses & curved red Cali cap
  addMesh(mateo, new THREE.CylinderGeometry(0.062, 0.072, 0.12, 10), skinMat, { y: 1.44 });
  addMesh(mateo, new THREE.SphereGeometry(0.146, 14, 12), skinMat, {
    y: 1.58,
    sx: 0.86,
    sy: 1.05,
    sz: 0.92,
  });
  attachOrganicSunglasses(mateo, shadesMat, 1.595, 0.122, 0.046, 0.044);
  addMesh(
    mateo,
    new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
    capMat,
    { y: 1.61, sx: 0.9, sy: 1.04, sz: 0.96 },
  );
  // Curved baseball cap visor brim built with a flattened partial cylinder (zero BoxGeometry)
  addMesh(
    mateo,
    new THREE.CylinderGeometry(0.138, 0.144, 0.024, 14, 1, false, -Math.PI * 0.46, Math.PI * 0.92),
    capMat,
    { y: 1.62, z: 0.11, rx: 0.14 },
  );
  group.add(mateo);

  // Two stacked black & gold DJ PA sound speaker towers beside Mateo
  const wooferCones: THREE.Object3D[] = [];
  const cabinetGeo = new THREE.BoxGeometry(0.96, 1.06, 0.78);
  const topTrimGeo = new THREE.BoxGeometry(1.0, 0.05, 0.82);
  const wooferRingGeo = new THREE.TorusGeometry(0.27, 0.032, 8, 22);
  const wooferConeGeo = new THREE.CylinderGeometry(0.25, 0.14, 0.09, 18);
  const dustCapGeo = new THREE.SphereGeometry(0.095, 10, 8);
  const tweeterGeo = new THREE.BoxGeometry(0.38, 0.14, 0.06);

  // Low stage riser beneath the dual speaker stacks
  addMesh(group, new THREE.BoxGeometry(2.35, 0.16, 1.05), cabinetMat, {
    x: 1.15,
    y: 0.08,
    z: 0,
  });

  for (const stackX of [0.58, 1.72] as const) {
    for (const tier of [0, 1] as const) {
      const cy = 0.16 + 0.53 + tier * 1.08;
      addMesh(group, cabinetGeo, cabinetMat, { x: stackX, y: cy });
      addMesh(group, topTrimGeo, goldTrimMat, {
        x: stackX,
        y: cy + 0.51,
        castShadow: false,
      });
      addMesh(group, topTrimGeo, goldTrimMat, {
        x: stackX,
        y: cy - 0.51,
        castShadow: false,
      });

      // Pulsing circular woofer assembly on front face (+Z)
      const wooferGroup = new THREE.Group();
      wooferGroup.position.set(stackX, cy - 0.1, 0.4);
      addMesh(wooferGroup, wooferRingGeo, goldTrimMat, { castShadow: false });
      addMesh(wooferGroup, wooferConeGeo, coneMat, { rx: Math.PI / 2, castShadow: false });
      addMesh(wooferGroup, dustCapGeo, dustCapMat, { z: 0.025, castShadow: false });
      group.add(wooferGroup);
      wooferCones.push(wooferGroup);

      // Horn tweeter above woofer
      addMesh(group, tweeterGeo, goldTrimMat, {
        x: stackX,
        y: cy + 0.3,
        z: 0.4,
        castShadow: false,
      });
    }
  }

  attachContactShadow(group, 4.4, 2.2, 0.52, 0.025);

  group.userData.wavingArm = wavingArm;
  group.userData.wooferCones = wooferCones;
  return group;
}

function buildSummitStageProp(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mission_prop_summit_stage';

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x1d1c28,
    roughness: 0.68,
    metalness: 0.24,
  });
  const boothMat = new THREE.MeshStandardMaterial({
    color: 0x141521,
    roughness: 0.42,
    metalness: 0.35,
  });
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0xaab2c0,
    roughness: 0.32,
    metalness: 0.82,
  });
  const warmGoldLedMat = new THREE.MeshStandardMaterial({
    color: 0xffc84a,
    emissive: 0xffa812,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  const magentaLedMat = new THREE.MeshStandardMaterial({
    color: 0xff3d8e,
    emissive: 0xff247a,
    emissiveIntensity: 1.35,
    roughness: 0.22,
  });
  const platterMat = new THREE.MeshPhysicalMaterial({
    color: 0xe6ecf5,
    metalness: 0.9,
    roughness: 0.16,
    clearcoat: 0.8,
  });
  const spotLensMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c2,
    emissive: 0xffcc66,
    emissiveIntensity: 2.2,
    roughness: 0.12,
  });
  const spotBeamMat = new THREE.MeshBasicMaterial({
    color: 0xffcf70,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Raised sunset salsa party stage deck with warm gold edge lighting
  addMesh(group, new THREE.BoxGeometry(5.2, 0.36, 2.6), deckMat, { y: 0.18 });
  addMesh(group, new THREE.BoxGeometry(5.26, 0.08, 0.08), warmGoldLedMat, {
    y: 0.34,
    z: 1.3,
    castShadow: false,
  });
  addMesh(group, new THREE.BoxGeometry(5.26, 0.08, 0.08), magentaLedMat, {
    y: 0.08,
    z: 1.3,
    castShadow: false,
  });

  // Illuminated DJ booth console + dual turntables + center mixer
  addMesh(group, new THREE.BoxGeometry(2.4, 1.12, 0.92), boothMat, { y: 0.92, z: 0.25 });
  addMesh(group, new THREE.BoxGeometry(2.46, 0.08, 0.08), warmGoldLedMat, {
    y: 1.46,
    z: 0.72,
    castShadow: false,
  });
  addMesh(group, new THREE.BoxGeometry(2.1, 0.1, 0.06), magentaLedMat, {
    y: 0.94,
    z: 0.72,
    castShadow: false,
  });
  for (const tx of [-0.66, 0.66] as const) {
    addMesh(group, new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20), platterMat, {
      x: tx,
      y: 1.51,
      z: 0.25,
    });
  }
  addMesh(group, new THREE.BoxGeometry(0.46, 0.08, 0.42), deckMat, { y: 1.52, z: 0.25 });

  // Twin vertical truss towers & overhead lighting gantry
  const postGeo = new THREE.CylinderGeometry(0.085, 0.085, 3.4, 8);
  for (const sx of [-2.35, 2.35] as const) {
    addMesh(group, postGeo, trussMat, { x: sx, y: 2.06, z: -0.4 });
    addMesh(group, postGeo, trussMat, { x: sx, y: 2.06, z: 0.2 });
    // Flanking stage speaker cabinets on deck corners
    addMesh(group, new THREE.BoxGeometry(0.82, 1.25, 0.72), boothMat, {
      x: sx * 0.78,
      y: 0.98,
      z: 0.42,
    });
    addMesh(group, new THREE.TorusGeometry(0.24, 0.03, 8, 18), warmGoldLedMat, {
      x: sx * 0.78,
      y: 0.92,
      z: 0.79,
      castShadow: false,
    });
  }
  addMesh(group, new THREE.BoxGeometry(5.1, 0.22, 0.68), trussMat, { y: 3.74, z: -0.1 });

  // Twin warm truss spotlight fixtures + soft golden light cones angling onto booth
  const spotHousingGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.42, 12);
  const spotLensGeo = new THREE.CircleGeometry(0.2, 12);
  const spotConeGeo = new THREE.ConeGeometry(1.15, 3.2, 16, 1, true);
  for (const sx of [-1.55, 1.55] as const) {
    const spotGroup = new THREE.Group();
    spotGroup.position.set(sx, 3.55, 0.15);
    spotGroup.rotation.z = sx > 0 ? -0.34 : 0.34;
    addMesh(spotGroup, spotHousingGeo, boothMat);
    addMesh(spotGroup, spotLensGeo, spotLensMat, {
      y: -0.22,
      rx: Math.PI / 2,
      castShadow: false,
    });
    addMesh(spotGroup, spotConeGeo, spotBeamMat, {
      y: -1.8,
      castShadow: false,
      receiveShadow: false,
    });
    group.add(spotGroup);
  }

  // Animated 7-band glowing equalizer bar backdrop
  const eqColors = [
    0xffb800,
    0xff7a2e,
    0xff2e93,
    0x00f0ff,
    0xff2e93,
    0xff7a2e,
    0xffb800,
  ] as const;
  const equalizerBars: THREE.Mesh[] = [];
  const barGeo = new THREE.BoxGeometry(0.32, 1.9, 0.12);
  barGeo.translate(0, 0.95, 0);

  eqColors.forEach((hex, idx) => {
    const barMat = new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: 1.45,
      roughness: 0.2,
    });
    const bx = (idx - 3) * 0.56;
    const barMesh = addMesh(group, barGeo, barMat, {
      x: bx,
      y: 0.42,
      z: -0.88,
      name: `summit_eq_bar_${idx}`,
      castShadow: false,
    });
    equalizerBars.push(barMesh);
  });

  attachContactShadow(group, 5.8, 3.4, 0.56, 0.025);

  group.userData.equalizerBars = equalizerBars;
  return group;
}

/**
 * Creates the 3 physical 3D mission props mounted inside active mission checkpoints:
 * vinyl_briefcase, mateo_speakers, and summit_stage.
 */
export function createMissionPropMeshes(): Record<MissionPropKey, THREE.Group> {
  return {
    vinyl_briefcase: buildVinylBriefcaseProp(),
    mateo_speakers: buildMateoSpeakersProp(),
    summit_stage: buildSummitStageProp(),
  };
}

/**
 * Creates a sleek glowing gold/cyan road-hugging directional GTA GPS arrow chevron
 * pointing toward local +Z for placement above upcoming turns along gpsRoute.
 */
export function createGpsChevronMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gps_road_chevron';

  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x0b0e16,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc400,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const accentMaterial = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  addMesh(group, createRoadChevronGeometry(1.24, 1.65, 0.44, 0.06), outlineMat, {
    y: -0.02,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(group, createRoadChevronGeometry(1.12, 1.5, 0.34, 0.08), glowMaterial, {
    y: 0.02,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(group, createRoadChevronGeometry(0.68, 0.92, 0.2, 0.07), accentMaterial, {
    y: 0.06,
    z: -0.26,
    castShadow: false,
    receiveShadow: false,
  });

  group.userData.glowMaterial = glowMaterial;
  group.userData.accentMaterial = accentMaterial;
  return group;
}

/**
 * Creates a smooth organic articulated 3D walking Cali pedestrian (zero BoxGeometry, grounded at
 * y = 0, facing +Z) with sculpted oval head, hair style variety, sunglasses, rounded shoulders,
 * tapered torso, and capsule limbs/sneakers with hip/shoulder pivots exposed in userData.
 */
export function createPedestrianMesh(
  shirtColorHex: number,
  pantsColorHex: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cali_pedestrian';

  const variantSeed = Math.abs(shirtColorHex * 3 + pantsColorHex * 7);
  const skinTonePalette = [0xd89e74, 0xc4855a, 0x9c6240, 0xe3b18a, 0x824e32] as const;
  const hairTonePalette = [0x1b1411, 0x2a1d16, 0x151110, 0x3b281c] as const;
  const skinHex = skinTonePalette[variantSeed % skinTonePalette.length] ?? 0xc98c62;
  const hairHex = hairTonePalette[(variantSeed >> 2) % hairTonePalette.length] ?? 0x1c1512;

  const skinMat = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.64 });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: shirtColorHex,
    roughness: 0.56,
    metalness: 0.05,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: pantsColorHex,
    roughness: 0.8,
    metalness: 0.04,
  });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x261d18, roughness: 0.72 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.54 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.78 });
  const shadesMat = createTintedGlassMaterial(0x11151d);

  // Articulated rounded legs with hip/knee spheres, tapered thigh/calf capsules & rounded sneakers
  const hipGeo = new THREE.SphereGeometry(0.08, 10, 8);
  const thighGeo = new THREE.CylinderGeometry(0.082, 0.066, 0.34, 12);
  const kneeGeo = new THREE.SphereGeometry(0.064, 10, 8);
  const calfGeo = new THREE.CapsuleGeometry(0.055, 0.25, 6, 12);
  const sneakerGeo = new THREE.CapsuleGeometry(0.055, 0.13, 6, 12);
  sneakerGeo.rotateX(Math.PI / 2);

  const buildLegPivot = (xPos: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(xPos, 0.8, 0);
    addMesh(pivot, hipGeo, pantsMat);
    addMesh(pivot, thighGeo, pantsMat, { y: -0.18 });
    addMesh(pivot, kneeGeo, pantsMat, { y: -0.35 });
    addMesh(pivot, calfGeo, pantsMat, { y: -0.52 });
    addMesh(pivot, sneakerGeo, shoeMat, { y: -0.753, z: 0.042, sy: 0.82 });
    return pivot;
  };

  const leftLeg = buildLegPivot(0.105);
  const rightLeg = buildLegPivot(-0.105);
  group.add(leftLeg, rightLeg);

  // Rounded hips, waist belt & tapered athletic torso (zero BoxGeometry)
  addMesh(group, new THREE.SphereGeometry(0.18, 14, 10), pantsMat, {
    y: 0.84,
    sx: 1.06,
    sy: 0.68,
    sz: 0.74,
  });
  addMesh(group, new THREE.TorusGeometry(0.154, 0.022, 8, 16), beltMat, {
    y: 0.9,
    rx: Math.PI / 2,
    sx: 1.05,
    sy: 0.74,
    castShadow: false,
  });
  addMesh(group, new THREE.CylinderGeometry(0.195, 0.155, 0.44, 14), shirtMat, {
    y: 1.12,
    sx: 1.08,
    sz: 0.72,
  });
  addMesh(group, new THREE.SphereGeometry(0.19, 14, 10), shirtMat, {
    y: 1.32,
    sx: 1.08,
    sy: 0.56,
    sz: 0.72,
  });

  // Rounded shoulder joints & articulated capsule arms with rounded hands
  const shoulderGeo = new THREE.SphereGeometry(0.076, 10, 8);
  const upperArmGeo = new THREE.CapsuleGeometry(0.056, 0.17, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.045, 0.19, 6, 10);
  const handGeo = new THREE.SphereGeometry(0.046, 8, 8);

  const buildArmPivot = (xPos: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(xPos, 1.31, 0);
    addMesh(pivot, shoulderGeo, shirtMat);
    addMesh(pivot, upperArmGeo, shirtMat, { y: -0.11 });
    addMesh(pivot, forearmGeo, skinMat, { y: -0.32 });
    addMesh(pivot, handGeo, skinMat, { y: -0.46, sx: 0.88, sy: 1.14, sz: 0.78 });
    return pivot;
  };

  const leftArm = buildArmPivot(0.245);
  const rightArm = buildArmPivot(-0.245);
  group.add(leftArm, rightArm);

  // Rounded neck, sculpted oval head, hair style variety (fade cap or high bun) & sleek sunglasses
  addMesh(group, new THREE.CylinderGeometry(0.054, 0.064, 0.12, 10), skinMat, { y: 1.43 });
  addMesh(group, new THREE.SphereGeometry(0.135, 14, 12), skinMat, {
    y: 1.57,
    sx: 0.86,
    sy: 1.05,
    sz: 0.92,
  });
  addMesh(
    group,
    new THREE.SphereGeometry(0.143, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairMat,
    { y: 1.59, z: -0.01, sx: 0.89, sy: 1.06, sz: 0.96 },
  );
  if (variantSeed % 2 === 0) {
    // High Cali sculpted hair bun
    addMesh(group, new THREE.SphereGeometry(0.068, 10, 8), hairMat, {
      y: 1.67,
      z: -0.11,
    });
  }

  attachOrganicSunglasses(group, shadesMat, 1.585, 0.112, 0.042, 0.04);

  attachContactShadow(group, 0.76, 0.76, 0.4, 0.025);

  group.userData.leftLeg = leftLeg;
  group.userData.rightLeg = rightLeg;
  group.userData.leftArm = leftArm;
  group.userData.rightArm = rightArm;
  return group;
}
