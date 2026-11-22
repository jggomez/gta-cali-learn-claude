/**
 * Pure presentation WebGL renderer for GTA VI: Cali (La Sucursal del Cielo).
 * Consumes immutable WorldSnapshot and MissionSnapshot objects without mutating simulation state.
 * Wires local HDRI golden-hour PMREM reflections & sky, 1K photographic PBR city textures,
 * real Ferrari 458 Italia & rigged animated character GLBs, 2048px player-tracking soft shadows,
 * subtle HDR UnrealBloom post-processing, GTA V free-orbit camera look, dynamic headlights &
 * siren lights, braking taillights, GLSL water/sky fallback, and GPU particles.
 */

import * as THREE from 'three';
import { CALI_MAP, getTerrainElevation } from '../config/caliMap';
import type {
  CaliMapConfig,
  CameraMode,
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
  setWorldNightLighting,
} from './caliLandmarks';
import { ParticleSystem } from './particles';
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
  setLightingTimeOfDay,
  setSkyDomeTimeOfDay,
  updateCameraRig,
  updateShadowFocus,
  updateSkyDomeTime,
  type CameraOrbitState,
  type PostProcessingRig,
} from './sceneSetup';
import {
  createFerrariLiveryMesh,
  createGpsChevronMesh,
  createMissionPropMeshes,
  createObjectiveBeacon,
  createPedestrianMesh,
  createPlayerMesh,
  createRiggedCharacterMesh,
  createVehicleMesh,
  type FerrariLiveryKind,
  type HeadlightConeMaterials,
  type MissionPropKey,
  type RiggedCharacterActions,
} from './vehicleMeshes';

const HEADLIGHT_LOOK_AHEAD_METERS = 45;
const TAILLIGHT_CRUISE_INTENSITY = 1.15;
const TAILLIGHT_BRAKE_INTENSITY = 2.8;
const BRAKE_DECEL_THRESHOLD_MPS2 = -3.2;
const DRIFT_SMOKE_MIN_SPEED_MPS = 4.5;
const COLLISION_SPARK_THRESHOLD = 0.14;
const COLLISION_SPARK_COOLDOWN_SECONDS = 0.09;
const CHARACTER_RUN_SPEED_THRESHOLD_MPS = 5.2;
const CHARACTER_CROSSFADE_SECONDS = 0.22;
const PEDESTRIAN_CULL_DISTANCE_METERS = 95;
const PEDESTRIAN_CULL_DISTANCE_SQ =
  PEDESTRIAN_CULL_DISTANCE_METERS * PEDESTRIAN_CULL_DISTANCE_METERS;
const PEDESTRIAN_CROSSFADE_SECONDS = 0.2;
const FLOATING_ARROW_BASE_Y = 8.0;
const GPS_CHEVRON_DISTANCES = [10, 22, 34, 46, 58] as const;
const GPS_CHEVRON_ELEVATION_OFFSET = 0.35;
const MISSION_PROP_KEYS: readonly MissionPropKey[] = [
  'vinyl_briefcase',
  'mateo_speakers',
  'summit_stage',
];

export interface GpsRoutePose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
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

function isFerrariLiveryKind(kind: VehicleKind): kind is FerrariLiveryKind {
  return kind === 'banshee' || kind === 'police' || kind === 'taxi';
}

function getHeadlightMountHeight(kind: VehicleKind): number {
  switch (kind) {
    case 'mio_bus':
    case 'chiva':
      return 1.25;
    case 'banshee':
      return 0.88;
    case 'taxi':
    case 'police':
      return 1.02;
  }
}

type CharacterLocomotionState = 'idle' | 'walk' | 'run';

interface PooledVehicleEntry {
  readonly kind: VehicleKind;
  readonly usesFerrariModel: boolean;
  readonly mesh: THREE.Group;
}

