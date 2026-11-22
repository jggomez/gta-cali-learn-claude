import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CALI_MAP, getTerrainElevation } from '../../../src/config/caliMap';
import type {
  CameraMode,
  VehicleKind,
  WorldSnapshot,
} from '../../../src/types/game';
import {
  applyPhotographicAssets,
  buildCaliWorld,
  setWorldNightLighting,
} from '../../../src/world/caliLandmarks';
import type {
  LoadedCharacterAsset,
  LoadedWorldTextureSets,
  PhotoPbrMaterialMaps,
} from '../../../src/world/assetLoader';
import {
  WebGLUnavailableError,
  applyCameraOrbitInput,
  createCameraOrbitState,
  createSunsetLighting,
  createSunsetSkyDome,
  setBloomTimeOfDay,
  setLightingTimeOfDay,
  setSkyDomeTimeOfDay,
  updateCameraRig,
  updateShadowFocus,
  updateSkyDomeTime,
  type PostProcessingRig,
} from '../../../src/world/sceneSetup';
import {
  createFerrariLiveryMesh,
  createFerrariPlayerMesh,
  createGpsChevronMesh,
  createMissionPropMeshes,
  createObjectiveBeacon,
  createPedestrianMesh,
  createPlayerMesh,
  createRiggedCharacterMesh,
  createVehicleMesh,
} from '../../../src/world/vehicleMeshes';
import {
  WorldRenderer,
  disposeObjectTree,
  sampleGpsRoutePose,
} from '../../../src/world/worldRenderer';

function countGeometryVertices(root: THREE.Object3D): number {
  let vertices = 0;
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const position = node.geometry.getAttribute('position');
      if (position) {
        vertices += position.count;
      }
    }
  });
  return vertices;
}

function createSampleWorld(overrides?: Partial<WorldSnapshot>): WorldSnapshot {
  return {
    timeSeconds: 12.5,
    player: {
      mode: 'driving',
      x: -4,
      y: 0,
      z: 12,
      heading: Math.PI / 2,
      speedMps: 22,
      speedKmh: 79.2,
      vehicleId: 'player_banshee',
      nearbyVehicleId: null,
      canEnterVehicle: false,
      nitro: 0.75,
      isDrifting: false,
      isBoosting: true,
      isSprinting: false,
      inRiverHazard: false,
    },
    vehicles: [
      {
        id: 'player_banshee',
        kind: 'banshee',
        role: 'player',
        x: -4,
        y: 0,
        z: 12,
        heading: Math.PI / 2,
        speedMps: 22,
        speedKmh: 79.2,
        steerAngle: 0.12,
        isDrifting: false,
        isBoosting: true,
        nitro: 0.75,
        sirenActive: false,
        colorHex: 0xff2e93,
        accentHex: 0x00f0ff,
        halfWidth: 1.05,
        halfLength: 2.25,
      },
    ],
    wantedStars: 1,
    bustProgress: 0,
    isBusted: false,
    driftScore: 420,
    topSpeedKmh: 120,
    currentDistrict: 'Bulevar del Río',
    collisionImpact: 0,
    ...overrides,
  };
}

describe('buildCaliWorld', () => {
  const { group, waterMesh } = buildCaliWorld(CALI_MAP);

  it('returns a world group and a Río Cali water mesh with non-empty geometry', () => {
    expect(group).toBeInstanceOf(THREE.Group);
    expect(waterMesh).toBeInstanceOf(THREE.Mesh);
    expect(countGeometryVertices(waterMesh)).toBeGreaterThan(0);
    expect(countGeometryVertices(group)).toBeGreaterThan(500);
  });

  it('creates all 6 named Cali landmark groups with non-empty geometry', () => {
    const expectedLandmarkNames = [
      'landmark_san_antonio',
      'landmark_torre_de_cali',
      'landmark_bulevar_del_rio',
      'landmark_la_ermita',
      'landmark_estadio_pascual',
      'landmark_cristo_rey',
    ] as const;

    for (const landmarkName of expectedLandmarkNames) {
      const landmarkNode = group.getObjectByName(landmarkName);
      expect(landmarkNode, `missing ${landmarkName}`).toBeInstanceOf(
        THREE.Group,
      );
      expect(
        countGeometryVertices(landmarkNode as THREE.Object3D),
        `empty geometry in ${landmarkName}`,
      ).toBeGreaterThan(0);
    }
  });

  it('positions each landmark group at its CALI_MAP coordinates and elevation', () => {
    for (const landmark of CALI_MAP.landmarks) {
      const node = group.getObjectByName(`landmark_${landmark.id}`);
      expect(node).toBeDefined();
      expect(node?.position.x).toBeCloseTo(landmark.position.x, 3);
      expect(node?.position.y).toBeCloseTo(landmark.elevation, 3);
      expect(node?.position.z).toBeCloseTo(landmark.position.z, 3);
    }
  });

  it('builds terrain, bridges, roads, buildings, and palm trees cleanly', () => {
    const terrain = group.getObjectByName('cali_terrain');
    const bridges = group.getObjectByName('cali_bridges');
    const roads = group.getObjectByName('cali_roads');
    const buildings = group.getObjectByName('cali_buildings');
    const palms = group.getObjectByName('cali_palms');

    expect(terrain).toBeInstanceOf(THREE.Mesh);
    expect(countGeometryVertices(terrain as THREE.Object3D)).toBeGreaterThan(
      100,
    );
    expect(bridges).toBeInstanceOf(THREE.Group);
    expect(bridges?.children.length).toBeGreaterThanOrEqual(
      CALI_MAP.river.bridges.length,
    );
    expect(roads).toBeInstanceOf(THREE.Group);
    expect(roads?.children.length).toBeGreaterThanOrEqual(
      CALI_MAP.roads.length,
    );
    expect(buildings).toBeInstanceOf(THREE.Group);
    expect(buildings?.children.length).toBe(CALI_MAP.buildingColliders.length);
    expect(palms).toBeInstanceOf(THREE.Group);
    expect(palms?.children.length).toBeGreaterThan(10);
  });

  it('orients terrain-conforming road ribbon normals upward for visible top surfaces', () => {
    const roads = group.getObjectByName('cali_roads');
    expect(roads).toBeInstanceOf(THREE.Group);
    let checkedNormals = 0;
    roads?.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const normals = node.geometry.getAttribute('normal');
        if (normals) {
          for (let i = 0; i < normals.count; i += 1) {
            expect(normals.getY(i)).toBeGreaterThan(0.5);
            checkedNormals += 1;
          }
        }
      }
    });
    expect(checkedNormals).toBeGreaterThan(100);
  });

  it('uses an animated GLSL ShaderMaterial with uTime on waterMesh and builds cinematic city props with PBR shadow-casting buildings', () => {
    expect(waterMesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    const waterMat = waterMesh.material as THREE.ShaderMaterial;
    expect(waterMat.uniforms.uTime).toBeDefined();
    expect(typeof waterMat.uniforms.uTime?.value).toBe('number');

    const crosswalks = group.getObjectByName('cali_crosswalks');
    const sidewalks = group.getObjectByName('cali_sidewalks');
    const neonSigns = group.getObjectByName('cali_neon_signs');
    const trafficSignals = group.getObjectByName('cali_traffic_signals');
    const streetlights = group.getObjectByName('cali_streetlights');

    expect(crosswalks).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(crosswalks as THREE.Object3D)).toBeGreaterThan(0);
    expect(sidewalks).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(sidewalks as THREE.Object3D)).toBeGreaterThan(0);
    expect(neonSigns).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(neonSigns as THREE.Object3D)).toBeGreaterThan(0);
    expect(trafficSignals).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(trafficSignals as THREE.Object3D)).toBeGreaterThan(0);
    expect(streetlights).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(streetlights as THREE.Object3D)).toBeGreaterThan(0);

    const buildings = group.getObjectByName('cali_buildings');
    expect(buildings).toBeInstanceOf(THREE.Group);
    let shadowCastingBuildings = 0;
    let pbrFacadeMaterials = 0;
    buildings?.traverse((node) => {
      if (node instanceof THREE.Mesh && node.castShadow) {
        shadowCastingBuildings += 1;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (
            mat instanceof THREE.MeshStandardMaterial &&
            mat.map &&
            mat.roughnessMap &&
            mat.bumpMap &&
            mat.emissiveMap
          ) {
            pbrFacadeMaterials += 1;
            break;
          }
        }
      }
    });
    expect(shadowCastingBuildings).toBeGreaterThanOrEqual(
      CALI_MAP.buildingColliders.length,
    );
    expect(pbrFacadeMaterials).toBeGreaterThanOrEqual(
      CALI_MAP.buildingColliders.length,
    );
  });
});

