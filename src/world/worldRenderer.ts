/**
 * Pure presentation WebGL renderer for GTA VI: Cali (La Sucursal del Cielo).
 * Consumes immutable WorldSnapshot and MissionSnapshot objects without mutating simulation state.
 * Wires local HDRI golden-hour PMREM reflections & sky, 1K photographic PBR city textures,
 * sculpted Colombian vehicles (Renault 4 Turbo, Spark GT, Willys V8, Policía Nacional SUV,
 * Taxi Zapatico, MIO Bus, Chiva) + Ferrari 458 Banshee, realistic Caleño (caleno.glb) and
 * Valeria (valeria.glb) characters with zero sci-fi soldiers, working traffic lights, 3-star
 * police roadblocks & officers, exhaust backfire flames, pooled skid marks, and post-FX.
 */

import * as THREE from 'three';
import {
  CALI_MAP,
  DEFAULT_GARAGE_CONFIG,
  ROADBLOCK_ZONES,
  getTerrainElevation,
  getWalkableGroundHeight,
} from '../config/caliMap';
import type {
  CaliMapConfig,
  CameraMode,
  GarageConfig,
  MissionSnapshot,
  PedestrianSnapshot,
  TimeOfDay,
  Vec2,
  VehicleKind,
  VehicleSnapshot,
  WorldSnapshot,
} from '../types/game';
import {
  loadWorldAssets,
  type LoadedCharacterAsset,
  type LoadedWorldAssets,
} from './assetLoader';
import {
  applyPhotographicAssets,
  buildCaliWorld,
  setRoadblockVisible,
  setWorldNightLighting,
  updateTrafficLightPhase,
  type CaliWorldBuildResult,
} from './caliLandmarks';
import { resolveLocomotionPlayback } from './calenoPeople';
import { ParticleSystem, SkidMarkPool } from './particles';
import {
  bindRenderTargetDisposal,
  createSunsetEnvironmentMap,
} from './pbrTextures';
import {
  WebGLUnavailableError,
  applyCameraOrbitInput,
  createCameraOrbitState,
  createPostProcessing,
  createSunsetLighting,
  createSunsetSkyDome,
  setBloomTimeOfDay,
  setGradeTimeOfDay,
  setLightingTimeOfDay,
  setSkyDomeTimeOfDay,
  updateCameraRig,
  updateShadowFocus,
  updateSkyDomeTime,
  type CameraOrbitState,
  type PostProcessingRig,
} from './sceneSetup';
import {
  createCalenoCharacterRig,
  createCivilianPedestrianRig,
  createFerrariLiveryMesh,
  createGpsChevronMesh,
  createMissionPropMeshes,
  createObjectiveBeacon,
  createPedestrianMesh,
  createPlayerMesh,
  createValeriaPlayerMesh,
  createVehicleMesh,
  type HeadlightConeMaterials,
  type MissionPropKey,
  type RiggedCharacterActions,
  type RiggedCharacterRig,
} from './vehicleMeshes';

const HEADLIGHT_LOOK_AHEAD_METERS = 45;
const TAILLIGHT_CRUISE_INTENSITY = 1.15;
const TAILLIGHT_BRAKE_INTENSITY = 2.8;
const BRAKE_DECEL_THRESHOLD_MPS2 = -3.2;
const DRIFT_SMOKE_MIN_SPEED_MPS = 4.5;
const SKID_MARK_MIN_SPEED_MPS = 5.0;
const SKID_MARK_MIN_INTERVAL_SECONDS = 0.045;
const SKID_MARK_MIN_DISTANCE_METERS = 0.75;
const SKID_MARK_MIN_DISTANCE_SQ =
  SKID_MARK_MIN_DISTANCE_METERS * SKID_MARK_MIN_DISTANCE_METERS;
const REAR_TIRE_TRACK_RATIO = 0.82;
const REAR_TIRE_AXLE_RATIO = 0.62;
const COLLISION_SPARK_THRESHOLD = 0.14;
const COLLISION_SPARK_COOLDOWN_SECONDS = 0.09;
const AIRBORNE_PITCH_THRESHOLD_METERS = 0.08;
const AIRBORNE_PITCH_MAX_RAD = 0.28;
const TERRAIN_SLOPE_MAX_RAD = 0.32;
const BOOST_PITCH_OFFSET_RAD = -0.035;
const BACKFIRE_AIRBORNE_THRESHOLD_METERS = 0.15;
const BACKFIRE_HIGH_RPM_SPEED_MPS = 10;
const BACKFIRE_HIGH_RPM_ACCEL_MPS2 = 5.5;
const CHARACTER_CROSSFADE_SECONDS = 0.22;
const PEDESTRIAN_CULL_DISTANCE_METERS = 95;
const PEDESTRIAN_CULL_DISTANCE_SQ =
  PEDESTRIAN_CULL_DISTANCE_METERS * PEDESTRIAN_CULL_DISTANCE_METERS;
const PEDESTRIAN_CROSSFADE_SECONDS = 0.2;
const CRISTO_REY_DANCER_ACTIVE_DISTANCE_METERS = 110;
const CRISTO_REY_DANCER_ACTIVE_DISTANCE_SQ =
  CRISTO_REY_DANCER_ACTIVE_DISTANCE_METERS *
  CRISTO_REY_DANCER_ACTIVE_DISTANCE_METERS;
const CRISTO_REY_PLAYER_DANCE_DISTANCE_METERS = 65;
const CRISTO_REY_PLAYER_DANCE_DISTANCE_SQ =
  CRISTO_REY_PLAYER_DANCE_DISTANCE_METERS *
  CRISTO_REY_PLAYER_DANCE_DISTANCE_METERS;
const SUMMIT_DANCER_SKIN_TONE_HEX = 0xb97c5b;
const BOOST_GRADE_RISE_RATE = 8.5;
const BOOST_GRADE_FALL_RATE = 4.5;
const DAY_TONE_MAPPING_EXPOSURE = 0.94;
const NIGHT_TONE_MAPPING_EXPOSURE = 1.12;
const DAY_BACKGROUND_INTENSITY = 0.72;
const NIGHT_BACKGROUND_INTENSITY = 1.0;
const DAY_HDRI_ENVIRONMENT_INTENSITY = 0.98;
const DAY_FALLBACK_ENVIRONMENT_INTENSITY = 0.82;
const NIGHT_ENVIRONMENT_INTENSITY = 0.24;
const DAY_FOG_COLOR_HEX = 0xc9916a;
const DAY_FOG_DENSITY = 0.00105;
const NIGHT_FOG_COLOR_HEX = 0x090d1f;
const NIGHT_FOG_DENSITY = 0.0023;
const FLOATING_ARROW_BASE_Y = 8.0;
const GPS_CHEVRON_DISTANCES = [10, 22, 34, 46, 58] as const;
const GPS_CHEVRON_ELEVATION_OFFSET = 0.35;
const MISSION_PROP_KEYS: readonly MissionPropKey[] = [
  'vinyl_briefcase',
  'mateo_speakers',
  'summit_stage',
];

export interface AtmosphereConfig {
  readonly toneMappingExposure: number;
  readonly backgroundIntensity: number;
  readonly environmentIntensity: number;
  readonly fogColorHex: number;
  readonly fogDensity: number;
}

/**
 * Resolves exposure, sky background intensity, IBL environment intensity, and exponential fog
 * for golden-hour daytime vs starlit night Cali, ensuring consistent initial, HDRI-loaded, and toggled states.
 */
export function resolveAtmosphereConfig(
  timeOfDay: TimeOfDay,
  hasHdriEnvironment: boolean,
): AtmosphereConfig {
  const isNight = timeOfDay === 'night';
  return {
    toneMappingExposure: isNight
      ? NIGHT_TONE_MAPPING_EXPOSURE
      : DAY_TONE_MAPPING_EXPOSURE,
    backgroundIntensity: isNight
      ? NIGHT_BACKGROUND_INTENSITY
      : DAY_BACKGROUND_INTENSITY,
    environmentIntensity: isNight
      ? NIGHT_ENVIRONMENT_INTENSITY
      : hasHdriEnvironment
        ? DAY_HDRI_ENVIRONMENT_INTENSITY
        : DAY_FALLBACK_ENVIRONMENT_INTENSITY,
    fogColorHex: isNight ? NIGHT_FOG_COLOR_HEX : DAY_FOG_COLOR_HEX,
    fogDensity: isNight ? NIGHT_FOG_DENSITY : DAY_FOG_DENSITY,
  };
}

export interface GpsRoutePose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface RearTireWorldPositions {
  readonly leftX: number;
  readonly leftY: number;
  readonly leftZ: number;
  readonly rightX: number;
  readonly rightY: number;
  readonly rightZ: number;
}

/**
 * Computes world-space rear-left and rear-right tire contact coordinates for a +Z forward
 * right-handed vehicle (vehicle left along +X = (cos, -sin), rear along -Z = (-sin, -cos)).
 */
export function computeRearTireWorldPositions(
  vehicle: Pick<VehicleSnapshot, 'x' | 'z' | 'heading' | 'halfWidth' | 'halfLength'>,
  elevationAt: (x: number, z: number) => number,
): RearTireWorldPositions {
  const x = Number.isFinite(vehicle.x) ? vehicle.x : 0;
  const z = Number.isFinite(vehicle.z) ? vehicle.z : 0;
  const heading = Number.isFinite(vehicle.heading) ? vehicle.heading : 0;
  const safeHalfWidth =
    Number.isFinite(vehicle.halfWidth) && vehicle.halfWidth > 0
      ? vehicle.halfWidth
      : 1.0;
  const safeHalfLength =
    Number.isFinite(vehicle.halfLength) && vehicle.halfLength > 0
      ? vehicle.halfLength
      : 2.2;

  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const leftDirX = Math.cos(heading);
  const leftDirZ = -Math.sin(heading);

  const rearOffset = safeHalfLength * REAR_TIRE_AXLE_RATIO;
  const trackHalfWidth = safeHalfWidth * REAR_TIRE_TRACK_RATIO;

  const axleX = x - forwardX * rearOffset;
  const axleZ = z - forwardZ * rearOffset;

  const leftX = axleX + leftDirX * trackHalfWidth;
  const leftZ = axleZ + leftDirZ * trackHalfWidth;
  const rightX = axleX - leftDirX * trackHalfWidth;
  const rightZ = axleZ - leftDirZ * trackHalfWidth;

  const rawLeftY = elevationAt(leftX, leftZ);
  const rawRightY = elevationAt(rightX, rightZ);

  return {
    leftX,
    leftY: Number.isFinite(rawLeftY) ? rawLeftY : 0,
    leftZ,
    rightX,
    rightY: Number.isFinite(rawRightY) ? rawRightY : 0,
    rightZ,
  };
}

