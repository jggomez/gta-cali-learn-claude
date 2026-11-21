/**
 * Procedural Vice-Sunset Cali sky dome, lighting rig, WebGL error type, and smooth camera rig.
 * Zero network assets and zero mutation of simulation snapshots.
 */

import * as THREE from 'three';
import { getTerrainElevation } from '../config/caliMap';
import type { CameraMode, WorldSnapshot } from '../types/game';

const SKY_RADIUS = 540;
const SUN_DIRECTION = new THREE.Vector3(-0.94, 0.16, -0.14).normalize();

const SKY_VERTEX_SHADER = `
varying vec3 vLocalDir;

void main() {
  vLocalDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 uZenithColor;
uniform vec3 uUpperMidColor;
uniform vec3 uLowerMidColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
uniform vec3 uSunDirection;

varying vec3 vLocalDir;

void main() {
  vec3 dir = normalize(vLocalDir);
  float h = dir.y;

  vec3 skyColor;
  if (h < 0.0) {
    float groundMix = clamp(-h * 4.0, 0.0, 1.0);
    skyColor = mix(uHorizonColor, uGroundColor, groundMix);
  } else if (h < 0.14) {
    skyColor = mix(uHorizonColor, uLowerMidColor, smoothstep(0.0, 0.14, h));
  } else if (h < 0.38) {
    skyColor = mix(uLowerMidColor, uUpperMidColor, smoothstep(0.14, 0.38, h));
  } else {
    skyColor = mix(uUpperMidColor, uZenithColor, smoothstep(0.38, 0.78, h));
  }

  float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
  float sunsetGlow = pow(sunDot, 6.0) * 0.42;
  float sunHalo = pow(sunDot, 48.0) * 0.55;
  float sunCore = smoothstep(0.9965, 0.9988, sunDot);

  skyColor += vec3(1.0, 0.37, 0.49) * sunsetGlow;
  skyColor += vec3(1.0, 0.72, 0.12) * sunHalo;
  skyColor = mix(skyColor, vec3(1.0, 0.94, 0.72), sunCore);

  gl_FragColor = vec4(skyColor, 1.0);
}
`;

/**
 * Thrown when the browser or device cannot initialize a WebGL rendering context.
 */
