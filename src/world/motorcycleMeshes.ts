/**
 * Sculpted PBR Cali motos: the iconic Yamaha RX115 two-stroke street bike ("la RX") and the
 * Yamaha DT125 dual-sport ("trochera"). Each rig has a painted tank, leather seat, raked chrome
 * forks, spoked/cast wheels, a fat 2-stroke expansion chamber, round headlight, rear-only yellow
 * Colombian moto plate ("ABC 12D"), and an NPC "motorizado" rider with helmet and the legally
 * required reflective vest printed with the plate number. Honors the vehicle userData contract
 * (wheels, frontWheels, nitroFlames, headlightCones, brakeLightMaterials) plus `riderSeat` and
 * `npcRider` for the renderer.
 */

import * as THREE from 'three';
import type { MotorcycleKind } from '../types/game';
import {
  addMesh,
  attachColombianLicensePlate,
  attachContactShadow,
  attachHeadlightCones,
  attachPlayerNitroFlames,
  attachUnderglow,
  createBrakeLightMaterial,
  createCarPaintMaterial,
  createChromeMaterial,
  createRoundedPodGeometry,
  createXenonHeadlightMaterial,
} from './vehicleMeshes';

export interface MotorcycleRiderSeat {
  readonly seatY: number;
  readonly seatZ: number;
}

interface MotorcycleSpec {
  readonly wheelbase: number;
  readonly frontRadius: number;
  readonly rearRadius: number;
  readonly tireTube: number;
  readonly spokedWheels: boolean;
  readonly forkLength: number;
  readonly forkRake: number;
  readonly seat: MotorcycleRiderSeat;
  readonly upsweptExhaust: boolean;
  readonly highFenders: boolean;
  readonly twinShocks: boolean;
}

const MOTORCYCLE_SPECS: Readonly<Record<MotorcycleKind, MotorcycleSpec>> = {
  yamaha_rx115: {
    wheelbase: 1.25,
    frontRadius: 0.29,
    rearRadius: 0.29,
    tireTube: 0.05,
    spokedWheels: false,
    forkLength: 0.7,
    forkRake: 0.45,
    seat: { seatY: 0.78, seatZ: -0.2 },
    upsweptExhaust: false,
    highFenders: false,
    twinShocks: true,
  },
  yamaha_dt125: {
    wheelbase: 1.33,
    frontRadius: 0.34,
    rearRadius: 0.32,
    tireTube: 0.065,
    spokedWheels: true,
    forkLength: 0.86,
    forkRake: 0.48,
    seat: { seatY: 0.88, seatZ: -0.18 },
    upsweptExhaust: true,
    highFenders: true,
    twinShocks: false,
  },
};

/** Colombian moto plates: three letters, two digits, and a trailing letter. */
export const MOTORCYCLE_PLATE_CODES: Readonly<Record<MotorcycleKind, string>> = {
  yamaha_rx115: 'RXK 15E',
  yamaha_dt125: 'DTC 25F',
};

const VEST_LIME_HEX = 0xc6f432;

export function getMotorcycleRiderSeat(kind: MotorcycleKind): MotorcycleRiderSeat {
  return MOTORCYCLE_SPECS[kind].seat;
}

interface MotoMaterials {
  readonly paint: THREE.MeshPhysicalMaterial;
  readonly accent: THREE.MeshPhysicalMaterial;
  readonly chrome: THREE.MeshPhysicalMaterial;
  readonly black: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly leather: THREE.MeshStandardMaterial;
  readonly engine: THREE.MeshStandardMaterial;
  readonly pipe: THREE.MeshStandardMaterial;
  readonly headlight: THREE.MeshStandardMaterial;
  readonly brake: THREE.MeshStandardMaterial;
}

function createMotoMaterials(colorHex: number, accentHex: number): MotoMaterials {
  return {
    paint: createCarPaintMaterial(colorHex, { metalness: 0.55, roughness: 0.22 }),
    accent: createCarPaintMaterial(accentHex, { metalness: 0.4, roughness: 0.3, clearcoat: 0.8 }),
    chrome: createChromeMaterial(),
    black: new THREE.MeshStandardMaterial({ color: 0x15161d, roughness: 0.5, metalness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111216, roughness: 0.92, metalness: 0.04 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1a1b22, roughness: 0.7, metalness: 0.08 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.38, metalness: 0.78 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.45, metalness: 0.7 }),
    headlight: createXenonHeadlightMaterial(),
    brake: createBrakeLightMaterial(),
  };
}