/**
 * Samples a world position and forward heading (+Z aligned) along a 2D GPS route polyline
 * at a given distance in meters from the start of the route. Returns null if the route ends earlier.
 */
export function sampleGpsRoutePose(
  route: readonly Vec2[],
  distanceMeters: number,
): GpsRoutePose | null {
  if (route.length < 2 || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return null;
  }

  let accumulated = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    if (!a || !b) {
      continue;
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segLen = Math.hypot(dx, dz);
    if (segLen < 0.001) {
      continue;
    }

    if (accumulated + segLen >= distanceMeters) {
      const t = (distanceMeters - accumulated) / segLen;
      return {
        x: a.x + dx * t,
        z: a.z + dz * t,
        heading: Math.atan2(dx, dz),
      };
    }
    accumulated += segLen;
  }

  return null;
}

function hashPedestrianSeed(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) {
    sum += id.charCodeAt(i) * (i + 1);
  }
  return Math.abs(sum);
}

function hashPedestrianPhase(id: string): number {
  return (hashPedestrianSeed(id) % 628) / 100;
}

export interface VehicleVisualSignature {
  readonly kind: VehicleKind;
  readonly colorHex: number;
  readonly neonHex?: number | undefined;
  readonly accentHex?: number | undefined;
  readonly usesFerrariModel?: boolean;
}

export interface VehicleRenderEntry {
  readonly kind: VehicleKind;
  readonly colorHex: number;
  readonly accentHex: number | undefined;
  readonly neonHex: number | undefined;
  readonly usesFerrariModel: boolean;
  readonly group: THREE.Group;
}

export interface ExhaustBackfireDecision {
  readonly intensity: number;
  readonly cooldownSeconds: number;
}

/**
 * Only the exotic 'banshee' mounts the Ferrari 458 Italia GLB; all authentic Colombian vehicles
 * (Renault 4 Turbo, Spark GT, Willys V8, Policía Nacional SUV, Taxi Zapatico, MIO Bus, Chiva)
 * mount their bespoke sculpted clearcoat PBR meshes.
 */
export function shouldUseFerrariModel(
  kind: VehicleKind,
  hasFerrariTemplate: boolean,
): boolean {
  return kind === 'banshee' && hasFerrariTemplate;
}

/**
 * Determines whether a pooled vehicle mesh must be disposed and rebuilt due to a runtime
 * car swap (Garaje [G]), live repaint (Garaje or Pay 'n' Spray), neon change, or Ferrari GLB load.
 */
export function shouldRebuildVehicleMesh(
  entry: VehicleVisualSignature | undefined,
  snapshot: Pick<VehicleSnapshot, 'kind' | 'colorHex' | 'neonHex' | 'accentHex'>,
  hasFerrariTemplate?: boolean,
): boolean {
  if (!entry) {
    return true;
  }
  if (
    entry.kind !== snapshot.kind ||
    entry.colorHex !== snapshot.colorHex ||
    entry.neonHex !== snapshot.neonHex
  ) {
    return true;
  }
  if (
    entry.accentHex !== undefined &&
    snapshot.accentHex !== undefined &&
    entry.accentHex !== snapshot.accentHex
  ) {
    return true;
  }
  if (hasFerrariTemplate !== undefined && entry.usesFerrariModel !== undefined) {
    const wantsFerrari = shouldUseFerrariModel(snapshot.kind, hasFerrariTemplate);
    if (entry.usesFerrariModel !== wantsFerrari) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the calibrated headlight emitter height (meters above ground) for each Cali vehicle kind.
 */
export function resolveHeadlightHeight(kind: VehicleKind): number {
  switch (kind) {
    case 'renault4_turbo':
      return 0.68;
    case 'spark_gt_turbo':
      return 0.62;
    case 'willys_v8':
      return 0.84;
    case 'police':
      return 0.86;
    case 'taxi':
      return 0.64;
    case 'banshee':
      return 0.58;
    case 'mio_bus':
      return 0.98;
    case 'chiva':
      return 1.04;
  }
}

/**
 * Computes vehicle local X pitch (negative = nose up) for GTA Stunt Jump airborne arcs,
 * terrain slopes on landing, and subtle nitro boost squat.
 */
export function computeVehiclePitchRad(
  airborneHeight: number | undefined,
  terrainSlopeRad: number,
  isBoosting: boolean,
): number {
  const safeAirborne =
    airborneHeight !== undefined && Number.isFinite(airborneHeight)
      ? Math.max(0, airborneHeight)
      : 0;
  const safeSlope = Number.isFinite(terrainSlopeRad)
    ? THREE.MathUtils.clamp(
        terrainSlopeRad,
        -TERRAIN_SLOPE_MAX_RAD,
        TERRAIN_SLOPE_MAX_RAD,
      )
    : 0;
  const boostOffset = isBoosting ? BOOST_PITCH_OFFSET_RAD : 0;

  if (safeAirborne > AIRBORNE_PITCH_THRESHOLD_METERS) {
    const airbornePitch = -Math.min(
      AIRBORNE_PITCH_MAX_RAD,
      (safeAirborne - AIRBORNE_PITCH_THRESHOLD_METERS) * 0.085 + 0.05,
    );
    return airbornePitch + boostOffset;
  }

  return safeSlope + boostOffset;
}

/**
 * Evaluates whether the player's tailpipe should fire an exhaust backfire flame pop
 * on stunt launch, nitro boost, or high-RPM acceleration bursts while enforcing rate limits.
 */
export function resolveExhaustBackfire(
  vehicle: Pick<VehicleSnapshot, 'isBoosting' | 'speedMps' | 'airborneHeight'>,
  accelMps2: number,
  cooldownRemaining: number,
  wasAirborne: boolean,
): ExhaustBackfireDecision | null {
  const airborneHeight =
    vehicle.airborneHeight !== undefined && Number.isFinite(vehicle.airborneHeight)
      ? vehicle.airborneHeight
      : 0;
  const isAirborne = airborneHeight > BACKFIRE_AIRBORNE_THRESHOLD_METERS;

  if (isAirborne && !wasAirborne) {
    return { intensity: 1.45, cooldownSeconds: 0.24 };
  }
  if (cooldownRemaining > 0) {
    return null;
  }
  if (vehicle.isBoosting) {
    return { intensity: 1.25, cooldownSeconds: 0.16 };
  }
  if (isAirborne) {
    return { intensity: 1.1, cooldownSeconds: 0.28 };
  }
  if (
    vehicle.speedMps > BACKFIRE_HIGH_RPM_SPEED_MPS &&
    Number.isFinite(accelMps2) &&
    accelMps2 > BACKFIRE_HIGH_RPM_ACCEL_MPS2
  ) {
    return { intensity: 0.9, cooldownSeconds: 0.28 };
  }
  return null;
}

type CharacterLocomotionState = 'idle' | 'walk' | 'run' | 'dance';

interface RoadblockOfficerEntry {
  readonly group: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
}

interface VehicleSkidState {
  cooldownSeconds: number;
  lastX: number;
  lastZ: number;
  hasLastStamp: boolean;
}

interface PooledPedestrianEntry {
  readonly group: THREE.Group;
  readonly mixer: THREE.AnimationMixer | null;
  readonly actions: RiggedCharacterActions;
  activeActionName: CharacterLocomotionState | null;
  readonly isRigged: boolean;
  readonly variantIndex: number;
  readonly shirtColorHex: number;
  readonly pantsColorHex: number;
  readonly phaseOffsetSeconds: number;
}

function disposeAnimationMixer(mixer: THREE.AnimationMixer | null): void {
  if (!mixer) {
    return;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(mixer.getRoot());
}

/**
 * Disposes a single rigged character clone safely while the shared GLB template stays active:
 * disposes its unique contact shadow tree, per-instance CanvasTexture jerseys, and cloned materials
 * without disposing shared GLB BufferGeometries or Textures still referenced by other characters.
 */
function disposeRiggedCharacterGroup(root: THREE.Group): void {
  const clonedMaterials = new Set<THREE.Material>();
  const ownedCanvasTextures = new Set<THREE.CanvasTexture>();

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    if (node.name === 'contact_shadow') {
      disposeObjectTree(node);
      return;
    }
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (mat) {
        clonedMaterials.add(mat);
        if (
          mat instanceof THREE.MeshStandardMaterial &&
          mat.map instanceof THREE.CanvasTexture
        ) {
          ownedCanvasTextures.add(mat.map);
        }
      }
    }
  });

  for (const texture of ownedCanvasTextures) {
    texture.dispose();
  }
  for (const mat of clonedMaterials) {
    mat.dispose();
  }
}

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'bumpMap',
  'roughnessMap',
  'emissiveMap',
  'alphaMap',
  'normalMap',
  'metalnessMap',
  'aoMap',
  'lightMap',
  'clearcoatRoughnessMap',
] as const;

function collectMaterialTextures(
  material: THREE.Material,
  target: Set<THREE.Texture>,
): void {
  const record = material as unknown as Record<string, unknown>;
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const candidate = record[key];
    if (candidate instanceof THREE.Texture) {
      target.add(candidate);
    }
  }
}

