/**
 * Pure presentation WebGL renderer for GTA VI: Cali (La Sucursal del Cielo).
 * Consumes immutable WorldSnapshot and MissionSnapshot objects without mutating simulation state.
 */

import * as THREE from 'three';
import {
  CALI_MAP,
  getTerrainElevation,
} from '../config/caliMap';
import type {
  CaliMapConfig,
  CameraMode,
  MissionSnapshot,
  VehicleKind,
  VehicleSnapshot,
  WorldSnapshot,
} from '../types/game';
import { buildCaliWorld } from './caliLandmarks';
import {
  WebGLUnavailableError,
  createSunsetLighting,
  createSunsetSkyDome,
  updateCameraRig,
} from './sceneSetup';
import {
  createObjectiveBeacon,
  createPlayerMesh,
  createVehicleMesh,
} from './vehicleMeshes';

interface PooledVehicleEntry {
  readonly kind: VehicleKind;
  readonly mesh: THREE.Group;
}

function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
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
        if ('map' in mat && mat.map instanceof THREE.Texture) {
          textures.add(mat.map);
        }
      }
    }
  });

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
  private readonly skyDome: THREE.Mesh;
  private readonly waterMesh: THREE.Mesh;
  private readonly playerMesh: THREE.Group;
  private readonly objectiveBeacon: THREE.Group;
  private readonly vehiclePool = new Map<string, PooledVehicleEntry>();
  private readonly landmarkCount: number;
  private readonly reducedMotion: boolean;

  private elapsedSeconds = 0;
  private orbitAngle = 0;
  private lastBeaconColorHex = -1;
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
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initialWidth = Math.max(1, canvas.clientWidth || canvas.width || 1280);
    const initialHeight = Math.max(
      1,
      canvas.clientHeight || canvas.height || 720,
    );
    this.renderer.setSize(initialWidth, initialHeight, false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x281140, 0.0021);

    this.camera = new THREE.PerspectiveCamera(
      60,
      initialWidth / initialHeight,
      0.4,
      900,
    );

    this.skyDome = createSunsetSkyDome();
    this.scene.add(this.skyDome);
    this.scene.add(createSunsetLighting());

    const builtWorld = buildCaliWorld(this.map);
    this.waterMesh = builtWorld.waterMesh;
    this.scene.add(builtWorld.group);

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

    this.animateWater(safeDt);
    this.syncPlayer(world);
    this.syncVehicles(world.vehicles, safeDt);
    this.syncObjectiveBeacon(mission, safeDt);

    updateCameraRig(this.camera, world, cameraMode, safeDt, this.orbitAngle);
    this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);

    this.renderer.render(this.scene, this.camera);
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
  }

  public getLandmarkCount(): number {
    return this.landmarkCount;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    disposeObjectTree(this.scene);
    this.vehiclePool.clear();
    this.renderer.dispose();
  }

  private animateWater(dt: number): void {
    const waterMat = this.waterMesh.material;
    if (!(waterMat instanceof THREE.MeshStandardMaterial)) {
      return;
    }
    if (!this.reducedMotion && waterMat.map) {
      waterMat.map.offset.y = (waterMat.map.offset.y + dt * 0.22) % 1;
    }
    waterMat.emissiveIntensity = this.reducedMotion
      ? 0.55
      : 0.48 + Math.sin(this.elapsedSeconds * 2.2) * 0.14;
  }

  private syncPlayer(world: WorldSnapshot): void {
    const { player } = world;
    const isOnFoot = player.mode === 'on_foot';
    this.playerMesh.visible = isOnFoot;
    if (!isOnFoot) {
      return;
    }

    this.playerMesh.position.set(player.x, player.y, player.z);
    this.playerMesh.rotation.y = player.heading;

    const moving = Math.abs(player.speedMps) > 0.35;
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

  private syncVehicles(
    vehicles: readonly VehicleSnapshot[],
    dt: number,
  ): void {
    const activeIds = new Set<string>();

    for (const vehicle of vehicles) {
      activeIds.add(vehicle.id);
      let entry = this.vehiclePool.get(vehicle.id);

      if (!entry || entry.kind !== vehicle.kind) {
        if (entry) {
          this.scene.remove(entry.mesh);
          disposeObjectTree(entry.mesh);
        }
        const createdMesh = createVehicleMesh(
          vehicle.kind,
          vehicle.colorHex,
          vehicle.accentHex,
        );
        this.scene.add(createdMesh);
        entry = { kind: vehicle.kind, mesh: createdMesh };
        this.vehiclePool.set(vehicle.id, entry);
      }

      this.updateVehicleTransform(entry.mesh, vehicle, dt);
    }

    // Remove & dispose vehicles that are no longer present in the snapshot
    for (const [id, entry] of this.vehiclePool.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.mesh);
        disposeObjectTree(entry.mesh);
        this.vehiclePool.delete(id);
      }
    }
  }

  private updateVehicleTransform(
    mesh: THREE.Group,
    vehicle: VehicleSnapshot,
    dt: number,
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
        wheel.rotation.x += spinDelta;
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
    if (redBeacon && blueBeacon) {
      this.updatePoliceBeacons(redBeacon, blueBeacon, vehicle.sirenActive);
    }
  }

  private updatePoliceBeacons(
    redBeacon: THREE.Mesh,
    blueBeacon: THREE.Mesh,
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
      return;
    }

    if (this.reducedMotion) {
      redMat.emissiveIntensity = 1.1;
      blueMat.emissiveIntensity = 1.1;
      return;
    }

    const redPhase = Math.floor(this.elapsedSeconds * 10) % 2 === 0;
    redMat.emissiveIntensity = redPhase ? 2.4 : 0.25;
    blueMat.emissiveIntensity = redPhase ? 0.25 : 2.4;
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
        | THREE.MeshBasicMaterial[]
        | undefined;
      if (mats) {
        for (const mat of mats) {
          mat.color.setHex(beaconColorHex);
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

    const ringScale = THREE.MathUtils.clamp(radius / 5.5, 0.85, 2.8);
    if (targetRing) {
      targetRing.scale.setScalar(ringScale);
      if (!this.reducedMotion) {
        targetRing.rotation.y += dt * 1.4;
      }
    }

    if (lightBeam) {
      const pulse = this.reducedMotion
        ? 1
        : 0.88 + Math.sin(this.elapsedSeconds * 3.8) * 0.16;
      lightBeam.scale.set(pulse, 1, pulse);
    }
  }
}