const UP = new THREE.Vector3(0, 1, 0);

/** Adds a cylinder spanning two local points (frame tubes, forks, rider limbs). */
function addSpan(
  parent: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  name?: string,
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(0.01, direction.length());
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) {
    mesh.name = name;
  }
  parent.add(mesh);
  return mesh;
}

/** Wheel spinning about local X (tire torus in the YZ plane), spoked or 5-spoke cast. */
function buildMotoWheel(radius: number, spec: MotorcycleSpec, mats: MotoMaterials, withDisc: boolean): THREE.Group {
  const hub = new THREE.Group();
  const tireGeo = new THREE.TorusGeometry(radius - spec.tireTube, spec.tireTube, 10, 28);
  tireGeo.rotateY(Math.PI / 2);
  addMesh(hub, tireGeo, mats.rubber);

  const rimGeo = new THREE.TorusGeometry(radius - spec.tireTube * 1.9, 0.018, 6, 28);
  rimGeo.rotateY(Math.PI / 2);
  addMesh(hub, rimGeo, mats.chrome, { castShadow: false });

  const hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12);
  hubGeo.rotateZ(Math.PI / 2);
  addMesh(hub, hubGeo, mats.engine, { castShadow: false });

  const spokeReach = radius - spec.tireTube * 1.9;
  const spokeCount = spec.spokedWheels ? 18 : 5;
  const spokeGeo = spec.spokedWheels
    ? new THREE.CylinderGeometry(0.004, 0.004, spokeReach, 4)
    : new THREE.BoxGeometry(0.03, spokeReach, 0.045);
  const spokeMat = spec.spokedWheels ? mats.chrome : mats.black;
  for (let i = 0; i < spokeCount; i += 1) {
    const angle = (i / spokeCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, spokeMat);
    spoke.position.set(
      spec.spokedWheels ? (i % 2 === 0 ? 0.03 : -0.03) : 0,
      Math.cos(angle) * spokeReach * 0.5,
      Math.sin(angle) * spokeReach * 0.5,
    );
    spoke.rotation.x = angle;
    spoke.castShadow = false;
    hub.add(spoke);
  }

  if (withDisc) {
    const discGeo = new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, 0.008, 18);
    discGeo.rotateZ(Math.PI / 2);
    addMesh(hub, discGeo, mats.engine, { x: 0.065, castShadow: false });
  }
  return hub;
}

interface ForkRig {
  readonly pivot: THREE.Group;
  readonly spin: THREE.Group;
  readonly headlightY: number;
  readonly headlightZ: number;
}