describe('vehicle, player, and objective meshes', () => {
  it('constructs distinct meshes for all 5 VehicleKind values with special rigs', () => {
    const kinds: readonly VehicleKind[] = [
      'banshee',
      'taxi',
      'mio_bus',
      'chiva',
      'police',
    ];
    const vertexCounts = new Map<VehicleKind, number>();
    const lengths = new Map<VehicleKind, number>();

    for (const kind of kinds) {
      const vehicle = createVehicleMesh(kind, 0xff2e93, 0x00f0ff);
      expect(vehicle).toBeInstanceOf(THREE.Group);
      expect(vehicle.name).toContain(kind);
      const verts = countGeometryVertices(vehicle);
      expect(verts).toBeGreaterThan(0);
      vertexCounts.set(kind, verts);

      const box = new THREE.Box3().setFromObject(vehicle);
      lengths.set(kind, box.max.z - box.min.z);

      if (kind === 'banshee') {
        expect(vehicle.userData.nitroFlames).toBeInstanceOf(THREE.Object3D);
      }
      if (kind === 'police') {
        expect(vehicle.userData.redBeacon).toBeInstanceOf(THREE.Object3D);
        expect(vehicle.userData.blueBeacon).toBeInstanceOf(THREE.Object3D);
      }
    }

    // MIO articulated bus and Chiva should be meaningfully longer than compact taxi
    expect(lengths.get('mio_bus') ?? 0).toBeGreaterThan(
      (lengths.get('taxi') ?? 0) * 1.4,
    );
    expect(lengths.get('chiva') ?? 0).toBeGreaterThan(
      (lengths.get('taxi') ?? 0) * 1.2,
    );
    // All 5 vehicle kinds produce varied procedural geometry
    expect(new Set(vertexCounts.values()).size).toBeGreaterThanOrEqual(4);
  });

  it('builds valid Object3Ds for player, objective beacon, sunset sky dome, and lighting', () => {
    const player = createPlayerMesh();
    expect(player).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(player)).toBeGreaterThan(0);

    const beacon = createObjectiveBeacon();
    expect(beacon).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(beacon)).toBeGreaterThan(0);

    const skyDome = createSunsetSkyDome();
    expect(skyDome).toBeInstanceOf(THREE.Mesh);
    expect(countGeometryVertices(skyDome)).toBeGreaterThan(0);
    const skyMaterial = skyDome.material as THREE.Material;
    expect(skyMaterial.side).toBe(THREE.BackSide);

    const lighting = createSunsetLighting();
    expect(lighting).toBeInstanceOf(THREE.Group);
    let hemisphereCount = 0;
    let directionalCount = 0;
    lighting.traverse((node) => {
      if (node instanceof THREE.HemisphereLight) hemisphereCount += 1;
      if (node instanceof THREE.DirectionalLight) directionalCount += 1;
    });
    expect(hemisphereCount).toBeGreaterThanOrEqual(1);
    expect(directionalCount).toBeGreaterThanOrEqual(1);
  });

  it('exports WebGLUnavailableError extending Error and throws it cleanly from WorldRenderer without WebGL', () => {
    const err = new WebGLUnavailableError('No WebGL');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WebGLUnavailableError');
    expect(err.message).toBe('No WebGL');

    const stubCanvas = {
      width: 1280,
      height: 720,
      clientWidth: 1280,
      clientHeight: 720,
      getContext: () => null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      style: {},
    } as unknown as HTMLCanvasElement;

    expect(() => new WorldRenderer(stubCanvas, CALI_MAP)).toThrow(
      WebGLUnavailableError,
    );
  });
});

describe('updateCameraRig', () => {
  const modes: readonly CameraMode[] = [
    'chase',
    'cinematic',
    'hood',
    'victory_orbit',
  ];

  it('produces finite camera positions across all 4 CameraModes without mutating snapshot', () => {
    const world = createSampleWorld();
    const snapshotBefore = JSON.stringify(world);

    for (const mode of modes) {
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 900);
      updateCameraRig(camera, world, mode, 0.016, 1.25);
      updateCameraRig(camera, world, mode, 0.016, 1.45);

      expect(Number.isFinite(camera.position.x)).toBe(true);
      expect(Number.isFinite(camera.position.y)).toBe(true);
      expect(Number.isFinite(camera.position.z)).toBe(true);
      expect(Number.isFinite(camera.quaternion.x)).toBe(true);
      expect(Number.isFinite(camera.quaternion.y)).toBe(true);
      expect(Number.isFinite(camera.quaternion.z)).toBe(true);
      expect(Number.isFinite(camera.quaternion.w)).toBe(true);
      expect(camera.position.length()).toBeGreaterThan(0);
    }

    expect(JSON.stringify(world)).toBe(snapshotBefore);
  });

  it('handles on-foot mode and zero/non-finite dt safely', () => {
    const onFootWorld = createSampleWorld({
      player: {
        mode: 'on_foot',
        x: -90,
        y: 3.5,
        z: 36,
        heading: Math.PI / 2,
        speedMps: 5,
        speedKmh: 18,
        vehicleId: null,
        nearbyVehicleId: 'player_banshee',
        canEnterVehicle: true,
        nitro: 1,
        isDrifting: false,
        isBoosting: false,
        isSprinting: true,
        inRiverHazard: false,
      },
    });

    for (const mode of modes) {
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.4, 900);
      updateCameraRig(camera, onFootWorld, mode, 0, Number.NaN);

      expect(Number.isFinite(camera.position.x)).toBe(true);
      expect(Number.isFinite(camera.position.y)).toBe(true);
      expect(Number.isFinite(camera.position.z)).toBe(true);
    }
  });

  it('opens FOV during nitro boost and stays finite under collision impact', () => {
    const cruiseWorld = createSampleWorld({
      player: {
        mode: 'driving',
        x: -4,
        y: 0,
        z: 12,
        heading: Math.PI / 2,
        speedMps: 12,
        speedKmh: 43.2,
        vehicleId: 'player_banshee',
        nearbyVehicleId: null,
        canEnterVehicle: false,
        nitro: 75,
        isDrifting: false,
        isBoosting: false,
        isSprinting: false,
        inRiverHazard: false,
      },
      vehicles: [
        {
          id: 'player_banshee',
          kind: 'banshee',
          role: 'player',
          x: -4,
          y: 0,
          z: 12,
          heading: Math.PI / 2,
          speedMps: 12,
          speedKmh: 43.2,
          steerAngle: 0,
          isDrifting: false,
          isBoosting: false,
          nitro: 75,
          sirenActive: false,
          colorHex: 0xff2e93,
          accentHex: 0x00f0ff,
          halfWidth: 1.05,
          halfLength: 2.25,
        },
      ],
      collisionImpact: 0,
    });

    const boostImpactWorld = createSampleWorld({
      collisionImpact: 0.85,
    });

    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 900);
    updateCameraRig(camera, cruiseWorld, 'chase', 0.016, 0, false);
    const cruiseFov = camera.fov;

    for (let step = 0; step < 24; step += 1) {
      updateCameraRig(camera, boostImpactWorld, 'chase', 0.05, step * 0.05, false);
    }

    expect(camera.fov).toBeGreaterThan(cruiseFov + 4);
    expect(Number.isFinite(camera.fov)).toBe(true);
    expect(Number.isFinite(camera.position.x)).toBe(true);
    expect(Number.isFinite(camera.position.y)).toBe(true);
    expect(Number.isFinite(camera.position.z)).toBe(true);
  });
});

