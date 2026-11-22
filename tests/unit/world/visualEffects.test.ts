import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaliOutfitId, PlayerCarKind, VehicleKind } from '../../../src/types/game';
import { CALI_MAP } from '../../../src/config/caliMap';
import {
  buildCaliWorld,
  setWorldNightLighting,
} from '../../../src/world/caliLandmarks';
import {
  bindRenderTargetDisposal,
  createAsphaltTextures,
  createBuildingFacadeTextures,
  createCrosswalkTexture,
  createNeonSignTexture,
  createSidewalkTextures,
  createSunsetEnvironmentMap,
  createWaterShaderMaterial,
  type BuildingFacadeStyle,
} from '../../../src/world/pbrTextures';
import { ParticleSystem, SkidMarkPool } from '../../../src/world/particles';
import {
  createCinematicGradeShader,
  createPostProcessing,
  setBloomTimeOfDay,
  setGradeTimeOfDay,
  type PostProcessingRig,
} from '../../../src/world/sceneSetup';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { LoadedCharacterAsset } from '../../../src/world/assetLoader';
import {
  attachColombianLicensePlate,
  createCalenoCharacterRig,
  createCaliJerseyTexture,
  createCivilianPedestrianRig,
  createColombianPlateTexture,
  createFerrariLiveryMesh,
  createValeriaPlayerMesh,
  createVehicleMesh,
  retargetMixamoClips,
  type CaliJerseyStyle,
} from '../../../src/world/vehicleMeshes';
import {
  disposeObjectTree,
  resolveAtmosphereConfig,
} from '../../../src/world/worldRenderer';