/** Steerable front end: wheel, raked chrome forks, bars, round headlight, speedo, fender. */
function buildFrontEnd(spec: MotorcycleSpec, mats: MotoMaterials): ForkRig {
  const axleZ = spec.wheelbase * 0.5;
  const pivot = new THREE.Group();
  pivot.name = 'moto_fork_pivot';
  pivot.position.set(0, spec.frontRadius, axleZ);

  const spin = buildMotoWheel(spec.frontRadius, spec, mats, true);
  pivot.add(spin);

  const rakeDir = new THREE.Vector3(0, Math.cos(spec.forkRake), -Math.sin(spec.forkRake));
  const forkTop = rakeDir.clone().multiplyScalar(spec.forkLength);
  for (const side of [-1, 1] as const) {
    const base = new THREE.Vector3(side * 0.085, 0, 0);
    const top = forkTop.clone().add(new THREE.Vector3(side * 0.085, 0, 0));
    addSpan(pivot, base, top, 0.022, mats.chrome);
  }
  addMesh(pivot, new THREE.BoxGeometry(0.22, 0.04, 0.07), mats.black, {
    y: forkTop.y - 0.04,
    z: forkTop.z,
  });

  const barY = forkTop.y + 0.06;
  const barZ = forkTop.z - 0.04;
  addSpan(pivot, new THREE.Vector3(-0.34, barY + 0.03, barZ - 0.05), new THREE.Vector3(0.34, barY + 0.03, barZ - 0.05), 0.012, mats.chrome);
  for (const side of [-1, 1] as const) {
    addSpan(
      pivot,
      new THREE.Vector3(side * 0.3, barY + 0.03, barZ - 0.05),
      new THREE.Vector3(side * 0.4, barY + 0.03, barZ - 0.07),
      0.018,
      mats.rubber,
    );
    // Round chrome mirrors on stalks
    addSpan(pivot, new THREE.Vector3(side * 0.24, barY + 0.04, barZ - 0.05), new THREE.Vector3(side * 0.3, barY + 0.24, barZ - 0.06), 0.006, mats.black);
    const mirrorGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.015, 14);
    mirrorGeo.rotateX(Math.PI / 2);
    addMesh(pivot, mirrorGeo, mats.chrome, { x: side * 0.3, y: barY + 0.26, z: barZ - 0.06, castShadow: false });
  }

  // Round headlight shell + lens and analog speedo
  const headlightY = barY - 0.12;
  const headlightZ = forkTop.z + 0.12;
  const shellGeo = new THREE.CylinderGeometry(0.095, 0.085, 0.12, 18);
  shellGeo.rotateX(Math.PI / 2);
  addMesh(pivot, shellGeo, mats.black, { y: headlightY, z: headlightZ - 0.04 });
  const lensGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.02, 18);
  lensGeo.rotateX(Math.PI / 2);
  addMesh(pivot, lensGeo, mats.headlight, { y: headlightY, z: headlightZ + 0.025, castShadow: false });
  const speedoGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 14);
  addMesh(pivot, speedoGeo, mats.black, { y: barY + 0.06, z: barZ + 0.02, rx: -0.5, castShadow: false });

  // Front fender: low hugging (RX) or high motocross (DT)
  const fenderGeo = createRoundedPodGeometry(0.13, 0.025, spec.highFenders ? 0.62 : 0.46, 0.01, 0.006);
  addMesh(pivot, fenderGeo, spec.highFenders ? mats.accent : mats.paint, {
    y: spec.highFenders ? forkTop.y * 0.55 : spec.frontRadius + 0.03,
    z: spec.highFenders ? forkTop.z * 0.55 + 0.1 : 0.0,
    rx: spec.highFenders ? 0.12 : 0,
  });
  if (spec.highFenders) {
    // DT125 enduro number board around the headlight
    addMesh(pivot, createRoundedPodGeometry(0.26, 0.24, 0.03, 0.05, 0.01), mats.accent, {
      y: headlightY + 0.03,
      z: headlightZ - 0.08,
      rx: -spec.forkRake,
    });
  }

  return { pivot, spin, headlightY: spec.frontRadius + headlightY, headlightZ: axleZ + headlightZ };
}

interface ExhaustTip {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Fat 2-stroke expansion chamber + stinger: under-slung (RX) or upswept along the side (DT). */
function attachExpansionChamber(group: THREE.Group, kind: MotorcycleKind, spec: MotorcycleSpec, mats: MotoMaterials): ExhaustTip {
  const side = 0.16;
  const points = spec.upsweptExhaust
    ? [
        new THREE.Vector3(0.02, 0.52, 0.28),
        new THREE.Vector3(0.1, 0.36, 0.22),
        new THREE.Vector3(side, 0.46, -0.1),
        new THREE.Vector3(side + 0.02, 0.66, -0.42),
      ]
    : [
        new THREE.Vector3(0.02, 0.5, 0.26),
        new THREE.Vector3(0.06, 0.2, 0.2),
        new THREE.Vector3(side, 0.18, -0.12),
        new THREE.Vector3(side + 0.02, 0.3, -0.42),
      ];
  const curve = new THREE.CatmullRomCurve3(points);
  addMesh(group, new THREE.TubeGeometry(curve, 24, 0.022, 8, false), mats.pipe, { name: `${kind}_exhaust_header` });

  const bellyStart = points[1] ?? new THREE.Vector3();
  const bellyEnd = points[2] ?? new THREE.Vector3();
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.24, 6, 12), mats.pipe);
  belly.position.copy(bellyStart).lerp(bellyEnd, 0.5);
  belly.quaternion.setFromUnitVectors(UP, bellyEnd.clone().sub(bellyStart).normalize());
  belly.name = `${kind}_expansion_chamber`;
  belly.castShadow = true;
  group.add(belly);

  const stingerEnd = points[3] ?? new THREE.Vector3();
  const tip = stingerEnd.clone().add(new THREE.Vector3(0, spec.upsweptExhaust ? 0.06 : 0.04, -0.22));
  addSpan(group, stingerEnd, tip, 0.03, mats.chrome, `${kind}_silencer`);
  return { x: tip.x, y: tip.y, z: tip.z - 0.06 };
}

