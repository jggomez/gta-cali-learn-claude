/**
 * Photorealistic golden-hour Cali sky dome fallback (with drifting FBM sunset clouds),
 * player-tracking 2048px soft shadow lighting rig, subtle cinematic HDR UnrealBloom post-processing,
 * WebGL error type, and GTA V free-orbit chase camera rig (360° mouse look, zoom, auto-recenter,
 * speed FOV, drift banking, impact shake).
 * Zero network assets and zero mutation of simulation snapshots.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getTerrainElevation } from '../config/caliMap';
import { isTwoWheelerKind } from '../simulation/physics';
import type { CameraMode, TimeOfDay, WorldSnapshot } from '../types/game';

const SKY_RADIUS = 540;
const SUN_DIRECTION = new THREE.Vector3(-0.94, 0.16, -0.14).normalize();
const MOON_DIRECTION = new THREE.Vector3(-0.78, 0.38, -0.22).normalize();
const SUN_SHADOW_OFFSET = new THREE.Vector3(-152, 76, -24);
const SHADOW_FRUSTUM_HALF = 72;
const SHADOW_DEPTH_BIAS = -0.00025;
const SHADOW_NORMAL_BIAS_TEXELS = 0.55;
const SHADOW_LIGHT_Z_AXIS = SUN_SHADOW_OFFSET.clone().normalize();
const SHADOW_LIGHT_X_AXIS = new THREE.Vector3(0, 1, 0)
  .cross(SHADOW_LIGHT_Z_AXIS)
  .normalize();
const SHADOW_LIGHT_Y_AXIS = SHADOW_LIGHT_Z_AXIS.clone()
  .cross(SHADOW_LIGHT_X_AXIS)
  .normalize();
const AO_RADIUS_METERS = 1.6;
const AO_THICKNESS_METERS = 1.4;
const AO_BLEND_INTENSITY = 0.85;

const BLOOM_THRESHOLD_DAY = 1.35;
const BLOOM_RADIUS_DAY = 0.28;
const BLOOM_STRENGTH_DAY_FULL = 0.14;
const BLOOM_STRENGTH_DAY_REDUCED = 0.08;

const BLOOM_THRESHOLD_NIGHT = 0.78;
const BLOOM_RADIUS_NIGHT = 0.48;
const BLOOM_STRENGTH_NIGHT_FULL = 0.62;
const BLOOM_STRENGTH_NIGHT_REDUCED = 0.3;

const GRADE_CONTRAST_DAY = 1.06;
const GRADE_CONTRAST_NIGHT = 1.08;
const GRADE_SATURATION_DAY = 1.08;
const GRADE_SATURATION_NIGHT = 1.13;
const GRADE_VIGNETTE_DAY = 0.22;
const GRADE_VIGNETTE_NIGHT = 0.24;
const GRADE_VIGNETTE_REDUCED = 0.08;

const CHASE_CRUISE_FOV = 58;
const CHASE_BOOST_FOV = 72;
/** Motos sit ~40% closer in chase view so the rider and lean read clearly on screen. */
export const MOTO_CHASE_DISTANCE_SCALE = 0.62;
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
uniform vec3 uMoonDirection;
uniform float uNightMix;
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
  vec3 moonDir = normalize(uMoonDirection);
  float dayMix = 1.0 - clamp(uNightMix, 0.0, 1.0);
  float nightMix = clamp(uNightMix, 0.0, 1.0);
  float h = dir.y;

  // Rayleigh-inspired multi-band atmospheric gradient (golden hour or midnight starlit indigo)
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

  float horizonBand = pow(1.0 - clamp(abs(h), 0.0, 1.0), 4.2);

  // Forward Mie atmospheric golden-hour scatter & warm horizon glow (completely off at night)
  float sunDot = max(dot(dir, sunDir), 0.0);
  if (dayMix > 0.001) {
    float rayleighGlow = horizonBand * (0.12 + 0.34 * pow(sunDot, 2.0));
    float mieGlow = pow(sunDot, 5.5) * 0.38;
    float sunHalo = pow(sunDot, 38.0) * 0.56;
    float sunCore = smoothstep(0.9968, 0.999, sunDot);

    skyColor += vec3(1.0, 0.72, 0.44) * rayleighGlow * dayMix;
    skyColor += vec3(1.0, 0.68, 0.42) * mieGlow * dayMix;
    skyColor += vec3(1.0, 0.86, 0.56) * sunHalo * dayMix;
    skyColor = mix(skyColor, vec3(1.0, 0.96, 0.86), sunCore * dayMix);
  }

  // Soft lunar halo & subtle Cali night city skyglow along the horizon
  if (nightMix > 0.001) {
    float moonDot = max(dot(dir, moonDir), 0.0);
    float moonHalo = pow(moonDot, 14.0) * 0.16 + pow(moonDot, 84.0) * 0.28;
    skyColor += vec3(0.55, 0.72, 1.0) * moonHalo * nightMix;
    skyColor += vec3(0.28, 0.19, 0.44) * horizonBand * 0.26 * nightMix;
  }

  // Layered procedural FBM clouds drifting across the sky vault
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

    vec3 cloudColorDay = mix(cloudTopSlate, cloudApricotEdge, smoothstep(0.18, 0.62, undersideLight));
    cloudColorDay = mix(
      cloudColorDay,
      cloudGoldUnderside,
      smoothstep(0.56, 0.96, undersideLight) * (0.45 + 0.55 * pow(sunDot, 1.8))
    );

    float moonDotCloud = max(dot(dir, moonDir), 0.0);
    vec3 cloudColorNight = mix(
      vec3(0.06, 0.08, 0.18),
      vec3(0.22, 0.28, 0.46),
      smoothstep(0.25, 0.9, undersideLight * 0.55 + pow(moonDotCloud, 4.0) * 0.7)
    );

    vec3 cloudColor = mix(cloudColorDay, cloudColorNight, nightMix);
    float cloudOpacity = mix(0.84, 0.38, nightMix);
    skyColor = mix(skyColor, cloudColor, cloudAlpha * cloudOpacity);
  }

  // Multi-scale twinkling starfield: subtle zenith stars at dusk, vivid starlit vault at night
  if (h > 0.03) {
    vec2 skyProj = dir.xz / (h + 0.22);

    // Layer 1: bright hero stars
    vec2 heroCell = floor(skyProj * 82.0);
    vec2 heroLocal = fract(skyProj * 82.0) - 0.5;
    float heroHash = hash21(heroCell);
    float heroThreshold = mix(0.995, 0.962, nightMix);
    if (heroHash > heroThreshold) {
      vec2 starOffset = vec2(hash21(heroCell + 11.7) - 0.5, hash21(heroCell + 29.3) - 0.5) * 0.55;
      float starDist = length(heroLocal - starOffset);
      float starSpot = smoothstep(0.22, 0.03, starDist);
      float twinkle = 0.62 + 0.38 * sin(uTime * (2.1 + fract(heroHash * 31.7) * 2.4) + heroHash * 62.83);
      float elevMask = mix(smoothstep(0.35, 0.78, h), smoothstep(0.04, 0.24, h), nightMix);
      float cloudClear = 1.0 - cloudAlpha * mix(1.0, 0.78, nightMix);
      vec3 starTint = mix(vec3(0.82, 0.90, 1.0), vec3(1.0, 0.95, 0.84), fract(heroHash * 19.3));
      float starGain = mix(0.32, 1.45, nightMix);
      skyColor += starTint * starSpot * twinkle * elevMask * cloudClear * starGain;
    }

    // Layer 2: dense sparkling midnight dust stars (night only)
    if (nightMix > 0.05) {
      vec2 fineCell = floor(skyProj * 165.0);
      vec2 fineLocal = fract(skyProj * 165.0) - 0.5;
      float fineHash = hash21(fineCell + 73.1);
      if (fineHash > 0.974) {
        float fineSpot = smoothstep(0.26, 0.05, length(fineLocal));
        float fineTwinkle = 0.55 + 0.45 * sin(uTime * 3.1 + fineHash * 91.2);
        float fineMask = smoothstep(0.06, 0.34, h) * (1.0 - cloudAlpha * 0.85);
        skyColor += vec3(0.84, 0.92, 1.0) * fineSpot * fineTwinkle * fineMask * nightMix * 0.78;
      }
    }
  }

  gl_FragColor = vec4(skyColor, 1.0);
}
`;

const CRESCENT_MOON_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CRESCENT_MOON_FRAGMENT_SHADER = `
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float dist = length(p);

  float outerDisc = 1.0 - smoothstep(0.42, 0.46, dist);
  float cutDist = length(p - vec2(0.18, 0.11));
  float innerCut = 1.0 - smoothstep(0.36, 0.405, cutDist);
  float crescent = clamp(outerDisc * (1.0 - innerCut), 0.0, 1.0);

  // Subtle lunar mare surface variation across illuminated crescent
  float mare = 0.92 + 0.08 * sin(p.x * 9.0 + p.y * 6.0) * cos(p.y * 11.0 - p.x * 5.0);
  vec3 moonColor = vec3(0.97, 0.99, 1.0) * mare * 1.18;

  // Soft translucent cool-silver lunar corona halo fading cleanly to 0 at edge
  float halo = smoothstep(1.0, 0.25, dist) * 0.32 * (1.0 - innerCut * 0.45);
  vec3 haloColor = vec3(0.68, 0.82, 1.0);

  vec3 finalColor = mix(haloColor, moonColor, crescent);
  float finalAlpha = clamp(crescent + halo, 0.0, 1.0);
  if (finalAlpha < 0.005) {
    discard;
  }
  gl_FragColor = vec4(finalColor, finalAlpha);
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