function createMockCanvasDocument(): {
  readonly createElement: (tag: string) => unknown;
  readonly drawCalls: { count: number };
} {
  const drawCalls = { count: 0 };

  const createMockGradient = () => ({
    addColorStop: () => {
      drawCalls.count += 1;
    },
  });

  const createMockContext = () => ({
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    lineCap: 'butt',
    fillRect: () => {
      drawCalls.count += 1;
    },
    clearRect: () => {
      drawCalls.count += 1;
    },
    strokeRect: () => {
      drawCalls.count += 1;
    },
    beginPath: () => {
      drawCalls.count += 1;
    },
    closePath: () => {
      drawCalls.count += 1;
    },
    moveTo: () => {
      drawCalls.count += 1;
    },
    lineTo: () => {
      drawCalls.count += 1;
    },
    quadraticCurveTo: () => {
      drawCalls.count += 1;
    },
    translate: () => {
      drawCalls.count += 1;
    },
    rotate: () => {
      drawCalls.count += 1;
    },
    arc: () => {
      drawCalls.count += 1;
    },
    ellipse: () => {
      drawCalls.count += 1;
    },
    fill: () => {
      drawCalls.count += 1;
    },
    stroke: () => {
      drawCalls.count += 1;
    },
    fillText: () => {
      drawCalls.count += 1;
    },
    strokeText: () => {
      drawCalls.count += 1;
    },
    measureText: (text: string) => ({ width: text.length * 24 }),
    save: () => {
      drawCalls.count += 1;
    },
    restore: () => {
      drawCalls.count += 1;
    },
    setLineDash: () => {
      drawCalls.count += 1;
    },
    createLinearGradient: () => createMockGradient(),
    createRadialGradient: () => createMockGradient(),
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    getImageData: (x: number, y: number, width: number, height: number) => ({
      x,
      y,
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: () => {
      drawCalls.count += 1;
    },
  });

  return {
    drawCalls,
    createElement: (tag: string) => {
      if (tag !== 'canvas') {
        return {};
      }
      return {
        width: 0,
        height: 0,
        getContext: (kind: string) => (kind === '2d' ? createMockContext() : null),
      };
    },
  };
}

describe('pbrTextures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates asphalt PBR textures headlessly in Node with repeat wrapping and anisotropy', () => {
    const asphalt = createAsphaltTextures();

    expect(asphalt.map).toBeInstanceOf(THREE.Texture);
    expect(asphalt.bumpMap).toBeInstanceOf(THREE.Texture);
    expect(asphalt.roughnessMap).toBeInstanceOf(THREE.Texture);

    expect(asphalt.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(asphalt.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(asphalt.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);

    for (const texture of [asphalt.map, asphalt.bumpMap, asphalt.roughnessMap]) {
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(texture.anisotropy).toBeGreaterThanOrEqual(4);
      texture.dispose();
    }
  });

  it('creates crosswalk texture headlessly in Node', () => {
    const crosswalk = createCrosswalkTexture();

    expect(crosswalk).toBeInstanceOf(THREE.Texture);
    expect(crosswalk.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(crosswalk.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(crosswalk.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(crosswalk.anisotropy).toBeGreaterThanOrEqual(4);
    crosswalk.dispose();
  });

  it('creates sidewalk albedo and bump textures headlessly in Node', () => {
    const sidewalk = createSidewalkTextures();

    expect(sidewalk.map).toBeInstanceOf(THREE.Texture);
    expect(sidewalk.bumpMap).toBeInstanceOf(THREE.Texture);
    expect(sidewalk.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(sidewalk.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(sidewalk.map.wrapS).toBe(THREE.RepeatWrapping);
    expect(sidewalk.bumpMap.wrapT).toBe(THREE.RepeatWrapping);
    expect(sidewalk.map.anisotropy).toBeGreaterThanOrEqual(4);

    sidewalk.map.dispose();
    sidewalk.bumpMap.dispose();
  });

  it.each<BuildingFacadeStyle>(['modern_glass', 'colonial_stucco', 'downtown_midrise'])(
    'creates full PBR building facade texture set for %s style headlessly',
    (style) => {
      const facade = createBuildingFacadeTextures(style, 0x3b2c54, 0xff2e93);

      expect(facade.map).toBeInstanceOf(THREE.Texture);
      expect(facade.roughnessMap).toBeInstanceOf(THREE.Texture);
      expect(facade.emissiveMap).toBeInstanceOf(THREE.Texture);
      expect(facade.bumpMap).toBeInstanceOf(THREE.Texture);

      expect(facade.map.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(facade.emissiveMap.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(facade.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(facade.bumpMap.colorSpace).toBe(THREE.NoColorSpace);

      for (const texture of [
        facade.map,
        facade.roughnessMap,
        facade.emissiveMap,
        facade.bumpMap,
      ]) {
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
        expect(texture.anisotropy).toBeGreaterThanOrEqual(4);
        texture.dispose();
      }
    },
  );

  it('creates neon sign textures for Cali billboard labels without throwing', () => {
    const labels = ['SALSA', 'CALI', 'CAFÉ', 'CHOLADO', 'BULEVAR', ''];
    for (const label of labels) {
      const texture = createNeonSignTexture(label, 0x00f0ff);
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
      expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
      texture.dispose();
    }
  });

  it('renders procedural CanvasTextures when a 2D canvas document is available', () => {
    const mockDoc = createMockCanvasDocument();
    vi.stubGlobal('document', mockDoc);

    const asphalt = createAsphaltTextures();
    const crosswalk = createCrosswalkTexture();
    const sidewalk = createSidewalkTextures();
    const modern = createBuildingFacadeTextures('modern_glass', 0x222038, 0x00f0ff);
    const colonial = createBuildingFacadeTextures('colonial_stucco', 0xd99b6c, 0x8b2f3c);
    const downtown = createBuildingFacadeTextures('downtown_midrise', 0x7a6573, 0xff5e7e);
    const sign = createNeonSignTexture('MI TIERRA', 0xff2e93);

    expect(asphalt.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(crosswalk).toBeInstanceOf(THREE.CanvasTexture);
    expect(sidewalk.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(modern.emissiveMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(colonial.bumpMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(downtown.roughnessMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(sign).toBeInstanceOf(THREE.CanvasTexture);
    expect(mockDoc.drawCalls.count).toBeGreaterThan(100);

    for (const tex of [
      asphalt.map,
      asphalt.bumpMap,
      asphalt.roughnessMap,
      crosswalk,
      sidewalk.map,
      sidewalk.bumpMap,
      modern.map,
      modern.roughnessMap,
      modern.emissiveMap,
      modern.bumpMap,
      colonial.map,
      colonial.roughnessMap,
      colonial.emissiveMap,
      colonial.bumpMap,
      downtown.map,
      downtown.roughnessMap,
      downtown.emissiveMap,
      downtown.bumpMap,
      sign,
    ]) {
      tex.dispose();
    }
  });

  it('creates Rio Cali water ShaderMaterial with required uniforms and valid GLSL', () => {
    const material = createWaterShaderMaterial();

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.transparent).toBe(true);

    const expectedUniforms = [
      'uTime',
      'uSunDirection',
      'uDeepColor',
      'uShallowColor',
      'uSkyHorizonColor',
      'uSkyZenithColor',
    ] as const;

    for (const name of expectedUniforms) {
      expect(material.uniforms[name]).toBeDefined();
      expect(material.fragmentShader).toContain(name);
    }

    expect(material.uniforms['uTime']?.value).toBe(0);
    expect(material.uniforms['uSunDirection']?.value).toBeInstanceOf(THREE.Vector3);
    const sunDir = material.uniforms['uSunDirection']?.value as THREE.Vector3;
    expect(sunDir.length()).toBeCloseTo(1, 3);

    expect(material.uniforms['uDeepColor']?.value).toBeInstanceOf(THREE.Color);
    expect(material.uniforms['uShallowColor']?.value).toBeInstanceOf(THREE.Color);
    expect(material.uniforms['uSkyHorizonColor']?.value).toBeInstanceOf(THREE.Color);
    expect(material.uniforms['uSkyZenithColor']?.value).toBeInstanceOf(THREE.Color);

    expect(material.vertexShader).toContain('void main()');
    expect(material.vertexShader).toContain('gl_Position');
    expect(material.fragmentShader).toContain('void main()');
    expect(material.fragmentShader).toContain('gl_FragColor');

    material.dispose();
  });

  it('returns null gracefully from createSunsetEnvironmentMap when WebGL PMREM is unavailable', () => {
    const invalidRenderer = {} as unknown as THREE.WebGLRenderer;
    const envMap = createSunsetEnvironmentMap(invalidRenderer);

    expect(envMap).toBeNull();
  });

  it('disposes the underlying PMREM WebGLRenderTarget exactly once when its texture is disposed', () => {
    const renderTarget = new THREE.WebGLRenderTarget(16, 16);
    const disposeSpy = vi.spyOn(renderTarget, 'dispose');

    const boundTexture = bindRenderTargetDisposal(renderTarget);
    expect(boundTexture).toBe(renderTarget.texture);
    expect(disposeSpy).not.toHaveBeenCalled();

    boundTexture.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    // Repeated texture disposal must stay idempotent with zero recursion
    expect(() => boundTexture.dispose()).not.toThrow();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('ParticleSystem', () => {
  it('starts empty with a valid Three.js Points group configured for dynamic simulation', () => {
    const particles = new ParticleSystem(120);

    expect(particles.group).toBeInstanceOf(THREE.Group);
    expect(particles.getActiveCount()).toBe(0);
    expect(particles.group.children.length).toBeGreaterThan(0);

    const points = particles.group.children[0];
    expect(points).toBeInstanceOf(THREE.Points);
    expect(points?.frustumCulled).toBe(false);

    particles.dispose();
  });

  it('emits drift smoke puffs and decays them back to zero cleanly', () => {
    const particles = new ParticleSystem(80);

    particles.emitDriftSmoke(10, 0.2, -15, 0.5, 8);
    expect(particles.getActiveCount()).toBe(8);

    // Zero or negative dt should be safe no-ops
    particles.update(0);
    particles.update(-0.1);
    expect(particles.getActiveCount()).toBe(8);

    // Step forward until all smoke particles fade out
    for (let step = 0; step < 60; step += 1) {
      particles.update(0.05);
    }
    expect(particles.getActiveCount()).toBe(0);

    particles.dispose();
  });

  it('emits collision sparks only when intensity exceeds 0.12 and simulates ballistic arc', () => {
    const particles = new ParticleSystem(80);

    particles.emitCollisionSparks(0, 1, 0, 0.12);
    expect(particles.getActiveCount()).toBe(0);

    particles.emitCollisionSparks(0, 1, 0, 0.05);
    expect(particles.getActiveCount()).toBe(0);

    particles.emitCollisionSparks(0, 1, 0, 0.8);
    const spawned = particles.getActiveCount();
    expect(spawned).toBeGreaterThan(0);

    const points = particles.group.children[0] as THREE.Points;
    const posAttr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const initialX = posAttr.getX(0);
    const initialY = posAttr.getY(0);

    particles.update(0.05);
    expect(posAttr.getX(0) !== initialX || posAttr.getY(0) !== initialY).toBe(true);

    for (let step = 0; step < 50; step += 1) {
      particles.update(0.05);
    }
    expect(particles.getActiveCount()).toBe(0);

    particles.dispose();
  });

  it('emits twin-tailpipe nitro exhaust puffs and decays cleanly', () => {
    const particles = new ParticleSystem(100);

    particles.emitNitroTrail(5, 0.4, 8, Math.PI * 0.25);
    expect(particles.getActiveCount()).toBeGreaterThan(0);

    for (let step = 0; step < 40; step += 1) {
      particles.update(0.05);
    }
    expect(particles.getActiveCount()).toBe(0);

    particles.dispose();
  });

  it('strictly respects maxParticles pool cap by recycling slots without allocating', () => {
    const maxParticles = 24;
    const particles = new ParticleSystem(maxParticles);

    for (let burst = 0; burst < 10; burst += 1) {
      particles.emitDriftSmoke(burst, 0.2, 0, 0, 6);
      particles.emitCollisionSparks(burst, 1.0, 0, 0.9);
      particles.emitNitroTrail(burst, 0.4, 0, 0);
      expect(particles.getActiveCount()).toBeLessThanOrEqual(maxParticles);
      particles.update(0.016);
    }

    expect(particles.getActiveCount()).toBe(maxParticles);

    for (let step = 0; step < 80; step += 1) {
      particles.update(0.05);
    }
    expect(particles.getActiveCount()).toBe(0);

    particles.dispose();
  });

  it('disposes cleanly and tolerates repeated dispose calls', () => {
    const particles = new ParticleSystem(32);
    particles.emitDriftSmoke(0, 0, 0, 0, 10);
    expect(particles.getActiveCount()).toBe(10);

    particles.dispose();
    expect(particles.getActiveCount()).toBe(0);

    expect(() => particles.dispose()).not.toThrow();
  });
});

function createSyntheticBoneCharacter(
  rootName: string,
  boneNames: readonly string[],
  clips: readonly THREE.AnimationClip[],
): LoadedCharacterAsset {
  const scene = new THREE.Group();
  scene.name = rootName;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.5,
  });
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 0.3), bodyMat);
  bodyMesh.name = `${rootName}_body`;
  bodyMesh.position.set(0, 1.0, 0);
  scene.add(bodyMesh);

  let parent: THREE.Object3D = scene;
  for (const name of boneNames) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(0, 0.25, 0);
    parent.add(bone);
    parent = bone;
  }

  return { scene, animations: clips };
}

function createMinimalSkinnedCharacter(
  rootName: string,
  hipRestRotX: number,
  legRestRotZ: number,
  clips: readonly THREE.AnimationClip[],
): LoadedCharacterAsset {
  const scene = new THREE.Group();
  scene.name = rootName;

  const characterRoot = new THREE.Group();
  characterRoot.name = 'Character';
  characterRoot.rotation.x = hipRestRotX;
  scene.add(characterRoot);

  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.set(0, 1.0, 0);

  const spine = new THREE.Bone();
  spine.name = 'mixamorigSpine';
  spine.position.set(0, 0.25, 0);
  hips.add(spine);

  const leftUpLeg = new THREE.Bone();
  leftUpLeg.name = 'mixamorigLeftUpLeg';
  leftUpLeg.position.set(0.1, -0.05, 0);
  leftUpLeg.rotation.z = legRestRotZ;
  hips.add(leftUpLeg);

  characterRoot.add(hips);

  const geometry = new THREE.BoxGeometry(0.5, 1.66, 0.3);
  geometry.translate(0, 0.83, 0);
  const posCount = geometry.attributes.position?.count ?? 0;
  const skinIndices = new Uint16Array(posCount * 4);
  const skinWeights = new Float32Array(posCount * 4);
  for (let i = 0; i < posCount; i += 1) {
    skinIndices[i * 4] = 0;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.5,
  });
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = `${rootName}_skinned`;
  const skeleton = new THREE.Skeleton([hips, spine, leftUpLeg]);
  characterRoot.add(skinnedMesh);
  scene.updateMatrixWorld(true);
  skinnedMesh.bind(skeleton);

  return { scene, animations: clips };
}

function createLocomotionClip(name: string, withScale = true): THREE.AnimationClip {
  const times = [0, 0.5, 1.0];
  const hipPosTrack = new THREE.VectorKeyframeTrack(
    'mixamorigHips.position',
    times,
    [0.0, 1.0, 0.0, 0.4, 0.94, 0.6, 0.0, 1.0, 1.2],
  );
  const hipQuatTrack = new THREE.QuaternionKeyframeTrack(
    'mixamorigHips.quaternion',
    times,
    [0, 0, 0, 1, 0, 0.08, 0, 0.9968, 0, 0, 0, 1],
  );
  const spineQuatTrack = new THREE.QuaternionKeyframeTrack(
    'mixamorigSpine.quaternion',
    times,
    [0, 0, 0, 1, 0.05, 0, 0, 0.9987, 0, 0, 0, 1],
  );
  const legQuatTrack = new THREE.QuaternionKeyframeTrack(
    'mixamorigLeftUpLeg.quaternion',
    times,
    [0, 0, 0, 1, 0.25, 0, 0, 0.9682, 0, 0, 0, 1],
  );
  const tracks: THREE.KeyframeTrack[] = [hipPosTrack, hipQuatTrack, spineQuatTrack, legQuatTrack];
  if (withScale) {
    tracks.push(
      new THREE.VectorKeyframeTrack(
        'mixamorigHips.scale',
        times,
        [1, 1, 1, 1.2, 1.2, 1.2, 1, 1, 1],
      ),
    );
  }
  return new THREE.AnimationClip(name, 1.0, tracks);
}

describe('SkidMarkPool', () => {
  function slotMatrix(pool: SkidMarkPool, slot: number): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();
    pool.mesh.getMatrixAt(slot, matrix);
    return matrix;
  }

  function slotQuaternion(pool: SkidMarkPool, slot: number): THREE.Quaternion {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    slotMatrix(pool, slot).decompose(position, quaternion, scale);
    return quaternion;
  }

  it('pre-allocates one hidden instanced asphalt ribbon draw call with polygonOffset and zero initial active count', () => {
    const pool = new SkidMarkPool({ capacity: 16 });

    expect(pool.group).toBeInstanceOf(THREE.Group);
    expect(pool.group.name).toBe('cali_skid_marks');
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.group.children.length).toBe(1);
    expect(pool.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(pool.mesh.count).toBe(16);
    expect(pool.mesh.visible).toBe(false);
    expect(pool.mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(pool.mesh.geometry.getAttribute('instanceOpacity').count).toBe(16);
    for (let slot = 0; slot < 16; slot += 1) {
      expect(pool.isSlotVisible(slot)).toBe(false);
      expect(pool.getSlotOpacity(slot)).toBe(0);
    }

    const mat = pool.mesh.material as THREE.MeshBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBe(-2);
    expect(mat.polygonOffsetUnits).toBe(-2);

    const shader = {
      uniforms: {},
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader: 'void main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n}',
    };
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(shader.vertexShader).toContain('attribute float instanceOpacity');
    expect(shader.fragmentShader).toContain('opacity * vSkidOpacity');

    pool.dispose();
  });

  it('emits dual flush rubber strips along heading and enforces ring buffer capacity cap', () => {
    const pool = new SkidMarkPool({ capacity: 6 });

    pool.emitPair(-0.8, 0.2, 1.0, 0.8, 0.2, 1.0, Math.PI * 0.25, 1.2, 0.65);
    expect(pool.getActiveCount()).toBe(2);
    expect(pool.mesh.visible).toBe(true);

    expect(pool.isSlotVisible(0)).toBe(true);
    expect(pool.isSlotVisible(1)).toBe(true);
    const left = new THREE.Vector3().setFromMatrixPosition(slotMatrix(pool, 0));
    const right = new THREE.Vector3().setFromMatrixPosition(slotMatrix(pool, 1));
    expect(left.y).toBeCloseTo(0.235, 3);
    expect(right.y).toBeCloseTo(0.235, 3);
    const expected = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, Math.PI * 0.25, 0, 'YXZ'),
    );
    expect(Math.abs(slotQuaternion(pool, 0).dot(expected))).toBeCloseTo(1, 4);
    expect(pool.getSlotOpacity(0)).toBeCloseTo(0.65, 3);

    // Over-emit past capacity=6; activeCount stays capped at 6 inside a single draw call
    for (let i = 0; i < 10; i += 1) {
      pool.emitPair(-0.8, 0, i, 0.8, 0, i, 0);
      expect(pool.getActiveCount()).toBeLessThanOrEqual(6);
    }
    expect(pool.getActiveCount()).toBe(6);
    expect(pool.group.children.length).toBe(1);

    pool.dispose();
  });

  it('fades marks smoothly after 6s, expires them at 14s, and supports clear and idempotent dispose', () => {
    const pool = new SkidMarkPool({ capacity: 8 });
    pool.emitPair(-0.7, 0, 0, 0.7, 0, 0, 0, 1.0, 0.6);
    const mat = pool.mesh.material as THREE.MeshBasicMaterial;

    // Non-positive or invalid dt must be safe no-ops
    pool.update(0);
    pool.update(-1);
    pool.update(Number.NaN);
    expect(pool.getActiveCount()).toBe(2);

    // At 5.5s, mark is still active and unfaded
    pool.update(5.5);
    expect(pool.getActiveCount()).toBe(2);
    expect(pool.getSlotOpacity(0)).toBeCloseTo(0.6, 3);

    // At 10s (past 6s fade start, before 14s expiry), opacity has smoothly dropped
    pool.update(4.5);
    expect(pool.getActiveCount()).toBe(2);
    expect(pool.getSlotOpacity(0)).toBeGreaterThan(0);
    expect(pool.getSlotOpacity(0)).toBeLessThan(0.55);

    // Past 14s, marks hide and expire back to 0
    pool.update(4.5);
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.isSlotVisible(0)).toBe(false);
    expect(pool.mesh.visible).toBe(false);

    // Re-emit then test clear()
    pool.emitPair(-0.7, 0, 2, 0.7, 0, 2, 0);
    expect(pool.getActiveCount()).toBe(2);
    pool.clear();
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.isSlotVisible(2)).toBe(false);

    // Dispose cleans the shared geometry and material, and ignores further emissions
    const geoDisposeSpy = vi.spyOn(pool.mesh.geometry, 'dispose');
    const matDisposeSpy = vi.spyOn(mat, 'dispose');
    pool.dispose();
    expect(geoDisposeSpy).toHaveBeenCalledTimes(1);
    expect(matDisposeSpy).toHaveBeenCalledTimes(1);
    pool.emitPair(-0.7, 0, 4, 0.7, 0, 4, 0);
    expect(pool.getActiveCount()).toBe(0);
    expect(() => pool.dispose()).not.toThrow();
  });
});

describe('CinematicGradePass and post-processing grading', () => {
  it('builds a valid CinematicGradeShader with all required uniforms and GLSL entrypoints', () => {
    const shader = createCinematicGradeShader();

    const expectedUniforms = [
      'tDiffuse',
      'uNightMix',
      'uBoostMix',
      'uVignetteStrength',
      'uContrast',
      'uSaturation',
    ] as const;

    for (const key of expectedUniforms) {
      expect(shader.uniforms[key]).toBeDefined();
      expect(shader.fragmentShader).toContain(key);
    }

    expect(shader.vertexShader).toContain('void main()');
    expect(shader.vertexShader).toContain('gl_Position');
    expect(shader.fragmentShader).toContain('void main()');
    expect(shader.fragmentShader).toContain('gl_FragColor');
  });

  it('updates CinematicGradePass uniforms cleanly for golden_hour, night, reducedMotion, and boostMix', () => {
    const gradePass = new ShaderPass(createCinematicGradeShader());
    const rig: PostProcessingRig = {
      composer: {} as PostProcessingRig['composer'],
      bloomPass: {} as PostProcessingRig['bloomPass'],
      gradePass,
      resize: () => {},
      render: () => {},
      dispose: () => {
        gradePass.dispose();
      },
    };

    setGradeTimeOfDay(rig, 'golden_hour', false, 0);
    expect(gradePass.uniforms['uNightMix']?.value).toBe(0);
    expect(gradePass.uniforms['uBoostMix']?.value).toBe(0);
    expect(gradePass.uniforms['uVignetteStrength']?.value).toBeCloseTo(0.22, 2);
    expect(gradePass.uniforms['uContrast']?.value).toBeGreaterThanOrEqual(1.04);

    setGradeTimeOfDay(rig, 'night', false, 0.75);
    expect(gradePass.uniforms['uNightMix']?.value).toBe(1);
    expect(gradePass.uniforms['uBoostMix']?.value).toBeCloseTo(0.75, 3);
    expect(gradePass.uniforms['uSaturation']?.value).toBeGreaterThan(1.05);

    setGradeTimeOfDay(rig, 'golden_hour', true, 1.5);
    expect(gradePass.uniforms['uVignetteStrength']?.value).toBeCloseTo(0.08, 2);
    expect(gradePass.uniforms['uBoostMix']?.value).toBe(1);

    // Safe no-op when gradePass is omitted
    const rigWithoutGrade: PostProcessingRig = {
      composer: {} as PostProcessingRig['composer'],
      bloomPass: {} as PostProcessingRig['bloomPass'],
      resize: () => {},
      render: () => {},
      dispose: () => {},
    };
    expect(() => setGradeTimeOfDay(rigWithoutGrade, 'night', false, 0.5)).not.toThrow();

    rig.dispose();
  });

  it('returns null cleanly from createPostProcessing when WebGL context is unavailable', () => {
    const invalidRenderer = {
      getContext: () => null,
      getPixelRatio: () => 1,
    } as unknown as THREE.WebGLRenderer;

    const rig = createPostProcessing(
      invalidRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
      false,
    );
    expect(rig).toBeNull();
  });

  it('uses restrained daytime bloom and highlight-safe warm golden-hour grading while preserving night bloom', () => {
    const shader = createCinematicGradeShader();
    expect(shader.fragmentShader).not.toContain('curvedLdr /');
    expect(shader.fragmentShader).toContain('0.22');
    expect(shader.fragmentShader).toContain('vec3(1.015, 0.985, 0.935)');
    expect(shader.fragmentShader).toContain('vec3(1.055, 0.975, 0.885)');

    const mockBloomRig: PostProcessingRig = {
      composer: {} as PostProcessingRig['composer'],
      bloomPass: {
        threshold: 0,
        strength: 0,
        radius: 0,
      } as PostProcessingRig['bloomPass'],
      resize: () => {},
      render: () => {},
      dispose: () => {},
    };

    setBloomTimeOfDay(mockBloomRig, 'golden_hour', false);
    expect(mockBloomRig.bloomPass.threshold).toBeCloseTo(1.35, 3);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.14, 3);
    expect(mockBloomRig.bloomPass.radius).toBeCloseTo(0.28, 3);

    setBloomTimeOfDay(mockBloomRig, 'golden_hour', true);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.08, 3);

    setBloomTimeOfDay(mockBloomRig, 'night', false);
    expect(mockBloomRig.bloomPass.threshold).toBeCloseTo(0.78, 3);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.62, 3);
    expect(mockBloomRig.bloomPass.radius).toBeCloseTo(0.48, 3);

    setBloomTimeOfDay(mockBloomRig, 'night', true);
    expect(mockBloomRig.bloomPass.strength).toBeCloseTo(0.3, 3);
  });

  it('renders storefront warm bays as dark tinted glass by day and glowing amber glass by night', () => {
    const { group: worldGroup, waterMesh } = buildCaliWorld(CALI_MAP);
    const warmBayMaterials = new Set<THREE.MeshStandardMaterial>();

    worldGroup.traverse((node) => {
      if (!node.name.startsWith('building_awning_')) {
        return;
      }
      for (const child of node.children) {
        if (
          child instanceof THREE.Mesh &&
          Math.abs(child.position.y + 1.65) < 0.01 &&
          child.material instanceof THREE.MeshStandardMaterial &&
          !(child.material instanceof THREE.MeshPhysicalMaterial)
        ) {
          warmBayMaterials.add(child.material);
        }
      }
    });

    expect(warmBayMaterials.size).toBe(1);
    const warmBayMat = [...warmBayMaterials][0];
    expect(warmBayMat).toBeDefined();
    if (warmBayMat) {
      expect(warmBayMat.color.getHex()).toBe(0x1b2735);
      expect(warmBayMat.emissive.getHex()).toBe(0x000000);
      expect(warmBayMat.emissiveIntensity).toBe(0);
      expect(warmBayMat.roughness).toBeCloseTo(0.11, 3);
      expect(warmBayMat.metalness).toBeCloseTo(0.45, 3);
      expect(warmBayMat.envMapIntensity).toBeCloseTo(1.45, 3);

      setWorldNightLighting(worldGroup, waterMesh, 'night');
      expect(warmBayMat.emissive.getHex()).toBe(0xffb85c);
      expect(warmBayMat.emissiveIntensity).toBeCloseTo(1.55, 3);

      setWorldNightLighting(worldGroup, waterMesh, 'golden_hour');
      expect(warmBayMat.emissive.getHex()).toBe(0x000000);
      expect(warmBayMat.emissiveIntensity).toBe(0);
    }

    disposeObjectTree(worldGroup);
  });

  it('resolves golden-hour HDRI, fallback, and night atmosphere settings cleanly without washout', () => {
    const dayHdri = resolveAtmosphereConfig('golden_hour', true);
    expect(dayHdri.toneMappingExposure).toBeCloseTo(0.94, 3);
    expect(dayHdri.backgroundIntensity).toBeCloseTo(0.72, 3);
    expect(dayHdri.environmentIntensity).toBeCloseTo(0.98, 3);
    // Warm 5 pm "brisa caleña" haze: apricot aerial perspective slightly denser than plain sunset fog
    expect(dayHdri.fogColorHex).toBe(0xd6a47a);
    expect(dayHdri.fogDensity).toBeCloseTo(0.0013, 5);

    const dayFallback = resolveAtmosphereConfig('golden_hour', false);
    expect(dayFallback.toneMappingExposure).toBeCloseTo(0.94, 3);
    expect(dayFallback.backgroundIntensity).toBeCloseTo(0.72, 3);
    expect(dayFallback.environmentIntensity).toBeCloseTo(0.82, 3);

    const nightHdri = resolveAtmosphereConfig('night', true);
    expect(nightHdri.toneMappingExposure).toBeCloseTo(1.12, 3);
    expect(nightHdri.backgroundIntensity).toBeCloseTo(1.0, 3);
    expect(nightHdri.environmentIntensity).toBeCloseTo(0.24, 3);
    expect(nightHdri.fogColorHex).toBe(0x090d1f);
    expect(nightHdri.fogDensity).toBeCloseTo(0.0023, 5);

    // The 2K sky background is an already tonemapped sRGB JPEG, so it is shown near full intensity
    const dayLdrSky = resolveAtmosphereConfig('golden_hour', true, true);
    expect(dayLdrSky.backgroundIntensity).toBeGreaterThan(0.9);
    expect(dayLdrSky.backgroundIntensity).toBeLessThanOrEqual(1);
    expect(resolveAtmosphereConfig('night', true, true).backgroundIntensity).toBeCloseTo(1.0, 3);
  });
});

describe('Valeria Mixamo retargeting and civilian pedestrians', () => {
  it('retargets synthetic bone-only mocks by cloning matched quaternion tracks and stripping .scale and .position', () => {
    const sourceClip = new THREE.AnimationClip('Walk', 1.0, [
      new THREE.VectorKeyframeTrack('mixamorig:Hips.position', [0, 1], [0, 1, 0, 2, 1, 2]),
      new THREE.QuaternionKeyframeTrack(
        'mixamorig:Hips.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 0.1, 0, 0.995],
      ),
      new THREE.VectorKeyframeTrack('mixamorig:Hips.scale', [0, 1], [1, 1, 1, 2, 2, 2]),
      new THREE.QuaternionKeyframeTrack(
        'mixamorig:Spine.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0.05, 0, 0, 0.998],
      ),
      new THREE.QuaternionKeyframeTrack(
        'mixamorig:UnknownFinger.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
    ]);

    const sourceAsset = createSyntheticBoneCharacter(
      'source_bones',
      ['mixamorig:Hips', 'mixamorig:Spine'],
      [sourceClip],
    );
    const targetAsset = createSyntheticBoneCharacter(
      'target_bones',
      ['mixamorigHips', 'mixamorigSpine'],
      [],
    );

    const retargeted = retargetMixamoClips(sourceAsset, targetAsset.scene);
    expect(retargeted).toHaveLength(1);
    const walk = retargeted[0];
    expect(walk?.name).toBe('Walk');

    const trackNames = walk?.tracks.map((track) => track.name) ?? [];
    expect(trackNames).toContain('mixamorigHips.quaternion');
    expect(trackNames).toContain('mixamorigSpine.quaternion');
    expect(trackNames.some((name) => name.endsWith('.scale'))).toBe(false);
    expect(trackNames.some((name) => name.endsWith('.position'))).toBe(false);
    expect(trackNames.some((name) => name.includes('UnknownFinger'))).toBe(false);
  });

  it('retargets SkinnedMesh skeletons via SkeletonUtils.retargetClip, caches results, strips .scale, and locks horizontal hip translation', () => {
    const sourceClips = [
      createLocomotionClip('Idle'),
      createLocomotionClip('Walk'),
      createLocomotionClip('Run'),
    ];
    const sourceAsset = createMinimalSkinnedCharacter('soldier', -Math.PI / 2, Math.PI, sourceClips);
    const targetAsset = createMinimalSkinnedCharacter('valeria', Math.PI / 2, 0, []);

    const firstPass = retargetMixamoClips(sourceAsset, targetAsset.scene);
    expect(firstPass.map((clip) => clip.name)).toEqual(['Idle', 'Walk', 'Run']);

    for (const clip of firstPass) {
      expect(clip.tracks.length).toBeGreaterThan(0);
      expect(clip.tracks.some((track) => track.name.endsWith('.scale'))).toBe(false);
      expect(clip.tracks.some((track) => track.name.startsWith('.bones['))).toBe(false);
    }

    // Play retargeted Walk clip and verify horizontal hip world X/Z remain locked near 0
    const walkClip = firstPass[1];
    expect(walkClip).toBeDefined();
    if (walkClip) {
      const mixer = new THREE.AnimationMixer(targetAsset.scene);
      mixer.clipAction(walkClip).play();
      mixer.setTime(0.5);
      targetAsset.scene.updateMatrixWorld(true);
      const hips = targetAsset.scene.getObjectByName('mixamorigHips');
      const worldPos = new THREE.Vector3();
      hips?.getWorldPosition(worldPos);
      expect(worldPos.x).toBeCloseTo(0, 3);
      expect(worldPos.z).toBeCloseTo(0, 3);
    }

    // Verify cached retargeted clips are reused on subsequent calls
    const secondPass = retargetMixamoClips(sourceAsset, targetAsset.scene);
    expect(secondPass).toHaveLength(firstPass.length);
    expect(secondPass[0]).toBe(firstPass[0]);
  });

  it('builds Morena Calena Valeria player rig grounded at y=0, 1.70m tall, with cloned materials and Idle/Walk/Run/Dance actions', () => {
    const sambaClip = new THREE.AnimationClip('SambaDance', 1.5, [
      new THREE.QuaternionKeyframeTrack(
        'mixamorigHips.quaternion',
        [0, 1.5],
        [0, 0, 0, 1, 0, 0.2, 0, 0.98],
      ),
    ]);
    const valeriaAsset = createMinimalSkinnedCharacter('valeria_template', 0, 0, [sambaClip]);
    const soldierAsset = createMinimalSkinnedCharacter('soldier_template', 0, 0, [
      createLocomotionClip('Idle'),
      createLocomotionClip('Walk'),
      createLocomotionClip('Run'),
    ]);

    const templateMesh = valeriaAsset.scene.getObjectByName(
      'valeria_template_skinned',
    ) as THREE.SkinnedMesh;
    const templateMat = templateMesh.material as THREE.MeshStandardMaterial;
    const origColorHex = templateMat.color.getHex();
    const origRoughness = templateMat.roughness;
    const origMetalness = templateMat.metalness;

    const rig = createValeriaPlayerMesh(valeriaAsset, soldierAsset);

    rig.group.updateMatrixWorld(true);
    const modelRoot = rig.group.getObjectByName('valeria_model_root');
    expect(modelRoot).toBeDefined();

    const bounds = new THREE.Box3().setFromObject(modelRoot as THREE.Object3D);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(1.7, 2);
    expect(bounds.min.y).toBeCloseTo(0, 2);

    // Verify template material was NOT mutated and cloned material is warm Morena Calena PBR
    expect(templateMat.color.getHex()).toBe(origColorHex);
    expect(templateMat.roughness).toBe(origRoughness);
    expect(templateMat.metalness).toBe(origMetalness);

    const clonedMesh = rig.group.getObjectByName('valeria_template_skinned') as THREE.SkinnedMesh;
    const clonedMat = clonedMesh.material as THREE.MeshStandardMaterial;
    expect(clonedMat).not.toBe(templateMat);
    expect(clonedMat.roughness).toBeGreaterThanOrEqual(0.72);
    expect(clonedMat.metalness).toBeLessThanOrEqual(0.04);
    expect(clonedMat.color.getHex()).not.toBe(origColorHex);
    expect(clonedMesh.castShadow).toBe(true);
    expect(clonedMesh.receiveShadow).toBe(true);

    // Verify locomotion + SambaDance actions bound
    expect(rig.actions.idle).toBeDefined();
    expect(rig.actions.walk).toBeDefined();
    expect(rig.actions.run).toBeDefined();
    expect(rig.actions.dance).toBeDefined();
    expect(rig.actions.idle?.isRunning()).toBe(true);
  });

  it('creates alternating diverse civilian pedestrians across Valeria and Soldier templates without pitch-black materials', () => {
    const valeriaAsset = createMinimalSkinnedCharacter('valeria_civ', 0, 0, []);
    const soldierAsset = createMinimalSkinnedCharacter('soldier_civ', 0, 0, [
      createLocomotionClip('Idle'),
      createLocomotionClip('Walk'),
      createLocomotionClip('Run'),
    ]);

    expect(createCivilianPedestrianRig(null, null, 0, 0xff5500, 0x223344)).toBeNull();

    const femaleRig = createCivilianPedestrianRig(
      valeriaAsset,
      soldierAsset,
      0,
      0x121212,
      0x222233,
    );
    const maleRig = createCivilianPedestrianRig(
      valeriaAsset,
      soldierAsset,
      1,
      0x2088ff,
      0x333344,
    );
    const secondFemaleRig = createCivilianPedestrianRig(
      valeriaAsset,
      soldierAsset,
      2,
      0xff2e93,
      0x1e2b45,
    );

    expect(femaleRig).not.toBeNull();
    expect(maleRig).not.toBeNull();
    expect(secondFemaleRig).not.toBeNull();

    expect(femaleRig?.group.name).toBe('cali_civilian_valeria');
    expect(maleRig?.group.name).toBe('cali_civilian_male');
    expect(secondFemaleRig?.group.name).toBe('cali_civilian_valeria');

    expect(femaleRig?.actions.walk).toBeDefined();
    expect(maleRig?.actions.walk).toBeDefined();

    // Even with a dark shirtColorHex=0x121212, female civilian tint must never collapse to pitch black
    const femMesh = femaleRig?.group.getObjectByName('valeria_civ_skinned') as THREE.SkinnedMesh;
    const femColor = (femMesh.material as THREE.MeshStandardMaterial).color;
    const luma = femColor.r * 0.2126 + femColor.g * 0.7152 + femColor.b * 0.0722;
    expect(luma).toBeGreaterThan(0.25);

    // Distinct palettes across consecutive female variants
    const femMesh2 = secondFemaleRig?.group.getObjectByName(
      'valeria_civ_skinned',
    ) as THREE.SkinnedMesh;
    const femColor2 = (femMesh2.material as THREE.MeshStandardMaterial).color;
    expect(femColor.getHex()).not.toBe(femColor2.getHex());

    // Graceful fallback when only one asset is provided
    const onlyValeria = createCivilianPedestrianRig(valeriaAsset, null, 3, 0x00f0ff, 0x222222);
    expect(onlyValeria?.group.name).toBe('cali_civilian_valeria');

    const onlySoldier = createCivilianPedestrianRig(null, soldierAsset, 0, 0x00f0ff, 0x222222);
    expect(onlySoldier?.group.name).toBe('cali_civilian_male');
  });
});

interface GlbJsonChunk {
  images?: unknown[];
  textures?: unknown[];
  materials?: Array<{
    pbrMetallicRoughness?: {
      baseColorTexture?: unknown;
      metallicRoughnessTexture?: unknown;
    };
    normalTexture?: unknown;
    occlusionTexture?: unknown;
    emissiveTexture?: unknown;
  }>;
}

interface NodeFsReader {
  readFileSync(path: URL): Uint8Array;
}

const PUBLIC_MODELS_ROOT = new URL('../../../public/', import.meta.url);
const UTF8_DECODER = new TextDecoder('utf-8');
const UTF8_ENCODER = new TextEncoder();

async function loadRealGlbForHeadlessTest(relativePublicPath: string): Promise<LoadedCharacterAsset> {
  const fsModuleId = 'node:fs';
  const fsMod = (await import(/* @vite-ignore */ fsModuleId)) as NodeFsReader;
  const fileUrl = new URL(relativePublicPath.replace(/^public\//, ''), PUBLIC_MODELS_ROOT);
  const raw = fsMod.readFileSync(fileUrl);
  const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const jsonLength = rawView.getUint32(12, true);
  const jsonText = UTF8_DECODER.decode(raw.subarray(20, 20 + jsonLength));
  const parsed = JSON.parse(jsonText) as GlbJsonChunk;

  // Strip only embedded image/texture references so Node GLTFLoader parses real skins, bones,
  // meshes, materials, and animations without requiring browser ImageBitmap decoding.
  delete parsed.images;
  delete parsed.textures;
  for (const mat of parsed.materials ?? []) {
    if (mat.pbrMetallicRoughness) {
      delete mat.pbrMetallicRoughness.baseColorTexture;
      delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete mat.normalTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
  }

  const rawJsonBytes = UTF8_ENCODER.encode(JSON.stringify(parsed));
  const padBytes = (4 - (rawJsonBytes.length % 4)) % 4;
  const strippedJson = new Uint8Array(rawJsonBytes.length + padBytes);
  strippedJson.set(rawJsonBytes, 0);
  strippedJson.fill(0x20, rawJsonBytes.length);

  const binChunk = raw.subarray(20 + jsonLength);
  const totalLength = 20 + strippedJson.length + binChunk.length;
  const rebuilt = new Uint8Array(totalLength);
  rebuilt.set(raw.subarray(0, 12), 0);
  const outView = new DataView(rebuilt.buffer);
  outView.setUint32(8, totalLength, true);
  outView.setUint32(12, strippedJson.length, true);
  outView.setUint32(16, 0x4e4f534a, true);
  rebuilt.set(strippedJson, 20);
  rebuilt.set(binChunk, 20 + strippedJson.length);

  const loader = new GLTFLoader();
  return new Promise<LoadedCharacterAsset>((resolveAsset, rejectAsset) => {
    loader.parse(
      rebuilt.buffer,
      '',
      (gltf) => {
        resolveAsset({ scene: gltf.scene, animations: gltf.animations });
      },
      (err) => {
        rejectAsset(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function createMockFerrariTemplateForPlates(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 1.1, 4.4),
    new THREE.MeshStandardMaterial({ name: 'Body_Color', color: 0xcc0000 }),
  );
  body.name = 'body';
  body.position.set(0, 0.7, 0);
  root.add(body);

  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.14, 0.08),
    new THREE.MeshStandardMaterial({ name: 'Taillight_Glass', color: 0xff0000 }),
  );
  tail.name = 'lights_red';
  tail.position.set(0, 0.72, 2.2);
  root.add(tail);

  for (const [name, x, z] of [
    ['wheel_fl', -0.9, -1.35],
    ['wheel_fr', 0.9, -1.35],
    ['wheel_rl', -0.9, 1.35],
    ['wheel_rr', 0.9, 1.35],
  ] as const) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10),
      new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    wheel.name = name;
    wheel.position.set(x, 0.35, z);
    root.add(wheel);
  }
  return root;
}

function countMeshVertices(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const pos = node.geometry.getAttribute('position');
      if (pos) {
        total += pos.count;
      }
    }
  });
  return total;
}

describe('Colombian license plates and sculpted clearcoat Cali fleet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates authentic Colombian plate CanvasTextures when DOM is present and falls back to null headlessly', () => {
    expect(createColombianPlateTexture('R4T · 680', 'CALI', 'private_yellow')).toBeNull();
    expect(createColombianPlateTexture('PNC · 123', 'CALI', 'public_white')).toBeNull();

    const mockDoc = createMockCanvasDocument();
    vi.stubGlobal('document', mockDoc);

    const yellowPlate = createColombianPlateTexture('R4T · 680', 'CALI', 'private_yellow');
    const whitePlate = createColombianPlateTexture('PNC · 123', 'CALI', 'public_white');

    expect(yellowPlate).toBeInstanceOf(THREE.CanvasTexture);
    expect(whitePlate).toBeInstanceOf(THREE.CanvasTexture);
    expect(yellowPlate?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(whitePlate?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mockDoc.drawCalls.count).toBeGreaterThan(20);

    yellowPlate?.dispose();
    whitePlate?.dispose();
  });

  it('mounts 3D front and rear Colombian plates on every VehicleKind and Ferrari livery', () => {
    const expectedPlates: readonly {
      readonly kind: VehicleKind;
      readonly code: string;
      readonly style: 'private_yellow' | 'public_white';
      readonly hullName: string;
    }[] = [
      { kind: 'renault4_turbo', code: 'R4T · 680', style: 'private_yellow', hullName: 'renault4_hull' },
      { kind: 'spark_gt_turbo', code: 'CAL · 323', style: 'private_yellow', hullName: 'spark_gt_hull' },
      { kind: 'willys_v8', code: 'YIP · 808', style: 'private_yellow', hullName: 'willys_tub_hull' },
      { kind: 'banshee', code: 'VLC · 458', style: 'private_yellow', hullName: 'banshee_chassis' },
      { kind: 'police', code: 'PNC · 123', style: 'public_white', hullName: 'police_chassis' },
      { kind: 'taxi', code: 'WKL · 714', style: 'public_white', hullName: 'taxi_chassis' },
      { kind: 'mio_bus', code: 'MIO · 901', style: 'public_white', hullName: 'mio_front_lower' },
      { kind: 'chiva', code: 'CHV · 555', style: 'public_white', hullName: 'chiva_hull' },
    ];

    for (const spec of expectedPlates) {
      const vehicle = createVehicleMesh(spec.kind, 0xd81b3a, 0x161922, 0x00f0ff);
      const frontPlate = vehicle.getObjectByName('colombian_license_plate_front');
      const rearPlate = vehicle.getObjectByName('colombian_license_plate_rear');
      const hull = vehicle.getObjectByName(spec.hullName);

      expect(frontPlate).toBeInstanceOf(THREE.Group);
      expect(rearPlate).toBeInstanceOf(THREE.Group);
      expect(frontPlate?.userData.plateCode).toBe(spec.code);
      expect(frontPlate?.userData.plateCity).toBe('CALI');
      expect(frontPlate?.userData.plateStyle).toBe(spec.style);
      expect(rearPlate?.userData.plateCode).toBe(spec.code);
      expect(rearPlate?.userData.plateStyle).toBe(spec.style);

      // Verify front/rear plates sit proudly outside beveled bodywork (zero buried plates)
      if (hull && frontPlate && rearPlate) {
        vehicle.updateMatrixWorld(true);
        const hullBox = new THREE.Box3().setFromObject(hull);
        expect(frontPlate.position.z).toBeGreaterThanOrEqual(hullBox.max.z - 0.02);
        if (spec.kind !== 'mio_bus') {
          expect(rearPlate.position.z).toBeLessThanOrEqual(hullBox.min.z + 0.02);
        }
      }

      disposeObjectTree(vehicle);
    }

    const holder = new THREE.Group();
    const standalone = attachColombianLicensePlate(holder, 'CAL · 999', 'CALI', 'private_yellow', {
      y: 0.5,
      z: 2.0,
      facing: 'front',
    });
    expect(standalone.userData.plateCode).toBe('CAL · 999');
    disposeObjectTree(holder);

    const ferrariTemplate = createMockFerrariTemplateForPlates();
    const customFerrari = createFerrariLiveryMesh(ferrariTemplate, 'banshee', 0x16a34a, 0x00f0ff);
    const bodyMesh = customFerrari.getObjectByName('body') as THREE.Mesh;
    expect((bodyMesh.material as THREE.MeshPhysicalMaterial).color.getHex()).toBe(0x16a34a);
    expect(customFerrari.userData.underglowMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(customFerrari.getObjectByName('colombian_license_plate_front')?.userData.plateCode).toBe(
      'VLC · 458',
    );
    expect(customFerrari.getObjectByName('colombian_license_plate_rear')?.userData.plateCode).toBe(
      'VLC · 458',
    );
    disposeObjectTree(customFerrari);
    disposeObjectTree(ferrariTemplate);
  });

  it('builds 15 distinct sculpted clearcoat four-wheel VehicleKind rigs with valid bounds, wheels, lights, and sirens', () => {
    const classicKinds: readonly PlayerCarKind[] = [
      'mazda_323_coupe',
      'renault_18_gtx',
      'chevrolet_sprint_turbo',
      'chevrolet_monza',
      'nissan_sentra_b13',
      'chevette_turbo',
      'renault_twingo',
    ];
    const allKinds: readonly VehicleKind[] = [
      'renault4_turbo',
      'spark_gt_turbo',
      'willys_v8',
      'banshee',
      'police',
      'taxi',
      'mio_bus',
      'chiva',
      ...classicKinds,
    ];
    const playerKinds = new Set<PlayerCarKind>([
      'renault4_turbo',
      'spark_gt_turbo',
      'willys_v8',
      'banshee',
      ...classicKinds,
    ]);
    const vertexCounts = new Set<number>();

    const mockDoc = createMockCanvasDocument();
    vi.stubGlobal('document', mockDoc);

    for (const kind of allKinds) {
      const vehicle = createVehicleMesh(kind, 0xe11d48, 0x181c28, 0x00f0ff);
      expect(vehicle.name).toBe(`vehicle_${kind}`);

      const verts = countMeshVertices(vehicle);
      expect(verts).toBeGreaterThan(200);
      vertexCounts.add(verts);

      // Finite, non-NaN bounding box
      vehicle.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(vehicle);
      const size = box.getSize(new THREE.Vector3());
      expect(Number.isFinite(size.x) && size.x > 1.4).toBe(true);
      expect(Number.isFinite(size.y) && size.y > 1.0).toBe(true);
      expect(Number.isFinite(size.z) && size.z > 3.2).toBe(true);

      // Required runtime contracts
      const wheels = vehicle.userData.wheels as THREE.Object3D[] | undefined;
      const frontWheels = vehicle.userData.frontWheels as THREE.Object3D[] | undefined;
      const brakeLights = vehicle.userData.brakeLightMaterials as
        | THREE.MeshStandardMaterial[]
        | undefined;
      expect(wheels?.length).toBeGreaterThanOrEqual(4);
      expect(frontWheels?.length).toBe(2);
      expect(brakeLights?.length).toBeGreaterThanOrEqual(1);
      expect(vehicle.userData.headlightCones).toBeInstanceOf(THREE.Object3D);

      // Must contain automotive clearcoat MeshPhysicalMaterial paint and sculpted ExtrudeGeometry
      let hasClearcoatPaint = false;
      let hasExtrudeHull = false;
      vehicle.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          if (node.geometry instanceof THREE.ExtrudeGeometry) {
            hasExtrudeHull = true;
          }
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshPhysicalMaterial && mat.clearcoat >= 0.95) {
              hasClearcoatPaint = true;
            }
          }
        }
      });
      expect(hasClearcoatPaint).toBe(true);
      expect(hasExtrudeHull).toBe(true);

      if (playerKinds.has(kind as PlayerCarKind)) {
        expect(vehicle.userData.nitroFlames).toBeInstanceOf(THREE.Object3D);
        expect(vehicle.userData.underglowMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);
      }
      if (kind === 'police') {
        expect(vehicle.userData.redBeacon).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.userData.blueBeacon).toBeInstanceOf(THREE.Mesh);
        expect(vehicle.userData.sirenLight).toBeInstanceOf(THREE.PointLight);
        const sirenMats = vehicle.userData.sirenLightMaterials as
          | THREE.MeshStandardMaterial[]
          | undefined;
        expect(sirenMats?.length).toBeGreaterThanOrEqual(2);
      }
      if (kind === 'taxi') {
        expect(vehicle.getObjectByName('taxi_roof_sign')).toBeInstanceOf(THREE.Mesh);
      }

      disposeObjectTree(vehicle);
    }

    // All 15 silhouettes must have genuinely distinct procedural meshes (no shared copy-paste box)
    expect(vertexCounts.size).toBe(allKinds.length);
  });

  it('textures the moto plate and the motorizado reflective vest with canvas art when a DOM exists', () => {
    vi.stubGlobal('document', createMockCanvasDocument());
    for (const kind of ['yamaha_rx115', 'yamaha_dt125'] as const) {
      const moto = createVehicleMesh(kind, 0x1d4ed8, 0xf8fafc);
      const vest = moto.getObjectByName('moto_rider_vest') as THREE.Mesh;
      const plateFace = moto.getObjectByName('plate_face_rear') as THREE.Mesh;
      expect((vest.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.CanvasTexture);
      expect((plateFace.material as THREE.MeshPhysicalMaterial).map).toBeInstanceOf(THREE.CanvasTexture);
      disposeObjectTree(moto);
    }
  });
});

describe('Caleno GLB character rig, Cali jerseys, and prefix-stripped Mixamo retargeting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates 512px Cali jersey CanvasTextures across all 6 authentic styles and falls back headlessly', () => {
    const styles: readonly CaliJerseyStyle[] = [
      'escarlata',
      'azucarero',
      'tricolor',
      'guayabera',
      'urbano_cali',
      'police_uniform',
    ];
    for (const style of styles) {
      expect(createCaliJerseyTexture(style)).toBeNull();
    }

    const mockDoc = createMockCanvasDocument();
    vi.stubGlobal('document', mockDoc);

    for (const style of styles) {
      const tex = createCaliJerseyTexture(style);
      expect(tex).toBeInstanceOf(THREE.CanvasTexture);
      expect(tex?.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(tex?.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex?.wrapT).toBe(THREE.RepeatWrapping);
      tex?.dispose();
    }
    expect(mockDoc.drawCalls.count).toBeGreaterThan(80);
  });

  it('retargets real character.glb Mixamo clips onto real caleno.glb (prefix-stripped Hips <-> mixamorig:Hips) and builds grounded 1.78m rig', async () => {
    const [calenoAsset, soldierAsset] = await Promise.all([
      loadRealGlbForHeadlessTest('public/models/caleno.glb'),
      loadRealGlbForHeadlessTest('public/models/character.glb'),
    ]);

    const retargeted = retargetMixamoClips(soldierAsset, calenoAsset.scene);
    const clipNames = retargeted.map((clip) => clip.name);
    expect(clipNames).toContain('Idle');
    expect(clipNames).toContain('Walk');
    expect(clipNames).toContain('Run');

    const walkClip = retargeted.find((clip) => clip.name === 'Walk');
    expect(walkClip).toBeDefined();
    const walkTrackNames = walkClip?.tracks.map((track) => track.name) ?? [];
    expect(walkTrackNames).toContain('Hips.quaternion');
    expect(walkTrackNames).toContain('Spine.quaternion');
    expect(walkTrackNames).toContain('LeftUpLeg.quaternion');
    expect(walkTrackNames.some((name) => name.endsWith('.scale'))).toBe(false);

    // Record template material before rigging to prove immutability
    const templateTopMesh = calenoAsset.scene.getObjectByName('Wolf3D_Outfit_Top') as THREE.Mesh;
    const templateTopMat = templateTopMesh.material as THREE.MeshStandardMaterial;
    const origTopColor = templateTopMat.color.getHex();

    const mockDoc = createMockCanvasDocument();
    vi.stubGlobal('document', mockDoc);

    const rigBearded = createCalenoCharacterRig(calenoAsset, soldierAsset, {
      skinToneHex: 0xb87b56,
      outfit: 'escarlata',
      showBeard: true,
      showHeadwear: false,
    });
    const rigClean = createCalenoCharacterRig(calenoAsset, soldierAsset, {
      skinToneHex: 0xddab84,
      outfit: 'guayabera',
      showBeard: false,
      showHeadwear: true,
    });

    // Template stays strictly untouched
    expect(templateTopMat.color.getHex()).toBe(origTopColor);

    // Verify grounding at y = 0 and 1.78m height on visible meshes
    rigBearded.group.updateMatrixWorld(true);
    const modelRoot = rigBearded.group.getObjectByName('caleno_model_root');
    expect(modelRoot).toBeDefined();
    const visibleBox = new THREE.Box3();
    modelRoot?.traverse((node) => {
      if (node instanceof THREE.Mesh && node.visible) {
        visibleBox.expandByObject(node);
      }
    });
    const size = visibleBox.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(1.78, 2);
    expect(visibleBox.min.y).toBeCloseTo(0, 2);

    // Verify independent cloned materials + beard/headwear toggles + natural non-plastic skin PBR
    const beardedTop = rigBearded.group.getObjectByName('Wolf3D_Outfit_Top') as THREE.Mesh;
    const beardedTopMat = beardedTop.material as THREE.MeshStandardMaterial;
    expect(beardedTopMat).not.toBe(templateTopMat);
    expect(beardedTopMat.map).toBeInstanceOf(THREE.CanvasTexture);

    const beardedHead = rigBearded.group.getObjectByName('Wolf3D_Head') as THREE.Mesh;
    const headMat = beardedHead.material as THREE.MeshStandardMaterial;
    expect(headMat.roughness).toBeGreaterThanOrEqual(0.65);
    expect(headMat.metalness).toBeLessThanOrEqual(0.05);

    expect(rigBearded.group.getObjectByName('Wolf3D_Beard')?.visible).toBe(true);
    expect(rigBearded.group.getObjectByName('Wolf3D_Headwear')?.visible).toBe(false);
    expect(rigClean.group.getObjectByName('Wolf3D_Beard')?.visible).toBe(false);
    expect(rigClean.group.getObjectByName('Wolf3D_Headwear')?.visible).toBe(true);

    // Locomotion actions bound and Idle running
    expect(rigBearded.actions.idle).toBeDefined();
    expect(rigBearded.actions.walk).toBeDefined();
    expect(rigBearded.actions.run).toBeDefined();
    expect(rigBearded.actions.idle?.isRunning()).toBe(true);

    disposeObjectTree(rigBearded.group);
    disposeObjectTree(rigClean.group);
  });

  it('alternates 6-arg civilian pedestrians strictly between Caleno and Valeria rigs and never renders sci-fi soldiers', async () => {
    const [calenoAsset, soldierAsset] = await Promise.all([
      loadRealGlbForHeadlessTest('public/models/caleno.glb'),
      loadRealGlbForHeadlessTest('public/models/character.glb'),
    ]);
    const valeriaAsset = createMinimalSkinnedCharacter('valeria_c8', 0, 0, []);

    // Never falls back to rendering Soldier.glb when both valeria & caleno are null
    expect(
      createCivilianPedestrianRig(null, null, soldierAsset, 0, 0xff2e93, 0x223344),
    ).toBeNull();

    const ped0 = createCivilianPedestrianRig(
      valeriaAsset,
      calenoAsset,
      soldierAsset,
      0,
      0xc8102e,
      0x1e293b,
    );
    const ped1 = createCivilianPedestrianRig(
      valeriaAsset,
      calenoAsset,
      soldierAsset,
      1,
      0x0b7a3e,
      0x334155,
    );

    expect(ped0?.group.name).toBe('cali_civilian_caleno');
    expect(ped1?.group.name).toBe('cali_civilian_valeria');
    expect(ped0?.actions.walk).toBeDefined();
    expect(ped1?.actions.walk).toBeDefined();

    // Valeria player rig accepts Cali outfit colorways while staying warm Morena Calena
    const outfits: readonly CaliOutfitId[] = [
      'urbano_cali',
      'escarlata',
      'azucarero',
      'tricolor',
      'guayabera',
    ];
    for (const outfit of outfits) {
      const valeriaRig = createValeriaPlayerMesh(valeriaAsset, soldierAsset, { outfit });
      expect(valeriaRig.group.userData.outfit).toBe(outfit);
      disposeObjectTree(valeriaRig.group);
    }

    if (ped0) {
      disposeObjectTree(ped0.group);
    }
    if (ped1) {
      disposeObjectTree(ped1.group);
    }
  });
});