function attachChassis(group: THREE.Group, kind: MotorcycleKind, spec: MotorcycleSpec, mats: MotoMaterials): void {
  const { seatY, seatZ } = spec.seat;
  const headTube = new THREE.Vector3(0, seatY + 0.12, spec.wheelbase * 0.5 - 0.22);
  const swingPivot = new THREE.Vector3(0, 0.4, -0.12);
  const rearAxle = new THREE.Vector3(0, spec.rearRadius, -spec.wheelbase * 0.5);

  // Steel spine + down tube frame
  addSpan(group, headTube, new THREE.Vector3(0, seatY - 0.02, seatZ + 0.1), 0.028, mats.black);
  addSpan(group, headTube, new THREE.Vector3(0, 0.3, 0.18), 0.025, mats.black);
  addSpan(group, new THREE.Vector3(0, 0.3, 0.18), swingPivot, 0.025, mats.black);
  for (const side of [-1, 1] as const) {
    addSpan(group, swingPivot.clone().setX(side * 0.1), rearAxle.clone().setX(side * 0.1), 0.022, mats.black);
  }
  if (spec.twinShocks) {
    for (const side of [-1, 1] as const) {
      addSpan(group, rearAxle.clone().setX(side * 0.12).setY(rearAxle.y + 0.04), new THREE.Vector3(side * 0.12, seatY - 0.04, seatZ - 0.28), 0.02, mats.chrome);
    }
  } else {
    addSpan(group, swingPivot.clone().setY(0.44), new THREE.Vector3(0, seatY - 0.06, seatZ + 0.05), 0.03, mats.accent);
  }

  // Air-cooled 2-stroke single: crankcase + finned barrel tilted forward
  addMesh(group, createRoundedPodGeometry(0.24, 0.24, 0.32, 0.06, 0.02), mats.engine, { y: 0.36, z: 0.06, name: `${kind}_engine` });
  for (let i = 0; i < 5; i += 1) {
    addMesh(group, new THREE.BoxGeometry(0.2, 0.014, 0.17), mats.engine, {
      y: 0.5 + i * 0.035,
      z: 0.14 + i * 0.012,
      rx: -0.35,
      castShadow: false,
    });
  }

  // Painted teardrop tank, accent stripe, leather seat, side covers, tail cowl
  addMesh(group, createRoundedPodGeometry(0.3, 0.19, 0.5, 0.08, 0.03), mats.paint, {
    y: seatY + 0.05,
    z: seatZ + 0.5,
    rx: 0.1,
    name: `${kind}_fuel_tank`,
  });
  for (const side of [-1, 1] as const) {
    addMesh(group, new THREE.BoxGeometry(0.01, 0.05, 0.36), mats.accent, {
      x: side * 0.16,
      y: seatY + 0.06,
      z: seatZ + 0.5,
      rx: 0.1,
      castShadow: false,
    });
    addMesh(group, createRoundedPodGeometry(0.03, 0.16, 0.24, 0.03, 0.01), mats.paint, {
      x: side * 0.12,
      y: seatY - 0.14,
      z: seatZ - 0.02,
    });
    // Foot pegs
    addSpan(group, new THREE.Vector3(side * 0.12, 0.3, -0.02), new THREE.Vector3(side * 0.24, 0.3, -0.02), 0.014, mats.black);
  }
  addMesh(group, createRoundedPodGeometry(0.25, 0.08, 0.64, 0.04, 0.015), mats.leather, {
    y: seatY,
    z: seatZ - 0.05,
    name: `${kind}_seat`,
  });
  addMesh(group, createRoundedPodGeometry(0.2, 0.1, 0.3, 0.04, 0.015), mats.paint, {
    y: seatY - 0.02,
    z: seatZ - 0.5,
    rx: -0.12,
  });

  // Rear fender carrying the plate
  addMesh(group, createRoundedPodGeometry(0.13, 0.025, 0.42, 0.01, 0.006), spec.highFenders ? mats.accent : mats.black, {
    y: spec.highFenders ? seatY - 0.08 : spec.rearRadius + 0.2,
    z: -spec.wheelbase * 0.5 - 0.12,
    rx: spec.highFenders ? -0.1 : 0.25,
  });
}

