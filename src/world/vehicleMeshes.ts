/**
 * Photorealistic real GLB vehicle/character rigs (Ferrari 458 Italia & rigged Soldier character)
 * plus naturalistic golden-hour procedural PBR 3D fallback vehicles (all 5 Cali kinds), Valeria
 * fallback mesh, and holographic mission objective beacon. Safe in headless Node tests.
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { VehicleKind } from '../types/game';
import type { LoadedCharacterAsset } from './assetLoader';

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
  const headGeo = new THREE.BoxGeometry(0.36, 0.18, 0.12);
  const tailGeo = new THREE.BoxGeometry(0.42, 0.18, 0.12);

  for (const side of [-1, 1] as const) {
    addMesh(parent, headGeo, headlightMat, {
      x: side * xOffset,
      y: lightY,
      z: frontZ,
      castShadow: false,
    });
    addMesh(parent, tailGeo, brakeLightMat, {
      x: side * xOffset,
      y: lightY + 0.04,
      z: rearZ,
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
    roughness: 0.22,
  });
  const whiteMat = createCarPaintMaterial(accentHex, {
    metalness: 0.34,
    roughness: 0.24,
  });
  const glassMat = createTintedGlassMaterial(0x0c162b, {
    emissive: 0x0b223d,
    emissiveIntensity: 0.25,
  });
  const bellowsMat = new THREE.MeshStandardMaterial({
    color: 0x1c1a2a,
    roughness: 0.9,
    metalness: 0.08,
  });
  const trimMat = createCarbonMaterial();
  const liveryAccentMat = createCarPaintMaterial(0x1f82c9, {
    metalness: 0.45,
    roughness: 0.24,
  });
  const routeBoardMat = new THREE.MeshStandardMaterial({
    color: 0xffcf6b,
    emissive: 0xffb338,
    emissiveIntensity: 0.95,
    roughness: 0.2,
  });
  const acPodMat = createCarPaintMaterial(0xdde4f2, {
    metalness: 0.28,
    roughness: 0.32,
  });

  // Curved aerodynamic front articulated coach
  const frontLowerGeo = createProfileGeometry(
    [
      [-0.08, 0.44],
      [4.44, 0.44],
      [4.54, 0.72],
      [4.48, 1.46],
      [-0.08, 1.46],
    ],
    2.44,
    0.06,
  );
  addMesh(group, frontLowerGeo, blueMat, { name: 'mio_front_lower' });

  const frontUpperGeo = createProfileGeometry(
    [
      [-0.08, 1.44],
      [4.48, 1.44],
      [4.32, 2.74],
      [4.04, 2.88],
      [-0.08, 2.88],
    ],
    2.42,
    0.06,
  );
  addMesh(group, frontUpperGeo, whiteMat, { name: 'mio_front_upper' });

  // Panoramic tinted windows (front coach) + cyan livery stripe
  addMesh(group, new THREE.BoxGeometry(2.47, 0.96, 4.12), glassMat, {
    y: 2.08,
    z: 2.22,
    castShadow: false,
  });
  addMesh(group, new THREE.BoxGeometry(2.2, 1.12, 0.12), glassMat, {
    y: 2.04,
    z: 4.38,
    rx: -0.14,
    castShadow: false,
  });
  addMesh(group, new THREE.BoxGeometry(2.48, 0.1, 4.46), liveryAccentMat, {
    y: 1.46,
    z: 2.18,
    castShadow: false,
  });

  // Pleated articulated bellows connector
  addMesh(group, new THREE.BoxGeometry(2.2, 2.24, 0.92), bellowsMat, {
    y: 1.66,
    z: -0.52,
  });
  for (let rib = -1; rib <= 1; rib += 1) {
    addMesh(group, new THREE.BoxGeometry(2.28, 2.28, 0.08), trimMat, {
      y: 1.66,
      z: -0.52 + rib * 0.26,
      castShadow: false,
    });
  }

  // Rear articulated coach
  const rearLowerGeo = createProfileGeometry(
    [
      [-4.56, 0.44],
      [-0.94, 0.44],
      [-0.94, 1.46],
      [-4.56, 1.46],
    ],
    2.44,
    0.06,
  );
  addMesh(group, rearLowerGeo, blueMat, { name: 'mio_rear_lower' });

  const rearUpperGeo = createProfileGeometry(
    [
      [-4.56, 1.44],
      [-0.94, 1.44],
      [-0.94, 2.88],
      [-4.46, 2.88],
    ],
    2.42,
    0.06,
  );
  addMesh(group, rearUpperGeo, whiteMat, { name: 'mio_rear_upper' });

  addMesh(group, new THREE.BoxGeometry(2.47, 0.96, 3.22), glassMat, {
    y: 2.08,
    z: -2.75,
    castShadow: false,
  });
  addMesh(group, new THREE.BoxGeometry(2.48, 0.1, 3.55), liveryAccentMat, {
    y: 1.46,
    z: -2.75,
    castShadow: false,
  });

  // Illuminated front LED destination route board
  addMesh(group, new THREE.BoxGeometry(1.74, 0.28, 0.14), routeBoardMat, {
    y: 2.66,
    z: 4.34,
    name: 'mio_route_board',
    castShadow: false,
  });

  attachContactShadow(group, 2.75, 9.45, 0.6, 0.03);

  // Twin aerodynamic roof AC pods
  addMesh(group, new THREE.BoxGeometry(1.66, 0.28, 1.85), acPodMat, {
    y: 3.02,
    z: 1.9,
  });
  addMesh(group, new THREE.BoxGeometry(1.66, 0.28, 1.6), acPodMat, {
    y: 3.02,
    z: -2.65,
  });

  // Extended bus side wing mirrors
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.28, 0.06, 0.06), trimMat, {
      x: side * 1.32,
      y: 2.18,
      z: 4.24,
    });
    addMesh(group, new THREE.BoxGeometry(0.1, 0.42, 0.18), trimMat, {
      x: side * 1.44,
      y: 2.02,
      z: 4.26,
    });
  }

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
  const brakeLightMaterials = attachStandardLampPairs(group, 1.14, 4.52, -4.58, 0.82);

  group.userData.brakeLightMaterials = brakeLightMaterials;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildChivaMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_chiva';

  const primaryMat = createCarPaintMaterial(colorHex, {
    metalness: 0.35,
    roughness: 0.28,
  });
  const accentMat = createCarPaintMaterial(accentHex, {
    metalness: 0.32,
    roughness: 0.28,
  });
  const emeraldMat = createCarPaintMaterial(0x00d98b, {
    metalness: 0.3,
    roughness: 0.3,
  });
  const cyanMat = createCarPaintMaterial(0x00d8f0, {
    metalness: 0.3,
    roughness: 0.3,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x7b4722,
    roughness: 0.78,
    metalness: 0.05,
  });
  const chromeMat = createChromeMaterial();
  const windshieldMat = createTintedGlassMaterial(0x161d33);

  // Classic curved front engine hood & wheel fenders
  const noseGeo = createProfileGeometry(
    [
      [2.05, 0.52],
      [3.38, 0.54],
      [3.44, 1.24],
      [3.16, 1.5],
      [2.05, 1.56],
    ],
    1.76,
    0.07,
  );
  addMesh(group, noseGeo, accentMat, { name: 'chiva_nose' });

  // Gleaming chrome front grille slats & chrome bumper
  addMesh(group, new THREE.BoxGeometry(1.98, 0.22, 0.18), chromeMat, {
    y: 0.62,
    z: 3.48,
  });
  for (let slat = 0; slat < 4; slat += 1) {
    addMesh(group, new THREE.BoxGeometry(1.16, 0.07, 0.08), chromeMat, {
      y: 0.88 + slat * 0.14,
      z: 3.45,
    });
  }

  // Windshield frame above hood
  addMesh(group, new THREE.BoxGeometry(2.14, 0.88, 0.12), windshieldMat, {
    y: 2.02,
    z: 2.12,
  });

  // Festive multi-colored wooden-slat lower body
  addMesh(group, new THREE.BoxGeometry(2.34, 0.96, 5.18), primaryMat, {
    y: 1.02,
    z: -0.46,
    name: 'chiva_hull',
  });
  addMesh(group, new THREE.BoxGeometry(2.4, 0.22, 5.12), cyanMat, {
    y: 1.18,
    z: -0.46,
  });
  addMesh(group, new THREE.BoxGeometry(2.4, 0.18, 5.12), emeraldMat, {
    y: 0.82,
    z: -0.46,
  });

  // Side wooden slat rails & running boards
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.14, 0.08, 4.9), woodMat, {
      x: side * 1.22,
      y: 0.56,
      z: -0.46,
    });
    for (let slat = 0; slat < 3; slat += 1) {
      addMesh(group, new THREE.BoxGeometry(0.05, 0.08, 5.05), woodMat, {
        x: side * 1.21,
        y: 0.72 + slat * 0.28,
        z: -0.46,
        castShadow: false,
      });
    }
  }

  // Open-air wooden passenger benches & festive vertical pillars
  const benchMats = [woodMat, accentMat, emeraldMat] as const;
  for (let i = 0; i < 4; i += 1) {
    const zPos = 1.42 - i * 1.26;
    const benchMat = benchMats[i % benchMats.length] ?? woodMat;
    addMesh(group, new THREE.BoxGeometry(2.08, 0.18, 0.48), benchMat, {
      y: 1.22,
      z: zPos,
    });
    addMesh(group, new THREE.BoxGeometry(2.08, 0.42, 0.1), woodMat, {
      y: 1.5,
      z: zPos - 0.22,
    });

    for (const side of [-1.1, 1.1] as const) {
      addMesh(group, new THREE.BoxGeometry(0.13, 1.22, 0.13), accentMat, {
        x: side,
        y: 2.04,
        z: zPos,
      });
    }
  }

  // Canopy roof + wooden rooftop luggage rack + colorful cargo bundles
  addMesh(group, new THREE.BoxGeometry(2.46, 0.22, 5.48), primaryMat, {
    y: 2.68,
    z: -0.42,
  });
  for (const side of [-1.12, 1.12] as const) {
    addMesh(group, new THREE.BoxGeometry(0.08, 0.3, 4.96), woodMat, {
      x: side,
      y: 2.94,
      z: -0.48,
    });
  }
  for (const endZ of [-2.94, 1.98] as const) {
    addMesh(group, new THREE.BoxGeometry(2.3, 0.3, 0.08), woodMat, {
      y: 2.94,
      z: endZ,
    });
  }

  const cargoSpecs = [
    { x: -0.46, z: 0.84, w: 0.84, h: 0.54, d: 1.0, mat: accentMat },
    { x: 0.46, z: 0.68, w: 0.8, h: 0.48, d: 0.9, mat: cyanMat },
    { x: 0.0, z: -0.68, w: 1.44, h: 0.58, d: 1.22, mat: emeraldMat },
    { x: -0.24, z: -2.0, w: 1.1, h: 0.48, d: 0.94, mat: accentMat },
  ] as const;
  for (const cargo of cargoSpecs) {
    addMesh(group, new THREE.BoxGeometry(cargo.w, cargo.h, cargo.d), cargo.mat, {
      x: cargo.x,
      y: 2.8 + cargo.h * 0.5,
      z: cargo.z,
    });
  }

  // Warm fiesta string bulbs along both roof eaves
  const bulbPalette = [0xffcf54, 0xff9e3d, 0xffe680, 0xe86b4a] as const;
  const bulbGeo = new THREE.SphereGeometry(0.11, 8, 8);
  for (let i = 0; i < 7; i += 1) {
    const bulbHex = bulbPalette[i % bulbPalette.length] ?? 0xffcf54;
    const bulbMat = new THREE.MeshStandardMaterial({
      color: bulbHex,
      emissive: bulbHex,
      emissiveIntensity: 1.05,
      roughness: 0.18,
    });
    const zPos = 2.08 - i * 0.84;
    for (const side of [-1.26, 1.26] as const) {
      addMesh(group, bulbGeo, bulbMat, {
        x: side,
        y: 2.66,
        z: zPos,
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
  const brakeLightMaterials = attachStandardLampPairs(group, 0.94, 3.45, -3.08, 0.86);

  group.userData.brakeLightMaterials = brakeLightMaterials;
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

/**
 * Creates a stylized realistic 3D mesh for Valeria (feet resting at y = 0, facing +Z).
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
  const cyanStripeMat = new THREE.MeshStandardMaterial({
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
  const soleMat = new THREE.MeshStandardMaterial({
    color: 0x1b1c22,
    roughness: 0.88,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x1b1412,
    roughness: 0.76,
    metalness: 0.08,
  });
  const shadesMat = createTintedGlassMaterial(0x11151d);

  // Legs with hip pivots, tapered slim pants, and detailed sneakers resting at y = 0
  const thighGeo = new THREE.CylinderGeometry(0.095, 0.078, 0.66, 10);
  const sneakerUpperGeo = new THREE.BoxGeometry(0.16, 0.09, 0.27);
  const sneakerSoleGeo = new THREE.BoxGeometry(0.17, 0.04, 0.28);

  const buildLegPivot = (xPos: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(xPos, 0.8, 0);
    addMesh(pivot, thighGeo, pantsMat, { y: -0.34 });
    addMesh(pivot, sneakerUpperGeo, sneakerMat, { y: -0.715, z: 0.03 });
    addMesh(pivot, sneakerSoleGeo, soleMat, { y: -0.78, z: 0.03 });
    addMesh(pivot, new THREE.BoxGeometry(0.165, 0.03, 0.09), cyanStripeMat, {
      y: -0.72,
      z: -0.06,
      castShadow: false,
    });
    return pivot;
  };

  const leftLegPivot = buildLegPivot(0.13);
  const rightLegPivot = buildLegPivot(-0.13);
  group.add(leftLegPivot, rightLegPivot);

  // Tailored torso: inner graphic tank + Vice-Sunset satin bomber jacket with collar & cyan stripe
  addMesh(group, new THREE.CylinderGeometry(0.2, 0.17, 0.56, 12), innerTopMat, {
    y: 1.09,
  });
  addMesh(group, new THREE.BoxGeometry(0.48, 0.44, 0.29), jacketMat, {
    y: 1.13,
    z: -0.02,
  });
  // Upturned bomber collar & cyan hem trim
  addMesh(group, new THREE.CylinderGeometry(0.14, 0.16, 0.1, 12), jacketMat, {
    y: 1.38,
    z: -0.01,
  });
  addMesh(group, new THREE.BoxGeometry(0.5, 0.055, 0.31), cyanStripeMat, {
    y: 0.91,
    z: -0.02,
    castShadow: false,
  });
  // Vertical cyan bomber accent stripes
  for (const sx of [-0.14, 0.14] as const) {
    addMesh(group, new THREE.BoxGeometry(0.04, 0.4, 0.03), cyanStripeMat, {
      x: sx,
      y: 1.13,
      z: 0.135,
      castShadow: false,
    });
  }

  // Arms with shoulder pivots, bomber sleeves, cyan cuff stripes & hands
  const sleeveGeo = new THREE.CylinderGeometry(0.072, 0.064, 0.34, 10);
  const forearmGeo = new THREE.CylinderGeometry(0.056, 0.048, 0.22, 8);
  const handGeo = new THREE.SphereGeometry(0.052, 8, 8);

  const buildArmPivot = (xPos: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(xPos, 1.31, 0);
    addMesh(pivot, sleeveGeo, jacketMat, { y: -0.16 });
    addMesh(pivot, new THREE.CylinderGeometry(0.074, 0.07, 0.04, 10), cyanStripeMat, {
      y: -0.32,
      castShadow: false,
    });
    addMesh(pivot, forearmGeo, skinMat, { y: -0.42 });
    addMesh(pivot, handGeo, skinMat, { y: -0.55 });
    return pivot;
  };

  const leftArmPivot = buildArmPivot(0.32);
  const rightArmPivot = buildArmPivot(-0.32);
  group.add(leftArmPivot, rightArmPivot);

  // Neck, sculpted head, reflective sunset visor shades & sweeping ponytail
  addMesh(group, new THREE.CylinderGeometry(0.065, 0.075, 0.12, 10), skinMat, {
    y: 1.43,
  });
  addMesh(group, new THREE.SphereGeometry(0.155, 14, 12), skinMat, {
    y: 1.56,
  });
  addMesh(group, new THREE.SphereGeometry(0.166, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat, {
    y: 1.58,
    z: -0.02,
  });
  addMesh(group, new THREE.BoxGeometry(0.28, 0.075, 0.08), shadesMat, {
    y: 1.57,
    z: 0.135,
    castShadow: false,
  });

  // Sculpted two-segment ponytail sweeping back
  addMesh(group, new THREE.SphereGeometry(0.075, 8, 8), hairMat, {
    y: 1.59,
    z: -0.17,
  });
  addMesh(group, new THREE.ConeGeometry(0.09, 0.42, 10), hairMat, {
    y: 1.42,
    z: -0.25,
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

/**
 * Builds the player Ferrari 458 Italia from the loaded GLB template: deep-cloned with
 * independent materials, rotated +180° around Y (nose +Z, quad-taillights -Z), normalized
 * to 4.55m length resting at y = 0, upgraded to glossy Rosso Corsa clearcoat + smoked glass +
 * emissive crimson brake lights, rigged with front steering pivots and spinning wheels.
 */