describe('ParticleSystem.emitExhaustBackfire', () => {
  it('emits twin-pipe blue/orange-gold exhaust backfire pops, respects pool cap, and disposes cleanly', () => {
    const particles = new ParticleSystem(40);

    // Non-positive or NaN intensity must be safe no-ops
    particles.emitExhaustBackfire(0, 0.3, 0, 0, 0);
    particles.emitExhaustBackfire(0, 0.3, 0, 0, -1);
    particles.emitExhaustBackfire(0, 0.3, 0, 0, Number.NaN);
    expect(particles.getActiveCount()).toBe(0);

    particles.emitExhaustBackfire(4, 0.3, -6, Math.PI * 0.5, 1.2);
    const spawned = particles.getActiveCount();
    expect(spawned).toBeGreaterThanOrEqual(4);
    expect(spawned).toBeLessThanOrEqual(40);

    // Burst repeatedly to confirm strict maxParticles cap enforcement
    for (let i = 0; i < 12; i += 1) {
      particles.emitExhaustBackfire(4, 0.3, -6, 0, 1.5);
      expect(particles.getActiveCount()).toBeLessThanOrEqual(40);
    }

    // Backfire pops are punchy and decay completely to zero
    for (let step = 0; step < 30; step += 1) {
      particles.update(0.05);
    }
    expect(particles.getActiveCount()).toBe(0);

    particles.dispose();
    particles.emitExhaustBackfire(0, 0.3, 0, 0, 1.0);
    expect(particles.getActiveCount()).toBe(0);
  });
});