function createVestTexture(code: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = '#c6f432';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#d7dde6';
  ctx.fillRect(0, 14, 256, 12);
  ctx.fillRect(0, 102, 256, 12);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Procedural NPC "motorizado": seated pose reaching the bars, full-face helmet with visor, and the
 * reflective vest showing the plate number (Colombian helmet + vest law).
 */
function buildNpcRider(spec: MotorcycleSpec, plateCode: string, helmetHex: number): THREE.Group {
  const rider = new THREE.Group();
  rider.name = 'moto_npc_rider';
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x9a6a4a, roughness: 0.7 });
  const jeansMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.85 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.8 });
  const vestTexture = createVestTexture(plateCode);
  const vestMat = new THREE.MeshStandardMaterial({
    color: vestTexture ? 0xffffff : VEST_LIME_HEX,
    ...(vestTexture ? { map: vestTexture } : {}),
    emissive: VEST_LIME_HEX,
    emissiveIntensity: 0.22,
    roughness: 0.5,
  });
  const helmetMat = createCarPaintMaterial(helmetHex, { metalness: 0.3, roughness: 0.18 });
  const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1522, metalness: 0.6, roughness: 0.05, clearcoat: 1 });

  const { seatY, seatZ } = spec.seat;
  const hip = new THREE.Vector3(0, seatY + 0.07, seatZ);
  const torsoLean = 0.38;
  const shoulder = hip.clone().add(new THREE.Vector3(0, Math.cos(torsoLean) * 0.48, Math.sin(torsoLean) * 0.48));
  const handY = seatY + 0.2;
  const handZ = spec.wheelbase * 0.5 - Math.sin(spec.forkRake) * spec.forkLength - 0.1;

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 6, 12), shirtMat);
  torso.position.copy(hip).lerp(shoulder, 0.5);
  torso.rotation.x = torsoLean;
  torso.castShadow = true;
  rider.add(torso);
  const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.24, 6, 12), vestMat);
  vest.position.copy(torso.position);
  vest.rotation.x = torsoLean;
  vest.name = 'moto_rider_vest';
  rider.add(vest);

  for (const side of [-1, 1] as const) {
    const hipSide = hip.clone().setX(side * 0.11);
    const knee = new THREE.Vector3(side * 0.19, seatY - 0.02, seatZ + 0.36);
    const foot = new THREE.Vector3(side * 0.2, 0.32, -0.02);
    addSpan(rider, hipSide, knee, 0.07, jeansMat);
    addSpan(rider, knee, foot, 0.055, jeansMat);
    addMesh(rider, new THREE.BoxGeometry(0.1, 0.07, 0.22), shirtMat, { x: foot.x, y: foot.y - 0.02, z: foot.z + 0.05 });

    const shoulderSide = shoulder.clone().setX(side * 0.2);
    const hand = new THREE.Vector3(side * 0.32, handY, handZ);
    const elbow = shoulderSide.clone().lerp(hand, 0.5).add(new THREE.Vector3(side * 0.06, -0.08, 0));
    addSpan(rider, shoulderSide, elbow, 0.045, shirtMat);
    addSpan(rider, elbow, hand, 0.038, skinMat);
  }

  const headCenter = shoulder.clone().add(new THREE.Vector3(0, 0.2, 0.06));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14), helmetMat);
  helmet.position.copy(headCenter);
  helmet.scale.set(1, 1.05, 1.12);
  helmet.name = 'moto_rider_helmet';
  helmet.castShadow = true;
  rider.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 16, 10, -0.9, 1.8, 1.1, 0.7), visorMat);
  visor.position.copy(headCenter);
  visor.scale.set(1, 1.05, 1.12);
  rider.add(visor);

  rider.userData.vestPlateCode = plateCode;
  return rider;
}

