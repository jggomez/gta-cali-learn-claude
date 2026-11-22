import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  createCivilianPedestrianRig,
  createValeriaPlayerMesh,
  retargetMixamoClips,
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
  it('pre-allocates hidden asphalt ribbon quads with polygonOffset and zero initial active count', () => {
    const pool = new SkidMarkPool({ capacity: 16 });

    expect(pool.group).toBeInstanceOf(THREE.Group);
    expect(pool.group.name).toBe('cali_skid_marks');
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.group.children.length).toBe(16);

    const first = pool.group.children[0];
    expect(first).toBeInstanceOf(THREE.Mesh);
    if (first instanceof THREE.Mesh) {
      expect(first.visible).toBe(false);
      expect(first.geometry).toBeInstanceOf(THREE.PlaneGeometry);
      expect(first.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      const mat = first.material as THREE.MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      expect(mat.polygonOffset).toBe(true);
      expect(mat.polygonOffsetFactor).toBe(-2);
      expect(mat.polygonOffsetUnits).toBe(-2);
    }

    pool.dispose();
  });

  it('emits dual flush rubber strips along heading and enforces ring buffer capacity cap', () => {
    const pool = new SkidMarkPool({ capacity: 6 });

    pool.emitPair(-0.8, 0.2, 1.0, 0.8, 0.2, 1.0, Math.PI * 0.25, 1.2, 0.65);
    expect(pool.getActiveCount()).toBe(2);

    const leftStrip = pool.group.children[0] as THREE.Mesh;
    const rightStrip = pool.group.children[1] as THREE.Mesh;
    expect(leftStrip.visible).toBe(true);
    expect(rightStrip.visible).toBe(true);
    expect(leftStrip.position.y).toBeCloseTo(0.235, 3);
    expect(rightStrip.position.y).toBeCloseTo(0.235, 3);
    expect(leftStrip.rotation.order).toBe('YXZ');
    expect(leftStrip.rotation.x).toBeCloseTo(-Math.PI / 2, 4);
    expect(leftStrip.rotation.y).toBeCloseTo(Math.PI * 0.25, 4);
    expect((leftStrip.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.65, 3);

    // Over-emit past capacity=6; activeCount and child count stay capped at 6
    for (let i = 0; i < 10; i += 1) {
      pool.emitPair(-0.8, 0, i, 0.8, 0, i, 0);
      expect(pool.getActiveCount()).toBeLessThanOrEqual(6);
    }
    expect(pool.getActiveCount()).toBe(6);
    expect(pool.group.children.length).toBe(6);

    pool.dispose();
  });

  it('fades marks smoothly after 6s, expires them at 14s, and supports clear and idempotent dispose', () => {
    const pool = new SkidMarkPool({ capacity: 8 });
    pool.emitPair(-0.7, 0, 0, 0.7, 0, 0, 0, 1.0, 0.6);
    const strip = pool.group.children[0] as THREE.Mesh;
    const mat = strip.material as THREE.MeshBasicMaterial;

    // Non-positive or invalid dt must be safe no-ops
    pool.update(0);
    pool.update(-1);
    pool.update(Number.NaN);
    expect(pool.getActiveCount()).toBe(2);

    // At 5.5s, mark is still active and unfaded
    pool.update(5.5);
    expect(pool.getActiveCount()).toBe(2);
    expect(mat.opacity).toBeCloseTo(0.6, 3);

    // At 10s (past 6s fade start, before 14s expiry), opacity has smoothly dropped
    pool.update(4.5);
    expect(pool.getActiveCount()).toBe(2);
    expect(mat.opacity).toBeGreaterThan(0);
    expect(mat.opacity).toBeLessThan(0.55);

    // Past 14s, marks hide and expire back to 0
    pool.update(4.5);
    expect(pool.getActiveCount()).toBe(0);
    expect(strip.visible).toBe(false);

    // Re-emit then test clear()
    pool.emitPair(-0.7, 0, 2, 0.7, 0, 2, 0);
    expect(pool.getActiveCount()).toBe(2);
    pool.clear();
    expect(pool.getActiveCount()).toBe(0);
    expect((pool.group.children[2] as THREE.Mesh).visible).toBe(false);

    // Dispose cleans geometry and all materials, and ignores further emissions
    const geoDisposeSpy = vi.spyOn(strip.geometry, 'dispose');
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
    expect(dayHdri.fogColorHex).toBe(0xc9916a);
    expect(dayHdri.fogDensity).toBeCloseTo(0.00105, 5);

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
