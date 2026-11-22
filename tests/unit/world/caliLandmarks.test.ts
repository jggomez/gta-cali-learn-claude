import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CALI_MAP } from '../../../src/config/caliMap';
import type {
  CameraMode,
  VehicleKind,
  WorldSnapshot,
} from '../../../src/types/game';
import { buildCaliWorld } from '../../../src/world/caliLandmarks';
import {
  WebGLUnavailableError,
  createSunsetLighting,
  createSunsetSkyDome,
  updateCameraRig,
  updateShadowFocus,
  updateSkyDomeTime,
} from '../../../src/world/sceneSetup';
import {
  createObjectiveBeacon,
  createPlayerMesh,
  createVehicleMesh,
} from '../../../src/world/vehicleMeshes';
import {
  WorldRenderer,
  disposeObjectTree,
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