/** Builds a Cali moto. `neonHex` (player bikes) adds a compact underglow strip. */
export function buildMotorcycleMesh(
  kind: MotorcycleKind,
  colorHex: number,
  accentHex: number,
  neonHex?: number,
): THREE.Group {
  const spec = MOTORCYCLE_SPECS[kind];
  const mats = createMotoMaterials(colorHex, accentHex);
  const plateCode = MOTORCYCLE_PLATE_CODES[kind];
  const group = new THREE.Group();
  group.name = `vehicle_${kind}`;

  const front = buildFrontEnd(spec, mats);
  group.add(front.pivot);

  const rearSpin = buildMotoWheel(spec.rearRadius, spec, mats, false);
  rearSpin.position.set(0, spec.rearRadius, -spec.wheelbase * 0.5);
  group.add(rearSpin);
  // Rear drum + chain guard
  addMesh(group, new THREE.BoxGeometry(0.03, 0.07, spec.wheelbase * 0.45), mats.black, {
    x: -0.13,
    y: 0.36,
    z: -spec.wheelbase * 0.3,
    castShadow: false,
  });

  attachChassis(group, kind, spec, mats);
  const exhaustTip = attachExpansionChamber(group, kind, spec, mats);

  const tailZ = -spec.wheelbase * 0.5 - 0.3;
  const tailY = spec.highFenders ? spec.seat.seatY - 0.04 : spec.rearRadius + 0.36;
  addMesh(group, createRoundedPodGeometry(0.14, 0.07, 0.05, 0.02, 0.01), mats.brake, {
    y: tailY,
    z: tailZ,
    castShadow: false,
    name: `${kind}_tail_light`,
  });
  attachColombianLicensePlate(group, plateCode, 'CALI', 'private_yellow', {
    y: tailY - 0.15,
    z: tailZ - 0.03,
    facing: 'rear',
    width: 0.22,
    height: 0.17,
    rx: -0.15,
  });

  const nitroFlames = attachPlayerNitroFlames(group, [exhaustTip.x], exhaustTip.y, exhaustTip.z, mats.chrome);
  const headlightCones = attachHeadlightCones(group, 0.04, front.headlightY, front.headlightZ + 0.05, 4.2, 0.7);
  attachContactShadow(group, 0.75, spec.wheelbase + 0.85, 0.55, 0.03);
  attachUnderglow(group, 0.55, spec.wheelbase + 0.4, neonHex);

  const npcRider = buildNpcRider(spec, plateCode, accentHex);
  npcRider.visible = false;
  group.add(npcRider);

  group.userData.nitroFlames = nitroFlames;
  group.userData.headlightCones = headlightCones;
  group.userData.brakeLightMaterials = [mats.brake];
  group.userData.wheels = [front.spin, rearSpin];
  group.userData.frontWheels = [front.pivot];
  group.userData.riderSeat = spec.seat;
  group.userData.npcRider = npcRider;
  return group;
}

/** Headlight emitter height (meters) used by the renderer's player spotlight. */
export function getMotorcycleHeadlightHeight(kind: MotorcycleKind): number {
  const spec = MOTORCYCLE_SPECS[kind];
  return spec.frontRadius + Math.cos(spec.forkRake) * spec.forkLength - 0.06;
}

export interface MotorcycleBodyPose {
  /** Three.js rotation.z (positive lean = left = -Z roll). */
  readonly roll: number;
  /** Three.js rotation.x offset (nose-up wheelie = negative X). */
  readonly pitch: number;
  /** Vertical lift (m) keeping the rear tire planted while the body pivots about its center. */
  readonly lift: number;
}

export function computeMotorcycleBodyPose(
  kind: MotorcycleKind,
  leanAngle: number,
  wheelieAngle: number,
): MotorcycleBodyPose {
  const rearAxleOffset = MOTORCYCLE_SPECS[kind].wheelbase * 0.5;
  return {
    roll: 0 - leanAngle,
    pitch: 0 - wheelieAngle,
    lift: Math.sin(Math.max(0, wheelieAngle)) * rearAxleOffset,
  };
}
