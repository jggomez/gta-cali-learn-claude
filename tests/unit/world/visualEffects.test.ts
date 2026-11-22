import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { ParticleSystem } from '../../../src/world/particles';

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
