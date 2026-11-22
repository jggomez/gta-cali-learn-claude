import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface PbrTextureSetPaths {
  readonly diff: string;
  readonly norGl: string;
  readonly rough: string;
}

export const ASSET_PATHS = {
  dracoDir: '/draco/',
  hdri: '/hdri/evening_road_01_puresky_1k.hdr',
  /** 2K Poly Haven tonemapped sRGB render of the same sky, used only as the visible background. */
  skyBackground: '/hdri/evening_road_01_puresky_2k_tonemapped.jpg',
  models: {
    ferrari: '/models/ferrari.glb',
    character: '/models/character.glb',
    valeria: '/models/valeria.glb',
    caleno: '/models/caleno.glb',
  },
  textures: {
    asphalt: {
      diff: '/textures/asphalt/diff.jpg',
      norGl: '/textures/asphalt/nor_gl.jpg',
      rough: '/textures/asphalt/rough.jpg',
    },
    sidewalk: {
      diff: '/textures/sidewalk/diff.jpg',
      norGl: '/textures/sidewalk/nor_gl.jpg',
      rough: '/textures/sidewalk/rough.jpg',
    },
    terrain: {
      diff: '/textures/terrain/diff.jpg',
      norGl: '/textures/terrain/nor_gl.jpg',
      rough: '/textures/terrain/rough.jpg',
    },
    plaster: {
      diff: '/textures/plaster/diff.jpg',
      norGl: '/textures/plaster/nor_gl.jpg',
      rough: '/textures/plaster/rough.jpg',
    },
    roof: {
      diff: '/textures/roof/diff.jpg',
      norGl: '/textures/roof/nor_gl.jpg',
      rough: '/textures/roof/rough.jpg',
    },
    facade: {
      diff: '/textures/facade/diff.jpg',
      norGl: '/textures/facade/nor_gl.jpg',
      rough: '/textures/facade/rough.jpg',
    },
    palmBark: {
      diff: '/textures/palm_bark/diff.jpg',
      norGl: '/textures/palm_bark/nor_gl.jpg',
      rough: '/textures/palm_bark/rough.jpg',
    },
    palmLeaves: {
      diff: '/textures/palm_leaves/diff.jpg',
      norGl: '/textures/palm_leaves/nor_gl.jpg',
      rough: '/textures/palm_leaves/rough.jpg',
    },
    jacarandaBark: {
      diff: '/textures/jacaranda_bark/diff.jpg',
      norGl: '/textures/jacaranda_bark/nor_gl.jpg',
      rough: '/textures/jacaranda_bark/rough.jpg',
    },
    jacarandaLeaves: {
      diff: '/textures/jacaranda_leaves/diff.jpg',
      norGl: '/textures/jacaranda_leaves/nor_gl.jpg',
      rough: '/textures/jacaranda_leaves/rough.jpg',
    },
    stucco: {
      diff: '/textures/stucco/diff.jpg',
      norGl: '/textures/stucco/nor_gl.jpg',
      rough: '/textures/stucco/rough.jpg',
    },
    concrete: {
      diff: '/textures/concrete/diff.jpg',
      norGl: '/textures/concrete/nor_gl.jpg',
      rough: '/textures/concrete/rough.jpg',
    },
    terracottaPlaster: {
      diff: '/textures/terracotta_plaster/diff.jpg',
      norGl: '/textures/terracotta_plaster/nor_gl.jpg',
      rough: '/textures/terracotta_plaster/rough.jpg',
    },
  },
} as const;

export interface PhotoPbrMaterialMaps {
  readonly map: THREE.Texture;
  readonly normalMap: THREE.Texture;
  /**
   * Linear roughness texture (`THREE.NoColorSpace`). Compatible with both
   * grayscale roughness JPEGs and Poly Haven ARM-packed JPEGs because Three.js
   * `roughnessMap` reads the Green channel.
   */
  readonly roughnessMap: THREE.Texture;
  dispose(): void;
}

export interface LoadedCharacterAsset {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
}