export class WebGLUnavailableError extends Error {
  constructor(
    message = 'WebGL rendering context is unavailable on this device or browser.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WebGLUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Creates a large BackSide sunset sky sphere transitioning from twilight-violet (#120826)
 * through magenta (#7a1e6e) and sunset coral (#ff5e7e) to warm gold (#ffb800),
 * accompanied by a glowing western sun disc behind Cerro Los Cristales.
 */
export function createSunsetSkyDome(): THREE.Mesh {
  const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: {
      uZenithColor: { value: new THREE.Color(0x120826) },
      uUpperMidColor: { value: new THREE.Color(0x7a1e6e) },
      uLowerMidColor: { value: new THREE.Color(0xff5e7e) },
      uHorizonColor: { value: new THREE.Color(0xffb800) },
      uGroundColor: { value: new THREE.Color(0x1a0b2e) },
      uSunDirection: { value: SUN_DIRECTION.clone() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
  skyMesh.name = 'sunset_sky_dome';
  skyMesh.frustumCulled = false;

  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(34, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffe082,
      fog: false,
      depthWrite: false,
    }),
  );
  sunDisc.name = 'western_sun_disc';
  sunDisc.position.copy(SUN_DIRECTION).multiplyScalar(462);
  sunDisc.lookAt(0, 0, 0);
  skyMesh.add(sunDisc);

  const sunCorona = new THREE.Mesh(
    new THREE.CircleGeometry(64, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff5e7e,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      fog: false,
      depthWrite: false,
    }),
  );
  sunCorona.name = 'western_sun_corona';
  sunCorona.position.copy(SUN_DIRECTION).multiplyScalar(470);
  sunCorona.lookAt(0, 0, 0);
  skyMesh.add(sunCorona);

  return skyMesh;
}

/**
 * Creates Vice-Sunset Cali lighting: twilight hemisphere light, golden western sun key light,
 * and subtle cyan/magenta fill accents for crisp low-poly architectural edges.
 */
export function createSunsetLighting(): THREE.Group {
  const lightGroup = new THREE.Group();
  lightGroup.name = 'sunset_lighting';

  const hemisphere = new THREE.HemisphereLight(0xff8ca8, 0x22103b, 0.95);
  hemisphere.name = 'sunset_hemisphere_light';
  lightGroup.add(hemisphere);

  const sunLight = new THREE.DirectionalLight(0xffb85c, 1.85);
  sunLight.name = 'sunset_key_light';
  sunLight.position.set(-190, 92, -32);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 520;
  sunLight.shadow.camera.left = -210;
  sunLight.shadow.camera.right = 210;
  sunLight.shadow.camera.top = 210;
  sunLight.shadow.camera.bottom = -210;
  sunLight.shadow.bias = -0.0006;
  lightGroup.add(sunLight);

  const cyanFill = new THREE.DirectionalLight(0x00f0ff, 0.45);
  cyanFill.name = 'sunset_cyan_fill';
  cyanFill.position.set(145, 70, -100);
  lightGroup.add(cyanFill);

  const magentaFill = new THREE.DirectionalLight(0xff2e93, 0.32);
  magentaFill.name = 'sunset_magenta_fill';
  magentaFill.position.set(95, 42, 145);
  lightGroup.add(magentaFill);

  return lightGroup;
}

interface CameraTargetPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly isDriving: boolean;
  readonly isBoosting: boolean;
}

interface CameraRigState {
  initialized: boolean;
  lastMode: CameraMode | null;
  lookTarget: THREE.Vector3;
}

const SCRATCH_DESIRED_POS = new THREE.Vector3();
const SCRATCH_DESIRED_LOOK = new THREE.Vector3();

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function resolveCameraTarget(world: WorldSnapshot): CameraTargetPose {
  const { player, vehicles } = world;
  if (player.mode === 'driving' && player.vehicleId !== null) {
    const activeVehicle = vehicles.find((v) => v.id === player.vehicleId);
    if (activeVehicle) {
      return {
        x: finiteOr(activeVehicle.x, 0),
        y: finiteOr(activeVehicle.y, 0),
        z: finiteOr(activeVehicle.z, 0),
        heading: finiteOr(activeVehicle.heading, 0),
        speedMps: finiteOr(activeVehicle.speedMps, 0),
        isDriving: true,
        isBoosting: activeVehicle.isBoosting,
      };
    }
  }

  return {
    x: finiteOr(player.x, 0),
    y: finiteOr(player.y, 0),
    z: finiteOr(player.z, 0),
    heading: finiteOr(player.heading, 0),
    speedMps: finiteOr(player.speedMps, 0),
    isDriving: player.mode === 'driving',
    isBoosting: player.isBoosting,
  };
}

function getCameraRigState(camera: THREE.PerspectiveCamera): CameraRigState {
  const existing = camera.userData.rigState as CameraRigState | undefined;
  if (existing) {
    return existing;
  }
  const created: CameraRigState = {
    initialized: false,
    lastMode: null,
    lookTarget: new THREE.Vector3(),
  };
  camera.userData.rigState = created;
  return created;
}

/**
 * Smoothly updates a PerspectiveCamera across 'chase', 'cinematic', 'hood', and 'victory_orbit'
 * modes while guaranteeing finite coordinates and terrain clearance.
 */
export function updateCameraRig(
  camera: THREE.PerspectiveCamera,
  world: WorldSnapshot,
  mode: CameraMode,
  dt: number,
  orbitAngle: number,
): void {
  const target = resolveCameraTarget(world);
  const safeOrbit = finiteOr(orbitAngle, 0);
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;

  const forwardX = Math.sin(target.heading);
  const forwardZ = Math.cos(target.heading);
  const absSpeed = Math.abs(target.speedMps);

  let targetFov = 60;
  let posSmoothRate = 7.5;
  let lookSmoothRate = 10.0;
  let clampTerrain = true;

  switch (mode) {
    case 'chase': {
      const baseDist = target.isDriving ? 9.4 : 5.8;
      const speedPull = target.isDriving ? Math.min(3.4, absSpeed * 0.085) : 0;
      const boostPull = target.isBoosting ? 1.8 : 0;
      const distance = baseDist + speedPull + boostPull;
      const height = target.isDriving
        ? 4.3 + Math.min(1.0, absSpeed * 0.02)
        : 2.9;

      SCRATCH_DESIRED_POS.set(
        target.x - forwardX * distance,
        target.y + height,
        target.z - forwardZ * distance,
      );
      const lookAhead = target.isDriving ? 6.5 : 3.5;
      SCRATCH_DESIRED_LOOK.set(
        target.x + forwardX * lookAhead,
        target.y + (target.isDriving ? 1.55 : 1.45),
        target.z + forwardZ * lookAhead,
      );
      targetFov = target.isBoosting
        ? 70
        : 60 + Math.min(6, absSpeed * 0.14);
      break;
    }

    case 'cinematic': {
      const sweepAngle =
        target.heading + Math.PI * 0.72 + Math.sin(safeOrbit * 0.45) * 0.55;
      const radius = target.isDriving ? 13.5 : 8.5;
      const height = 4.6 + Math.sin(safeOrbit * 0.7) * 1.15;

      SCRATCH_DESIRED_POS.set(
        target.x + Math.sin(sweepAngle) * radius,
        target.y + height,
        target.z + Math.cos(sweepAngle) * radius,
      );
      SCRATCH_DESIRED_LOOK.set(
        target.x + forwardX * 2.4,
        target.y + 1.6,
        target.z + forwardZ * 2.4,
      );
      targetFov = 52;
      posSmoothRate = 4.5;
      lookSmoothRate = 6.5;
      break;
    }

    case 'hood': {
      const mountForward = target.isDriving ? 0.85 : 0.35;
      const mountHeight = target.isDriving ? 1.68 : 1.65;
      const lookAhead = target.isDriving ? 28 : 20;

      SCRATCH_DESIRED_POS.set(
        target.x + forwardX * mountForward,
        target.y + mountHeight,
        target.z + forwardZ * mountForward,
      );
      SCRATCH_DESIRED_LOOK.set(
        target.x + forwardX * lookAhead,
        target.y + (target.isDriving ? 1.35 : 1.55),
        target.z + forwardZ * lookAhead,
      );
      targetFov = target.isBoosting ? 74 : 68;
      posSmoothRate = 28;
      lookSmoothRate = 28;
      clampTerrain = false;
      break;
    }

    case 'victory_orbit': {
      const radius = 24;
      const height = 10.5 + Math.sin(safeOrbit * 0.6) * 2.2;

      SCRATCH_DESIRED_POS.set(
        target.x + Math.cos(safeOrbit) * radius,
        target.y + height,
        target.z + Math.sin(safeOrbit) * radius,
      );
      SCRATCH_DESIRED_LOOK.set(target.x, target.y + 3.2, target.z);
      targetFov = 54;
      posSmoothRate = 5.0;
      lookSmoothRate = 6.0;
      break;
    }
  }

  if (clampTerrain) {
    const minGroundY =
      getTerrainElevation(SCRATCH_DESIRED_POS.x, SCRATCH_DESIRED_POS.z) + 1.25;
    if (SCRATCH_DESIRED_POS.y < minGroundY) {
      SCRATCH_DESIRED_POS.y = minGroundY;
    }
  }

  const rigState = getCameraRigState(camera);
  const shouldSnap =
    !rigState.initialized ||
    safeDt === 0 ||
    (mode === 'hood' && rigState.lastMode !== 'hood');

  if (shouldSnap) {
    camera.position.copy(SCRATCH_DESIRED_POS);
    rigState.lookTarget.copy(SCRATCH_DESIRED_LOOK);
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
    rigState.initialized = true;
  } else {
    const posAlpha = 1 - Math.exp(-posSmoothRate * safeDt);
    const lookAlpha = 1 - Math.exp(-lookSmoothRate * safeDt);
    const fovAlpha = 1 - Math.exp(-5 * safeDt);

    camera.position.lerp(SCRATCH_DESIRED_POS, posAlpha);
    rigState.lookTarget.lerp(SCRATCH_DESIRED_LOOK, lookAlpha);

    const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, fovAlpha);
    if (Math.abs(nextFov - camera.fov) > 0.05) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }

  rigState.lastMode = mode;
  camera.lookAt(rigState.lookTarget);
}