describe('cinematic sky and shadow helpers', () => {
  it('advances sky dome shader uTime via updateSkyDomeTime', () => {
    const skyDome = createSunsetSkyDome();
    const skyMaterial = skyDome.material as THREE.ShaderMaterial;
    expect(skyMaterial.uniforms.uTime?.value).toBe(0);

    updateSkyDomeTime(skyDome, 14.25);
    expect(skyMaterial.uniforms.uTime?.value).toBeCloseTo(14.25, 5);
  });

  it('tracks player coordinates via updateShadowFocus on sunset lighting rig', () => {
    const lighting = createSunsetLighting();
    const keyLight = lighting.userData.keyLight as THREE.DirectionalLight;
    expect(keyLight).toBeInstanceOf(THREE.DirectionalLight);

    const initialLightX = keyLight.position.x;
    const initialLightZ = keyLight.position.z;

    updateShadowFocus(lighting, 74, -24);

    expect(keyLight.target.position.x).toBeCloseTo(74, 3);
    expect(keyLight.target.position.z).toBeCloseTo(-24, 3);
    expect(keyLight.position.x).toBeCloseTo(initialLightX + 74, 3);
    expect(keyLight.position.z).toBeCloseTo(initialLightZ - 24, 3);
  });

  it('disposes lights (including shadow maps), meshes, points, lines, and PBR textures cleanly via disposeObjectTree', () => {
    const root = new THREE.Group();

    const sunLight = new THREE.DirectionalLight(0xffbe6b, 2);
    const shadowMapTarget = new THREE.WebGLRenderTarget(64, 64);
    sunLight.shadow.map = shadowMapTarget;
    const lightDisposeSpy = vi.spyOn(sunLight, 'dispose');
    const shadowMapDisposeSpy = vi.spyOn(shadowMapTarget, 'dispose');
    root.add(sunLight);

    const mapTex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const bumpTex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const roughTex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const emissiveTex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const alphaTex = new THREE.DataTexture(new Uint8Array(16), 2, 2);

    const meshGeo = new THREE.BoxGeometry(1, 1, 1);
    const meshMat = new THREE.MeshStandardMaterial({
      map: mapTex,
      bumpMap: bumpTex,
      roughnessMap: roughTex,
      emissiveMap: emissiveTex,
      alphaMap: alphaTex,
    });
    const mesh = new THREE.Mesh(meshGeo, meshMat);
    root.add(mesh);

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3),
    );
    const pointsMat = new THREE.PointsMaterial({ color: 0x00f0ff });
    root.add(new THREE.Points(pointsGeo, pointsMat));

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0]), 3),
    );
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff2e93 });
    root.add(new THREE.Line(lineGeo, lineMat));

    const meshGeoSpy = vi.spyOn(meshGeo, 'dispose');
    const meshMatSpy = vi.spyOn(meshMat, 'dispose');
    const alphaTexSpy = vi.spyOn(alphaTex, 'dispose');
    const bumpTexSpy = vi.spyOn(bumpTex, 'dispose');
    const roughTexSpy = vi.spyOn(roughTex, 'dispose');
    const emissiveTexSpy = vi.spyOn(emissiveTex, 'dispose');
    const pointsGeoSpy = vi.spyOn(pointsGeo, 'dispose');
    const pointsMatSpy = vi.spyOn(pointsMat, 'dispose');
    const lineGeoSpy = vi.spyOn(lineGeo, 'dispose');
    const lineMatSpy = vi.spyOn(lineMat, 'dispose');

    disposeObjectTree(root);

    expect(lightDisposeSpy).toHaveBeenCalledTimes(1);
    expect(shadowMapDisposeSpy).toHaveBeenCalledTimes(1);
    expect(meshGeoSpy).toHaveBeenCalledTimes(1);
    expect(meshMatSpy).toHaveBeenCalledTimes(1);
    expect(alphaTexSpy).toHaveBeenCalledTimes(1);
    expect(bumpTexSpy).toHaveBeenCalledTimes(1);
    expect(roughTexSpy).toHaveBeenCalledTimes(1);
    expect(emissiveTexSpy).toHaveBeenCalledTimes(1);
    expect(pointsGeoSpy).toHaveBeenCalledTimes(1);
    expect(pointsMatSpy).toHaveBeenCalledTimes(1);
    expect(lineGeoSpy).toHaveBeenCalledTimes(1);
    expect(lineMatSpy).toHaveBeenCalledTimes(1);
  });
});

function createMockPbrMaps(): PhotoPbrMaterialMaps {
  const map = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const normalMap = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const roughnessMap = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  return {
    map,
    normalMap,
    roughnessMap,
    dispose() {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

function createMockFerrariTemplate(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'RootNode';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  bodyMat.name = 'Body_Color';
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 4.2), bodyMat);
  body.name = 'body';
  body.position.set(0, 0.72, 0);
  root.add(body);

  const glassMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  glassMat.name = 'Glass_Gray';
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.8), glassMat);
  glass.name = 'glass';
  glass.position.set(0, 1.05, 0);
  root.add(glass);

  const tailMat = new THREE.MeshStandardMaterial({ color: 0xaa0000 });
  tailMat.name = 'Taillight_Glass';
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.1), tailMat);
  tail.name = 'lights_red';
  tail.position.set(0, 0.75, 2.08);
  root.add(tail);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  headMat.name = 'Projector_Glass';
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.1), headMat);
  head.name = 'lights';
  head.position.set(0, 0.65, -2.08);
  root.add(head);

  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wheelPositions: readonly [string, number, number, number][] = [
    ['wheel_fl', -0.84, 0.35, -1.2],
    ['wheel_fr', 0.84, 0.35, -1.2],
    ['wheel_rl', -0.84, 0.35, 1.4],
    ['wheel_rr', 0.84, 0.35, 1.4],
  ];

  for (const [name, x, y, z] of wheelPositions) {
    const wheelGroup = new THREE.Group();
    wheelGroup.name = name;
    wheelGroup.position.set(x, y, z);
    wheelGroup.rotation.x = -Math.PI / 2;
    const tireMesh = new THREE.Mesh(wheelGeo, wheelMat);
    tireMesh.name = 'tire';
    wheelGroup.add(tireMesh);
    root.add(wheelGroup);
  }

  return root;
}

function createMockCharacterAsset(): LoadedCharacterAsset {
  const scene = new THREE.Group();
  scene.name = 'Character';

  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.9, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x555555 }),
  );
  bodyMesh.name = 'vanguard_Mesh';
  bodyMesh.position.set(0, 0.95, 0);
  scene.add(bodyMesh);

  const makeClip = (name: string) =>
    new THREE.AnimationClip(name, 1.0, [
      new THREE.NumberKeyframeTrack('vanguard_Mesh.position[1]', [0, 0.5, 1], [0.95, 1.0, 0.95]),
    ]);

  return {
    scene,
    animations: [
      makeClip('Idle'),
      makeClip('Walk'),
      makeClip('Run'),
      makeClip('TPose'),
    ],
  };
}