export interface LoadedWorldTextureSets {
  readonly asphalt: PhotoPbrMaterialMaps | null;
  readonly sidewalk: PhotoPbrMaterialMaps | null;
  readonly terrain: PhotoPbrMaterialMaps | null;
  readonly plaster: PhotoPbrMaterialMaps | null;
  readonly roof: PhotoPbrMaterialMaps | null;
  readonly facade: PhotoPbrMaterialMaps | null;
  readonly palmBark: PhotoPbrMaterialMaps | null;
  readonly palmLeaves: PhotoPbrMaterialMaps | null;
  readonly jacarandaBark: PhotoPbrMaterialMaps | null;
  readonly jacarandaLeaves: PhotoPbrMaterialMaps | null;
  readonly stucco: PhotoPbrMaterialMaps | null;
  readonly concrete: PhotoPbrMaterialMaps | null;
  readonly terracottaPlaster: PhotoPbrMaterialMaps | null;
}

export interface LoadedWorldAssets {
  readonly hdriTexture: THREE.DataTexture | null;
  /** sRGB equirectangular 2K sky shown as scene background (HDRI stays the PMREM light source). */
  readonly skyBackgroundTexture: THREE.Texture | null;
  readonly ferrari: THREE.Group | null;
  readonly character: LoadedCharacterAsset | null;
  readonly valeria: LoadedCharacterAsset | null;
  readonly caleno: LoadedCharacterAsset | null;
  readonly textures: LoadedWorldTextureSets;
  dispose(): void;
}

export interface GltfLoadResult {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
}

export interface AssetLoaderDeps {
  readonly configureDraco: (decoderPath: string) => { dispose(): void };
  readonly loadHdri: (url: string) => Promise<THREE.DataTexture>;
  readonly loadGltf: (url: string) => Promise<GltfLoadResult>;
  readonly loadTexture: (url: string) => Promise<THREE.Texture>;
}

export interface AssetLoadOptions {
  /** Upper anisotropic filtering level supported by the GPU (renderer.capabilities.getMaxAnisotropy()). */
  readonly maxAnisotropy?: number;
}

const DEFAULT_TEXTURE_ANISOTROPY = 8;
const MAX_TEXTURE_ANISOTROPY = 16;

function resolveAnisotropy(options: AssetLoadOptions | undefined): number {
  const requested = options?.maxAnisotropy;
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) {
    return DEFAULT_TEXTURE_ANISOTROPY;
  }
  return Math.min(MAX_TEXTURE_ANISOTROPY, Math.floor(requested));
}

