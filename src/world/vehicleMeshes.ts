/**
 * Procedural low-poly 3D vehicle meshes (all 5 Cali vehicle kinds), Valeria player mesh,
 * and animated mission objective beacon. 100% procedural and safe in Node test environments.
 */

import * as THREE from 'three';
import type { VehicleKind } from '../types/game';

interface WheelRig {
  readonly wheels: THREE.Object3D[];
  readonly frontWheels: THREE.Object3D[];
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

function attachWheels(
  parent: THREE.Group,
  specs: readonly { x: number; z: number; isFront: boolean }[],
  radius: number,
  width: number,
): WheelRig {
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 12);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(
    radius * 0.58,
    radius * 0.58,
    width + 0.04,
    8,
  );
  rimGeo.rotateZ(Math.PI / 2);

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x161421,
    roughness: 0.9,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc9d1e8,
    roughness: 0.3,
    metalness: 0.75,
  });

  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];

  for (const spec of specs) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(spec.x, radius, spec.z);

    const spinHub = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    spinHub.add(tire, rim);
    steerPivot.add(spinHub);
    parent.add(steerPivot);

    wheels.push(spinHub);
    if (spec.isFront) {
      frontWheels.push(steerPivot);
    }
  }

  return { wheels, frontWheels };
}

function attachLights(
  parent: THREE.Group,
  halfWidth: number,
  frontZ: number,
  rearZ: number,
  lightY: number,
): void {
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfff8dc,
    emissive: 0xfff3c4,
    emissiveIntensity: 1.15,
    roughness: 0.15,
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xff2244,
    emissive: 0xff1e42,
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });

  const xOffset = halfWidth * 0.68;
  for (const side of [-1, 1] as const) {
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.2, 0.12),
      headlightMat,
    );
    head.position.set(side * xOffset, lightY, frontZ);
    parent.add(head);

    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.2, 0.12),
      taillightMat,
    );
    tail.position.set(side * xOffset, lightY + 0.04, rearZ);
    parent.add(tail);
  }
}

function buildBansheeMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_banshee';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.28,
    metalness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.85,
    roughness: 0.22,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x160f2b,
    roughness: 0.15,
    metalness: 0.8,
  });

  // Low-slung sports chassis & aerodynamic hood
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.58, 4.45), bodyMat);
  lowerBody.position.set(0, 0.62, 0);
  lowerBody.castShadow = true;
  group.add(lowerBody);

  const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 2.0), accentMat);
  hoodStripe.position.set(0, 0.93, 1.15);
  group.add(hoodStripe);

  // Sleek sloped sports cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.54, 1.85), glassMat);
  cabin.position.set(0, 1.12, -0.18);
  group.add(cabin);

  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.1, 1.25), bodyMat);
  roofPanel.position.set(0, 1.4, -0.22);
  group.add(roofPanel);

  // Rear carbon/neon spoiler wing
  for (const sx of [-0.68, 0.68] as const) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.24), glassMat);
    strut.position.set(sx, 1.06, -1.96);
    group.add(strut);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.1, 0.38), accentMat);
  wing.position.set(0, 1.24, -2.02);
  group.add(wing);

  // Iconic Vice-Sunset neon cyan underglow
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.35, 4.55),
    new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  underglow.name = 'banshee_underglow';
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.set(0, 0.09, 0);
  group.add(underglow);

  // Dual exhaust tips & nitro boost flames
  const exhaustMat = new THREE.MeshStandardMaterial({
    color: 0x8e99b5,
    metalness: 0.8,
    roughness: 0.3,
  });
  const nitroFlames = new THREE.Group();
  nitroFlames.name = 'nitro_flames';
  nitroFlames.visible = false;

  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xffb800,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  for (const ex of [-0.46, 0.46] as const) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8),
      exhaustMat,
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(ex, 0.42, -2.26);
    group.add(pipe);

    const outerCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 1.35, 8),
      outerFlameMat,
    );
    outerCone.rotation.x = -Math.PI / 2;
    outerCone.position.set(ex, 0.42, -3.0);
    nitroFlames.add(outerCone);

    const innerCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.85, 8),
      innerFlameMat,
    );
    innerCone.rotation.x = -Math.PI / 2;
    innerCone.position.set(ex, 0.42, -2.75);
    nitroFlames.add(innerCone);
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
    0.3,
  );
  attachLights(group, 1.04, 2.24, -2.24, 0.68);

  group.userData.nitroFlames = nitroFlames;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildTaxiMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_taxi';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.45,
    metalness: 0.2,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.6,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1d1a33,
    roughness: 0.2,
    metalness: 0.65,
  });

  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.68, 4.2), bodyMat);
  lowerBody.position.set(0, 0.66, 0);
  lowerBody.castShadow = true;
  group.add(lowerBody);

  // Dark side checker/trim band
  const sideBand = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.14, 3.6), trimMat);
  sideBand.position.set(0, 0.68, 0);
  group.add(sideBand);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.64, 2.05), glassMat);
  cabin.position.set(0, 1.3, -0.15);
  group.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.12, 1.75), bodyMat);
  roof.position.set(0, 1.64, -0.15);
  group.add(roof);

  // Glowing yellow TAXI roof sign
  const taxiSignTex = createTaxiSignTexture();
  const taxiSignMat = new THREE.MeshStandardMaterial({
    color: 0xffe047,
    emissive: 0xffc400,
    emissiveIntensity: 0.85,
    ...(taxiSignTex ? { map: taxiSignTex } : {}),
    roughness: 0.25,
  });
  const taxiSign = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.26, 0.34),
    taxiSignMat,
  );
  taxiSign.name = 'taxi_roof_sign';
  taxiSign.position.set(0, 1.82, 0.05);
  group.add(taxiSign);

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
  );
  attachLights(group, 0.97, 2.12, -2.12, 0.68);

  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildMioBusMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_mio_bus';

  const blueMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.4,
    metalness: 0.25,
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.45,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x11172b,
    emissive: 0x102744,
    emissiveIntensity: 0.35,
    roughness: 0.15,
    metalness: 0.75,
  });
  const bellowsMat = new THREE.MeshStandardMaterial({
    color: 0x201d2e,
    roughness: 0.92,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0xffb800,
    emissive: 0xffb800,
    emissiveIntensity: 0.95,
  });

  // Front articulated coach
  const frontLower = new THREE.Mesh(new THREE.BoxGeometry(2.44, 1.05, 4.6), blueMat);
  frontLower.position.set(0, 0.96, 2.2);
  frontLower.castShadow = true;
  group.add(frontLower);

  const frontUpper = new THREE.Mesh(new THREE.BoxGeometry(2.42, 1.35, 4.56), whiteMat);
  frontUpper.position.set(0, 2.16, 2.2);
  group.add(frontUpper);

  const frontWindows = new THREE.Mesh(
    new THREE.BoxGeometry(2.48, 0.84, 4.2),
    windowMat,
  );
  frontWindows.position.set(0, 2.1, 2.3);
  group.add(frontWindows);

  // Articulated accordion bellows connector
  const bellows = new THREE.Mesh(new THREE.BoxGeometry(2.22, 2.18, 0.9), bellowsMat);
  bellows.position.set(0, 1.62, -0.52);
  group.add(bellows);

  // Rear articulated coach
  const rearLower = new THREE.Mesh(new THREE.BoxGeometry(2.44, 1.05, 3.65), blueMat);
  rearLower.position.set(0, 0.96, -2.75);
  rearLower.castShadow = true;
  group.add(rearLower);

  const rearUpper = new THREE.Mesh(new THREE.BoxGeometry(2.42, 1.35, 3.62), whiteMat);
  rearUpper.position.set(0, 2.16, -2.75);
  group.add(rearUpper);

  const rearWindows = new THREE.Mesh(
    new THREE.BoxGeometry(2.48, 0.84, 3.25),
    windowMat,
  );
  rearWindows.position.set(0, 2.1, -2.75);
  group.add(rearWindows);

  // Glowing amber MIO route destination header
  const routeSign = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 0.14), ledMat);
  routeSign.position.set(0, 2.66, 4.5);
  group.add(routeSign);

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
  );
  attachLights(group, 1.16, 4.52, -4.6, 0.78);

  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildChivaMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_chiva';

  const primaryMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.45,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.45,
  });
  const emeraldMat = new THREE.MeshStandardMaterial({
    color: 0x00e699,
    roughness: 0.5,
  });
  const cyanMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    roughness: 0.45,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x7c4a26,
    roughness: 0.82,
  });

  // Classic front engine nose
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.05, 1.35), accentMat);
  nose.position.set(0, 1.02, 2.75);
  group.add(nose);

  // Lower festive painted body
  const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(2.36, 1.05, 5.2), primaryMat);
  lowerHull.position.set(0, 1.0, -0.45);
  lowerHull.castShadow = true;
  group.add(lowerHull);

  // Colorful side decorative stripes
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.24, 5.15), cyanMat);
  stripe.position.set(0, 1.18, -0.45);
  group.add(stripe);

  // Open-air wooden passenger benches & vertical colorful side bars
  const benchColors = [woodMat, accentMat, emeraldMat] as const;
  for (let i = 0; i < 4; i += 1) {
    const zPos = 1.45 - i * 1.28;
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.22, 0.52),
      benchColors[i % benchColors.length],
    );
    bench.position.set(0, 1.18, zPos);
    group.add(bench);

    for (const side of [-1.1, 1.1] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.18, 0.14), accentMat);
      bar.position.set(side, 2.02, zPos);
      group.add(bar);
    }
  }

  // Festive painted canopy roof + rooftop luggage rack
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.22, 5.45), primaryMat);
  roof.position.set(0, 2.66, -0.42);
  group.add(roof);

  const rackRail = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.26, 4.9), emeraldMat);
  rackRail.position.set(0, 2.88, -0.48);
  group.add(rackRail);

  // Colorful luggage/bales on the Chiva roof rack
  const cargoSpecs = [
    { x: -0.45, z: 0.8, w: 0.85, h: 0.55, d: 1.0, mat: accentMat },
    { x: 0.45, z: 0.65, w: 0.8, h: 0.48, d: 0.9, mat: cyanMat },
    { x: 0.0, z: -0.7, w: 1.45, h: 0.6, d: 1.25, mat: emeraldMat },
    { x: -0.25, z: -2.0, w: 1.1, h: 0.5, d: 0.95, mat: accentMat },
  ] as const;
  for (const cargo of cargoSpecs) {
    const bundle = new THREE.Mesh(
      new THREE.BoxGeometry(cargo.w, cargo.h, cargo.d),
      cargo.mat,
    );
    bundle.position.set(cargo.x, 3.05 + cargo.h * 0.5, cargo.z);
    group.add(bundle);
  }

  // Festive glowing party string bulbs along both roof rails
  const bulbColors = [0xffb800, 0x00f0ff, 0xff2e93, 0x00e699] as const;
  for (let i = 0; i < 6; i += 1) {
    const bulbColor = bulbColors[i % bulbColors.length];
    const bulbMat = new THREE.MeshBasicMaterial({ color: bulbColor });
    const zPos = 1.9 - i * 0.92;
    for (const side of [-1.24, 1.24] as const) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), bulbMat);
      bulb.position.set(side, 2.68, zPos);
      group.add(bulb);
    }
  }

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
  );
  attachLights(group, 0.95, 3.45, -3.08, 0.85);

  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