describe('photorealistic golden-hour lighting, free-orbit camera, photographic PBR, and real GLB rigs', () => {
  it('uses naturalistic golden-hour sun, sky-earth hemisphere, and cool-sky rim without neon fills', () => {
    const lighting = createSunsetLighting();
    const keyLight = lighting.getObjectByName('sunset_key_light') as THREE.DirectionalLight | undefined;
    const hemi = lighting.getObjectByName('sunset_hemisphere_light') as THREE.HemisphereLight | undefined;
    const skyRim = lighting.getObjectByName('sunset_sky_rim') as THREE.DirectionalLight | undefined;

    expect(keyLight).toBeInstanceOf(THREE.DirectionalLight);
    expect(keyLight?.color.getHex()).toBe(0xffe0b5);
    expect(keyLight?.intensity).toBeCloseTo(2.85, 2);

    expect(hemi).toBeInstanceOf(THREE.HemisphereLight);
    expect(hemi?.color.getHex()).toBe(0x9bc4e8);
    expect(hemi?.groundColor.getHex()).toBe(0x6b5240);

    expect(skyRim).toBeInstanceOf(THREE.DirectionalLight);
    expect(skyRim?.color.getHex()).toBe(0x88b4e6);
    expect(lighting.getObjectByName('sunset_cyan_fill')).toBeUndefined();
    expect(lighting.getObjectByName('sunset_magenta_fill')).toBeUndefined();
  });

  it('clamps CameraOrbitState pitch and zoom, resets idleSeconds, and auto-recenters while driving', () => {
    const orbit = createCameraOrbitState();
    expect(orbit.yawOffset).toBe(0);
    expect(orbit.pitchOffset).toBe(0);
    expect(orbit.zoomDistance).toBeCloseTo(6.2, 2);

    orbit.idleSeconds = 4.2;
    applyCameraOrbitInput(orbit, Math.PI * 0.5, 5.0, -50);
    expect(orbit.pitchOffset).toBeCloseTo(0.62, 4);
    expect(orbit.zoomDistance).toBeCloseTo(4.4, 4);
    expect(orbit.idleSeconds).toBe(0);

    applyCameraOrbitInput(orbit, 0, -5.0, 50);
    expect(orbit.pitchOffset).toBeCloseTo(-0.12, 4);
    expect(orbit.zoomDistance).toBeCloseTo(11.0, 4);

    // Non-finite deltas must not corrupt camera orbit state
    applyCameraOrbitInput(orbit, Number.NaN, Number.POSITIVE_INFINITY, Number.NaN);
    expect(Number.isFinite(orbit.yawOffset)).toBe(true);
    expect(Number.isFinite(orbit.pitchOffset)).toBe(true);
    expect(Number.isFinite(orbit.zoomDistance)).toBe(true);

    // Driving above 4 m/s after > 1.5s idle smoothly decays yawOffset & pitchOffset toward 0
    orbit.yawOffset = 1.1;
    orbit.pitchOffset = 0.35;
    orbit.idleSeconds = 0;

    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 900);
    const drivingWorld = createSampleWorld();

    // During first 1.0s idle, orbit offset remains preserved
    for (let i = 0; i < 10; i += 1) {
      updateCameraRig(camera, drivingWorld, 'chase', 0.1, i * 0.1, false, orbit);
    }
    expect(orbit.yawOffset).toBeCloseTo(1.1, 3);
    expect(orbit.pitchOffset).toBeCloseTo(0.35, 3);

    // After > 1.5s idle while driving, offsets smoothly decay toward 0
    for (let i = 0; i < 30; i += 1) {
      updateCameraRig(camera, drivingWorld, 'chase', 0.1, 1.0 + i * 0.1, false, orbit);
    }
    expect(Math.abs(orbit.yawOffset)).toBeLessThan(0.25);
    expect(Math.abs(orbit.pitchOffset)).toBeLessThan(0.1);
  });

  it('upgrades all 10 Cali surface roles in-place via applyPhotographicAssets and handles null slots safely', () => {
    const { group } = buildCaliWorld(CALI_MAP);
    const textures: LoadedWorldTextureSets = {
      asphalt: createMockPbrMaps(),
      sidewalk: createMockPbrMaps(),
      terrain: createMockPbrMaps(),
      plaster: createMockPbrMaps(),
      roof: createMockPbrMaps(),
      facade: createMockPbrMaps(),
      palmBark: createMockPbrMaps(),
      palmLeaves: createMockPbrMaps(),
      jacarandaBark: createMockPbrMaps(),
      jacarandaLeaves: createMockPbrMaps(),
    };

    applyPhotographicAssets(group, textures);

    const upgradedMaps = new Set<THREE.Texture>();
    group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) {
        return;
      }
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial && mat.map && mat.normalMap && mat.roughnessMap) {
          upgradedMaps.add(mat.map);
        }
      }
    });

    for (const texSet of Object.values(textures)) {
      expect(texSet).not.toBeNull();
      expect(upgradedMaps.has(texSet!.map)).toBe(true);
    }

    // All-null texture sets must be a safe no-op
    const nullTextures: LoadedWorldTextureSets = {
      asphalt: null,
      sidewalk: null,
      terrain: null,
      plaster: null,
      roof: null,
      facade: null,
      palmBark: null,
      palmLeaves: null,
      jacarandaBark: null,
      jacarandaLeaves: null,
    };
    expect(() => applyPhotographicAssets(group, nullTextures)).not.toThrow();

    disposeObjectTree(group);
    for (const texSet of Object.values(textures)) {
      texSet?.dispose();
    }
  });

  it('builds a properly oriented, scaled, wheel-rigged Rosso Corsa Ferrari mesh without mutating template', () => {
    const template = createMockFerrariTemplate();
    const originalBody = template.getObjectByName('body') as THREE.Mesh;
    const originalBodyMat = originalBody.material;

    const ferrari = createFerrariPlayerMesh(template);
    expect(ferrari).toBeInstanceOf(THREE.Group);

    // Template must remain untouched
    expect(originalBody.material).toBe(originalBodyMat);

    // Inner model normalized to ~4.55m length and grounded at y = 0
    const bodyClone = ferrari.getObjectByName('body') as THREE.Mesh | undefined;
    expect(bodyClone).toBeInstanceOf(THREE.Mesh);
    expect(bodyClone?.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const bodyMat = bodyClone?.material as THREE.MeshPhysicalMaterial;
    expect(bodyMat.color.getHex()).toBe(0xb80e24);
    expect(bodyMat.clearcoat).toBe(1.0);
    expect(bodyClone?.castShadow).toBe(true);
    expect(bodyClone?.receiveShadow).toBe(true);

    const chassisBox = new THREE.Box3().setFromObject(bodyClone!);
    expect(chassisBox.max.z - chassisBox.min.z).toBeGreaterThan(4.2);
    expect(chassisBox.max.z - chassisBox.min.z).toBeLessThan(4.9);

    const wheels = ferrari.userData.wheels as THREE.Object3D[] | undefined;
    const frontWheels = ferrari.userData.frontWheels as THREE.Object3D[] | undefined;
    const brakeLights = ferrari.userData.brakeLightMaterials as THREE.MeshStandardMaterial[] | undefined;
    expect(wheels?.length).toBe(4);
    expect(frontWheels?.length).toBe(2);
    expect(brakeLights?.length).toBeGreaterThanOrEqual(1);
    expect(ferrari.userData.headlightCones).toBeInstanceOf(THREE.Object3D);
    expect(ferrari.userData.nitroFlames).toBeInstanceOf(THREE.Object3D);

    disposeObjectTree(ferrari);
    disposeObjectTree(template);
  });

  it('builds a normalized, grounded, animated rigged character mesh with Idle/Walk/Run actions', () => {
    const asset = createMockCharacterAsset();
    const rig = createRiggedCharacterMesh(asset);

    expect(rig.group).toBeInstanceOf(THREE.Group);
    expect(rig.mixer).toBeInstanceOf(THREE.AnimationMixer);
    expect(rig.actions.idle).toBeDefined();
    expect(rig.actions.walk).toBeDefined();
    expect(rig.actions.run).toBeDefined();
    expect(rig.actions.idle?.isRunning()).toBe(true);

    const bodyClone = rig.group.getObjectByName('vanguard_Mesh') as THREE.Mesh | undefined;
    expect(bodyClone).toBeInstanceOf(THREE.Mesh);
    expect(bodyClone?.castShadow).toBe(true);

    const box = new THREE.Box3().setFromObject(bodyClone!);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y - box.min.y).toBeCloseTo(1.78, 2);

    rig.mixer.stopAllAction();
    rig.mixer.uncacheRoot(rig.mixer.getRoot());
    disposeObjectTree(rig.group);
    disposeObjectTree(asset.scene);
  });
});

