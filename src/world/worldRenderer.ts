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
  Vec2,
  VehicleKind,
  VehicleSnapshot,
  WorldSnapshot,
} from '../types/game';
import { loadWorldAssets, type LoadedWorldAssets } from './assetLoader';
import { applyPhotographicAssets, buildCaliWorld } from './caliLandmarks';
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
  updateCameraRig,
  updateShadowFocus,
  updateSkyDomeTime,
  type CameraOrbitState,
  type PostProcessingRig,
} from './sceneSetup';
import {
  createFerrariPlayerMesh,
  createGpsChevronMesh,
  createMissionPropMeshes,
  createObjectiveBeacon,
  createPedestrianMesh,
  createPlayerMesh,
  createRiggedCharacterMesh,
  createVehicleMesh,
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

function hashPedestrianPhase(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) {
    sum += id.charCodeAt(i) * (i + 1);
  }
  return (sum % 628) / 100;
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
  private readonly postProcessing: PostProcessingRig | null;
  private readonly waterMesh: THREE.Mesh;
  private playerMesh: THREE.Group;
  private characterMixer: THREE.AnimationMixer | null = null;
  private characterActions: RiggedCharacterActions = {};
  private activeCharacterState: CharacterLocomotionState = 'idle';
  private readonly objectiveBeacon: THREE.Group;
  private readonly missionProps: Record<MissionPropKey, THREE.Group>;
  private readonly gpsChevrons: readonly THREE.Group[];
  private readonly particles: ParticleSystem;
  private readonly headlightSpot: THREE.SpotLight;
  private readonly headlightTarget: THREE.Object3D;
  private readonly vehiclePool = new Map<string, PooledVehicleEntry>();
  private readonly pedestrianPool = new Map<string, THREE.Group>();
  private readonly prevSpeeds = new Map<string, number>();
  private readonly cameraOrbit: CameraOrbitState = createCameraOrbitState();
  private readonly landmarkCount: number;
  private readonly reducedMotion: boolean;

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
      36,
      60,
      Math.PI / 5.2,
      0.55,
      1.35,
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
    this.syncPedestrians(world.pedestrians);
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

    if (this.characterMixer) {
      this.characterMixer.stopAllAction();
      this.characterMixer.uncacheRoot(this.characterMixer.getRoot());
      this.characterMixer = null;
    }
    this.characterActions = {};

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

      if (assets.ferrari) {
        this.ferrariTemplate = assets.ferrari;
        this.upgradePooledBansheesToFerrari(assets.ferrari);
      }

      if (assets.character) {
        this.upgradePlayerToRiggedCharacter(assets.character);
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
      this.scene.background = envTex;
      this.scene.backgroundBlurriness = 0.015;
      this.scene.environment = envTex;
      this.scene.environmentIntensity = 1.15;
      this.skyDome.visible = false;

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

  private upgradePooledBansheesToFerrari(ferrariTemplate: THREE.Group): void {
    for (const [id, entry] of this.vehiclePool.entries()) {
      if (entry.kind !== 'banshee' || entry.usesFerrariModel) {
        continue;
      }
      const ferrariMesh = createFerrariPlayerMesh(ferrariTemplate);
      ferrariMesh.position.copy(entry.mesh.position);
      ferrariMesh.rotation.copy(entry.mesh.rotation);
      ferrariMesh.visible = entry.mesh.visible;

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
    characterAsset: NonNullable<LoadedWorldAssets['character']>,
  ): void {
    const rig = createRiggedCharacterMesh(characterAsset);
    rig.group.position.copy(this.playerMesh.position);
    rig.group.rotation.copy(this.playerMesh.rotation);
    rig.group.visible = this.playerMesh.visible;

    const previousMesh = this.playerMesh;
    this.scene.remove(previousMesh);
    disposeObjectTree(previousMesh);

    if (this.characterMixer) {
      this.characterMixer.stopAllAction();
      this.characterMixer.uncacheRoot(this.characterMixer.getRoot());
    }

    this.playerMesh = rig.group;
    this.characterMixer = rig.mixer;
    this.characterActions = rig.actions;
    this.activeCharacterState = 'idle';
    this.scene.add(this.playerMesh);
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
        vehicle.kind === 'banshee' && this.ferrariTemplate !== null;
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
          shouldUseFerrari && this.ferrariTemplate
            ? createFerrariPlayerMesh(this.ferrariTemplate)
            : createVehicleMesh(
                vehicle.kind,
                vehicle.colorHex,
                vehicle.accentHex,
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

    if (this.reducedMotion) {
      redMat.emissiveIntensity = 1.25;
      blueMat.emissiveIntensity = 1.25;
      if (sirenLight) {
        sirenLight.color.setHex(0x5b6cff);
        sirenLight.intensity = 8;
      }
      return;
    }

    const redPhase = Math.floor(this.elapsedSeconds * 10) % 2 === 0;
    redMat.emissiveIntensity = redPhase ? 2.8 : 0.25;
    blueMat.emissiveIntensity = redPhase ? 0.25 : 2.8;
    if (sirenLight) {
      sirenLight.color.setHex(redPhase ? 0xff2244 : 0x1a88ff);
      sirenLight.intensity = 24;
    }
  }

  private syncPedestrians(
    pedestrians: readonly PedestrianSnapshot[] | undefined,
  ): void {
    const list = pedestrians ?? [];
    const activeIds = new Set<string>();

    for (const ped of list) {
      activeIds.add(ped.id);
      let mesh = this.pedestrianPool.get(ped.id);
      if (!mesh) {
        mesh = createPedestrianMesh(ped.shirtColorHex, ped.pantsColorHex);
        this.scene.add(mesh);
        this.pedestrianPool.set(ped.id, mesh);
      }

      mesh.position.set(ped.x, ped.y, ped.z);
      mesh.rotation.y = ped.heading;

      const absSpeed = Math.abs(ped.speedMps);
      const moving = absSpeed > 0.2;
      const phase = hashPedestrianPhase(ped.id);
      const swingRate = ped.fleeing ? 14.5 : 8.5;
      const swingAmp = !moving || this.reducedMotion ? 0 : ped.fleeing ? 0.72 : 0.48;
      const swing = Math.sin(this.elapsedSeconds * swingRate + phase) * swingAmp;

      const leftLeg = mesh.userData.leftLeg as THREE.Object3D | undefined;
      const rightLeg = mesh.userData.rightLeg as THREE.Object3D | undefined;
      const leftArm = mesh.userData.leftArm as THREE.Object3D | undefined;
      const rightArm = mesh.userData.rightArm as THREE.Object3D | undefined;

      if (leftLeg) leftLeg.rotation.x = swing;
      if (rightLeg) rightLeg.rotation.x = -swing;
      if (leftArm) {
        leftArm.rotation.x = ped.fleeing ? -0.95 - swing * 0.75 : -swing * 0.65;
      }
      if (rightArm) {
        rightArm.rotation.x = ped.fleeing ? -0.95 + swing * 0.75 : swing * 0.65;
      }
    }

    for (const [id, mesh] of this.pedestrianPool.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        disposeObjectTree(mesh);
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
        const wavingArm = prop.userData.wavingArm as THREE.Object3D | undefined;
        if (wavingArm) {
          wavingArm.rotation.z = this.reducedMotion
            ? -2.35
            : -2.35 + Math.sin(this.elapsedSeconds * 5.2) * 0.42;
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
