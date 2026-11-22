/**
 * Photorealistic golden-hour Cali sky dome fallback (with drifting FBM sunset clouds),
 * player-tracking 2048px soft shadow lighting rig, subtle cinematic HDR UnrealBloom post-processing,
 * WebGL error type, and GTA V free-orbit chase camera rig (360° mouse look, zoom, auto-recenter,
 * speed FOV, drift banking, impact shake).
 * Zero network assets and zero mutation of simulation snapshots.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getTerrainElevation } from '../config/caliMap';
import type { CameraMode, WorldSnapshot } from '../types/game';

const SKY_RADIUS = 540;
const SUN_DIRECTION = new THREE.Vector3(-0.94, 0.16, -0.14).normalize();
const SUN_SHADOW_OFFSET = new THREE.Vector3(-152, 76, -24);
const SHADOW_FRUSTUM_HALF = 72;

const BLOOM_THRESHOLD = 1.05;
const BLOOM_RADIUS = 0.35;
const BLOOM_STRENGTH_FULL = 0.24;
const BLOOM_STRENGTH_REDUCED = 0.14;

const CHASE_CRUISE_FOV = 58;
const CHASE_BOOST_FOV = 72;
const FOV_UPDATE_EPSILON = 0.05;
const IMPACT_SHAKE_THRESHOLD = 0.15;

const DEFAULT_ORBIT_ZOOM = 6.2;
const MIN_ORBIT_ZOOM = 4.4;
const MAX_ORBIT_ZOOM = 11.0;
const MIN_ORBIT_PITCH = -0.12;
const MAX_ORBIT_PITCH = 0.62;
const ORBIT_RECENTER_IDLE_SECONDS = 1.5;
const ORBIT_RECENTER_MIN_SPEED_MPS = 4.0;
const ORBIT_RECENTER_DECAY_RATE = 2.6;
const ORBIT_INPUT_EPSILON = 1e-6;

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
uniform float uTime;

varying vec3 vLocalDir;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.52;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    total += amplitude * valueNoise(p);
    p = rot * p * 2.04 + vec2(17.1, 31.7);
    amplitude *= 0.5;
  }
  return total;
}

void main() {
  vec3 dir = normalize(vLocalDir);
  vec3 sunDir = normalize(uSunDirection);
  float h = dir.y;

  // Rayleigh-inspired multi-band Vice-Sunset atmospheric gradient
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

  // Forward Mie atmospheric golden-hour scatter & warm horizon glow
  float sunDot = max(dot(dir, sunDir), 0.0);
  float horizonBand = pow(1.0 - clamp(abs(h), 0.0, 1.0), 4.2);
  float rayleighGlow = horizonBand * (0.12 + 0.34 * pow(sunDot, 2.0));
  float mieGlow = pow(sunDot, 5.5) * 0.38;
  float sunHalo = pow(sunDot, 38.0) * 0.56;
  float sunCore = smoothstep(0.9968, 0.999, sunDot);

  skyColor += vec3(1.0, 0.72, 0.44) * rayleighGlow;
  skyColor += vec3(1.0, 0.68, 0.42) * mieGlow;
  skyColor += vec3(1.0, 0.86, 0.56) * sunHalo;
  skyColor = mix(skyColor, vec3(1.0, 0.96, 0.86), sunCore);

  // Layered procedural FBM golden-hour clouds drifting across the sky vault
  float cloudAlpha = 0.0;
  if (h > 0.01) {
    vec2 cloudUv = dir.xz / (h + 0.19);
    vec2 drift1 = vec2(uTime * 0.011, uTime * 0.004);
    vec2 drift2 = vec2(uTime * 0.021, -uTime * 0.007);

    float baseLayer = fbm(cloudUv * 0.42 + drift1);
    float wispLayer = fbm(cloudUv * 0.88 + drift2 + vec2(baseLayer * 0.4, -baseLayer * 0.2));
    float rawCloud = smoothstep(0.45, 0.82, baseLayer * 0.72 + wispLayer * 0.34);

    float horizonFade = smoothstep(0.015, 0.16, h) * (1.0 - smoothstep(0.76, 0.98, h) * 0.3);
    cloudAlpha = rawCloud * horizonFade;

    vec2 sunStep = normalize(sunDir.xz + vec2(0.0001)) * 0.15;
    float towardSunDensity = fbm(cloudUv * 0.42 + drift1 + sunStep);
    float undersideLight = clamp(
      (baseLayer - towardSunDensity) * 2.5 + 0.42 + pow(sunDot, 2.8) * 0.65,
      0.0,
      1.0
    );

    vec3 cloudTopSlate = vec3(0.32, 0.36, 0.48);
    vec3 cloudApricotEdge = vec3(0.95, 0.65, 0.46);
    vec3 cloudGoldUnderside = vec3(1.0, 0.88, 0.66);

    vec3 cloudColor = mix(cloudTopSlate, cloudApricotEdge, smoothstep(0.18, 0.62, undersideLight));
    cloudColor = mix(
      cloudColor,
      cloudGoldUnderside,
      smoothstep(0.56, 0.96, undersideLight) * (0.45 + 0.55 * pow(sunDot, 1.8))
    );
    skyColor = mix(skyColor, cloudColor, cloudAlpha * 0.84);
  }

  // Faint early-dusk stars high in the cerulean zenith
  if (h > 0.32) {
    vec2 starGrid = floor((dir.xz / (h + 0.18)) * 96.0);
    float starHash = hash21(starGrid);
    if (starHash > 0.995) {
      float twinkle = 0.68 + 0.32 * sin(uTime * 1.9 + starHash * 62.83);
      float zenithMask = smoothstep(0.35, 0.78, h) * (1.0 - cloudAlpha);
      skyColor += vec3(0.92, 0.95, 1.0) * twinkle * zenithMask * 0.32;
    }
  }

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

export interface PostProcessingRig {
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Creates a large BackSide golden-hour photographic sky dome fallback with Rayleigh/Mie scatter,
 * drifting FBM sunset clouds, and western sun disc behind Cerro Los Cristales.
 */