describe('daylight checkpoints, 3D mission props, GPS chevrons, pedestrians, and San Antonio road conformance', () => {
  it('adds a bold floating downward GTA arrow (7-9m height) to createObjectiveBeacon while preserving ring/beam contracts', () => {
    const beacon = createObjectiveBeacon();

    expect(beacon.userData.targetRing).toBeInstanceOf(THREE.Object3D);
    expect(beacon.userData.lightBeam).toBeInstanceOf(THREE.Object3D);
    expect(Array.isArray(beacon.userData.beamMaterials)).toBe(true);
    expect((beacon.userData.beamMaterials as THREE.Material[]).length).toBeGreaterThanOrEqual(3);

    const floatingArrow = beacon.userData.floatingArrow as THREE.Object3D | undefined;
    expect(floatingArrow).toBeInstanceOf(THREE.Object3D);
    expect(countGeometryVertices(floatingArrow!)).toBeGreaterThan(0);
    expect(floatingArrow!.position.y).toBeGreaterThanOrEqual(7);
    expect(floatingArrow!.position.y).toBeLessThanOrEqual(9);

    disposeObjectTree(beacon);
  });

  it('builds all 3 physical 3D mission props (vinyl_briefcase, mateo_speakers, summit_stage) with animated sub-parts', () => {
    const props = createMissionPropMeshes();

    expect(Object.keys(props).sort()).toEqual([
      'mateo_speakers',
      'summit_stage',
      'vinyl_briefcase',
    ]);

    for (const [key, prop] of Object.entries(props)) {
      expect(prop, `prop ${key} should be THREE.Group`).toBeInstanceOf(THREE.Group);
      expect(countGeometryVertices(prop), `prop ${key} should have vertices`).toBeGreaterThan(50);
      const box = new THREE.Box3().setFromObject(prop);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
      expect(box.min.y).toBeLessThanOrEqual(0.15);
    }

    expect(props.vinyl_briefcase.userData.spinningRecord).toBeInstanceOf(THREE.Object3D);
    expect(props.mateo_speakers.userData.wavingArm).toBeInstanceOf(THREE.Object3D);
    expect(Array.isArray(props.mateo_speakers.userData.wooferCones)).toBe(true);
    expect((props.mateo_speakers.userData.wooferCones as THREE.Object3D[]).length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(props.summit_stage.userData.equalizerBars)).toBe(true);
    expect((props.summit_stage.userData.equalizerBars as THREE.Object3D[]).length).toBeGreaterThanOrEqual(4);

    for (const prop of Object.values(props)) {
      disposeObjectTree(prop);
    }
  });

  it('builds a road-hugging GPS chevron mesh and articulated shadow-casting pedestrian meshes', () => {
    const chevron = createGpsChevronMesh();
    expect(chevron).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(chevron)).toBeGreaterThan(0);
    expect(chevron.userData.glowMaterial).toBeInstanceOf(THREE.Material);
    disposeObjectTree(chevron);

    const pedestrian = createPedestrianMesh(0xff6b35, 0x1e3a5f);
    expect(pedestrian).toBeInstanceOf(THREE.Group);
    expect(countGeometryVertices(pedestrian)).toBeGreaterThan(0);
    expect(pedestrian.userData.leftLeg).toBeInstanceOf(THREE.Object3D);
    expect(pedestrian.userData.rightLeg).toBeInstanceOf(THREE.Object3D);
    expect(pedestrian.userData.leftArm).toBeInstanceOf(THREE.Object3D);
    expect(pedestrian.userData.rightArm).toBeInstanceOf(THREE.Object3D);

    let shadowCasters = 0;
    pedestrian.traverse((node) => {
      if (node instanceof THREE.Mesh && node.castShadow) {
        shadowCasters += 1;
      }
    });
    expect(shadowCasters).toBeGreaterThanOrEqual(4);

    const pedBox = new THREE.Box3().setFromObject(pedestrian);
    expect(pedBox.min.y).toBeCloseTo(0, 1);
    expect(pedBox.max.y).toBeGreaterThan(1.4);
    expect(pedBox.max.y).toBeLessThan(2.0);
    disposeObjectTree(pedestrian);
  });

  it('conforms road meshes smoothly to getTerrainElevation across the San Antonio intersection (-68, 36) without vertical slab lips', () => {
    const { group } = buildCaliWorld(CALI_MAP);
    group.updateMatrixWorld(true);

    const terrain = group.getObjectByName('cali_terrain') as THREE.Mesh | undefined;
    const circunvalar = group.getObjectByName('road_av_circunvalar');
    const sanAntonio = group.getObjectByName('road_calle_san_antonio');

    expect(terrain).toBeInstanceOf(THREE.Mesh);
    expect(circunvalar).toBeInstanceOf(THREE.Group);
    expect(sanAntonio).toBeInstanceOf(THREE.Group);

    const circunvalarSurface = circunvalar?.children[0] as THREE.Mesh | undefined;
    const sanAntonioSurface = sanAntonio?.children[0] as THREE.Mesh | undefined;
    expect(circunvalarSurface).toBeInstanceOf(THREE.Mesh);
    expect(sanAntonioSurface).toBeInstanceOf(THREE.Mesh);

    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const sampleSurfaceY = (target: THREE.Object3D, x: number, z: number): number | null => {
      raycaster.set(new THREE.Vector3(x, 50, z), down);
      const hits = raycaster.intersectObject(target, false);
      return hits[0]?.point.y ?? null;
    };

    const intersectionPoints: readonly (readonly [number, number])[] = [
      [-74, 36],
      [-72, 36],
      [-70, 36],
      [-68, 36],
      [-66, 36],
      [-64, 36],
      [-62.5, 36],
      [-61, 36],
      [-68, 31],
      [-68, 41],
    ];

    for (const [x, z] of intersectionPoints) {
      const expectedTerrainY = getTerrainElevation(x, z);
      const nsY = sampleSurfaceY(circunvalarSurface!, x, z);
      const ewY = sampleSurfaceY(sanAntonioSurface!, x, z);
      const terrainMeshY = sampleSurfaceY(terrain!, x, z);

      expect(nsY, `av_circunvalar missing surface at (${x}, ${z})`).not.toBeNull();
      expect(ewY, `calle_san_antonio missing surface at (${x}, ${z})`).not.toBeNull();
      expect(terrainMeshY, `terrain missing surface at (${x}, ${z})`).not.toBeNull();

      // Both roads must conform tightly to getTerrainElevation(x, z) + ROAD_OFFSET (~0.07..0.10m)
      expect(Math.abs(nsY! - (expectedTerrainY + 0.08))).toBeLessThan(0.05);
      expect(Math.abs(ewY! - (expectedTerrainY + 0.08))).toBeLessThan(0.05);

      // Tiny tier offset (~0.008m) between N-S and E-W roads — zero 0.15m+ slab lip
      expect(Math.abs(nsY! - ewY!)).toBeLessThan(0.03);

      // Road asphalt must sit strictly above the displaced terrain triangles (zero dirt clip)
      expect(ewY!).toBeGreaterThan(terrainMeshY!);
      expect(nsY!).toBeGreaterThan(terrainMeshY!);
    }

    disposeObjectTree(group);
  });

  it('samples 3D GPS chevron poses and headings cleanly along multi-segment routes', () => {
    const route = [
      { x: -68, z: 36 },
      { x: -68, z: 36 }, // degenerate duplicate point should be skipped safely
      { x: -4, z: 36 }, // 64m east (+X -> heading +PI/2)
      { x: -4, z: -24 }, // 60m north (-Z -> heading PI)
    ] as const;

    const firstSegment = sampleGpsRoutePose(route, 10);
    expect(firstSegment).not.toBeNull();
    expect(firstSegment!.x).toBeCloseTo(-58, 3);
    expect(firstSegment!.z).toBeCloseTo(36, 3);
    expect(firstSegment!.heading).toBeCloseTo(Math.PI / 2, 4);

    const secondSegment = sampleGpsRoutePose(route, 74);
    expect(secondSegment).not.toBeNull();
    expect(secondSegment!.x).toBeCloseTo(-4, 3);
    expect(secondSegment!.z).toBeCloseTo(26, 3);
    expect(Math.abs(secondSegment!.heading)).toBeCloseTo(Math.PI, 4);

    expect(sampleGpsRoutePose(route, 200)).toBeNull();
    expect(sampleGpsRoutePose([], 10)).toBeNull();
  });
});