export function createFerrariPlayerMesh(ferrariTemplate: THREE.Group): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_banshee_ferrari';

  const clonedModel = cloneGroupWithMaterials(ferrariTemplate);
  const innerGroup = new THREE.Group();
  innerGroup.name = 'ferrari_model_root';
  innerGroup.rotation.y = Math.PI;
  innerGroup.add(clonedModel);
  group.add(innerGroup);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xb80e24,
    metalness: 0.65,
    roughness: 0.15,
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
    emissiveIntensity: 1.6,
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

  const headlightCones = attachHeadlightCones(group, 0.72, 0.62, 2.22, 4.8, 0.88);
  const nitroFlames = attachFerrariNitroFlames(group);
  attachContactShadow(group, 2.35, 4.9, 0.64, 0.03);

  group.userData.wheels = wheels;
  group.userData.frontWheels = frontWheels;
  group.userData.brakeLightMaterials = [brakeLightMat];
  group.userData.headlightCones = headlightCones;
  group.userData.nitroFlames = nitroFlames;
  return group;
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
 * Builds the rigged, animated third-person character from the loaded GLB asset, rotated +180°
 * around Y to walk facing +Z, normalized to 1.78m height resting at y = 0, with Idle/Walk/Run
 * AnimationActions bound to an AnimationMixer.
 */