export function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const lights = new Set<THREE.Light>();

  root.traverse((node) => {
    if (
      node instanceof THREE.Mesh ||
      node instanceof THREE.Points ||
      node instanceof THREE.Line
    ) {
      if (node.geometry instanceof THREE.BufferGeometry) {
        geometries.add(node.geometry);
      }
      const matList = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const mat of matList) {
        if (!mat) {
          continue;
        }
        materials.add(mat);
        collectMaterialTextures(mat, textures);
      }
    } else if (node instanceof THREE.Light) {
      lights.add(node);
    }
  });

  for (const light of lights) {
    const shadow = light.shadow;
    if (shadow) {
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
      if (shadow.mapPass) {
        shadow.mapPass.dispose();
        shadow.mapPass = null;
      }
    }
    light.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  for (const geometry of geometries) {
    geometry.dispose();
  }
}

function sampleObjectiveGroundY(
  x: number,
  z: number,
  map: CaliMapConfig,
): number {
  for (const bridge of map.river.bridges) {
    if (
      x >= bridge.minX &&
      x <= bridge.maxX &&
      z >= bridge.minZ &&
      z <= bridge.maxZ
    ) {
      return bridge.deckElevation;
    }
  }
  return getTerrainElevation(x, z);
}

function detectReducedMotion(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class WorldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly map: CaliMapConfig;
  private readonly caliWorld: CaliWorldBuildResult;
  private readonly worldGroup: THREE.Group;
  private readonly skyDome: THREE.Mesh;
  private readonly lightingGroup: THREE.Group;
  private environmentMap: THREE.Texture | null;
  private hdriEnvTexture: THREE.Texture | null = null;
  private loadedAssets: LoadedWorldAssets | null = null;
  private ferrariTemplate: THREE.Group | null = null;
  private characterAsset: LoadedCharacterAsset | null = null;
  private valeriaAsset: LoadedCharacterAsset | null = null;
  private calenoAsset: LoadedCharacterAsset | null = null;
  private garageAppearance: GarageConfig = DEFAULT_GARAGE_CONFIG;
  private readonly postProcessing: PostProcessingRig | null;
  private readonly waterMesh: THREE.Mesh;
  private playerMesh: THREE.Group;
  private playerIsRigged = false;
  private characterMixer: THREE.AnimationMixer | null = null;
  private characterActions: RiggedCharacterActions = {};
  private activeCharacterState: CharacterLocomotionState = 'idle';
  private playerGroundY: number | null = null;
  private mateoMixer: THREE.AnimationMixer | null = null;
  private mateoIsRigged = false;
  private summitDancerGroup: THREE.Group | null = null;
  private summitDancerMixer: THREE.AnimationMixer | null = null;
  private readonly roadblockOfficers: RoadblockOfficerEntry[] = [];
  private readonly objectiveBeacon: THREE.Group;
  private readonly missionProps: Record<MissionPropKey, THREE.Group>;
  private readonly gpsChevrons: readonly THREE.Group[];
  private readonly particles: ParticleSystem;
  private readonly skidMarks: SkidMarkPool;
  private readonly headlightSpot: THREE.SpotLight;
  private readonly headlightTarget: THREE.Object3D;
  private readonly vehiclePool = new Map<string, VehicleRenderEntry>();
  private readonly pedestrianPool = new Map<string, PooledPedestrianEntry>();
  private readonly prevSpeeds = new Map<string, number>();
  private readonly vehicleSkidState = new Map<string, VehicleSkidState>();
  private readonly cameraOrbit: CameraOrbitState = createCameraOrbitState();
  private readonly cristoReyPosition: Vec2;
  private readonly landmarkCount: number;
  private readonly reducedMotion: boolean;

  private currentTimeOfDay: TimeOfDay = 'golden_hour';
  private currentBoostMix = 0;
  private elapsedSeconds = 0;
  private orbitAngle = 0;
  private sparkCooldown = 0;
  private backfireCooldown = 0;
  private wasPlayerAirborne = false;
  private lastBeaconColorHex = -1;
  private worldAssetsLoaded = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, map: CaliMapConfig = CALI_MAP) {
    this.map = map;
    this.reducedMotion = detectReducedMotion();
    this.cristoReyPosition =
      this.map.landmarks.find((landmark) => landmark.id === 'cristo_rey')
        ?.position ?? this.map.missionWaypoints.mission2Summit;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
      if (!renderer.getContext()) {
        renderer.dispose();
        throw new WebGLUnavailableError(
          'WebGL context could not be created for the game canvas.',
        );
      }
    } catch (error) {
      if (error instanceof WebGLUnavailableError) {
        throw error;
      }
      throw new WebGLUnavailableError(
        'Failed to initialize Three.js WebGLRenderer.',
        { cause: error },
      );
    }

    this.renderer = renderer;
    const pixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? Math.min(window.devicePixelRatio, 2)
        : 1;
    this.renderer.setPixelRatio(pixelRatio);
    const initialAtmosphere = resolveAtmosphereConfig('golden_hour', false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = initialAtmosphere.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initialWidth = Math.max(1, canvas.clientWidth || canvas.width || 1280);
    const initialHeight = Math.max(
      1,
      canvas.clientHeight || canvas.height || 720,
    );
    this.renderer.setSize(initialWidth, initialHeight, false);

    this.scene = new THREE.Scene();
    this.scene.backgroundIntensity = initialAtmosphere.backgroundIntensity;
    this.scene.fog = new THREE.FogExp2(
      initialAtmosphere.fogColorHex,
      initialAtmosphere.fogDensity,
    );

    this.environmentMap = createSunsetEnvironmentMap(this.renderer);
    if (this.environmentMap) {
      this.scene.environment = this.environmentMap;
      this.scene.environmentIntensity = initialAtmosphere.environmentIntensity;
    }

    this.camera = new THREE.PerspectiveCamera(
      58,
      initialWidth / initialHeight,
      0.4,
      900,
    );

    this.skyDome = createSunsetSkyDome();
    this.scene.add(this.skyDome);

    this.lightingGroup = createSunsetLighting();
    this.scene.add(this.lightingGroup);

    const builtWorld = buildCaliWorld(this.map);
    this.caliWorld = builtWorld;
    this.worldGroup = builtWorld.group;
    this.waterMesh = builtWorld.waterMesh;
    this.scene.add(this.worldGroup);

    let count = 0;
    for (const landmark of this.map.landmarks) {
      if (builtWorld.group.getObjectByName(`landmark_${landmark.id}`)) {
        count += 1;
      }
    }
    this.landmarkCount = count;

    this.playerMesh = createPlayerMesh();
    this.scene.add(this.playerMesh);

    this.objectiveBeacon = createObjectiveBeacon();
    this.objectiveBeacon.visible = false;
    this.scene.add(this.objectiveBeacon);

    this.missionProps = createMissionPropMeshes();
    for (const propKey of MISSION_PROP_KEYS) {
      const prop = this.missionProps[propKey];
      prop.visible = false;
      this.scene.add(prop);
    }

    this.gpsChevrons = GPS_CHEVRON_DISTANCES.map(() => {
      const chevron = createGpsChevronMesh();
      chevron.visible = false;
      this.scene.add(chevron);
      return chevron;
    });

    this.particles = new ParticleSystem();
    this.scene.add(this.particles.group);

    this.skidMarks = new SkidMarkPool();
    this.scene.add(this.skidMarks.group);

    this.headlightSpot = new THREE.SpotLight(
      0xfff1cc,
      2.6,
      45,
      Math.PI / 5.0,
      0.55,
      1.05,
    );
    this.headlightSpot.name = 'player_vehicle_headlight_spot';
    this.headlightSpot.castShadow = false;
    this.headlightSpot.visible = false;

    this.headlightTarget = new THREE.Object3D();
    this.headlightTarget.name = 'player_vehicle_headlight_target';
    this.headlightSpot.target = this.headlightTarget;
    this.scene.add(this.headlightSpot);
    this.scene.add(this.headlightTarget);

    this.postProcessing = createPostProcessing(
      this.renderer,
      this.scene,
      this.camera,
      initialWidth,
      initialHeight,
      this.reducedMotion,
    );
    if (this.postProcessing) {
      setGradeTimeOfDay(
        this.postProcessing,
        this.currentTimeOfDay,
        this.reducedMotion,
        0,
      );
    }

    // Load local HDRI sky, 1K photographic city PBR textures, Ferrari 458, Valeria, and rigged character
    void this.loadRealWorldAssets();
  }

  public setTimeOfDay(timeOfDay: TimeOfDay): void {
    if (this.disposed || this.currentTimeOfDay === timeOfDay) {
      return;
    }
    this.currentTimeOfDay = timeOfDay;
    const isNight = timeOfDay === 'night';

    setSkyDomeTimeOfDay(this.skyDome, timeOfDay);
    this.applyAtmosphereForTimeOfDay(timeOfDay);

    setLightingTimeOfDay(this.lightingGroup, timeOfDay);
    if (this.postProcessing) {
      setBloomTimeOfDay(this.postProcessing, timeOfDay, this.reducedMotion);
      setGradeTimeOfDay(
        this.postProcessing,
        timeOfDay,
        this.reducedMotion,
        this.currentBoostMix,
      );
    }
    setWorldNightLighting(this.worldGroup, this.waterMesh, timeOfDay);

    this.headlightSpot.intensity = isNight ? 8.8 : 2.6;
    this.headlightSpot.distance = isNight ? 68 : 45;

    for (const entry of this.vehiclePool.values()) {
      this.applyVehicleHeadlightTimeOfDay(entry.group, isNight);
    }
  }

  public setGarageAppearance(garage: GarageConfig): void {
    if (this.disposed) {
      return;
    }
    const appearanceChanged =
      this.garageAppearance.avatar !== garage.avatar ||
      this.garageAppearance.outfit !== garage.outfit;
    this.garageAppearance = { ...garage };
    if (appearanceChanged) {
      this.rebuildPlayerRig();
    }
  }

  private applyAtmosphereForTimeOfDay(timeOfDay: TimeOfDay): void {
    const isNight = timeOfDay === 'night';
    const atmosphere = resolveAtmosphereConfig(
      timeOfDay,
      this.hdriEnvTexture !== null,
    );

    this.skyDome.visible = isNight || !this.hdriEnvTexture;
    this.scene.background = isNight ? null : this.hdriEnvTexture;
    this.scene.backgroundIntensity = atmosphere.backgroundIntensity;
    this.scene.environmentIntensity = atmosphere.environmentIntensity;
    this.scene.fog = new THREE.FogExp2(
      atmosphere.fogColorHex,
      atmosphere.fogDensity,
    );
    this.renderer.toneMappingExposure = atmosphere.toneMappingExposure;
  }

  public applyCameraLook(
    yawDelta: number,
    pitchDelta: number,
    zoomDelta: number,
  ): void {
    if (this.disposed) {
      return;
    }
    applyCameraOrbitInput(this.cameraOrbit, yawDelta, pitchDelta, zoomDelta);
  }

  public sync(
    world: WorldSnapshot,
    mission: MissionSnapshot,
    cameraMode: CameraMode,
    dt: number,
  ): void {
    if (this.disposed) {
      return;
    }

    this.setTimeOfDay(mission.timeOfDay ?? 'golden_hour');

    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0.016;
    this.elapsedSeconds += safeDt;
    this.orbitAngle += safeDt * (cameraMode === 'victory_orbit' ? 0.5 : 0.35);
    this.sparkCooldown = Math.max(0, this.sparkCooldown - safeDt);
    this.backfireCooldown = Math.max(0, this.backfireCooldown - safeDt);

    const targetBoostMix = world.player.isBoosting ? 1 : 0;
    const boostLerpRate =
      targetBoostMix > this.currentBoostMix
        ? BOOST_GRADE_RISE_RATE
        : BOOST_GRADE_FALL_RATE;
    const boostAlpha = 1 - Math.exp(-boostLerpRate * safeDt);
    this.currentBoostMix = THREE.MathUtils.lerp(
      this.currentBoostMix,
      targetBoostMix,
      boostAlpha,
    );
    if (targetBoostMix === 0 && this.currentBoostMix < 0.001) {
      this.currentBoostMix = 0;
    }
    if (this.postProcessing) {
      setGradeTimeOfDay(
        this.postProcessing,
        this.currentTimeOfDay,
        this.reducedMotion,
        this.currentBoostMix,
      );
    }

    const animTime = this.reducedMotion ? 0 : this.elapsedSeconds;
    if (this.skyDome.visible) {
      updateSkyDomeTime(this.skyDome, animTime);
    }
    updateShadowFocus(this.lightingGroup, world.player.x, world.player.z);

    updateTrafficLightPhase(
      this.caliWorld,
      world.trafficLightPhase ?? 'ns_green',
    );
    const roadblockActive = Boolean(world.roadblockActive);
    setRoadblockVisible(
      this.caliWorld,
      roadblockActive,
      this.reducedMotion ? 0 : world.timeSeconds,
    );
    if (roadblockActive && !this.reducedMotion) {
      for (const officer of this.roadblockOfficers) {
        officer.mixer.update(safeDt);
      }
    }

    const activePlayerVehicleId =
      world.player.mode === 'driving' ? world.player.vehicleId : null;

    this.animateWater(safeDt, animTime);
    this.syncPlayer(world, mission, safeDt);
    this.syncVehicles(world.vehicles, activePlayerVehicleId, safeDt);
    this.syncPedestrians(world.pedestrians, world.player.x, world.player.z, safeDt);
    this.syncPlayerHeadlight(world);
    this.syncCollisionSparks(world);
    this.particles.update(safeDt);
    this.skidMarks.update(safeDt);
    this.syncObjectiveBeacon(mission, safeDt);
    this.syncMissionProps(mission, safeDt, world.player.x, world.player.z);
    this.syncGpsChevrons(mission);

    updateCameraRig(
      this.camera,
      world,
      cameraMode,
      safeDt,
      this.orbitAngle,
      this.reducedMotion,
      this.cameraOrbit,
    );
    if (this.skyDome.visible) {
      this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);
    }

    if (this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.postProcessing?.resize(safeWidth, safeHeight);
  }

  public getLandmarkCount(): number {
    return this.landmarkCount;
  }

  public getAssetsLoaded(): boolean {
    return this.worldAssetsLoaded;
  }

  public get assetsLoaded(): boolean {
    return this.worldAssetsLoaded;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    disposeAnimationMixer(this.characterMixer);
    this.characterMixer = null;
    this.characterActions = {};
    if (this.playerIsRigged) {
      this.scene.remove(this.playerMesh);
      disposeRiggedCharacterGroup(this.playerMesh);
      this.playerIsRigged = false;
    }

    disposeAnimationMixer(this.mateoMixer);
    this.mateoMixer = null;
    if (this.mateoIsRigged) {
      const mateoSpeakers = this.missionProps.mateo_speakers;
      const mateoNode = mateoSpeakers.getObjectByName('npc_mateo');
      if (mateoNode) {
        mateoSpeakers.remove(mateoNode);
        if (mateoNode instanceof THREE.Group) {
          disposeRiggedCharacterGroup(mateoNode);
        }
      }
      this.mateoIsRigged = false;
    }

    this.disposeSummitDancer();
    this.disposeRoadblockOfficers();

    for (const entry of this.pedestrianPool.values()) {
      this.disposePedestrianEntry(entry);
    }
    this.pedestrianPool.clear();

    for (const entry of this.vehiclePool.values()) {
      this.scene.remove(entry.group);
      disposeObjectTree(entry.group);
    }
    this.vehiclePool.clear();

    this.scene.remove(this.particles.group);
    this.particles.dispose();

    this.scene.remove(this.skidMarks.group);
    this.skidMarks.dispose();

    this.postProcessing?.dispose();

    this.scene.background = null;
    this.scene.environment = null;
    this.hdriEnvTexture?.dispose();
    this.hdriEnvTexture = null;
    this.environmentMap?.dispose();
    this.environmentMap = null;

    this.loadedAssets?.dispose();
    this.loadedAssets = null;
    this.ferrariTemplate = null;
    this.characterAsset = null;
    this.valeriaAsset = null;
    this.calenoAsset = null;

    disposeObjectTree(this.scene);
    this.prevSpeeds.clear();
    this.vehicleSkidState.clear();
    this.wasPlayerAirborne = false;
    this.renderer.dispose();
  }

  private async loadRealWorldAssets(): Promise<void> {
    try {
      const assets = await loadWorldAssets();

      if (this.disposed) {
        assets.dispose();
        return;
      }

      this.applyLoadedAssets(assets);
    } catch {
      // Fall back cleanly to procedural assets while signaling load completion
    } finally {
      if (!this.disposed) {
        this.worldAssetsLoaded = true;
      }
    }
  }

  private applyLoadedAssets(assets: LoadedWorldAssets): void {
    this.loadedAssets = assets;

    if (assets.hdriTexture) {
      this.applyHdriEnvironment(assets.hdriTexture);
    }

    applyPhotographicAssets(this.worldGroup, assets.textures);
    if (this.currentTimeOfDay === 'night') {
      setWorldNightLighting(this.worldGroup, this.waterMesh, 'night');
    }

    if (assets.ferrari) {
      this.ferrariTemplate = assets.ferrari;
      this.upgradePooledVehiclesToFerrari(assets.ferrari);
    }

    this.characterAsset = assets.character;
    this.valeriaAsset = assets.valeria;
    this.calenoAsset = assets.caleno;

    this.rebuildPlayerRig();

    if (assets.valeria || assets.caleno) {
      this.upgradePooledPedestriansToRigged(
        assets.valeria,
        assets.caleno,
        assets.character,
      );
    }

    if (assets.caleno) {
      this.upgradeMateoToRiggedCharacter(assets.caleno, assets.character);
      this.mountRoadblockOfficers(assets.caleno, assets.character);
    }

    if (assets.valeria) {
      this.mountSummitDancer(assets.valeria, assets.character);
    }
  }

  private applyHdriEnvironment(hdriTexture: THREE.DataTexture): void {
    let pmrem: THREE.PMREMGenerator | null = null;
    try {
      if (!this.renderer.getContext()) {
        return;
      }
      pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const renderTarget = pmrem.fromEquirectangular(hdriTexture);
      const envTex = bindRenderTargetDisposal(renderTarget);

      this.hdriEnvTexture = envTex;
      this.scene.environment = envTex;
      this.scene.backgroundBlurriness = 0.015;
      this.applyAtmosphereForTimeOfDay(this.currentTimeOfDay);

      if (this.environmentMap) {
        this.environmentMap.dispose();
        this.environmentMap = null;
      }
    } catch {
      // Keep procedural sunset sky dome & fallback PMREM environment map
    } finally {
      pmrem?.dispose();
    }
  }

  private applyVehicleHeadlightTimeOfDay(
    vehicleMesh: THREE.Group,
    isNight: boolean,
  ): void {
    const headlightCones = vehicleMesh.userData.headlightCones as
      | THREE.Group
      | undefined;
    const coneMaterials = headlightCones?.userData.coneMaterials as
      | HeadlightConeMaterials
      | undefined;
    if (!coneMaterials) {
      return;
    }
    coneMaterials.outerBeamMat.opacity = isNight ? 0.16 : 0.045;
    coneMaterials.coreBeamMat.opacity = isNight ? 0.28 : 0.08;
    coneMaterials.roadPoolMat.opacity = isNight ? 0.42 : 0.14;
  }

  private upgradePooledVehiclesToFerrari(ferrariTemplate: THREE.Group): void {
    const isNight = this.currentTimeOfDay === 'night';
    for (const [id, entry] of this.vehiclePool.entries()) {
      if (entry.kind !== 'banshee' || entry.usesFerrariModel) {
        continue;
      }
      const ferrariGroup = createFerrariLiveryMesh(
        ferrariTemplate,
        'banshee',
        entry.colorHex,
        entry.neonHex,
      );
      ferrariGroup.position.copy(entry.group.position);
      ferrariGroup.rotation.copy(entry.group.rotation);
      ferrariGroup.visible = entry.group.visible;
      this.applyVehicleHeadlightTimeOfDay(ferrariGroup, isNight);

      this.scene.remove(entry.group);
      disposeObjectTree(entry.group);
      this.scene.add(ferrariGroup);
      this.vehiclePool.set(id, {
        kind: entry.kind,
        colorHex: entry.colorHex,
        accentHex: entry.accentHex,
        neonHex: entry.neonHex,
        usesFerrariModel: true,
        group: ferrariGroup,
      });
    }
  }

  private rebuildPlayerRig(): void {
    let rig: RiggedCharacterRig | null = null;
    if (this.garageAppearance.avatar === 'mateo' && this.calenoAsset) {
      rig = createCalenoCharacterRig(this.calenoAsset, this.characterAsset, {
        outfit: this.garageAppearance.outfit,
        showBeard: true,
        showHeadwear: true,
      });
    } else if (this.garageAppearance.avatar === 'valeria' && this.valeriaAsset) {
      rig = createValeriaPlayerMesh(this.valeriaAsset, this.characterAsset, {
        outfit: this.garageAppearance.outfit,
      });
    }

    if (!rig) {
      return;
    }
    this.upgradePlayerToRiggedRig(rig);
  }

  private upgradePlayerToRiggedRig(rig: RiggedCharacterRig): void {
    rig.group.position.copy(this.playerMesh.position);
    rig.group.rotation.copy(this.playerMesh.rotation);
    rig.group.visible = this.playerMesh.visible;

    const previousMesh = this.playerMesh;
    this.scene.remove(previousMesh);
    if (this.playerIsRigged) {
      disposeRiggedCharacterGroup(previousMesh);
    } else {
      disposeObjectTree(previousMesh);
    }

    disposeAnimationMixer(this.characterMixer);

    this.playerMesh = rig.group;
    this.playerIsRigged = true;
    this.characterMixer = rig.mixer;
    this.characterActions = rig.actions;
    this.activeCharacterState = 'idle';
    this.scene.add(this.playerMesh);
  }

  private createRiggedPedestrianEntry(
    pedId: string,
    variantIndex: number,
    shirtColorHex: number,
    pantsColorHex: number,
    valeriaAsset: LoadedCharacterAsset | null,
    calenoAsset: LoadedCharacterAsset | null,
    characterAsset: LoadedCharacterAsset | null,
  ): PooledPedestrianEntry | null {
    const rig = createCivilianPedestrianRig(
      valeriaAsset,
      calenoAsset,
      characterAsset,
      variantIndex,
      shirtColorHex,
      pantsColorHex,
    );
    if (!rig) {
      return null;
    }

    const seed = hashPedestrianSeed(pedId);
    const phaseOffsetSeconds = (seed % 100) * 0.025;
    if (!this.reducedMotion) {
      rig.mixer.update(phaseOffsetSeconds);
    }

    return {
      group: rig.group,
      mixer: rig.mixer,
      actions: rig.actions,
      activeActionName: rig.actions.idle ? 'idle' : null,
      isRigged: true,
      variantIndex,
      shirtColorHex,
      pantsColorHex,
      phaseOffsetSeconds,
    };
  }

  private disposePedestrianEntry(entry: PooledPedestrianEntry): void {
    disposeAnimationMixer(entry.mixer);
    this.scene.remove(entry.group);
    if (entry.isRigged) {
      disposeRiggedCharacterGroup(entry.group);
    } else {
      disposeObjectTree(entry.group);
    }
  }

  private upgradePooledPedestriansToRigged(
    valeriaAsset: LoadedCharacterAsset | null,
    calenoAsset: LoadedCharacterAsset | null,
    characterAsset: LoadedCharacterAsset | null,
  ): void {
    if (!valeriaAsset && !calenoAsset) {
      return;
    }

    for (const [id, entry] of this.pedestrianPool.entries()) {
      const riggedEntry = this.createRiggedPedestrianEntry(
        id,
        entry.variantIndex,
        entry.shirtColorHex,
        entry.pantsColorHex,
        valeriaAsset,
        calenoAsset,
        characterAsset,
      );
      if (!riggedEntry) {
        continue;
      }

      riggedEntry.group.position.copy(entry.group.position);
      riggedEntry.group.rotation.copy(entry.group.rotation);
      riggedEntry.group.visible = entry.group.visible;

      this.disposePedestrianEntry(entry);
      this.scene.add(riggedEntry.group);
      this.pedestrianPool.set(id, riggedEntry);
    }
  }

  private upgradeMateoToRiggedCharacter(
    calenoAsset: LoadedCharacterAsset,
    characterAsset: LoadedCharacterAsset | null,
  ): void {
    const mateoSpeakers = this.missionProps.mateo_speakers;
    const previousMateo = mateoSpeakers.getObjectByName('npc_mateo');

    const rig = createCalenoCharacterRig(calenoAsset, characterAsset, {
      outfit: 'escarlata',
      showBeard: true,
      showHeadwear: true,
    });
    rig.group.name = 'npc_mateo';
    if (previousMateo) {
      rig.group.position.copy(previousMateo.position);
      rig.group.rotation.copy(previousMateo.rotation);
      mateoSpeakers.remove(previousMateo);
      if (this.mateoIsRigged && previousMateo instanceof THREE.Group) {
        disposeRiggedCharacterGroup(previousMateo);
      } else {
        disposeObjectTree(previousMateo);
      }
    } else {
      rig.group.position.set(-1.15, 0, 0.25);
    }

    disposeAnimationMixer(this.mateoMixer);
    mateoSpeakers.userData.wavingArm = undefined;
    mateoSpeakers.add(rig.group);
    this.mateoMixer = rig.mixer;
    this.mateoIsRigged = true;
  }

  private mountRoadblockOfficers(
    calenoAsset: LoadedCharacterAsset,
    characterAsset: LoadedCharacterAsset | null,
  ): void {
    this.disposeRoadblockOfficers();

    const roadblockGroup = this.caliWorld.roadblockGroup;
    if (!roadblockGroup) {
      return;
    }

    const zones = this.map.roadblockZones ?? ROADBLOCK_ZONES;
    zones.forEach((zone, index) => {
      const rig = createCalenoCharacterRig(calenoAsset, characterAsset, {
        outfit: 'police_uniform',
        showBeard: false,
        showHeadwear: true,
      });
      rig.group.name = `officer_${zone.id}`;

      const zoneNode = roadblockGroup.getObjectByName(`roadblock_${zone.id}`);
      const surfaceY =
        zoneNode?.position.y ??
        sampleObjectiveGroundY(zone.x, zone.z, this.map) + 0.04;

      const span = Math.max(3.6, zone.halfWidth * 0.58);
      const sideOffset = span + 1.45;
      const forwardOffset = 1.25;
      const sideX = Math.cos(zone.heading);
      const sideZ = -Math.sin(zone.heading);
      const fwdX = Math.sin(zone.heading);
      const fwdZ = Math.cos(zone.heading);

      rig.group.position.set(
        zone.x + sideX * sideOffset + fwdX * forwardOffset,
        surfaceY,
        zone.z + sideZ * sideOffset + fwdZ * forwardOffset,
      );
      rig.group.rotation.y = zone.heading + Math.PI - 0.35;

      if (!this.reducedMotion) {
        rig.mixer.update(index * 0.65);
      }

      roadblockGroup.add(rig.group);
      this.roadblockOfficers.push({
        group: rig.group,
        mixer: rig.mixer,
      });
    });
  }

  private disposeRoadblockOfficers(): void {
    for (const officer of this.roadblockOfficers) {
      disposeAnimationMixer(officer.mixer);
      officer.group.parent?.remove(officer.group);
      disposeRiggedCharacterGroup(officer.group);
    }
    this.roadblockOfficers.length = 0;
  }

  private mountSummitDancer(
    valeriaAsset: LoadedCharacterAsset,
    characterAsset: LoadedCharacterAsset | null,
  ): void {
    this.disposeSummitDancer();

    const rig = createValeriaPlayerMesh(valeriaAsset, characterAsset, {
      skinToneHex: SUMMIT_DANCER_SKIN_TONE_HEX,
    });
    rig.group.name = 'npc_summit_dancer';
    rig.group.position.set(1.55, 0, 2.05);
    rig.group.rotation.y = -0.22;

    if (rig.actions.dance) {
      rig.mixer.stopAllAction();
      rig.actions.dance
        .reset()
        .setLoop(THREE.LoopRepeat, Infinity)
        .setEffectiveTimeScale(1)
        .setEffectiveWeight(1)
        .play();
    }

    this.missionProps.summit_stage.add(rig.group);
    this.summitDancerGroup = rig.group;
    this.summitDancerMixer = rig.mixer;
  }

  private disposeSummitDancer(): void {
    disposeAnimationMixer(this.summitDancerMixer);
    this.summitDancerMixer = null;
    if (this.summitDancerGroup) {
      this.summitDancerGroup.parent?.remove(this.summitDancerGroup);
      disposeRiggedCharacterGroup(this.summitDancerGroup);
      this.summitDancerGroup = null;
    }
  }

  private isNearCristoRey(
    x: number,
    z: number,
    maxDistanceSq: number,
  ): boolean {
    const dx = x - this.cristoReyPosition.x;
    const dz = z - this.cristoReyPosition.z;
    return dx * dx + dz * dz <= maxDistanceSq;
  }

  private animateWater(dt: number, animTime: number): void {
    const waterMat = this.waterMesh.material;
    if (waterMat instanceof THREE.ShaderMaterial) {
      const timeUniform = waterMat.uniforms.uTime;
      if (timeUniform) {
        timeUniform.value = animTime;
      }
      return;
    }

    if (waterMat instanceof THREE.MeshStandardMaterial) {
      if (!this.reducedMotion && waterMat.map) {
        waterMat.map.offset.y = (waterMat.map.offset.y + dt * 0.22) % 1;
      }
      waterMat.emissiveIntensity = this.reducedMotion
        ? 0.55
        : 0.48 + Math.sin(this.elapsedSeconds * 2.2) * 0.14;
    }
  }

  private syncPlayer(
    world: WorldSnapshot,
    mission: MissionSnapshot,
    dt: number,
  ): void {
    const { player } = world;
    const isOnFoot = player.mode === 'on_foot';
    this.playerMesh.visible = isOnFoot;
    if (!isOnFoot) {
      this.playerGroundY = null;
      return;
    }

    // Stand on raised sidewalks instead of sinking into them; ease the curb step up/down.
    const groundY = Math.max(player.y, getWalkableGroundHeight(player.x, player.z));
    this.playerGroundY =
      this.playerGroundY === null || Math.abs(groundY - this.playerGroundY) > 1
        ? groundY
        : this.playerGroundY + (groundY - this.playerGroundY) * Math.min(1, dt * 18);
    this.playerMesh.position.set(player.x, this.playerGroundY, player.z);
    this.playerMesh.rotation.y = player.heading;

    const absSpeed = Math.abs(player.speedMps);

    if (this.characterMixer) {
      const shouldDanceAtCristoRey =
        mission.mode === 'victory' &&
        this.characterActions.dance !== undefined &&
        this.isNearCristoRey(
          player.x,
          player.z,
          CRISTO_REY_PLAYER_DANCE_DISTANCE_SQ,
        );
      const gait = resolveLocomotionPlayback(player.speedMps, player.isSprinting);
      const targetState: CharacterLocomotionState = shouldDanceAtCristoRey
        ? 'dance'
        : gait.state;

      if (targetState !== this.activeCharacterState) {
        const prevAction = this.characterActions[this.activeCharacterState];
        const nextAction = this.characterActions[targetState];
        if (nextAction) {
          nextAction
            .reset()
            .setLoop(THREE.LoopRepeat, Infinity)
            .setEffectiveTimeScale(1)
            .setEffectiveWeight(1)
            .play();
          if (prevAction && prevAction !== nextAction) {
            prevAction.crossFadeTo(nextAction, CHARACTER_CROSSFADE_SECONDS, false);
          }
          this.activeCharacterState = targetState;
        } else if (this.activeCharacterState === 'dance' && prevAction) {
          prevAction.fadeOut(CHARACTER_CROSSFADE_SECONDS);
          this.activeCharacterState = targetState;
        }
      }

      // Match stride cadence to the simulated ground speed so feet stay planted (no sliding).
      const activeAction = this.characterActions[this.activeCharacterState];
      if (activeAction && this.activeCharacterState !== 'dance') {
        activeAction.timeScale = gait.timeScale;
      }

      this.characterMixer.update(this.reducedMotion ? 0 : dt);
      return;
    }

    const moving = absSpeed > 0.35;
    const swingRate = player.isSprinting ? 14 : 9;
    const swingAmp = moving && !this.reducedMotion ? 0.55 : 0;
    const swing = Math.sin(this.elapsedSeconds * swingRate) * swingAmp;

    const leftLeg = this.playerMesh.userData.leftLeg as
      | THREE.Object3D
      | undefined;
    const rightLeg = this.playerMesh.userData.rightLeg as
      | THREE.Object3D
      | undefined;
    const leftArm = this.playerMesh.userData.leftArm as
      | THREE.Object3D
      | undefined;
    const rightArm = this.playerMesh.userData.rightArm as
      | THREE.Object3D
      | undefined;

    if (leftLeg) leftLeg.rotation.x = swing;
    if (rightLeg) rightLeg.rotation.x = -swing;
    if (leftArm) leftArm.rotation.x = -swing * 0.7;
    if (rightArm) rightArm.rotation.x = swing * 0.7;
  }

  private syncPlayerHeadlight(world: WorldSnapshot): void {
    const { player, vehicles } = world;
    if (player.mode !== 'driving' || player.vehicleId === null) {
      this.headlightSpot.visible = false;
      return;
    }

    const activeVehicle = vehicles.find((v) => v.id === player.vehicleId);
    if (!activeVehicle) {
      this.headlightSpot.visible = false;
      return;
    }

    const forwardX = Math.sin(activeVehicle.heading);
    const forwardZ = Math.cos(activeVehicle.heading);
    const noseOffset = activeVehicle.halfLength + 0.25;

    const lampX = activeVehicle.x + forwardX * noseOffset;
    const lampY = activeVehicle.y + resolveHeadlightHeight(activeVehicle.kind);
    const lampZ = activeVehicle.z + forwardZ * noseOffset;

    const targetX = activeVehicle.x + forwardX * HEADLIGHT_LOOK_AHEAD_METERS;
    const targetZ = activeVehicle.z + forwardZ * HEADLIGHT_LOOK_AHEAD_METERS;
    const targetY = sampleObjectiveGroundY(targetX, targetZ, this.map) + 0.15;

    this.headlightSpot.position.set(lampX, lampY, lampZ);
    this.headlightTarget.position.set(targetX, targetY, targetZ);
    this.headlightTarget.updateMatrixWorld();
    this.headlightSpot.visible = true;
  }

  private syncCollisionSparks(world: WorldSnapshot): void {
    if (
      this.reducedMotion ||
      world.collisionImpact <= COLLISION_SPARK_THRESHOLD ||
      this.sparkCooldown > 0
    ) {
      return;
    }

    let impactX = world.player.x;
    let impactY = world.player.y;
    let impactZ = world.player.z;

    if (world.player.mode === 'driving' && world.player.vehicleId !== null) {
      const activeVehicle = world.vehicles.find(
        (v) => v.id === world.player.vehicleId,
      );
      if (activeVehicle) {
        impactX = activeVehicle.x;
        impactY = activeVehicle.y;
        impactZ = activeVehicle.z;
      }
    }

    this.particles.emitCollisionSparks(
      impactX,
      impactY,
      impactZ,
      world.collisionImpact,
    );
    this.sparkCooldown = COLLISION_SPARK_COOLDOWN_SECONDS;
  }

  private syncVehicles(
    vehicles: readonly VehicleSnapshot[],
    activePlayerVehicleId: string | null,
    dt: number,
  ): void {
    const activeIds = new Set<string>();
    const hasFerrariTemplate = this.ferrariTemplate !== null;
    let sawPlayerVehicle = false;

    for (const vehicle of vehicles) {
      activeIds.add(vehicle.id);
      let entry = this.vehiclePool.get(vehicle.id);

      const usesFerrariModel = shouldUseFerrariModel(
        vehicle.kind,
        hasFerrariTemplate,
      );
      if (
        !entry ||
        shouldRebuildVehicleMesh(entry, vehicle, hasFerrariTemplate)
      ) {
        const previousRotation = entry ? entry.group.rotation.clone() : null;
        if (entry) {
          this.scene.remove(entry.group);
          disposeObjectTree(entry.group);
        }
        const createdGroup =
          usesFerrariModel && this.ferrariTemplate
            ? createFerrariLiveryMesh(
                this.ferrariTemplate,
                'banshee',
                vehicle.colorHex,
                vehicle.neonHex,
              )
            : createVehicleMesh(
                vehicle.kind,
                vehicle.colorHex,
                vehicle.accentHex,
                vehicle.neonHex,
              );
        if (previousRotation) {
          createdGroup.rotation.copy(previousRotation);
        }
        this.applyVehicleHeadlightTimeOfDay(
          createdGroup,
          this.currentTimeOfDay === 'night',
        );
        this.scene.add(createdGroup);
        entry = {
          kind: vehicle.kind,
          colorHex: vehicle.colorHex,
          accentHex: vehicle.accentHex,
          neonHex: vehicle.neonHex,
          usesFerrariModel,
          group: createdGroup,
        };
        this.vehiclePool.set(vehicle.id, entry);
      }

      const prevSpeed = this.prevSpeeds.get(vehicle.id) ?? vehicle.speedMps;
      const accelMps2 = (vehicle.speedMps - prevSpeed) / Math.max(dt, 0.001);
      const isBrakingOrReversing =
        vehicle.isDrifting ||
        vehicle.speedMps < -0.5 ||
        (prevSpeed > 2.5 && accelMps2 < BRAKE_DECEL_THRESHOLD_MPS2);
      this.prevSpeeds.set(vehicle.id, vehicle.speedMps);

      this.updateVehicleTransform(entry.group, vehicle, dt, isBrakingOrReversing);
      this.emitVehicleParticles(vehicle);
      this.emitVehicleSkidMarks(vehicle, dt);

      if (
        activePlayerVehicleId !== null &&
        vehicle.id === activePlayerVehicleId
      ) {
        sawPlayerVehicle = true;
        const backfire = resolveExhaustBackfire(
          vehicle,
          accelMps2,
          this.backfireCooldown,
          this.wasPlayerAirborne,
        );
        this.wasPlayerAirborne =
          (vehicle.airborneHeight ?? 0) > BACKFIRE_AIRBORNE_THRESHOLD_METERS;
        if (!this.reducedMotion && backfire) {
          this.particles.emitExhaustBackfire(
            vehicle.x,
            vehicle.y,
            vehicle.z,
            vehicle.heading,
            backfire.intensity,
          );
          this.backfireCooldown = backfire.cooldownSeconds;
        }
      }
    }

    if (!sawPlayerVehicle) {
      this.wasPlayerAirborne = false;
    }

    // Remove & dispose vehicles that are no longer present in the snapshot
    for (const [id, entry] of this.vehiclePool.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        disposeObjectTree(entry.group);
        this.vehiclePool.delete(id);
        this.prevSpeeds.delete(id);
        this.vehicleSkidState.delete(id);
      }
    }
  }

  private emitVehicleSkidMarks(vehicle: VehicleSnapshot, dt: number): void {
    let skidState = this.vehicleSkidState.get(vehicle.id);
    if (!skidState) {
      skidState = {
        cooldownSeconds: 0,
        lastX: vehicle.x,
        lastZ: vehicle.z,
        hasLastStamp: false,
      };
      this.vehicleSkidState.set(vehicle.id, skidState);
    }

    skidState.cooldownSeconds = Math.max(0, skidState.cooldownSeconds - dt);

    if (!vehicle.isDrifting || vehicle.speedMps <= SKID_MARK_MIN_SPEED_MPS) {
      skidState.hasLastStamp = false;
      return;
    }

    if (skidState.cooldownSeconds > 0) {
      return;
    }

    const dx = vehicle.x - skidState.lastX;
    const dz = vehicle.z - skidState.lastZ;
    const distSq = dx * dx + dz * dz;
    if (skidState.hasLastStamp && distSq < SKID_MARK_MIN_DISTANCE_SQ) {
      return;
    }

    const segmentLength = skidState.hasLastStamp
      ? THREE.MathUtils.clamp(Math.sqrt(distSq) * 1.15, 0.85, 2.2)
      : 0.95;
    const opacity = THREE.MathUtils.clamp(
      0.42 + (vehicle.speedMps - SKID_MARK_MIN_SPEED_MPS) * 0.015,
      0.42,
      0.68,
    );

    const tires = computeRearTireWorldPositions(vehicle, (tx, tz) =>
      sampleObjectiveGroundY(tx, tz, this.map),
    );
    this.skidMarks.emitPair(
      tires.leftX,
      tires.leftY,
      tires.leftZ,
      tires.rightX,
      tires.rightY,
      tires.rightZ,
      vehicle.heading,
      segmentLength,
      opacity,
    );

    skidState.cooldownSeconds = SKID_MARK_MIN_INTERVAL_SECONDS;
    skidState.lastX = vehicle.x;
    skidState.lastZ = vehicle.z;
    skidState.hasLastStamp = true;
  }

  private emitVehicleParticles(vehicle: VehicleSnapshot): void {
    if (this.reducedMotion) {
      return;
    }

    if (
      vehicle.isDrifting &&
      Math.abs(vehicle.speedMps) > DRIFT_SMOKE_MIN_SPEED_MPS
    ) {
      this.particles.emitDriftSmoke(
        vehicle.x,
        vehicle.y,
        vehicle.z,
        vehicle.heading,
        3,
      );
    }

    if (vehicle.isBoosting) {
      this.particles.emitNitroTrail(
        vehicle.x,
        vehicle.y,
        vehicle.z,
        vehicle.heading,
      );
    }
  }

  private sampleVehicleTerrainSlopeRad(vehicle: VehicleSnapshot): number {
    const forwardX = Math.sin(vehicle.heading);
    const forwardZ = Math.cos(vehicle.heading);
    const sampleSpan = Math.max(1.2, vehicle.halfLength);
    const frontY = sampleObjectiveGroundY(
      vehicle.x + forwardX * sampleSpan,
      vehicle.z + forwardZ * sampleSpan,
      this.map,
    );
    const rearY = sampleObjectiveGroundY(
      vehicle.x - forwardX * sampleSpan,
      vehicle.z - forwardZ * sampleSpan,
      this.map,
    );
    return -Math.atan2(frontY - rearY, sampleSpan * 2);
  }

  private updateVehicleTransform(
    mesh: THREE.Group,
    vehicle: VehicleSnapshot,
    dt: number,
    isBrakingOrReversing: boolean,
  ): void {
    mesh.position.set(vehicle.x, vehicle.y, vehicle.z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = vehicle.heading;

    // Subtle arcade body roll when drifting, terrain-following slope when grounded,
    // and proportional nose-up GTA Stunt Jump pitch when airborne
    const driftRoll = vehicle.isDrifting ? -vehicle.steerAngle * 0.24 : 0;
    const terrainSlopeRad =
      (vehicle.airborneHeight ?? 0) > AIRBORNE_PITCH_THRESHOLD_METERS
        ? 0
        : this.sampleVehicleTerrainSlopeRad(vehicle);
    const targetPitch = computeVehiclePitchRad(
      vehicle.airborneHeight,
      terrainSlopeRad,
      vehicle.isBoosting,
    );
    const rollAlpha = 1 - Math.exp(-14 * dt);
    const pitchAlpha = 1 - Math.exp(-12 * dt);
    mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, driftRoll, rollAlpha);
    mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, targetPitch, pitchAlpha);

    const wheels = mesh.userData.wheels as THREE.Object3D[] | undefined;
    if (wheels) {
      const spinDelta = vehicle.speedMps * dt * 2.4;
      for (const wheel of wheels) {
        const spinSign =
          typeof wheel.userData.spinSign === 'number'
            ? wheel.userData.spinSign
            : 1;
        wheel.rotation.x += spinDelta * spinSign;
      }
    }

    const frontWheels = mesh.userData.frontWheels as
      | THREE.Object3D[]
      | undefined;
    if (frontWheels) {
      for (const frontWheel of frontWheels) {
        frontWheel.rotation.y = vehicle.steerAngle;
      }
    }

    const brakeLightMaterials = mesh.userData.brakeLightMaterials as
      | THREE.MeshStandardMaterial[]
      | undefined;
    if (brakeLightMaterials) {
      const targetIntensity = isBrakingOrReversing
        ? TAILLIGHT_BRAKE_INTENSITY
        : TAILLIGHT_CRUISE_INTENSITY;
      for (const mat of brakeLightMaterials) {
        mat.emissiveIntensity = targetIntensity;
      }
    }

    const nitroFlames = mesh.userData.nitroFlames as THREE.Object3D | undefined;
    if (nitroFlames) {
      nitroFlames.visible = vehicle.isBoosting;
      if (vehicle.isBoosting) {
        const flicker = this.reducedMotion
          ? 1
          : 0.85 + Math.abs(Math.sin(this.elapsedSeconds * 42)) * 0.55;
        nitroFlames.scale.set(1, 1, flicker);
      }
    }

    const redBeacon = mesh.userData.redBeacon as THREE.Mesh | undefined;
    const blueBeacon = mesh.userData.blueBeacon as THREE.Mesh | undefined;
    const sirenLight = mesh.userData.sirenLight as THREE.PointLight | undefined;
    if (redBeacon && blueBeacon) {
      this.updatePoliceBeacons(
        redBeacon,
        blueBeacon,
        sirenLight,
        vehicle.sirenActive,
      );
    }
  }

  private updatePoliceBeacons(
    redBeacon: THREE.Mesh,
    blueBeacon: THREE.Mesh,
    sirenLight: THREE.PointLight | undefined,
    sirenActive: boolean,
  ): void {
    const redMat = redBeacon.material;
    const blueMat = blueBeacon.material;
    if (
      !(redMat instanceof THREE.MeshStandardMaterial) ||
      !(blueMat instanceof THREE.MeshStandardMaterial)
    ) {
      return;
    }

    if (!sirenActive) {
      redMat.emissiveIntensity = 0.2;
      blueMat.emissiveIntensity = 0.2;
      if (sirenLight) {
        sirenLight.intensity = 0;
      }
      return;
    }

    const isNight = this.currentTimeOfDay === 'night';
    if (this.reducedMotion) {
      redMat.emissiveIntensity = isNight ? 1.85 : 1.25;
      blueMat.emissiveIntensity = isNight ? 1.85 : 1.25;
      if (sirenLight) {
        sirenLight.color.setHex(0x5b6cff);
        sirenLight.intensity = isNight ? 12 : 8;
      }
      return;
    }

    const redPhase = Math.floor(this.elapsedSeconds * 10) % 2 === 0;
    const peakEmissive = isNight ? 3.4 : 2.8;
    redMat.emissiveIntensity = redPhase ? peakEmissive : 0.25;
    blueMat.emissiveIntensity = redPhase ? 0.25 : peakEmissive;
    if (sirenLight) {
      sirenLight.color.setHex(redPhase ? 0xff2244 : 0x1a88ff);
      sirenLight.intensity = isNight ? 34 : 22;
    }
  }

  private syncPedestrians(
    pedestrians: readonly PedestrianSnapshot[] | undefined,
    focusX: number,
    focusZ: number,
    dt: number,
  ): void {
    const list = pedestrians ?? [];
    const activeIds = new Set<string>();

    for (let index = 0; index < list.length; index += 1) {
      const ped = list[index];
      if (!ped) {
        continue;
      }
      activeIds.add(ped.id);
      let entry = this.pedestrianPool.get(ped.id);
      if (!entry) {
        const riggedEntry =
          this.valeriaAsset || this.calenoAsset
            ? this.createRiggedPedestrianEntry(
                ped.id,
                index,
                ped.shirtColorHex,
                ped.pantsColorHex,
                this.valeriaAsset,
                this.calenoAsset,
                this.characterAsset,
              )
            : null;
        entry = riggedEntry ?? {
          group: createPedestrianMesh(ped.shirtColorHex, ped.pantsColorHex),
          mixer: null,
          actions: {},
          activeActionName: null,
          isRigged: false,
          variantIndex: index,
          shirtColorHex: ped.shirtColorHex,
          pantsColorHex: ped.pantsColorHex,
          phaseOffsetSeconds: (hashPedestrianSeed(ped.id) % 100) * 0.025,
        };
        this.scene.add(entry.group);
        this.pedestrianPool.set(ped.id, entry);
      }

      entry.group.position.set(ped.x, Math.max(ped.y, getWalkableGroundHeight(ped.x, ped.z)), ped.z);
      entry.group.rotation.y = ped.heading;

      // Distance culling beyond 95m preserves 60fps & smooth SwiftShader frame budgets
      const dx = ped.x - focusX;
      const dz = ped.z - focusZ;
      if (dx * dx + dz * dz > PEDESTRIAN_CULL_DISTANCE_SQ) {
        entry.group.visible = false;
        continue;
      }
      entry.group.visible = true;

      const absSpeed = Math.abs(ped.speedMps);

      if (entry.isRigged && entry.mixer) {
        if (!this.reducedMotion) {
          const targetAction: CharacterLocomotionState =
            absSpeed < 0.2 ? 'idle' : ped.fleeing ? 'run' : 'walk';
          if (targetAction !== entry.activeActionName) {
            const prevAction = entry.activeActionName
              ? entry.actions[entry.activeActionName]
              : undefined;
            const nextAction = entry.actions[targetAction];
            if (nextAction) {
              const clipDuration = nextAction.getClip().duration;
              nextAction.reset();
              if (clipDuration > 0.05) {
                nextAction.time = entry.phaseOffsetSeconds % clipDuration;
              }
              nextAction.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
              if (prevAction && prevAction !== nextAction) {
                prevAction.crossFadeTo(
                  nextAction,
                  PEDESTRIAN_CROSSFADE_SECONDS,
                  false,
                );
              }
              entry.activeActionName = targetAction;
            }
          }
          entry.mixer.update(dt);
        }
        continue;
      }

      const moving = absSpeed > 0.2;
      const phase = hashPedestrianPhase(ped.id);
      const swingRate = ped.fleeing ? 14.5 : 8.5;
      const swingAmp =
        !moving || this.reducedMotion ? 0 : ped.fleeing ? 0.72 : 0.48;
      const swing = Math.sin(this.elapsedSeconds * swingRate + phase) * swingAmp;

      const leftLeg = entry.group.userData.leftLeg as
        | THREE.Object3D
        | undefined;
      const rightLeg = entry.group.userData.rightLeg as
        | THREE.Object3D
        | undefined;
      const leftArm = entry.group.userData.leftArm as
        | THREE.Object3D
        | undefined;
      const rightArm = entry.group.userData.rightArm as
        | THREE.Object3D
        | undefined;

      if (leftLeg) leftLeg.rotation.x = swing;
      if (rightLeg) rightLeg.rotation.x = -swing;
      if (leftArm) {
        leftArm.rotation.x = ped.fleeing ? -0.95 - swing * 0.75 : -swing * 0.65;
      }
      if (rightArm) {
        rightArm.rotation.x = ped.fleeing ? -0.95 + swing * 0.75 : swing * 0.65;
      }
    }

    for (const [id, entry] of this.pedestrianPool.entries()) {
      if (!activeIds.has(id)) {
        this.disposePedestrianEntry(entry);
        this.pedestrianPool.delete(id);
      }
    }
  }

  private syncObjectiveBeacon(mission: MissionSnapshot, dt: number): void {
    const objective = mission.activeObjective;
    if (!objective || !objective.target) {
      this.objectiveBeacon.visible = false;
      return;
    }

    const { target, beaconColorHex, radius } = objective;
    const groundY = sampleObjectiveGroundY(target.x, target.z, this.map);
    this.objectiveBeacon.visible = true;
    this.objectiveBeacon.position.set(target.x, groundY, target.z);

    if (this.lastBeaconColorHex !== beaconColorHex) {
      const mats = this.objectiveBeacon.userData.beamMaterials as
        | (THREE.MeshBasicMaterial | THREE.MeshStandardMaterial)[]
        | undefined;
      if (mats) {
        for (const mat of mats) {
          mat.color.setHex(beaconColorHex);
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.emissive.setHex(beaconColorHex);
          }
        }
      }
      this.lastBeaconColorHex = beaconColorHex;
    }

    const targetRing = this.objectiveBeacon.userData.targetRing as
      | THREE.Object3D
      | undefined;
    const lightBeam = this.objectiveBeacon.userData.lightBeam as
      | THREE.Object3D
      | undefined;
    const floatingArrow = this.objectiveBeacon.userData.floatingArrow as
      | THREE.Object3D
      | undefined;

    const ringScale = THREE.MathUtils.clamp(radius / 5.5, 0.85, 2.8);
    if (targetRing) {
      targetRing.scale.set(ringScale, 1, ringScale);
      if (!this.reducedMotion) {
        targetRing.rotation.y += dt * 1.25;
      }
    }

    if (lightBeam) {
      const pulse = this.reducedMotion
        ? 1
        : 0.9 + Math.sin(this.elapsedSeconds * 3.6) * 0.14;
      lightBeam.scale.set(pulse, 1, pulse);
    }

    if (floatingArrow) {
      const bobOffset = this.reducedMotion
        ? 0
        : Math.sin(this.elapsedSeconds * 2.8) * 0.85;
      floatingArrow.position.y = FLOATING_ARROW_BASE_Y + bobOffset;
      if (!this.reducedMotion) {
        floatingArrow.rotation.y += dt * 1.45;
      }
    }
  }

  private syncMissionProps(
    mission: MissionSnapshot,
    dt: number,
    playerX: number,
    playerZ: number,
  ): void {
    const objective = mission.activeObjective;
    const target = objective?.target ?? null;
    const propKind = objective?.propKind;
    const activeKey: MissionPropKey | null =
      target && propKind && propKind !== 'none' ? propKind : null;
    const isNearCristoRey = this.isNearCristoRey(
      playerX,
      playerZ,
      CRISTO_REY_DANCER_ACTIVE_DISTANCE_SQ,
    );

    for (const key of MISSION_PROP_KEYS) {
      const prop = this.missionProps[key];
      const isSummitStage = key === 'summit_stage';
      const isObjectiveMatch = key === activeKey && target !== null;
      const isVisible = isSummitStage
        ? isObjectiveMatch ||
          mission.mode === 'victory' ||
          (this.summitDancerGroup !== null && isNearCristoRey)
        : isObjectiveMatch;
      prop.visible = isVisible;
      if (!isVisible) {
        continue;
      }

      const propTarget: Vec2 | null = isObjectiveMatch
        ? target
        : isSummitStage
          ? this.map.missionWaypoints.mission2Summit
          : null;
      if (!propTarget) {
        prop.visible = false;
        continue;
      }

      const groundY = sampleObjectiveGroundY(propTarget.x, propTarget.z, this.map);
      prop.position.set(propTarget.x, groundY, propTarget.z);

      if (key === 'vinyl_briefcase') {
        const record = prop.userData.spinningRecord as THREE.Object3D | undefined;
        const baseY =
          typeof prop.userData.recordBaseY === 'number'
            ? prop.userData.recordBaseY
            : 1.95;
        if (record) {
          if (!this.reducedMotion) {
            record.rotation.y += dt * 1.85;
            record.position.y = baseY + Math.sin(this.elapsedSeconds * 2.6) * 0.09;
          } else {
            record.position.y = baseY;
          }
        }
      } else if (key === 'mateo_speakers') {
        if (this.mateoIsRigged && this.mateoMixer) {
          if (!this.reducedMotion) {
            this.mateoMixer.update(dt);
          }
        } else {
          const wavingArm = prop.userData.wavingArm as THREE.Object3D | undefined;
          if (wavingArm) {
            wavingArm.rotation.z = this.reducedMotion
              ? -2.35
              : -2.35 + Math.sin(this.elapsedSeconds * 5.2) * 0.42;
          }
        }
        const wooferCones = prop.userData.wooferCones as
          | THREE.Object3D[]
          | undefined;
        if (wooferCones) {
          const pulseScale = this.reducedMotion
            ? 1
            : 1 + Math.abs(Math.sin(this.elapsedSeconds * 8.4)) * 0.07;
          for (const cone of wooferCones) {
            cone.scale.setScalar(pulseScale);
          }
        }
      } else if (key === 'summit_stage') {
        const eqBars = prop.userData.equalizerBars as THREE.Object3D[] | undefined;
        if (eqBars) {
          eqBars.forEach((bar, idx) => {
            bar.scale.y = this.reducedMotion
              ? 0.72
              : 0.35 + 0.65 * Math.abs(Math.sin(this.elapsedSeconds * 5.5 + idx * 0.85));
          });
        }
        if (this.summitDancerMixer && !this.reducedMotion) {
          this.summitDancerMixer.update(dt);
        }
      }
    }
  }

  private syncGpsChevrons(mission: MissionSnapshot): void {
    const route = mission.activeObjective?.gpsRoute;
    if (!route || route.length < 2) {
      for (const chevron of this.gpsChevrons) {
        chevron.visible = false;
      }
      return;
    }

    for (let i = 0; i < this.gpsChevrons.length; i += 1) {
      const chevron = this.gpsChevrons[i];
      const distance = GPS_CHEVRON_DISTANCES[i];
      if (!chevron || distance === undefined) {
        continue;
      }

      const pose = sampleGpsRoutePose(route, distance);
      if (!pose) {
        chevron.visible = false;
        continue;
      }

      const groundY = sampleObjectiveGroundY(pose.x, pose.z, this.map);
      chevron.position.set(
        pose.x,
        groundY + GPS_CHEVRON_ELEVATION_OFFSET,
        pose.z,
      );
      chevron.rotation.y = pose.heading;
      chevron.visible = true;

      const wave = this.reducedMotion
        ? 0.85
        : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 5.2 - i * 0.95));
      chevron.scale.setScalar(0.92 + wave * 0.16);

      const glowMat = chevron.userData.glowMaterial as
        | THREE.MeshBasicMaterial
        | undefined;
      const accentMat = chevron.userData.accentMaterial as
        | THREE.MeshBasicMaterial
        | undefined;
      if (glowMat) {
        glowMat.opacity = 0.5 + wave * 0.46;
      }
      if (accentMat) {
        accentMat.opacity = 0.45 + wave * 0.5;
      }
    }
  }
}