export interface CinematicGradeUniforms {
  readonly tDiffuse: { value: THREE.Texture | null };
  readonly uNightMix: { value: number };
  readonly uBoostMix: { value: number };
  readonly uVignetteStrength: { value: number };
  readonly uContrast: { value: number };
  readonly uSaturation: { value: number };
}

export interface CinematicGradeShaderConfig {
  readonly name: string;
  readonly uniforms: CinematicGradeUniforms;
  readonly vertexShader: string;
  readonly fragmentShader: string;
}

export interface PostProcessingQuality {
  /** Fraction of the drawing buffer used by the bloom mip chain. */
  readonly bloomResolutionScale: number;
  readonly smaa: boolean;
  /** Screen-space ground-truth ambient occlusion (GTAOPass). */
  readonly ambientOcclusion: boolean;
}

export interface PostProcessingRig {
  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;
  readonly gradePass?: ShaderPass;
  readonly smaaPass?: SMAAPass;
  resize(width: number, height: number): void;
  setQuality?(quality: PostProcessingQuality): void;
  render(): void;
  dispose(): void;
}

/**
 * GTAO that reuses the depth buffer written by the main RenderPass instead of re-rendering the
 * whole city into its own normal/depth G-buffer, so enabling AO does not double the draw calls.
 * Normals are reconstructed from depth inside the GTAO shader.
 */