describe('Automotive smoked cabin glass, solid roof/pillars, and defensive jersey disposal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('equips every closed-roof Colombian car with smoked metallic glass, a capping solid clearcoat roof, and A/B/C pillars', () => {
    const closedRoofSpecs: readonly {
      readonly kind: VehicleKind;
      readonly glassName: string;
      readonly roofName: string;
      readonly pillarsName: string;
      readonly minPillarMeshes: number;
    }[] = [
      {
        kind: 'renault4_turbo',
        glassName: 'renault4_cabin_glass',
        roofName: 'renault4_roof',
        pillarsName: 'renault4_pillars',
        minPillarMeshes: 8,
      },
      {
        kind: 'spark_gt_turbo',
        glassName: 'spark_gt_cabin_glass',
        roofName: 'spark_gt_floating_roof',
        pillarsName: 'spark_gt_pillars',
        minPillarMeshes: 8,
      },
      {
        kind: 'police',
        glassName: 'police_cabin_glass',
        roofName: 'police_roof',
        pillarsName: 'police_pillars',
        minPillarMeshes: 10,
      },
      {
        kind: 'taxi',
        glassName: 'taxi_cabin_glass',
        roofName: 'taxi_roof',
        pillarsName: 'taxi_pillars',
        minPillarMeshes: 8,
      },
    ];

    for (const spec of closedRoofSpecs) {
      const vehicle = createVehicleMesh(spec.kind, 0xe63946, 0x0b7a45, 0x00f0ff);
      vehicle.updateMatrixWorld(true);

      const glassMesh = vehicle.getObjectByName(spec.glassName) as THREE.Mesh | undefined;
      expect(glassMesh).toBeInstanceOf(THREE.Mesh);
      const glassMat = glassMesh?.material as THREE.MeshPhysicalMaterial | undefined;
      expect(glassMat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(glassMat?.color.getHex()).toBe(0x0b1522);
      expect(glassMat?.transparent).toBe(true);
      expect(glassMat?.opacity).toBeCloseTo(0.86, 3);
      expect(glassMat?.roughness).toBeCloseTo(0.05, 3);
      expect(glassMat?.metalness).toBeCloseTo(0.55, 3);
      expect(glassMat?.clearcoat).toBeCloseTo(1.0, 3);
      expect(glassMat?.envMapIntensity).toBeCloseTo(1.65, 3);

      const roofMesh = vehicle.getObjectByName(spec.roofName) as THREE.Mesh | undefined;
      expect(roofMesh).toBeInstanceOf(THREE.Mesh);
      const roofMat = roofMesh?.material as THREE.MeshPhysicalMaterial | undefined;
      expect(roofMat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(roofMat?.transparent).toBe(false);
      expect(roofMat?.opacity).toBe(1);
      expect(roofMat?.clearcoat).toBeGreaterThanOrEqual(0.95);

      // Solid roof panel cap must be at least as wide as cabin glass so edges never look hollow
      if (glassMesh && roofMesh) {
        const glassBox = new THREE.Box3().setFromObject(glassMesh);
        const roofBox = new THREE.Box3().setFromObject(roofMesh);
        const glassWidth = glassBox.max.x - glassBox.min.x;
        const roofWidth = roofBox.max.x - roofBox.min.x;
        expect(roofWidth).toBeGreaterThanOrEqual(glassWidth + 0.04);
      }

      const pillarsGroup = vehicle.getObjectByName(spec.pillarsName);
      expect(pillarsGroup).toBeInstanceOf(THREE.Group);
      let solidPillarMeshes = 0;
      pillarsGroup?.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const mat = node.material;
          expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
          if (mat instanceof THREE.MeshPhysicalMaterial) {
            expect(mat.transparent).toBe(false);
            expect(mat.clearcoat).toBeGreaterThanOrEqual(0.95);
          }
          solidPillarMeshes += 1;
        }
      });
      expect(solidPillarMeshes).toBeGreaterThanOrEqual(spec.minPillarMeshes);

      disposeObjectTree(vehicle);
    }

    // Open-top Jeep Willys must remain open-top with its roll cage (no closed roof cap)
    const willys = createVehicleMesh('willys_v8', 0xe63946, 0x181c28, 0x00f0ff);
    expect(willys.getObjectByName('willys_roof')).toBeUndefined();
    disposeObjectTree(willys);
  });

  it('disposes unused jersey CanvasTexture when a partial Caleno template lacks Wolf3D_Outfit_Top', () => {
    const mockDoc = createMockCanvasDocument();
    vi.stubGlobal('document', mockDoc);

    const disposeSpy = vi.spyOn(THREE.CanvasTexture.prototype, 'dispose');
    const partialTemplate = createSyntheticBoneCharacter(
      'partial_caleno_template',
      ['Hips', 'Spine'],
      [],
    );

    const rig = createCalenoCharacterRig(partialTemplate, null, {
      outfit: 'escarlata',
    });

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeObjectTree(rig.group);
    disposeObjectTree(partialTemplate.scene);
  });
});