function buildPoliceMesh(colorHex: number, accentHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vehicle_police';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.35,
    metalness: 0.3,
  });
  const liveryMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    roughness: 0.4,
    metalness: 0.25,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x151428,
    roughness: 0.18,
    metalness: 0.78,
  });
  const bumperMat = new THREE.MeshStandardMaterial({
    color: 0x1c1b29,
    roughness: 0.7,
    metalness: 0.4,
  });

  // Muscular interceptor body & tactical contrast livery
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.7, 4.55), bodyMat);
  lowerBody.position.set(0, 0.68, 0);
  lowerBody.castShadow = true;
  group.add(lowerBody);

  const hoodPanel = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.08, 1.45), liveryMat);
  hoodPanel.position.set(0, 1.05, 1.45);
  group.add(hoodPanel);

  const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 4.1), liveryMat);
  sideStripe.position.set(0, 0.68, 0);
  group.add(sideStripe);

  // Heavy front push-bar bumper
  const pushBar = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.46, 0.22), bumperMat);
  pushBar.position.set(0, 0.64, 2.36);
  group.add(pushBar);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.62, 2.08), glassMat);
  cabin.position.set(0, 1.32, -0.15);
  group.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.12, 1.78), bodyMat);
  roof.position.set(0, 1.65, -0.15);
  group.add(roof);

  // Roof siren bar with explicit redBeacon & blueBeacon meshes
  const lightbarBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, 0.12, 0.34),
    bumperMat,
  );
  lightbarBase.position.set(0, 1.74, -0.05);
  group.add(lightbarBase);

  const redBeacon = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.22, 0.28),
    new THREE.MeshStandardMaterial({
      color: 0xff3b5c,
      emissive: 0xff3b5c,
      emissiveIntensity: 1.4,
      roughness: 0.15,
    }),
  );
  redBeacon.name = 'police_red_beacon';
  redBeacon.position.set(-0.34, 1.88, -0.05);
  group.add(redBeacon);

  const blueBeacon = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.22, 0.28),
    new THREE.MeshStandardMaterial({
      color: 0x2e7bff,
      emissive: 0x2e7bff,
      emissiveIntensity: 1.4,
      roughness: 0.15,
    }),
  );
  blueBeacon.name = 'police_blue_beacon';
  blueBeacon.position.set(0.34, 1.88, -0.05);
  group.add(blueBeacon);

  const rig = attachWheels(
    group,
    [
      { x: -0.98, z: 1.4, isFront: true },
      { x: 0.98, z: 1.4, isFront: true },
      { x: -0.98, z: -1.4, isFront: false },
      { x: 0.98, z: -1.4, isFront: false },
    ],
    0.37,
    0.28,
  );
  attachLights(group, 1.02, 2.3, -2.3, 0.7);

  group.userData.redBeacon = redBeacon;
  group.userData.blueBeacon = blueBeacon;
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