export function createSunsetSkyDome(): THREE.Mesh {
  const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: {
      uZenithColor: { value: new THREE.Color(0x1f3b6b) },
      uUpperMidColor: { value: new THREE.Color(0x5c688a) },
      uLowerMidColor: { value: new THREE.Color(0xe08e68) },
      uHorizonColor: { value: new THREE.Color(0xffca80) },
      uGroundColor: { value: new THREE.Color(0x3a322c) },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uTime: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
  skyMesh.name = 'sunset_sky_dome';
  skyMesh.frustumCulled = false;

  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(30, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfff2cc,
      fog: false,
      depthWrite: false,
    }),
  );
  sunDisc.name = 'western_sun_disc';
  sunDisc.position.copy(SUN_DIRECTION).multiplyScalar(462);
  sunDisc.lookAt(0, 0, 0);
  skyMesh.add(sunDisc);

  const sunCorona = new THREE.Mesh(
    new THREE.CircleGeometry(62, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffd996,
      transparent: true,
      opacity: 0.24,
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
 * Advances the procedural sky dome shader time uniform to animate drifting sunset clouds.
 */
export function updateSkyDomeTime(
  skyDome: THREE.Mesh,
  elapsedSeconds: number,
): void {
  const material = skyDome.material;
  if (!(material instanceof THREE.ShaderMaterial)) {
    return;
  }
  const timeUniform = material.uniforms.uTime;
  if (timeUniform) {
    timeUniform.value = finiteOr(elapsedSeconds, 0);
  }
}

/**
 * Creates naturalistic GTA V golden-hour Cali lighting with a 2048x2048 tight-frustum (±72m)
 * directional afternoon sun shadow rig, cerulean sky / warm earth hemisphere bounce, and subtle
 * cool-sky rim fill.
 */
export function createSunsetLighting(): THREE.Group {
  const lightGroup = new THREE.Group();
  lightGroup.name = 'sunset_lighting';

  const hemisphere = new THREE.HemisphereLight(0x9bc4e8, 0x6b5240, 0.9);
  hemisphere.name = 'sunset_hemisphere_light';
  lightGroup.add(hemisphere);

  const sunLight = new THREE.DirectionalLight(0xffe0b5, 2.85);
  sunLight.name = 'sunset_key_light';
  sunLight.position.copy(SUN_SHADOW_OFFSET);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 15;
  sunLight.shadow.camera.far = 360;
  sunLight.shadow.camera.left = -SHADOW_FRUSTUM_HALF;
  sunLight.shadow.camera.right = SHADOW_FRUSTUM_HALF;
  sunLight.shadow.camera.top = SHADOW_FRUSTUM_HALF;
  sunLight.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.04;
  sunLight.shadow.radius = 2.5;
  lightGroup.add(sunLight);
  lightGroup.add(sunLight.target);
  lightGroup.userData.keyLight = sunLight;

  const skyRim = new THREE.DirectionalLight(0x88b4e6, 0.35);
  skyRim.name = 'sunset_sky_rim';
  skyRim.position.set(140, 72, 95);
  lightGroup.add(skyRim);

  return lightGroup;
}

/**
 * Smoothly repositions the directional sun light and its ±72m shadow frustum around the active player
 * focus coordinates for razor-sharp shadows across the entire Cali map.
 */
export function updateShadowFocus(
  lightingGroup: THREE.Group,
  focusX: number,
  focusZ: number,
): void {
  const keyLightCandidate =
    lightingGroup.userData.keyLight ??
    lightingGroup.getObjectByName('sunset_key_light');
  if (!(keyLightCandidate instanceof THREE.DirectionalLight)) {
    return;
  }

  const safeX = finiteOr(focusX, 0);
  const safeZ = finiteOr(focusZ, 0);
  const focusY = finiteOr(getTerrainElevation(safeX, safeZ), 0);

  keyLightCandidate.target.position.set(safeX, focusY, safeZ);
  keyLightCandidate.position.set(
    safeX + SUN_SHADOW_OFFSET.x,
    focusY + SUN_SHADOW_OFFSET.y,
    safeZ + SUN_SHADOW_OFFSET.z,
  );
  keyLightCandidate.target.updateMatrixWorld();
  keyLightCandidate.updateMatrixWorld();
}

/**
 * Constructs an EffectComposer pipeline with RenderPass, UnrealBloomPass, and OutputPass.
 * Returns null cleanly if WebGL post-processing cannot be initialized.
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  reducedMotion: boolean,
): PostProcessingRig | null {
  try {
    if (!renderer.getContext()) {
      return null;
    }
    const safeWidth = Math.max(1, Math.floor(finiteOr(width, 1)));
    const safeHeight = Math.max(1, Math.floor(finiteOr(height, 1)));

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 2));
    composer.setSize(safeWidth, safeHeight);

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(safeWidth, safeHeight),
      reducedMotion ? BLOOM_STRENGTH_REDUCED : BLOOM_STRENGTH_FULL,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    const outputPass = new OutputPass();

    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    return {
      composer,
      bloomPass,
      resize(nextWidth: number, nextHeight: number): void {
        const clampedW = Math.max(1, Math.floor(finiteOr(nextWidth, 1)));
        const clampedH = Math.max(1, Math.floor(finiteOr(nextHeight, 1)));
        composer.setSize(clampedW, clampedH);
        bloomPass.setSize(clampedW, clampedH);
      },
      render(): void {
        composer.render();
      },
      dispose(): void {
        bloomPass.dispose();
        outputPass.dispose();
        composer.dispose();
      },
    };
  } catch {
    return null;
  }
}

interface CameraTargetPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly steerAngle: number;
  readonly isDriving: boolean;
  readonly isDrifting: boolean;
  readonly isBoosting: boolean;
}

interface CameraRigState {
  initialized: boolean;
  lastMode: CameraMode | null;
  basePosition: THREE.Vector3;
  lookTarget: THREE.Vector3;
  bankAngle: number;
  shakeIntensity: number;
  shakePhase: number;
}

const SCRATCH_DESIRED_POS = new THREE.Vector3();
const SCRATCH_DESIRED_LOOK = new THREE.Vector3();
const SCRATCH_SHAKE_OFFSET = new THREE.Vector3();

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
        steerAngle: finiteOr(activeVehicle.steerAngle, 0),
        isDriving: true,
        isDrifting: activeVehicle.isDrifting,
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
    steerAngle: 0,
    isDriving: player.mode === 'driving',
    isDrifting: player.isDrifting,
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
    basePosition: new THREE.Vector3(),
    lookTarget: new THREE.Vector3(),
    bankAngle: 0,
    shakeIntensity: 0,
    shakePhase: 0,
  };
  camera.userData.rigState = created;
  return created;
}

export interface CameraOrbitState {
  yawOffset: number;
  pitchOffset: number;
  zoomDistance: number;
  idleSeconds: number;
}

function wrapRadians(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = (angle + Math.PI) % twoPi;
  if (wrapped < 0) {
    wrapped += twoPi;
  }
  return wrapped - Math.PI;
}

/**
 * Creates a fresh GTA V free-orbit camera state centered directly behind the player/vehicle
 * at the sleek golden-hour default chase zoom distance (6.2m).
 */
export function createCameraOrbitState(): CameraOrbitState {
  return {
    yawOffset: 0,
    pitchOffset: 0,
    zoomDistance: DEFAULT_ORBIT_ZOOM,
    idleSeconds: 0,
  };
}

/**
 * Applies free-orbit mouse-look & zoom deltas to a CameraOrbitState, clamping pitch to
 * [-0.12, 0.62], zoomDistance to [4.4, 11.0], allowing full 360° yaw orbit, and resetting
 * idleSeconds = 0 when input is active.
 */
export function applyCameraOrbitInput(
  state: CameraOrbitState,
  yawDelta: number,
  pitchDelta: number,
  zoomDelta: number,
): void {
  const safeYaw = finiteOr(yawDelta, 0);
  const safePitch = finiteOr(pitchDelta, 0);
  const safeZoom = finiteOr(zoomDelta, 0);

  state.yawOffset = wrapRadians(finiteOr(state.yawOffset, 0) + safeYaw);
  state.pitchOffset = THREE.MathUtils.clamp(
    finiteOr(state.pitchOffset, 0) + safePitch,
    MIN_ORBIT_PITCH,
    MAX_ORBIT_PITCH,
  );
  state.zoomDistance = THREE.MathUtils.clamp(
    finiteOr(state.zoomDistance, DEFAULT_ORBIT_ZOOM) + safeZoom,
    MIN_ORBIT_ZOOM,
    MAX_ORBIT_ZOOM,
  );

  if (
    Math.abs(safeYaw) > ORBIT_INPUT_EPSILON ||
    Math.abs(safePitch) > ORBIT_INPUT_EPSILON ||
    Math.abs(safeZoom) > ORBIT_INPUT_EPSILON
  ) {
    state.idleSeconds = 0;
  }
}

function applyFovIfChanged(
  camera: THREE.PerspectiveCamera,
  nextFov: number,
): void {
  if (Math.abs(nextFov - camera.fov) > FOV_UPDATE_EPSILON) {
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }
}

/**
 * Smoothly updates a PerspectiveCamera across 'chase', 'cinematic', 'hood', and 'victory_orbit'
 * modes with GTA V 360° free-orbit mouse-look, zoom, driving auto-recenter, speed-responsive
 * dynamic FOV (58°..72°), drift banking, and damped collision shake (motion FX disabled when
 * reducedMotion is true) while guaranteeing finite coordinates and terrain clearance.
 */
export function updateCameraRig(
  camera: THREE.PerspectiveCamera,
  world: WorldSnapshot,
  mode: CameraMode,
  dt: number,
  orbitAngle: number,
  reducedMotion = false,
  orbitState?: CameraOrbitState,
): void {
  const target = resolveCameraTarget(world);
  const safeOrbit = finiteOr(orbitAngle, 0);
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;

  const forwardX = Math.sin(target.heading);
  const forwardZ = Math.cos(target.heading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const absSpeed = Math.abs(target.speedMps);

  let targetFov = CHASE_CRUISE_FOV;
  let posSmoothRate = 8.5;
  let lookSmoothRate = 11.0;
  let clampTerrain = true;

  switch (mode) {
    case 'chase': {
      if (orbitState) {
        orbitState.idleSeconds = finiteOr(orbitState.idleSeconds, 0) + safeDt;
        if (
          target.isDriving &&
          absSpeed > ORBIT_RECENTER_MIN_SPEED_MPS &&
          orbitState.idleSeconds > ORBIT_RECENTER_IDLE_SECONDS &&
          safeDt > 0
        ) {
          const decay = Math.exp(-ORBIT_RECENTER_DECAY_RATE * safeDt);
          orbitState.yawOffset = finiteOr(orbitState.yawOffset, 0) * decay;
          orbitState.pitchOffset = finiteOr(orbitState.pitchOffset, 0) * decay;
          if (Math.abs(orbitState.yawOffset) < 0.001) {
            orbitState.yawOffset = 0;
          }
          if (Math.abs(orbitState.pitchOffset) < 0.001) {
            orbitState.pitchOffset = 0;
          }
        }
      }

      const zoomDist = orbitState
        ? THREE.MathUtils.clamp(
            finiteOr(orbitState.zoomDistance, DEFAULT_ORBIT_ZOOM),
            MIN_ORBIT_ZOOM,
            MAX_ORBIT_ZOOM,
          )
        : DEFAULT_ORBIT_ZOOM;
      const yawOffset = orbitState ? finiteOr(orbitState.yawOffset, 0) : 0;
      const pitchOffset = orbitState
        ? THREE.MathUtils.clamp(
            finiteOr(orbitState.pitchOffset, 0),
            MIN_ORBIT_PITCH,
            MAX_ORBIT_PITCH,
          )
        : 0;

      const baseDist = target.isDriving
        ? zoomDist
        : THREE.MathUtils.clamp(zoomDist * 0.65, 3.0, 7.2);
      const speedPull = target.isDriving ? Math.min(1.6, absSpeed * 0.045) : 0;
      const boostPull = target.isBoosting && !reducedMotion ? 1.15 : 0;
      const distance = baseDist + speedPull + boostPull;

      const chaseHeading = target.heading + yawOffset;
      const orbitForwardX = Math.sin(chaseHeading);
      const orbitForwardZ = Math.cos(chaseHeading);
      const basePitch = target.isDriving ? 0.14 : 0.18;
      const totalPitch = THREE.MathUtils.clamp(basePitch + pitchOffset, -0.02, 0.92);
      const pivotY = target.isDriving ? 1.18 : 1.38;
      const horizDist = distance * Math.cos(totalPitch);
      const height = pivotY + distance * Math.sin(totalPitch);

      SCRATCH_DESIRED_POS.set(
        target.x - orbitForwardX * horizDist,
        target.y + height,
        target.z - orbitForwardZ * horizDist,
      );

      const alignFactor = Math.max(0, Math.cos(yawOffset));
      const lookAhead = (target.isDriving ? 5.5 : 2.2) * alignFactor;
      const lookHeight = target.isDriving ? 1.38 + 0.12 * alignFactor : 1.42;
      SCRATCH_DESIRED_LOOK.set(
        target.x + forwardX * lookAhead,
        target.y + lookHeight,
        target.z + forwardZ * lookAhead,
      );

      if (
        orbitState &&
        orbitState.idleSeconds < 0.25 &&
        (Math.abs(yawOffset) > 0.001 || Math.abs(pitchOffset) > 0.001)
      ) {
        posSmoothRate = 18;
        lookSmoothRate = 18;
      }

      if (reducedMotion) {
        targetFov = CHASE_CRUISE_FOV;
      } else {
        const speedFov = Math.min(7.5, absSpeed * 0.22);
        targetFov = target.isBoosting
          ? CHASE_BOOST_FOV
          : Math.min(CHASE_BOOST_FOV, CHASE_CRUISE_FOV + speedFov);
      }
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
      targetFov = target.isBoosting && !reducedMotion ? 74 : 66;
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
    rigState.basePosition.copy(SCRATCH_DESIRED_POS);
    rigState.lookTarget.copy(SCRATCH_DESIRED_LOOK);
    rigState.bankAngle = 0;
    rigState.shakeIntensity = 0;
    applyFovIfChanged(camera, targetFov);
    rigState.initialized = true;
  } else {
    const posAlpha = 1 - Math.exp(-posSmoothRate * safeDt);
    const lookAlpha = 1 - Math.exp(-lookSmoothRate * safeDt);
    const fovAlpha = 1 - Math.exp(-5.5 * safeDt);

    rigState.basePosition.lerp(SCRATCH_DESIRED_POS, posAlpha);
    rigState.lookTarget.lerp(SCRATCH_DESIRED_LOOK, lookAlpha);

    const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, fovAlpha);
    applyFovIfChanged(camera, nextFov);
  }

  // Update cinematic drift banking & damped impact shake (both disabled in reducedMotion)
  if (reducedMotion || mode === 'victory_orbit') {
    rigState.bankAngle = 0;
    rigState.shakeIntensity = 0;
  } else {
    const desiredBank =
      mode === 'chase' && target.isDriving && target.isDrifting && absSpeed > 4
        ? THREE.MathUtils.clamp(target.steerAngle * 0.16, -0.055, 0.055)
        : 0;
    const bankAlpha = safeDt > 0 ? 1 - Math.exp(-6.5 * safeDt) : 1;
    rigState.bankAngle = THREE.MathUtils.lerp(
      rigState.bankAngle,
      desiredBank,
      bankAlpha,
    );

    const impact = finiteOr(world.collisionImpact, 0);
    if (impact > IMPACT_SHAKE_THRESHOLD) {
      rigState.shakeIntensity = Math.max(
        rigState.shakeIntensity,
        Math.min(1, impact),
      );
    }
    if (safeDt > 0 && rigState.shakeIntensity > 0) {
      rigState.shakePhase += safeDt * 42;
      rigState.shakeIntensity *= Math.exp(-9.5 * safeDt);
      if (rigState.shakeIntensity < 0.004) {
        rigState.shakeIntensity = 0;
      }
    }
  }

  // Compose final camera position (base + damped shake) with terrain clearance guard
  SCRATCH_SHAKE_OFFSET.set(0, 0, 0);
  if (rigState.shakeIntensity > 0) {
    const lateralShake =
      Math.sin(rigState.shakePhase) * rigState.shakeIntensity * 0.34;
    const verticalShake =
      Math.cos(rigState.shakePhase * 1.37) * rigState.shakeIntensity * 0.24;
    SCRATCH_SHAKE_OFFSET.set(
      rightX * lateralShake,
      verticalShake,
      rightZ * lateralShake,
    );
  }

  camera.position.copy(rigState.basePosition).add(SCRATCH_SHAKE_OFFSET);
  if (clampTerrain) {
    const minGroundY =
      getTerrainElevation(camera.position.x, camera.position.z) + 1.1;
    if (camera.position.y < minGroundY) {
      camera.position.y = minGroundY;
    }
  }

  rigState.lastMode = mode;
  camera.lookAt(rigState.lookTarget);
  if (Math.abs(rigState.bankAngle) > 0.0002) {
    camera.rotateZ(rigState.bankAngle);
  }
}