interface PooledPedestrianEntry {
  readonly group: THREE.Group;
  readonly mixer: THREE.AnimationMixer | null;
  readonly actions: RiggedCharacterActions;
  activeActionName: CharacterLocomotionState | null;
  readonly isRigged: boolean;
  readonly shirtColorHex: number;
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
 * disposes its unique contact shadow tree and cloned materials without disposing shared GLB
 * BufferGeometries or Textures still referenced by other active characters.
 */
function disposeRiggedCharacterGroup(root: THREE.Group): void {
  const clonedMaterials = new Set<THREE.Material>();

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
      }
    }
  });

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
  private readonly worldGroup: THREE.Group;
  private readonly skyDome: THREE.Mesh;
  private readonly lightingGroup: THREE.Group;
  private environmentMap: THREE.Texture | null;
  private hdriEnvTexture: THREE.Texture | null = null;
  private loadedAssets: LoadedWorldAssets | null = null;
  private ferrariTemplate: THREE.Group | null = null;
  private characterAsset: LoadedCharacterAsset | null = null;
  private readonly postProcessing: PostProcessingRig | null;
  private readonly waterMesh: THREE.Mesh;
  private playerMesh: THREE.Group;
  private characterMixer: THREE.AnimationMixer | null = null;
  private characterActions: RiggedCharacterActions = {};
  private activeCharacterState: CharacterLocomotionState = 'idle';
  private mateoMixer: THREE.AnimationMixer | null = null;
  private mateoIsRigged = false;
  private readonly objectiveBeacon: THREE.Group;
  private readonly missionProps: Record<MissionPropKey, THREE.Group>;
  private readonly gpsChevrons: readonly THREE.Group[];
  private readonly particles: ParticleSystem;
  private readonly headlightSpot: THREE.SpotLight;
  private readonly headlightTarget: THREE.Object3D;
  private readonly vehiclePool = new Map<string, PooledVehicleEntry>();
  private readonly pedestrianPool = new Map<string, PooledPedestrianEntry>();
  private readonly prevSpeeds = new Map<string, number>();
  private readonly cameraOrbit: CameraOrbitState = createCameraOrbitState();
  private readonly landmarkCount: number;
  private readonly reducedMotion: boolean;

  private currentTimeOfDay: TimeOfDay = 'golden_hour';
  private elapsedSeconds = 0;
  private orbitAngle = 0;
  private sparkCooldown = 0;
  private lastBeaconColorHex = -1;
  private worldAssetsLoaded = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, map: CaliMapConfig = CALI_MAP) {
    this.map = map;
    this.reducedMotion = detectReducedMotion();

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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initialWidth = Math.max(1, canvas.clientWidth || canvas.width || 1280);
    const initialHeight = Math.max(
      1,
      canvas.clientHeight || canvas.height || 720,
    );
    this.renderer.setSize(initialWidth, initialHeight, false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc49576, 0.00145);

    this.environmentMap = createSunsetEnvironmentMap(this.renderer);
    if (this.environmentMap) {
      this.scene.environment = this.environmentMap;
      this.scene.environmentIntensity = 0.85;
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

    // Load local HDRI sky, 1K photographic city PBR textures, Ferrari 458, and rigged character
    void this.loadRealWorldAssets();
  }

  public setTimeOfDay(timeOfDay: TimeOfDay): void {
    if (this.disposed || this.currentTimeOfDay === timeOfDay) {
      return;
    }
    this.currentTimeOfDay = timeOfDay;
    const isNight = timeOfDay === 'night';

    setSkyDomeTimeOfDay(this.skyDome, timeOfDay);
    this.skyDome.visible = isNight || !this.hdriEnvTexture;
    this.scene.background = isNight ? null : this.hdriEnvTexture;
    this.scene.environmentIntensity = isNight
      ? 0.24
      : this.hdriEnvTexture
        ? 1.15
        : 0.85;
    this.scene.fog = isNight
      ? new THREE.FogExp2(0x090d1f, 0.0023)
      : new THREE.FogExp2(0xc49576, 0.00145);
    this.renderer.toneMappingExposure = isNight ? 1.12 : 1.06;

    setLightingTimeOfDay(this.lightingGroup, timeOfDay);
    if (this.postProcessing) {
      setBloomTimeOfDay(this.postProcessing, timeOfDay, this.reducedMotion);
    }
    setWorldNightLighting(this.worldGroup, this.waterMesh, timeOfDay);

    this.headlightSpot.intensity = isNight ? 8.8 : 2.6;
    this.headlightSpot.distance = isNight ? 68 : 45;

    for (const entry of this.vehiclePool.values()) {
      this.applyVehicleHeadlightTimeOfDay(entry.mesh, isNight);
    }
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

    const animTime = this.reducedMotion ? 0 : this.elapsedSeconds;
    if (this.skyDome.visible) {
      updateSkyDomeTime(this.skyDome, animTime);
    }
    updateShadowFocus(this.lightingGroup, world.player.x, world.player.z);

    this.animateWater(safeDt, animTime);
    this.syncPlayer(world, safeDt);
    this.syncVehicles(world.vehicles, safeDt);
    this.syncPedestrians(world.pedestrians, world.player.x, world.player.z, safeDt);
    this.syncPlayerHeadlight(world);
    this.syncCollisionSparks(world);
    this.particles.update(safeDt);
    this.syncObjectiveBeacon(mission, safeDt);
    this.syncMissionProps(mission, safeDt);
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

    disposeAnimationMixer(this.mateoMixer);
    this.mateoMixer = null;
    this.mateoIsRigged = false;

    for (const entry of this.pedestrianPool.values()) {
      disposeAnimationMixer(entry.mixer);
    }

    this.scene.remove(this.particles.group);
    this.particles.dispose();

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

    disposeObjectTree(this.scene);
    this.vehiclePool.clear();
    this.pedestrianPool.clear();
    this.prevSpeeds.clear();
    this.renderer.dispose();
  }

  private async loadRealWorldAssets(): Promise<void> {
    try {
      const assets = await loadWorldAssets();

      if (this.disposed) {
        assets.dispose();
        return;
      }

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

      if (assets.character) {
        this.characterAsset = assets.character;
        this.upgradePlayerToRiggedCharacter(assets.character);
        this.upgradePooledPedestriansToRigged(assets.character);
        this.upgradeMateoToRiggedCharacter(assets.character);
      }
    } catch {
      // Fall back cleanly to procedural assets while signaling load completion
    } finally {
      if (!this.disposed) {
        this.worldAssetsLoaded = true;
      }
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
      const isNight = this.currentTimeOfDay === 'night';
      this.scene.background = isNight ? null : envTex;
      this.scene.environmentIntensity = isNight ? 0.24 : 1.15;
      this.skyDome.visible = isNight;

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
      if (!isFerrariLiveryKind(entry.kind) || entry.usesFerrariModel) {
        continue;
      }
      const ferrariMesh = createFerrariLiveryMesh(ferrariTemplate, entry.kind);
      ferrariMesh.position.copy(entry.mesh.position);
      ferrariMesh.rotation.copy(entry.mesh.rotation);
      ferrariMesh.visible = entry.mesh.visible;
      this.applyVehicleHeadlightTimeOfDay(ferrariMesh, isNight);

      this.scene.remove(entry.mesh);
      disposeObjectTree(entry.mesh);
      this.scene.add(ferrariMesh);
      this.vehiclePool.set(id, {
        kind: entry.kind,
        usesFerrariModel: true,
        mesh: ferrariMesh,
      });
    }
  }

  private upgradePlayerToRiggedCharacter(
    characterAsset: LoadedCharacterAsset,
  ): void {
    const rig = createRiggedCharacterMesh(characterAsset);
    rig.group.position.copy(this.playerMesh.position);
    rig.group.rotation.copy(this.playerMesh.rotation);
    rig.group.visible = this.playerMesh.visible;

    const previousMesh = this.playerMesh;
    this.scene.remove(previousMesh);
    disposeObjectTree(previousMesh);

    disposeAnimationMixer(this.characterMixer);

    this.playerMesh = rig.group;
    this.characterMixer = rig.mixer;
    this.characterActions = rig.actions;
    this.activeCharacterState = 'idle';
    this.scene.add(this.playerMesh);
  }

  private createRiggedPedestrianEntry(
    pedId: string,
    shirtColorHex: number,
    characterAsset: LoadedCharacterAsset,
  ): PooledPedestrianEntry {
    const seed = hashPedestrianSeed(pedId);
    const heightMeters = 1.72 + (seed % 14) * 0.01;
    const phaseOffsetSeconds = (seed % 100) * 0.025;

    const rig = createRiggedCharacterMesh(characterAsset, {
      tintHex: shirtColorHex,
      heightMeters,
    });
    rig.group.name = 'cali_pedestrian_rigged';
    if (!this.reducedMotion) {
      rig.mixer.update(phaseOffsetSeconds);
    }

    return {
      group: rig.group,
      mixer: rig.mixer,
      actions: rig.actions,
      activeActionName: 'idle',
      isRigged: true,
      shirtColorHex,
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
    characterAsset: LoadedCharacterAsset,
  ): void {
    for (const [id, entry] of this.pedestrianPool.entries()) {
      if (entry.isRigged) {
        continue;
      }
      const riggedEntry = this.createRiggedPedestrianEntry(
        id,
        entry.shirtColorHex,
        characterAsset,
      );
      riggedEntry.group.position.copy(entry.group.position);
      riggedEntry.group.rotation.copy(entry.group.rotation);
      riggedEntry.group.visible = entry.group.visible;

      this.disposePedestrianEntry(entry);
      this.scene.add(riggedEntry.group);
      this.pedestrianPool.set(id, riggedEntry);
    }
  }

  private upgradeMateoToRiggedCharacter(
    characterAsset: LoadedCharacterAsset,
  ): void {
    const mateoSpeakers = this.missionProps.mateo_speakers;
    const previousMateo = mateoSpeakers.getObjectByName('npc_mateo');

    const rig = createRiggedCharacterMesh(characterAsset, {
      tintHex: 0xffb800,
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

  private syncPlayer(world: WorldSnapshot, dt: number): void {
    const { player } = world;
    const isOnFoot = player.mode === 'on_foot';
    this.playerMesh.visible = isOnFoot;
    if (!isOnFoot) {
      return;
    }

    this.playerMesh.position.set(player.x, player.y, player.z);
    this.playerMesh.rotation.y = player.heading;

    const absSpeed = Math.abs(player.speedMps);

    if (this.characterMixer) {
      const targetState: CharacterLocomotionState =
        absSpeed <= 0.35
          ? 'idle'
          : player.isSprinting || absSpeed > CHARACTER_RUN_SPEED_THRESHOLD_MPS
            ? 'run'
            : 'walk';

      if (targetState !== this.activeCharacterState) {
        const prevAction = this.characterActions[this.activeCharacterState];
        const nextAction = this.characterActions[targetState];
        if (nextAction) {
          nextAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
          if (prevAction && prevAction !== nextAction) {
            prevAction.crossFadeTo(nextAction, CHARACTER_CROSSFADE_SECONDS, false);
          }
        }
        this.activeCharacterState = targetState;
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
    const lampY = activeVehicle.y + getHeadlightMountHeight(activeVehicle.kind);
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
    dt: number,
  ): void {
    const activeIds = new Set<string>();

    for (const vehicle of vehicles) {
      activeIds.add(vehicle.id);
      let entry = this.vehiclePool.get(vehicle.id);

      const shouldUseFerrari =
        isFerrariLiveryKind(vehicle.kind) && this.ferrariTemplate !== null;
      if (
        !entry ||
        entry.kind !== vehicle.kind ||
        entry.usesFerrariModel !== shouldUseFerrari
      ) {
        if (entry) {
          this.scene.remove(entry.mesh);
          disposeObjectTree(entry.mesh);
        }
        const createdMesh =
          shouldUseFerrari &&
          this.ferrariTemplate &&
          isFerrariLiveryKind(vehicle.kind)
            ? createFerrariLiveryMesh(this.ferrariTemplate, vehicle.kind)
            : createVehicleMesh(
                vehicle.kind,
                vehicle.colorHex,
                vehicle.accentHex,
              );
        this.applyVehicleHeadlightTimeOfDay(
          createdMesh,
          this.currentTimeOfDay === 'night',
        );
        this.scene.add(createdMesh);
        entry = {
          kind: vehicle.kind,
          usesFerrariModel: shouldUseFerrari,
          mesh: createdMesh,
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

      this.updateVehicleTransform(entry.mesh, vehicle, dt, isBrakingOrReversing);
      this.emitVehicleParticles(vehicle);
    }

    // Remove & dispose vehicles that are no longer present in the snapshot
    for (const [id, entry] of this.vehiclePool.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.mesh);
        disposeObjectTree(entry.mesh);
        this.vehiclePool.delete(id);
        this.prevSpeeds.delete(id);
      }
    }
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

  private updateVehicleTransform(
    mesh: THREE.Group,
    vehicle: VehicleSnapshot,
    dt: number,
    isBrakingOrReversing: boolean,
  ): void {
    mesh.position.set(vehicle.x, vehicle.y, vehicle.z);
    mesh.rotation.y = vehicle.heading;

    // Subtle arcade body roll when drifting / steering and squat on nitro boost
    const driftRoll = vehicle.isDrifting ? -vehicle.steerAngle * 0.24 : 0;
    const boostPitch = vehicle.isBoosting ? -0.035 : 0;
    mesh.rotation.z = THREE.MathUtils.lerp(mesh.rotation.z, driftRoll, 0.22);
    mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, boostPitch, 0.2);

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

    for (const ped of list) {
      activeIds.add(ped.id);
      let entry = this.pedestrianPool.get(ped.id);
      if (!entry) {
        entry = this.characterAsset
          ? this.createRiggedPedestrianEntry(
              ped.id,
              ped.shirtColorHex,
              this.characterAsset,
            )
          : {
              group: createPedestrianMesh(ped.shirtColorHex, ped.pantsColorHex),
              mixer: null,
              actions: {},
              activeActionName: null,
              isRigged: false,
              shirtColorHex: ped.shirtColorHex,
              phaseOffsetSeconds: (hashPedestrianSeed(ped.id) % 100) * 0.025,
            };
        this.scene.add(entry.group);
        this.pedestrianPool.set(ped.id, entry);
      }

      entry.group.position.set(ped.x, ped.y, ped.z);
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
            }
            entry.activeActionName = targetAction;
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

  private syncMissionProps(mission: MissionSnapshot, dt: number): void {
    const objective = mission.activeObjective;
    const target = objective?.target ?? null;
    const propKind = objective?.propKind;
    const activeKey: MissionPropKey | null =
      target && propKind && propKind !== 'none' ? propKind : null;

    for (const key of MISSION_PROP_KEYS) {
      const prop = this.missionProps[key];
      const isVisible = key === activeKey && target !== null;
      prop.visible = isVisible;
      if (!isVisible || !target) {
        continue;
      }

      const groundY = sampleObjectiveGroundY(target.x, target.z, this.map);
      prop.position.set(target.x, groundY, target.z);

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