describe('starlit night lighting, sculpted Ferrari liveries, curved buses/chivas, and organic pedestrians', () => {
  it('switches sky dome, directional/hemisphere lighting, bloom, and world night emissives cleanly between golden_hour and night', () => {
    const skyDome = createSunsetSkyDome();
    const skyMat = skyDome.material as THREE.ShaderMaterial;
    const sunDisc = skyDome.getObjectByName('western_sun_disc');
    const moonDisc = skyDome.getObjectByName('western_crescent_moon');

    expect(sunDisc?.visible).toBe(true);
    expect(moonDisc).toBeDefined();
    expect(moonDisc?.visible).toBe(false);

    setSkyDomeTimeOfDay(skyDome, 'night');
    expect((skyMat.uniforms.uZenithColor?.value as THREE.Color).getHex()).toBe(0x040714);
    expect((skyMat.uniforms.uHorizonColor?.value as THREE.Color).getHex()).toBe(0x13102b);
    expect(skyMat.uniforms.uNightMix?.value).toBe(1);
    expect(sunDisc?.visible).toBe(false);
    expect(moonDisc?.visible).toBe(true);

    setSkyDomeTimeOfDay(skyDome, 'golden_hour');
    expect((skyMat.uniforms.uZenithColor?.value as THREE.Color).getHex()).toBe(0x1f3b6b);
    expect(skyMat.uniforms.uNightMix?.value).toBe(0);
    expect(sunDisc?.visible).toBe(true);
    expect(moonDisc?.visible).toBe(false);
    disposeObjectTree(skyDome);

    const lighting = createSunsetLighting();
    const keyLight = lighting.getObjectByName('sunset_key_light') as THREE.DirectionalLight;
    const hemi = lighting.getObjectByName('sunset_hemisphere_light') as THREE.HemisphereLight;
    const skyRim = lighting.getObjectByName('sunset_sky_rim') as THREE.DirectionalLight;

    setLightingTimeOfDay(lighting, 'night');
    expect(keyLight.color.getHex()).toBe(0x7da2ff);
    expect(keyLight.intensity).toBeCloseTo(0.65, 2);
    expect(hemi.color.getHex()).toBe(0x1e2a55);
    expect(hemi.groundColor.getHex()).toBe(0x100d1f);
    expect(hemi.intensity).toBeCloseTo(0.42, 2);
    expect(skyRim.color.getHex()).toBe(0x3b4e99);
    expect(skyRim.intensity).toBeCloseTo(0.25, 2);

    setLightingTimeOfDay(lighting, 'golden_hour');
    expect(keyLight.color.getHex()).toBe(0xffe0b5);
    expect(keyLight.intensity).toBeCloseTo(2.85, 2);
    expect(hemi.color.getHex()).toBe(0x9bc4e8);
    expect(hemi.groundColor.getHex()).toBe(0x6b5240);
    expect(hemi.intensity).toBeCloseTo(0.9, 2);
    expect(skyRim.color.getHex()).toBe(0x88b4e6);
    expect(skyRim.intensity).toBeCloseTo(0.35, 2);
    disposeObjectTree(lighting);

    const mockBloomRig: PostProcessingRig = {
      composer: {} as PostProcessingRig['composer'],
      bloomPass: { threshold: 1.05, strength: 0.24, radius: 0.35 } as PostProcessingRig['bloomPass'],
      resize: () => undefined,
      render: () => undefined,
      dispose: () => undefined,
    };
    setBloomTimeOfDay(mockBloomRig, 'night', false);
    expect(mockBloomRig.bloomPass.threshold).toBeCloseTo(0.78, 2);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.62, 2);
    expect(mockBloomRig.bloomPass.radius).toBeCloseTo(0.48, 2);

    setBloomTimeOfDay(mockBloomRig, 'night', true);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.3, 2);

    setBloomTimeOfDay(mockBloomRig, 'golden_hour', false);
    expect(mockBloomRig.bloomPass.threshold).toBeCloseTo(1.05, 2);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.24, 2);

    const { group: worldGroup, waterMesh } = buildCaliWorld(CALI_MAP);
    const waterMat = waterMesh.material as THREE.ShaderMaterial;
    const neonSigns = worldGroup.getObjectByName('cali_neon_signs')!;
    const cristoRey = worldGroup.getObjectByName('landmark_cristo_rey')!;
    const estadio = worldGroup.getObjectByName('landmark_estadio_pascual')!;
    const buildings = worldGroup.getObjectByName('cali_buildings')!;
    const streetlights = worldGroup.getObjectByName('cali_streetlights')!;

    setWorldNightLighting(worldGroup, waterMesh, 'night');
    expect((waterMat.uniforms.uDeepColor?.value as THREE.Color).getHex()).toBe(0x040917);

    let maxNeonEmissiveNight = 0;
    neonSigns.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
        maxNeonEmissiveNight = Math.max(maxNeonEmissiveNight, node.material.emissiveIntensity);
      }
    });
    expect(maxNeonEmissiveNight).toBeGreaterThanOrEqual(1.8);

    let maxCristoEmissiveNight = 0;
    cristoRey.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
        maxCristoEmissiveNight = Math.max(maxCristoEmissiveNight, node.material.emissiveIntensity);
      }
    });
    expect(maxCristoEmissiveNight).toBeGreaterThanOrEqual(1.2);

    let maxEstadioEmissiveNight = 0;
    estadio.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
        maxEstadioEmissiveNight = Math.max(maxEstadioEmissiveNight, node.material.emissiveIntensity);
      }
    });
    expect(maxEstadioEmissiveNight).toBeGreaterThanOrEqual(3.0);

    let maxBuildingWindowNight = 0;
    buildings.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial && mat.emissiveIntensity > maxBuildingWindowNight) {
            maxBuildingWindowNight = mat.emissiveIntensity;
          }
        }
      }
    });
    expect(maxBuildingWindowNight).toBeGreaterThanOrEqual(1.65);

    let maxStreetlightPoolNight = 0;
    streetlights.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshBasicMaterial) {
        maxStreetlightPoolNight = Math.max(maxStreetlightPoolNight, node.material.opacity);
      }
    });
    expect(maxStreetlightPoolNight).toBeGreaterThanOrEqual(0.5);

    setWorldNightLighting(worldGroup, waterMesh, 'golden_hour');
    expect((waterMat.uniforms.uDeepColor?.value as THREE.Color).getHex()).toBe(0x10282c);
    let maxNeonEmissiveDay = 0;
    neonSigns.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
        maxNeonEmissiveDay = Math.max(maxNeonEmissiveDay, node.material.emissiveIntensity);
      }
    });
    expect(maxNeonEmissiveDay).toBeLessThan(1.4);
    disposeObjectTree(worldGroup);
  });

  it('uses ZERO BoxGeometry meshes on organic pedestrians, Valeria fallback, and Mateo NPC', () => {
    const pedestrian = createPedestrianMesh(0xff5e7e, 0x1b263b);
    let pedMeshCount = 0;
    let pedBoxCount = 0;
    pedestrian.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        pedMeshCount += 1;
        if (node.geometry instanceof THREE.BoxGeometry) {
          pedBoxCount += 1;
        }
      }
    });
    expect(pedMeshCount).toBeGreaterThanOrEqual(10);
    expect(pedBoxCount).toBe(0);
    disposeObjectTree(pedestrian);

    const player = createPlayerMesh();
    let playerBoxCount = 0;
    player.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry instanceof THREE.BoxGeometry) {
        playerBoxCount += 1;
      }
    });
    expect(playerBoxCount).toBe(0);
    disposeObjectTree(player);

    const props = createMissionPropMeshes();
    const mateo = props.mateo_speakers.getObjectByName('npc_mateo');
    expect(mateo).toBeInstanceOf(THREE.Group);
    let mateoMeshCount = 0;
    let mateoBoxCount = 0;
    mateo?.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        mateoMeshCount += 1;
        if (node.geometry instanceof THREE.BoxGeometry) {
          mateoBoxCount += 1;
        }
      }
    });
    expect(mateoMeshCount).toBeGreaterThanOrEqual(10);
    expect(mateoBoxCount).toBe(0);
    for (const prop of Object.values(props)) {
      disposeObjectTree(prop);
    }
  });

  it('builds distinct sculpted Ferrari livery rigs for banshee, police (with beacons & sirenLight), and taxi', () => {
    const template = createMockFerrariTemplate();
    const originalBody = template.getObjectByName('body') as THREE.Mesh;
    const originalBodyMat = originalBody.material;

    const banshee = createFerrariLiveryMesh(template, 'banshee');
    const police = createFerrariLiveryMesh(template, 'police');
    const taxi = createFerrariLiveryMesh(template, 'taxi');

    // Template stays strictly immutable
    expect(originalBody.material).toBe(originalBodyMat);

    const bansheeBody = banshee.getObjectByName('body') as THREE.Mesh;
    const policeBody = police.getObjectByName('body') as THREE.Mesh;
    const taxiBody = taxi.getObjectByName('body') as THREE.Mesh;

    expect((bansheeBody.material as THREE.MeshPhysicalMaterial).color.getHex()).toBe(0xb80e24);
    expect((policeBody.material as THREE.MeshPhysicalMaterial).color.getHex()).toBe(0xf2f5f8);
    expect((taxiBody.material as THREE.MeshPhysicalMaterial).color.getHex()).toBe(0xe5ad00);

    // Police Ferrari carries working red/blue LED beacons, dynamic siren PointLight, and headlights
    expect(police.userData.redBeacon).toBeInstanceOf(THREE.Mesh);
    expect(police.userData.blueBeacon).toBeInstanceOf(THREE.Mesh);
    expect(police.userData.sirenLight).toBeInstanceOf(THREE.PointLight);
    expect(police.userData.headlightCones).toBeInstanceOf(THREE.Object3D);
    expect((police.userData.wheels as THREE.Object3D[]).length).toBe(4);
    expect((police.userData.frontWheels as THREE.Object3D[]).length).toBe(2);

    // Taxi Ferrari carries backlit curved TAXI roof dome, headlights, brake lights, and 4 rotating wheels
    expect(taxi.getObjectByName('taxi_roof_sign')).toBeInstanceOf(THREE.Mesh);
    expect(taxi.userData.headlightCones).toBeInstanceOf(THREE.Object3D);
    expect((taxi.userData.brakeLightMaterials as THREE.MeshStandardMaterial[]).length).toBeGreaterThanOrEqual(1);
    expect((taxi.userData.wheels as THREE.Object3D[]).length).toBe(4);

    disposeObjectTree(banshee);
    disposeObjectTree(police);
    disposeObjectTree(taxi);
    disposeObjectTree(template);
  });

  it('builds non-boxy curved ExtrudeGeometry hulls on mio_bus and chiva', () => {
    const mio = createVehicleMesh('mio_bus', 0x1677ff, 0xf8f7ff);
    const chiva = createVehicleMesh('chiva', 0xff2e93, 0xffb800);

    const mioFront = mio.getObjectByName('mio_front_upper') as THREE.Mesh | undefined;
    const chivaHull = chiva.getObjectByName('chiva_hull') as THREE.Mesh | undefined;
    expect(mioFront?.geometry).toBeInstanceOf(THREE.ExtrudeGeometry);
    expect(chivaHull?.geometry).toBeInstanceOf(THREE.ExtrudeGeometry);

    disposeObjectTree(mio);
    disposeObjectTree(chiva);
  });

  it('clones createRiggedCharacterMesh with distinct tintHex and heightMeters without mutating the template scene', () => {
    const asset = createMockCharacterAsset();
    const templateMesh = asset.scene.getObjectByName('vanguard_Mesh') as THREE.Mesh;
    const templateMat = templateMesh.material as THREE.MeshStandardMaterial;
    const originalColorHex = templateMat.color.getHex();

    const pedA = createRiggedCharacterMesh(asset, {
      tintHex: 0xff2e93,
      heightMeters: 1.74,
    });
    const pedB = createRiggedCharacterMesh(asset, {
      tintHex: 0x00f0ff,
      heightMeters: 1.85,
    });

    // Template scene material and original color must remain strictly untouched
    expect(templateMesh.material).toBe(templateMat);
    expect(templateMat.color.getHex()).toBe(originalColorHex);

    const meshA = pedA.group.getObjectByName('vanguard_Mesh') as THREE.Mesh;
    const meshB = pedB.group.getObjectByName('vanguard_Mesh') as THREE.Mesh;
    const matA = meshA.material as THREE.MeshStandardMaterial;
    const matB = meshB.material as THREE.MeshStandardMaterial;

    expect(matA).not.toBe(templateMat);
    expect(matB).not.toBe(templateMat);
    expect(matA).not.toBe(matB);

    const expectedColorA = new THREE.Color(originalColorHex).lerp(
      new THREE.Color(0xff2e93),
      0.35,
    );
    const expectedColorB = new THREE.Color(originalColorHex).lerp(
      new THREE.Color(0x00f0ff),
      0.35,
    );
    expect(matA.color.getHex()).toBe(expectedColorA.getHex());
    expect(matB.color.getHex()).toBe(expectedColorB.getHex());
    expect(matA.color.getHex()).not.toBe(matB.color.getHex());

    // Custom heights normalized and grounded at y = 0
    const boxA = new THREE.Box3().setFromObject(meshA);
    const boxB = new THREE.Box3().setFromObject(meshB);
    expect(boxA.min.y).toBeCloseTo(0, 2);
    expect(boxA.max.y - boxA.min.y).toBeCloseTo(1.74, 2);
    expect(boxB.min.y).toBeCloseTo(0, 2);
    expect(boxB.max.y - boxB.min.y).toBeCloseTo(1.85, 2);

    // Independent mixers & locomotion actions
    expect(pedA.mixer).not.toBe(pedB.mixer);
    expect(pedA.actions.idle).toBeDefined();
    expect(pedA.actions.walk).toBeDefined();
    expect(pedA.actions.run).toBeDefined();
    expect(pedB.actions.idle).toBeDefined();
    expect(pedB.actions.walk).toBeDefined();
    expect(pedB.actions.run).toBeDefined();

    pedA.mixer.stopAllAction();
    pedA.mixer.uncacheRoot(pedA.mixer.getRoot());
    pedB.mixer.stopAllAction();
    pedB.mixer.uncacheRoot(pedB.mixer.getRoot());
    disposeObjectTree(pedA.group);
    disposeObjectTree(pedB.group);
    disposeObjectTree(asset.scene);
  });
});