/**
 * Constructs a distinct low-poly 3D vehicle mesh for any of the 5 Cali VehicleKind values.
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
      return buildPoliceMesh(colorHex, accentHex ?? 0x14452f);
  }
}

/**
 * Creates a stylized low-poly 3D mesh for Valeria (feet resting at y = 0, facing +Z).
 */
export function createPlayerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'player_valeria';

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd99b72,
    roughness: 0.65,
  });
  const jacketMat = new THREE.MeshStandardMaterial({
    color: 0xff2e93,
    emissive: 0x450828,
    emissiveIntensity: 0.25,
    roughness: 0.45,
  });
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x004e59,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x1d1633,
    roughness: 0.78,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x181022,
    roughness: 0.8,
  });
  const shadesMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 0.55,
    roughness: 0.15,
  });

  // Legs with hip pivots for walk/sprint animation
  const legGeo = new THREE.BoxGeometry(0.2, 0.78, 0.22);
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(0.14, 0.78, 0);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.y = -0.39;
  leftLegPivot.add(leftLeg);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(-0.14, 0.78, 0);
  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.y = -0.39;
  rightLegPivot.add(rightLeg);
  group.add(leftLegPivot, rightLegPivot);

  // Torso (cyan accent top + magenta cropped Vice jacket)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.54, 0.28), topMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  group.add(torso);

  const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.44, 0.31), jacketMat);
  jacket.position.set(0, 1.1, -0.02);
  group.add(jacket);

  // Arms with shoulder pivots
  const armGeo = new THREE.BoxGeometry(0.15, 0.52, 0.16);
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(0.34, 1.28, 0);
  const leftArm = new THREE.Mesh(armGeo, jacketMat);
  leftArm.position.y = -0.22;
  leftArmPivot.add(leftArm);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(-0.34, 1.28, 0);
  const rightArm = new THREE.Mesh(armGeo, jacketMat);
  rightArm.position.y = -0.22;
  rightArmPivot.add(rightArm);
  group.add(leftArmPivot, rightArmPivot);

  // Head, sunset shades, and stylized ponytail
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skinMat);
  head.position.y = 1.54;
  group.add(head);

  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.14, 0.34), hairMat);
  hairCap.position.set(0, 1.67, -0.02);
  group.add(hairCap);

  const ponytail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.4, 6), hairMat);
  ponytail.position.set(0, 1.48, -0.22);
  ponytail.rotation.x = -0.45;
  group.add(ponytail);

  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.06), shadesMat);
  shades.position.set(0, 1.56, 0.15);
  group.add(shades);

  group.userData.leftLeg = leftLegPivot;
  group.userData.rightLeg = rightLegPivot;
  group.userData.leftArm = leftArmPivot;
  group.userData.rightArm = rightArmPivot;
  return group;
}

/**
 * Creates a pulsing translucent vertical mission light beam paired with a spinning ground target ring.
 */
export function createObjectiveBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'objective_beacon';

  const outerBeamMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerBeamMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const lightBeam = new THREE.Group();
  lightBeam.name = 'objective_light_beam';

  const outerColumn = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.5, 64, 16, 1, true),
    outerBeamMat,
  );
  outerColumn.position.y = 32;
  lightBeam.add(outerColumn);

  const innerColumn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.58, 64, 12, 1, true),
    innerBeamMat,
  );
  innerColumn.position.y = 32;
  lightBeam.add(innerColumn);
  group.add(lightBeam);

  // Spinning ground target ring with floating perimeter markers
  const targetRing = new THREE.Group();
  targetRing.name = 'objective_target_ring';
  targetRing.position.y = 0.28;

  const outerTorus = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.18, 8, 28),
    ringMat,
  );
  outerTorus.rotation.x = Math.PI / 2;
  targetRing.add(outerTorus);

  const innerDisc = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.25, 24),
    ringMat,
  );
  innerDisc.rotation.x = -Math.PI / 2;
  targetRing.add(innerDisc);

  const markerGeo = new THREE.OctahedronGeometry(0.45, 0);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const marker = new THREE.Mesh(markerGeo, ringMat);
    marker.position.set(Math.cos(angle) * 3.2, 0.85, Math.sin(angle) * 3.2);
    targetRing.add(marker);
  }
  group.add(targetRing);

  group.userData.lightBeam = lightBeam;
  group.userData.targetRing = targetRing;
  group.userData.beamMaterials = [outerBeamMat, innerBeamMat, ringMat];
  return group;
}