class SceneDepthGTAOPass extends GTAOPass {
  public override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const sceneDepth = readBuffer.depthTexture;
    if (sceneDepth) {
      const gtaoDepth = this.gtaoMaterial.uniforms['tDepth'];
      const denoiseDepth = this.pdMaterial.uniforms['tDepth'];
      if (gtaoDepth) gtaoDepth.value = sceneDepth;
      if (denoiseDepth) denoiseDepth.value = sceneDepth;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Creates a large BackSide golden-hour / starlit-night photographic sky dome with Rayleigh/Mie
 * scatter, drifting FBM clouds, western sun disc, and luminous crescent moon for Cali night mode.
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
      uMoonDirection: { value: MOON_DIRECTION.clone() },
      uNightMix: { value: 0 },
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

  const crescentMoon = new THREE.Mesh(
    new THREE.CircleGeometry(46, 36),
    new THREE.ShaderMaterial({
      vertexShader: CRESCENT_MOON_VERTEX_SHADER,
      fragmentShader: CRESCENT_MOON_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  crescentMoon.name = 'western_crescent_moon';
  crescentMoon.position.copy(MOON_DIRECTION).multiplyScalar(458);
  crescentMoon.lookAt(0, 0, 0);
  crescentMoon.visible = false;
  skyMesh.add(crescentMoon);

  skyMesh.userData.timeOfDay = 'golden_hour' satisfies TimeOfDay;
  return skyMesh;
}

/**
 * Switches sky dome shader uniforms and celestial discs seamlessly between golden hour
 * and starlit midnight Cali (deep indigo zenith, twinkling stars, crescent moon, zero sun).
 */
export function setSkyDomeTimeOfDay(
  skyDome: THREE.Mesh,
  timeOfDay: TimeOfDay,
): void {
  const isNight = timeOfDay === 'night';
  const material = skyDome.material;
  if (material instanceof THREE.ShaderMaterial) {
    const uniforms = material.uniforms;
    if (uniforms.uZenithColor?.value instanceof THREE.Color) {
      uniforms.uZenithColor.value.setHex(isNight ? 0x040714 : 0x1f3b6b);
    }
    if (uniforms.uUpperMidColor?.value instanceof THREE.Color) {
      uniforms.uUpperMidColor.value.setHex(isNight ? 0x080c22 : 0x5c688a);
    }
    if (uniforms.uLowerMidColor?.value instanceof THREE.Color) {
      uniforms.uLowerMidColor.value.setHex(isNight ? 0x0e1029 : 0xe08e68);
    }
    if (uniforms.uHorizonColor?.value instanceof THREE.Color) {
      uniforms.uHorizonColor.value.setHex(isNight ? 0x13102b : 0xffca80);
    }
    if (uniforms.uGroundColor?.value instanceof THREE.Color) {
      uniforms.uGroundColor.value.setHex(isNight ? 0x05060f : 0x3a322c);
    }
    if (uniforms.uNightMix) {
      uniforms.uNightMix.value = isNight ? 1 : 0;
    }
  }

  const sunDisc = skyDome.getObjectByName('western_sun_disc');
  if (sunDisc) {
    sunDisc.visible = !isNight;
  }
  const sunCorona = skyDome.getObjectByName('western_sun_corona');
  if (sunCorona) {
    sunCorona.visible = !isNight;
  }
  const crescentMoon = skyDome.getObjectByName('western_crescent_moon');
  if (crescentMoon) {
    crescentMoon.visible = isNight;
  }
  skyDome.userData.timeOfDay = timeOfDay;
}

/**
 * Advances the procedural sky dome shader time uniform to animate drifting clouds and stars.
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

  const sunLight = new THREE.DirectionalLight(0xffd39c, 3.0);
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
  sunLight.shadow.radius = 2.5;
  applyShadowBias(sunLight.shadow, 2048);
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
 * Switches scene key, hemisphere, and rim lights seamlessly between golden-hour sun
 * and cool moonlit Cali night illumination.
 */
export function setLightingTimeOfDay(
  lightingGroup: THREE.Group,
  timeOfDay: TimeOfDay,
): void {
  const isNight = timeOfDay === 'night';

  const keyLight =
    lightingGroup.userData.keyLight ??
    lightingGroup.getObjectByName('sunset_key_light');
  if (keyLight instanceof THREE.DirectionalLight) {
    keyLight.color.setHex(isNight ? 0x7da2ff : 0xffd39c);
    keyLight.intensity = isNight ? 0.65 : 3.0;
  }

  const hemisphere = lightingGroup.getObjectByName('sunset_hemisphere_light');
  if (hemisphere instanceof THREE.HemisphereLight) {
    hemisphere.color.setHex(isNight ? 0x1e2a55 : 0x9bc4e8);
    hemisphere.groundColor.setHex(isNight ? 0x100d1f : 0x6b5240);
    hemisphere.intensity = isNight ? 0.42 : 0.9;
  }

  const skyRim = lightingGroup.getObjectByName('sunset_sky_rim');
  if (skyRim instanceof THREE.DirectionalLight) {
    skyRim.color.setHex(isNight ? 0x3b4e99 : 0x88b4e6);
    skyRim.intensity = isNight ? 0.25 : 0.35;
  }
}

function applyShadowBias(shadow: THREE.DirectionalLightShadow, mapSize: number): void {
  const texelMeters = (SHADOW_FRUSTUM_HALF * 2) / mapSize;
  shadow.bias = SHADOW_DEPTH_BIAS;
  shadow.normalBias = texelMeters * SHADOW_NORMAL_BIAS_TEXELS;
}

/**
 * Resizes the sun shadow map for the active quality preset. Normal bias follows the texel size
 * so low presets avoid acne and high presets avoid peter-panning.
 */
export function setShadowQuality(lightingGroup: THREE.Group, mapSize: number): void {
  const keyLight =
    lightingGroup.userData.keyLight ?? lightingGroup.getObjectByName('sunset_key_light');
  if (!(keyLight instanceof THREE.DirectionalLight) || !(mapSize > 0)) {
    return;
  }
  const shadow = keyLight.shadow;
  if (shadow.mapSize.x === mapSize && shadow.mapSize.y === mapSize) {
    return;
  }
  shadow.mapSize.set(mapSize, mapSize);
  applyShadowBias(shadow, mapSize);
  if (shadow.map) {
    shadow.map.dispose();
    shadow.map = null;
  }
}

/**
 * Snaps a shadow focus point to the sun shadow map texel grid in light space, so the
 * orthographic shadow camera only ever moves by whole texels and shadow edges stop shimmering.
 */
export function computeShadowTexelSnappedFocus(
  x: number,
  y: number,
  z: number,
  mapSize: number,
): { x: number; y: number; z: number } {
  if (!(mapSize > 0)) {
    return { x, y, z };
  }
  const texel = (SHADOW_FRUSTUM_HALF * 2) / mapSize;
  const along = (axis: THREE.Vector3): number => x * axis.x + y * axis.y + z * axis.z;
  const u = along(SHADOW_LIGHT_X_AXIS);
  const v = along(SHADOW_LIGHT_Y_AXIS);
  const w = along(SHADOW_LIGHT_Z_AXIS);
  const du = Math.round(u / texel) * texel - u;
  const dv = Math.round(v / texel) * texel - v;
  const dw = Math.round(w / texel) * texel - w;
  return {
    x: x + du * SHADOW_LIGHT_X_AXIS.x + dv * SHADOW_LIGHT_Y_AXIS.x + dw * SHADOW_LIGHT_Z_AXIS.x,
    y: y + du * SHADOW_LIGHT_X_AXIS.y + dv * SHADOW_LIGHT_Y_AXIS.y + dw * SHADOW_LIGHT_Z_AXIS.y,
    z: z + du * SHADOW_LIGHT_X_AXIS.z + dv * SHADOW_LIGHT_Y_AXIS.z + dw * SHADOW_LIGHT_Z_AXIS.z,
  };
}

/**
 * Repositions the directional sun/moon light and its ±72m shadow frustum around the active
 * player focus, snapped to whole shadow texels to keep shadow edges stable while moving.
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

  const snapped = computeShadowTexelSnappedFocus(
    safeX,
    focusY,
    safeZ,
    keyLightCandidate.shadow.mapSize.x,
  );

  keyLightCandidate.target.position.set(snapped.x, snapped.y, snapped.z);
  keyLightCandidate.position.set(
    snapped.x + SUN_SHADOW_OFFSET.x,
    snapped.y + SUN_SHADOW_OFFSET.y,
    snapped.z + SUN_SHADOW_OFFSET.z,
  );
  keyLightCandidate.target.updateMatrixWorld();
  keyLightCandidate.updateMatrixWorld();
}

const CINEMATIC_GRADE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CINEMATIC_GRADE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uNightMix;
uniform float uBoostMix;
uniform float uVignetteStrength;
uniform float uContrast;
uniform float uSaturation;

varying vec2 vUv;

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 col = max(texel.rgb, vec3(0.0));

  float night = clamp(uNightMix, 0.0, 1.0);
  float boost = clamp(uBoostMix, 0.0, 1.0);

  // Preserve deep blacks while lifting warm golden-hour sunlight vs crisp neon-night indigo
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float highlightMask = smoothstep(0.35, 1.35, luma);
  float shadowMask = 1.0 - smoothstep(0.0, 0.45, luma);

  vec3 dayTint = mix(vec3(1.015, 0.985, 0.935), vec3(1.055, 0.975, 0.885), highlightMask);
  vec3 nightTint = mix(vec3(0.91, 0.95, 1.06), vec3(1.03, 1.0, 1.04), highlightMask);
  col *= mix(dayTint, nightTint, night);

  // Subtle shadow tint anchoring without washing out blacks
  col *= mix(vec3(1.0), mix(vec3(1.01, 0.995, 0.985), vec3(0.95, 0.97, 1.04), night), shadowMask * 0.35);

  // Saturation with dynamic boost pop and night neon vibrancy
  float sat = max(0.0, uSaturation + boost * 0.10 + night * highlightMask * 0.08);
  float gradedLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gradedLuma), col, sat), vec3(0.0));

  // Highlight-safe filmic contrast around linear mid-grey (0.22) that deepens shadows/midtones
  // while smoothly rolling off to 1.0 above bright highlights so HDR sky never blows out
  float contrastDelta = clamp((uContrast + boost * 0.06) - 1.0, 0.0, 0.32) * 1.45;
  float peakChannel = max(col.r, max(col.g, col.b));
  float highlightProtect = 1.0 - smoothstep(0.50, 1.10, max(gradedLuma, peakChannel * 0.85));
  vec3 safeRatio = max(col, vec3(0.0001)) / vec3(0.22);
  col *= pow(safeRatio, vec3(contrastDelta * highlightProtect));

  // Soft radial cinema vignette (tightens subtly during nitro boost)
  vec2 centered = vUv - vec2(0.5);
  float distSq = dot(centered, centered);
  float vigAmount = clamp(uVignetteStrength + boost * 0.05, 0.0, 0.65);
  float vignette = 1.0 - smoothstep(0.18, 0.78, distSq * 1.65) * vigAmount;
  col *= vignette;

  gl_FragColor = vec4(max(col, vec3(0.0)), texel.a);
}
`;

/**
 * Builds the Cali Vice Sunset / Neon Night filmic color-grading shader definition for ShaderPass.
 */
export function createCinematicGradeShader(): CinematicGradeShaderConfig {
  return {
    name: 'CinematicGradeShader',
    uniforms: {
      tDiffuse: { value: null },
      uNightMix: { value: 0 },
      uBoostMix: { value: 0 },
      uVignetteStrength: { value: GRADE_VIGNETTE_DAY },
      uContrast: { value: GRADE_CONTRAST_DAY },
      uSaturation: { value: GRADE_SATURATION_DAY },
    },
    vertexShader: CINEMATIC_GRADE_VERTEX_SHADER,
    fragmentShader: CINEMATIC_GRADE_FRAGMENT_SHADER,
  };
}

/**
 * Tunes UnrealBloom thresholds and glow strength for crisp golden-hour restraint vs
 * dramatic night headlights, sirens, neon signs, windows, and Cristo Rey floodlights.
 */
export function setBloomTimeOfDay(
  rig: PostProcessingRig,
  timeOfDay: TimeOfDay,
  reducedMotion: boolean,
): void {
  const isNight = timeOfDay === 'night';
  rig.bloomPass.threshold = isNight ? BLOOM_THRESHOLD_NIGHT : BLOOM_THRESHOLD_DAY;
  rig.bloomPass.radius = isNight ? BLOOM_RADIUS_NIGHT : BLOOM_RADIUS_DAY;
  rig.bloomPass.strength = isNight
    ? reducedMotion
      ? BLOOM_STRENGTH_NIGHT_REDUCED
      : BLOOM_STRENGTH_NIGHT_FULL
    : reducedMotion
      ? BLOOM_STRENGTH_DAY_REDUCED
      : BLOOM_STRENGTH_DAY_FULL;
}

/**
 * Updates CinematicGradePass shader uniforms cleanly for golden-hour vs starlit night,
 * reduced-motion vignette attenuation, and nitro boost punch.
 */
export function setGradeTimeOfDay(
  rig: PostProcessingRig,
  timeOfDay: TimeOfDay,
  reducedMotion: boolean,
  boostMix = 0,
): void {
  const uniforms = rig.gradePass?.uniforms;
  if (!uniforms) {
    return;
  }

  const isNight = timeOfDay === 'night';
  const clampedBoost = Math.max(0, Math.min(1, finiteOr(boostMix, 0)));

  const nightUniform = uniforms['uNightMix'];
  if (nightUniform) {
    nightUniform.value = isNight ? 1 : 0;
  }

  const boostUniform = uniforms['uBoostMix'];
  if (boostUniform) {
    boostUniform.value = clampedBoost;
  }

  const vignetteUniform = uniforms['uVignetteStrength'];
  if (vignetteUniform) {
    vignetteUniform.value = reducedMotion
      ? GRADE_VIGNETTE_REDUCED
      : isNight
        ? GRADE_VIGNETTE_NIGHT
        : GRADE_VIGNETTE_DAY;
  }

  const contrastUniform = uniforms['uContrast'];
  if (contrastUniform) {
    contrastUniform.value = isNight ? GRADE_CONTRAST_NIGHT : GRADE_CONTRAST_DAY;
  }

  const saturationUniform = uniforms['uSaturation'];
  if (saturationUniform) {
    saturationUniform.value = isNight ? GRADE_SATURATION_NIGHT : GRADE_SATURATION_DAY;
  }
}

/**
 * Constructs an EffectComposer pipeline with RenderPass, UnrealBloomPass, CinematicGradePass,
 * optional SMAAPass (gracefully skipped if unsupported), and OutputPass.
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
    const pixelRatio = Math.min(renderer.getPixelRatio(), 2);

    const composer = new EffectComposer(renderer);
    // Expose scene depth from the ping-pong buffers so GTAO can reuse it without a G-buffer pass
    const sceneDepthTextures = [composer.renderTarget1, composer.renderTarget2].map((target) => {
      const depthTexture = new THREE.DepthTexture(1, 1);
      target.depthTexture = depthTexture;
      return depthTexture;
    });
    composer.setPixelRatio(pixelRatio);
    composer.setSize(safeWidth, safeHeight);

    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(safeWidth, safeHeight),
      reducedMotion ? BLOOM_STRENGTH_DAY_REDUCED : BLOOM_STRENGTH_DAY_FULL,
      BLOOM_RADIUS_DAY,
      BLOOM_THRESHOLD_DAY,
    );
    const gradePass = new ShaderPass(createCinematicGradeShader());

    let smaaPass: SMAAPass | undefined;
    try {
      smaaPass = new SMAAPass(safeWidth * pixelRatio, safeHeight * pixelRatio);
    } catch {
      smaaPass = undefined;
    }

    const outputPass = new OutputPass();
    let aoPass: GTAOPass | null = null;
    let bloomResolutionScale = 0.5;
    let lastWidth = safeWidth;
    let lastHeight = safeHeight;

    const ensureAoPass = (): GTAOPass => {
      if (!aoPass) {
        const pr = renderer.getPixelRatio();
        aoPass = new SceneDepthGTAOPass(scene, camera, lastWidth * pr, lastHeight * pr);
        aoPass.setGBuffer(sceneDepthTextures[0]);
        aoPass.blendIntensity = AO_BLEND_INTENSITY;
        aoPass.updateGtaoMaterial({
          radius: AO_RADIUS_METERS,
          thickness: AO_THICKNESS_METERS,
          distanceExponent: 1.4,
          scale: 1,
          samples: 12,
        });
        composer.insertPass(aoPass, 1);
      }
      return aoPass;
    };

    const applyBloomResolution = (): void => {
      const pr = renderer.getPixelRatio();
      bloomPass.setSize(
        Math.max(1, Math.round(lastWidth * pr * bloomResolutionScale)),
        Math.max(1, Math.round(lastHeight * pr * bloomResolutionScale)),
      );
    };

    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(gradePass);
    if (smaaPass) {
      composer.addPass(smaaPass);
    }
    composer.addPass(outputPass);

    const rig: PostProcessingRig = {
      composer,
      bloomPass,
      gradePass,
      ...(smaaPass ? { smaaPass } : {}),
      resize(nextWidth: number, nextHeight: number): void {
        const clampedW = Math.max(1, Math.floor(finiteOr(nextWidth, 1)));
        const clampedH = Math.max(1, Math.floor(finiteOr(nextHeight, 1)));
        lastWidth = clampedW;
        lastHeight = clampedH;
        const currentPixelRatio = Math.min(renderer.getPixelRatio(), 2);
        composer.setPixelRatio(currentPixelRatio);
        composer.setSize(clampedW, clampedH);
        applyBloomResolution();
        smaaPass?.setSize(clampedW * currentPixelRatio, clampedH * currentPixelRatio);
      },
      setQuality(quality: PostProcessingQuality): void {
        bloomResolutionScale = Math.max(0.2, Math.min(1, finiteOr(quality.bloomResolutionScale, 0.5)));
        applyBloomResolution();
        if (smaaPass) {
          smaaPass.enabled = quality.smaa;
        }
        if (quality.ambientOcclusion) {
          ensureAoPass().enabled = true;
        } else if (aoPass) {
          aoPass.enabled = false;
        }
      },
      render(): void {
        composer.render();
      },
      dispose(): void {
        aoPass?.dispose();
        for (const depthTexture of sceneDepthTextures) {
          depthTexture.dispose();
        }
        bloomPass.dispose();
        gradePass.dispose();
        smaaPass?.dispose();
        outputPass.dispose();
        composer.dispose();
      },
    };

    setGradeTimeOfDay(rig, 'golden_hour', reducedMotion, 0);
    applyBloomResolution();
    return rig;
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
  /** True while riding a moto: tighter, lower chase framing for the smaller silhouette. */
  readonly isTwoWheeler?: boolean;
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
        isTwoWheeler: isTwoWheelerKind(activeVehicle.kind),
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

      const bikeScale = target.isTwoWheeler ? MOTO_CHASE_DISTANCE_SCALE : 1;
      const baseDist = target.isDriving
        ? zoomDist * bikeScale
        : THREE.MathUtils.clamp(zoomDist * 0.65, 3.0, 7.2);
      const speedPull = target.isDriving ? Math.min(1.6, absSpeed * 0.045) * bikeScale : 0;
      const boostPull = target.isBoosting && !reducedMotion ? 1.15 : 0;
      const distance = baseDist + speedPull + boostPull;
      if (target.isTwoWheeler) {
        // Light motos change direction fast; follow tighter so the bike never drifts off-frame.
        posSmoothRate = 12;
      }

      const chaseHeading = target.heading + yawOffset;
      const orbitForwardX = Math.sin(chaseHeading);
      const orbitForwardZ = Math.cos(chaseHeading);
      const basePitch = target.isDriving ? 0.14 : 0.18;
      const totalPitch = THREE.MathUtils.clamp(basePitch + pitchOffset, -0.02, 0.92);
      const pivotY = target.isTwoWheeler ? 1.3 : target.isDriving ? 1.18 : 1.38;
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