export function createRiggedCharacterMesh(
  characterAsset: LoadedCharacterAsset,
): RiggedCharacterRig {
  const group = new THREE.Group();
  group.name = 'player_rigged_character';

  const clonedScene = SkeletonUtils.clone(characterAsset.scene);
  const innerGroup = new THREE.Group();
  innerGroup.name = 'character_model_root';
  innerGroup.rotation.y = Math.PI;
  innerGroup.add(clonedScene);
  group.add(innerGroup);

  innerGroup.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false;

    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.envMapIntensity = Math.max(mat.envMapIntensity, 0.9);
      }
    }
  });

  innerGroup.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(innerGroup);
  if (!rawBox.isEmpty()) {
    const rawSize = rawBox.getSize(new THREE.Vector3());
    if (rawSize.y > 0.01) {
      const scaleFactor = CHARACTER_TARGET_HEIGHT_METERS / rawSize.y;
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
 * Creates a bloom-ready holographic mission light pillar paired with a spinning ground target ring
 * and hovering downward chevron indicator.
 */
export function createObjectiveBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'objective_beacon';

  const outerBeamMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerBeamMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const chevronMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // Soft vertical volumetric light pillar
  const lightBeam = new THREE.Group();
  lightBeam.name = 'objective_light_beam';

  addMesh(lightBeam, new THREE.CylinderGeometry(1.18, 1.55, 64, 18, 1, true), outerBeamMat, {
    y: 32,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(lightBeam, new THREE.CylinderGeometry(0.4, 0.56, 64, 14, 1, true), innerBeamMat, {
    y: 32,
    castShadow: false,
    receiveShadow: false,
  });
  for (const ringY of [5, 13, 24] as const) {
    addMesh(lightBeam, new THREE.TorusGeometry(1.42, 0.06, 8, 28), innerBeamMat, {
      y: ringY,
      rx: Math.PI / 2,
      castShadow: false,
      receiveShadow: false,
    });
  }
  group.add(lightBeam);

  // Spinning ground holographic target ring + hovering pulsing chevron
  const targetRing = new THREE.Group();
  targetRing.name = 'objective_target_ring';
  targetRing.position.y = 0.28;

  addMesh(targetRing, new THREE.TorusGeometry(3.2, 0.16, 10, 32), ringMat, {
    rx: Math.PI / 2,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(targetRing, new THREE.RingGeometry(1.85, 2.28, 32), ringMat, {
    rx: -Math.PI / 2,
    castShadow: false,
    receiveShadow: false,
  });

  // Holographic 3D downward chevron floating above target center
  const chevronArmGeo = new THREE.BoxGeometry(1.35, 0.24, 0.24);
  addMesh(targetRing, chevronArmGeo, chevronMat, {
    x: -0.44,
    y: 2.85,
    rz: -Math.PI / 4,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(targetRing, chevronArmGeo, chevronMat, {
    x: 0.44,
    y: 2.85,
    rz: Math.PI / 4,
    castShadow: false,
    receiveShadow: false,
  });
  addMesh(targetRing, new THREE.OctahedronGeometry(0.42, 0), chevronMat, {
    y: 3.9,
    castShadow: false,
    receiveShadow: false,
  });

  // Perimeter diamond markers
  const markerGeo = new THREE.OctahedronGeometry(0.42, 0);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    addMesh(targetRing, markerGeo, ringMat, {
      x: Math.cos(angle) * 3.2,
      y: 0.85,
      z: Math.sin(angle) * 3.2,
      castShadow: false,
      receiveShadow: false,
    });
  }
  group.add(targetRing);

  group.userData.lightBeam = lightBeam;
  group.userData.targetRing = targetRing;
  group.userData.beamMaterials = [outerBeamMat, innerBeamMat, ringMat, chevronMat];
  return group;
}