describe('C-07 Track E2B: 3D architectural relief, authentic Cali street props, wet road puddles, and high-craft landmarks', () => {
  it('adds 3D architectural facade relief (window bays, balconies, awnings, pilasters, colonial eaves) to urban buildings', () => {
    const { group } = buildCaliWorld(CALI_MAP);
    const buildings = group.getObjectByName('cali_buildings');
    expect(buildings).toBeInstanceOf(THREE.Group);
    expect(buildings?.children.length).toBe(CALI_MAP.buildingColliders.length);

    let windowBayCount = 0;
    let balconyCount = 0;
    let awningCount = 0;
    let pilasterCount = 0;
    let colonialEavesCount = 0;
    let parapetCorniceCount = 0;
    let lowRoughnessWindowPanes = 0;

    buildings?.traverse((node) => {
      if (node.name.startsWith('building_window_bay_')) windowBayCount += 1;
      if (node.name.startsWith('building_balcony_')) balconyCount += 1;
      if (node.name.startsWith('building_awning_')) awningCount += 1;
      if (node.name.startsWith('building_pilaster_')) pilasterCount += 1;
      if (node.name.startsWith('building_colonial_eaves_')) colonialEavesCount += 1;
      if (node.name.startsWith('building_parapet_cornice_')) parapetCorniceCount += 1;

      if (
        node instanceof THREE.Mesh &&
        node.name.includes('window_pane') &&
        node.material instanceof THREE.MeshStandardMaterial &&
        node.material.roughness <= 0.15 &&
        node.material.metalness >= 0.4
      ) {
        lowRoughnessWindowPanes += 1;
      }
    });

    expect(windowBayCount).toBeGreaterThanOrEqual(40);
    expect(balconyCount).toBeGreaterThanOrEqual(20);
    expect(awningCount).toBeGreaterThanOrEqual(15);
    expect(pilasterCount).toBeGreaterThanOrEqual(CALI_MAP.buildingColliders.length * 4);
    expect(colonialEavesCount).toBeGreaterThanOrEqual(5);
    expect(parapetCorniceCount).toBeGreaterThanOrEqual(15);
    expect(lowRoughnessWindowPanes).toBeGreaterThanOrEqual(30);

    disposeObjectTree(group);
  });

  it('builds authentic Cali street props (4 MIO shelters, Bulevar benches, bollards, palm planters) cleanly outside road lanes', () => {
    const { group } = buildCaliWorld(CALI_MAP);
    group.updateMatrixWorld(true);

    const propsGroup = group.getObjectByName('cali_street_props');
    expect(propsGroup).toBeInstanceOf(THREE.Group);

    const mioShelters: THREE.Object3D[] = [];
    const benches: THREE.Object3D[] = [];
    const bollards: THREE.Object3D[] = [];
    const planters: THREE.Object3D[] = [];

    propsGroup?.traverse((node) => {
      if (node.name.startsWith('mio_shelter_') && !node.name.includes('_sign_')) {
        mioShelters.push(node);
      }
      if (node.name.startsWith('bulevar_bench_')) {
        benches.push(node);
      }
      if (node.name.startsWith('sidewalk_bollard_')) {
        bollards.push(node);
      }
      if (node.name.startsWith('bulevar_planter_')) {
        planters.push(node);
      }
    });

    expect(mioShelters.length).toBe(4);
    expect(benches.length).toBeGreaterThanOrEqual(8);
    expect(bollards.length).toBeGreaterThanOrEqual(16);
    expect(planters.length).toBeGreaterThanOrEqual(6);

    const worldPos = new THREE.Vector3();
    for (const prop of [...mioShelters, ...benches, ...bollards, ...planters]) {
      expect(countGeometryVertices(prop)).toBeGreaterThan(0);
      prop.getWorldPosition(worldPos);
      // Must stay outside Avenida Colombia drivable lanes (x in [-12, 4])
      const inAvColombia = worldPos.x > -12 && worldPos.x < 4;
      expect(inAvColombia, `${prop.name} intrudes into Av. Colombia`).toBe(false);
      // Must stay outside Calle 5 drivable lanes (z in [69, 85])
      const inCalle5 = worldPos.z > 69 && worldPos.z < 85;
      expect(inCalle5, `${prop.name} intrudes into Calle 5`).toBe(false);
      // Must stay outside Río Cali channel (x in [24, 46])
      const inRiver = worldPos.x > 24 && worldPos.x < 46;
      expect(inRiver, `${prop.name} intrudes into Río Cali`).toBe(false);
    }

    disposeObjectTree(group);
  });

  it('places wet specular asphalt road puddles with low roughness (<= 0.08) and decal settings', () => {
    const { group } = buildCaliWorld(CALI_MAP);
    const puddlesGroup = group.getObjectByName('cali_road_puddles');
    expect(puddlesGroup).toBeInstanceOf(THREE.Group);

    const puddles: THREE.Mesh[] = [];
    puddlesGroup?.traverse((node) => {
      if (node instanceof THREE.Mesh && node.name.startsWith('road_puddle_')) {
        puddles.push(node);
      }
    });

    expect(puddles.length).toBeGreaterThanOrEqual(10);
    for (const puddle of puddles) {
      expect(puddle.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      const mat = puddle.material as THREE.MeshStandardMaterial;
      expect(mat.roughness).toBeLessThanOrEqual(0.08);
      expect(mat.metalness).toBeGreaterThanOrEqual(0.2);
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.polygonOffset).toBe(true);
      expect(puddle.position.y).toBeGreaterThan(0.05);
      expect(puddle.position.y).toBeLessThan(0.25);
    }

    disposeObjectTree(group);
  });

  it('upgrades La Ermita, Torre de Cali, and Cristo Rey with high-craft architectural sub-parts', () => {
    const { group } = buildCaliWorld(CALI_MAP);

    const laErmita = group.getObjectByName('landmark_la_ermita');
    expect(laErmita).toBeInstanceOf(THREE.Group);
    expect(laErmita?.getObjectByName('la_ermita_central_spire')).toBeDefined();
    expect(laErmita?.getObjectByName('la_ermita_rose_window')).toBeDefined();
    let ermitaPinnacles = 0;
    let ermitaLancets = 0;
    let ermitaButtresses = 0;
    let ermitaCrosses = 0;
    laErmita?.traverse((node) => {
      if (node.name.startsWith('la_ermita_flanking_pinnacle_')) ermitaPinnacles += 1;
      if (node.name.startsWith('la_ermita_lancet_window_')) ermitaLancets += 1;
      if (node.name.startsWith('la_ermita_buttress_')) ermitaButtresses += 1;
      if (node.name.startsWith('la_ermita_cross_finial_')) ermitaCrosses += 1;
    });
    expect(ermitaPinnacles).toBeGreaterThanOrEqual(2);
    expect(ermitaLancets).toBeGreaterThanOrEqual(6);
    expect(ermitaButtresses).toBeGreaterThanOrEqual(6);
    expect(ermitaCrosses).toBeGreaterThanOrEqual(3);

    const torre = group.getObjectByName('landmark_torre_de_cali');
    expect(torre).toBeInstanceOf(THREE.Group);
    expect(torre?.getObjectByName('torre_mechanical_crown')).toBeDefined();
    expect(torre?.getObjectByName('torre_helipad')).toBeDefined();
    let torreMullions = 0;
    let torreBeacons = 0;
    torre?.traverse((node) => {
      if (node.name.startsWith('torre_mullion_fin_')) torreMullions += 1;
      if (node.name.startsWith('torre_aviation_beacon_')) torreBeacons += 1;
    });
    expect(torreMullions).toBeGreaterThanOrEqual(24);
    expect(torreBeacons).toBeGreaterThanOrEqual(2);

    const cristoRey = group.getObjectByName('landmark_cristo_rey');
    expect(cristoRey).toBeInstanceOf(THREE.Group);
    expect(cristoRey?.getObjectByName('cristo_rey_mirador_railing')).toBeDefined();
    expect(cristoRey?.getObjectByName('cristo_rey_approach_steps')).toBeDefined();
    let cristoFloodlights = 0;
    let cristoUplights = 0;
    cristoRey?.traverse((node) => {
      if (node.name.startsWith('cristo_rey_floodlight_')) cristoFloodlights += 1;
      if (node.name.startsWith('cristo_rey_uplight_beam_')) cristoUplights += 1;
    });
    expect(cristoFloodlights).toBeGreaterThanOrEqual(4);
    expect(cristoUplights).toBeGreaterThanOrEqual(4);

    disposeObjectTree(group);
  });

  it('toggles night glow cleanly on new architectural windows, MIO signs, and upgraded landmarks via setWorldNightLighting', () => {
    const { group, waterMesh } = buildCaliWorld(CALI_MAP);

    const collectMaxEmissive = (root: THREE.Object3D | undefined): number => {
      let maxVal = 0;
      root?.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshStandardMaterial) {
              maxVal = Math.max(maxVal, mat.emissiveIntensity);
            }
          }
        }
      });
      return maxVal;
    };

    const propsGroup = group.getObjectByName('cali_street_props');
    const laErmita = group.getObjectByName('landmark_la_ermita');
    const torre = group.getObjectByName('landmark_torre_de_cali');
    const cristoRey = group.getObjectByName('landmark_cristo_rey');
    const cristoLight = cristoRey?.getObjectByName(
      'cristo_rey_monument_uplight',
    ) as THREE.PointLight | undefined;
    expect(cristoLight).toBeInstanceOf(THREE.PointLight);

    expect(() => setWorldNightLighting(group, waterMesh, 'golden_hour')).not.toThrow();
    const dayPropsGlow = collectMaxEmissive(propsGroup);
    const dayErmitaGlow = collectMaxEmissive(laErmita);
    const dayTorreGlow = collectMaxEmissive(torre);
    const dayCristoGlow = collectMaxEmissive(cristoRey);
    const dayCristoLightIntensity = cristoLight?.intensity ?? 0;

    expect(() => setWorldNightLighting(group, waterMesh, 'night')).not.toThrow();
    const nightPropsGlow = collectMaxEmissive(propsGroup);
    const nightErmitaGlow = collectMaxEmissive(laErmita);
    const nightTorreGlow = collectMaxEmissive(torre);
    const nightCristoGlow = collectMaxEmissive(cristoRey);
    const nightCristoLightIntensity = cristoLight?.intensity ?? 0;

    expect(nightPropsGlow).toBeGreaterThan(dayPropsGlow);
    expect(nightErmitaGlow).toBeGreaterThan(dayErmitaGlow);
    expect(nightTorreGlow).toBeGreaterThan(dayTorreGlow);
    expect(nightCristoGlow).toBeGreaterThan(dayCristoGlow);
    expect(nightCristoLightIntensity).toBeGreaterThan(dayCristoLightIntensity);

    // Switching back to golden_hour restores lower daylight intensities cleanly
    expect(() => setWorldNightLighting(group, waterMesh, 'golden_hour')).not.toThrow();
    expect(collectMaxEmissive(propsGroup)).toBeCloseTo(dayPropsGlow, 3);
    expect(collectMaxEmissive(torre)).toBeCloseTo(dayTorreGlow, 3);
    expect(cristoLight?.intensity).toBeCloseTo(dayCristoLightIntensity, 3);

    disposeObjectTree(group);
  });
});