function configurePbrTexture(
  texture: THREE.Texture,
  colorSpace: THREE.ColorSpace,
  anisotropy: number,
): THREE.Texture {
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function createPhotoPbrMaterialMaps(
  map: THREE.Texture,
  normalMap: THREE.Texture,
  roughnessMap: THREE.Texture,
  anisotropy: number,
): PhotoPbrMaterialMaps {
  let disposed = false;
  configurePbrTexture(map, THREE.SRGBColorSpace, anisotropy);
  configurePbrTexture(normalMap, THREE.NoColorSpace, anisotropy);
  configurePbrTexture(roughnessMap, THREE.NoColorSpace, anisotropy);

  return {
    map,
    normalMap,
    roughnessMap,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

function collectMaterialTextures(
  material: THREE.Material,
  target: Set<THREE.Texture>,
): void {
  const values: unknown[] = Object.values(material);
  for (const value of values) {
    if (value instanceof THREE.Texture) {
      target.add(value);
    }
  }
}

function disposeObject3DTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((node) => {
    if (
      !(
        node instanceof THREE.Mesh ||
        node instanceof THREE.Line ||
        node instanceof THREE.Points
      )
    ) {
      return;
    }
    if (node.geometry instanceof THREE.BufferGeometry) {
      geometries.add(node.geometry);
    }
    const meshMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of meshMaterials) {
      if (material instanceof THREE.Material) {
        materials.add(material);
        collectMaterialTextures(material, textures);
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

function disposeWorldAssets(
  hdriTexture: THREE.DataTexture | null,
  skyBackgroundTexture: THREE.Texture | null,
  textures: LoadedWorldTextureSets,
  models: ReadonlyArray<THREE.Object3D | null>,
): void {
  hdriTexture?.dispose();
  skyBackgroundTexture?.dispose();
  for (const textureSet of Object.values(textures)) {
    textureSet?.dispose();
  }
  for (const model of models) {
    if (model) {
      disposeObject3DTree(model);
    }
  }
}

function unwrapSettled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function toLoadedCharacterAsset(
  gltf: GltfLoadResult | null,
): LoadedCharacterAsset | null {
  return gltf
    ? {
        scene: gltf.scene,
        animations: gltf.animations,
      }
    : null;
}

async function safeInvoke<T>(loader: () => Promise<T>): Promise<T> {
  return loader();
}

async function loadPbrTextureSet(
  paths: PbrTextureSetPaths,
  loadTexture: (url: string) => Promise<THREE.Texture>,
  anisotropy: number,
): Promise<PhotoPbrMaterialMaps | null> {
  const [diffRes, normalRes, roughRes] = await Promise.allSettled([
    safeInvoke(() => loadTexture(paths.diff)),
    safeInvoke(() => loadTexture(paths.norGl)),
    safeInvoke(() => loadTexture(paths.rough)),
  ]);

  if (
    diffRes.status === 'fulfilled' &&
    normalRes.status === 'fulfilled' &&
    roughRes.status === 'fulfilled'
  ) {
    return createPhotoPbrMaterialMaps(
      diffRes.value,
      normalRes.value,
      roughRes.value,
      anisotropy,
    );
  }

  // Dispose any channels that succeeded before another channel failed
  if (diffRes.status === 'fulfilled') {
    diffRes.value.dispose();
  }
  if (normalRes.status === 'fulfilled') {
    normalRes.value.dispose();
  }
  if (roughRes.status === 'fulfilled') {
    roughRes.value.dispose();
  }
  return null;
}

function createDefaultDeps(): AssetLoaderDeps {
  const gltfLoader = new GLTFLoader();
  const rgbeLoader = new RGBELoader();
  const textureLoader = new THREE.TextureLoader();

  return {
    configureDraco(decoderPath: string): { dispose(): void } {
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(decoderPath);
      dracoLoader.setDecoderConfig({ type: 'js' });
      gltfLoader.setDRACOLoader(dracoLoader);
      return dracoLoader;
    },
    loadHdri(url: string): Promise<THREE.DataTexture> {
      return rgbeLoader.loadAsync(url);
    },
    async loadGltf(url: string): Promise<GltfLoadResult> {
      const gltf: GLTF = await gltfLoader.loadAsync(url);
      return {
        scene: gltf.scene,
        animations: gltf.animations,
      };
    },
    loadTexture(url: string): Promise<THREE.Texture> {
      return textureLoader.loadAsync(url);
    },
  };
}

/**
 * Loads all local 3D models, the HDRI environment, the 2K sky background, and 13 1K
 * photographic PBR texture sets in parallel. Never throws in headless environments or when
 * individual assets fail; failed slots degrade gracefully to `null`.
 */
export async function loadWorldAssets(
  deps?: AssetLoaderDeps,
  options?: AssetLoadOptions,
): Promise<LoadedWorldAssets> {
  const activeDeps = deps ?? createDefaultDeps();
  const dracoHandle = activeDeps.configureDraco(ASSET_PATHS.dracoDir);
  const anisotropy = resolveAnisotropy(options);
  const loadSet = (paths: PbrTextureSetPaths): Promise<PhotoPbrMaterialMaps | null> =>
    loadPbrTextureSet(paths, activeDeps.loadTexture, anisotropy);

  try {
    const [
      hdriResult,
      ferrariResult,
      characterResult,
      valeriaResult,
      calenoResult,
      asphaltResult,
      sidewalkResult,
      terrainResult,
      plasterResult,
      roofResult,
      facadeResult,
      palmBarkResult,
      palmLeavesResult,
      jacarandaBarkResult,
      jacarandaLeavesResult,
      stuccoResult,
      concreteResult,
      terracottaPlasterResult,
      skyBackgroundResult,
    ] = await Promise.allSettled([
      safeInvoke(() => activeDeps.loadHdri(ASSET_PATHS.hdri)),
      safeInvoke(() => activeDeps.loadGltf(ASSET_PATHS.models.ferrari)),
      safeInvoke(() => activeDeps.loadGltf(ASSET_PATHS.models.character)),
      safeInvoke(() => activeDeps.loadGltf(ASSET_PATHS.models.valeria)),
      safeInvoke(() => activeDeps.loadGltf(ASSET_PATHS.models.caleno)),
      loadSet(ASSET_PATHS.textures.asphalt),
      loadSet(ASSET_PATHS.textures.sidewalk),
      loadSet(ASSET_PATHS.textures.terrain),
      loadSet(ASSET_PATHS.textures.plaster),
      loadSet(ASSET_PATHS.textures.roof),
      loadSet(ASSET_PATHS.textures.facade),
      loadSet(ASSET_PATHS.textures.palmBark),
      loadSet(ASSET_PATHS.textures.palmLeaves),
      loadSet(ASSET_PATHS.textures.jacarandaBark),
      loadSet(ASSET_PATHS.textures.jacarandaLeaves),
      loadSet(ASSET_PATHS.textures.stucco),
      loadSet(ASSET_PATHS.textures.concrete),
      loadSet(ASSET_PATHS.textures.terracottaPlaster),
      safeInvoke(() => activeDeps.loadTexture(ASSET_PATHS.skyBackground)),
    ]);

    const hdriTexture = unwrapSettled(hdriResult);
    if (hdriTexture) {
      hdriTexture.mapping = THREE.EquirectangularReflectionMapping;
      hdriTexture.needsUpdate = true;
    }

    const skyBackgroundTexture = unwrapSettled(skyBackgroundResult);
    if (skyBackgroundTexture) {
      skyBackgroundTexture.mapping = THREE.EquirectangularReflectionMapping;
      skyBackgroundTexture.colorSpace = THREE.SRGBColorSpace;
      skyBackgroundTexture.needsUpdate = true;
    }

    const ferrariGltf = unwrapSettled(ferrariResult);
    const ferrari = ferrariGltf ? ferrariGltf.scene : null;
    const character = toLoadedCharacterAsset(unwrapSettled(characterResult));
    const valeria = toLoadedCharacterAsset(unwrapSettled(valeriaResult));
    const caleno = toLoadedCharacterAsset(unwrapSettled(calenoResult));

    const textures: LoadedWorldTextureSets = {
      asphalt: unwrapSettled(asphaltResult),
      sidewalk: unwrapSettled(sidewalkResult),
      terrain: unwrapSettled(terrainResult),
      plaster: unwrapSettled(plasterResult),
      roof: unwrapSettled(roofResult),
      facade: unwrapSettled(facadeResult),
      palmBark: unwrapSettled(palmBarkResult),
      palmLeaves: unwrapSettled(palmLeavesResult),
      jacarandaBark: unwrapSettled(jacarandaBarkResult),
      jacarandaLeaves: unwrapSettled(jacarandaLeavesResult),
      stucco: unwrapSettled(stuccoResult),
      concrete: unwrapSettled(concreteResult),
      terracottaPlaster: unwrapSettled(terracottaPlasterResult),
    };

    let disposed = false;

    return {
      hdriTexture,
      skyBackgroundTexture,
      ferrari,
      character,
      valeria,
      caleno,
      textures,
      dispose(): void {
        if (disposed) {
          return;
        }
        disposed = true;
        disposeWorldAssets(hdriTexture, skyBackgroundTexture, textures, [
          ferrari,
          character?.scene ?? null,
          valeria?.scene ?? null,
          caleno?.scene ?? null,
        ]);
      },
    };
  } finally {
    dracoHandle.dispose();
  }
}
