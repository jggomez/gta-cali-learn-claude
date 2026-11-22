import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  ASSET_PATHS,
  loadWorldAssets,
  type AssetLoaderDeps,
  type PbrTextureSetPaths,
} from '../../../src/world/assetLoader';

interface NodeDirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface NodeFsModule {
  existsSync(path: URL): boolean;
  statSync(path: URL): { readonly size: number; isDirectory(): boolean };
  readFileSync(path: URL): Uint8Array;
  readdirSync(path: URL, options: { withFileTypes: true }): NodeDirent[];
}

const PUBLIC_ROOT = new URL('../../../public/', import.meta.url);
const UTF8_DECODER = new TextDecoder('utf-8');
const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB upper bound per asset file

async function loadNodeFs(): Promise<NodeFsModule> {
  const moduleId = 'node:fs';
  const mod: unknown = await import(/* @vite-ignore */ moduleId);
  return mod as NodeFsModule;
}

function resolvePublicUrl(assetPath: string): URL {
  return new URL(assetPath.replace(/^\/+/, ''), PUBLIC_ROOT);
}

function walkFiles(fs: NodeFsModule, dirUrl: URL): URL[] {
  const results: URL[] = [];
  for (const entry of fs.readdirSync(dirUrl, { withFileTypes: true })) {
    const childUrl = new URL(
      entry.isDirectory() ? `${entry.name}/` : entry.name,
      dirUrl,
    );
    if (entry.isDirectory()) {
      results.push(...walkFiles(fs, childUrl));
    } else if (entry.isFile()) {
      results.push(childUrl);
    }
  }
  return results;
}

function assertJpegMagic(bytes: Uint8Array, label: string): void {
  expect(bytes.byteLength, `${label} must be non-empty`).toBeGreaterThan(2);
  expect(bytes[0], `${label} JPEG byte 0`).toBe(0xff);
  expect(bytes[1], `${label} JPEG byte 1`).toBe(0xd8);
}

function collectAllDeclaredPaths(): string[] {
  const texturePaths = Object.values(ASSET_PATHS.textures).flatMap(
    (set: PbrTextureSetPaths) => [set.diff, set.norGl, set.rough],
  );
  return [
    ASSET_PATHS.dracoDir,
    ASSET_PATHS.hdri,
    ASSET_PATHS.models.ferrari,
    ASSET_PATHS.models.character,
    ASSET_PATHS.models.valeria,
    ASSET_PATHS.models.caleno,
    ...texturePaths,
  ];
}

interface GlbJsonChunk {
  readonly nodes?: ReadonlyArray<{ readonly name?: string }>;
  readonly materials?: ReadonlyArray<{ readonly name?: string }>;
  readonly animations?: ReadonlyArray<{ readonly name?: string }>;
}

function parseGlbJsonChunk(bytes: Uint8Array): GlbJsonChunk {
  const headerView = new DataView(bytes.buffer, bytes.byteOffset, 20);
  const jsonChunkLength = headerView.getUint32(12, true);
  const jsonChunkType = headerView.getUint32(16, true);
  expect(jsonChunkType).toBe(0x4e4f534a);
  const jsonText = UTF8_DECODER.decode(bytes.slice(20, 20 + jsonChunkLength));
  return JSON.parse(jsonText) as GlbJsonChunk;
}

describe('ASSET_PATHS local offline asset pack', () => {
  it('declares strictly local root-relative paths with zero external URLs', () => {
    for (const assetPath of collectAllDeclaredPaths()) {
      expect(assetPath.startsWith('/'), `${assetPath} must start with /`).toBe(true);
      expect(assetPath).not.toMatch(/^https?:\/\//i);
    }
  });

  it('includes local Draco JS decoder under public/draco/', async () => {
    const fs = await loadNodeFs();
    const dracoDirUrl = resolvePublicUrl(ASSET_PATHS.dracoDir);
    expect(fs.existsSync(dracoDirUrl)).toBe(true);
    expect(fs.statSync(dracoDirUrl).isDirectory()).toBe(true);

    const decoderUrl = new URL('draco_decoder.js', dracoDirUrl);
    expect(fs.existsSync(decoderUrl), 'missing draco_decoder.js').toBe(true);
    const bytes = fs.readFileSync(decoderUrl);
    expect(bytes.byteLength, 'draco_decoder.js must be non-empty').toBeGreaterThan(1024);
  });

  it('includes a valid Radiance HDRI skybox file with #?RADIANCE header', async () => {
    const fs = await loadNodeFs();
    const hdriUrl = resolvePublicUrl(ASSET_PATHS.hdri);
    expect(fs.existsSync(hdriUrl)).toBe(true);

    const bytes = fs.readFileSync(hdriUrl);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    const header = UTF8_DECODER.decode(bytes.slice(0, 10));
    expect(header).toBe('#?RADIANCE');
  });

  it('includes valid binary glTF 2.0 (.glb) vehicle and character models', async () => {
    const fs = await loadNodeFs();
    for (const glbPath of [
      ASSET_PATHS.models.ferrari,
      ASSET_PATHS.models.character,
      ASSET_PATHS.models.valeria,
      ASSET_PATHS.models.caleno,
    ]) {
      const url = resolvePublicUrl(glbPath);
      expect(fs.existsSync(url), `missing ${glbPath}`).toBe(true);
      const bytes = fs.readFileSync(url);
      expect(bytes.byteLength, `${glbPath} must be non-empty`).toBeGreaterThan(1024);
      const magic = UTF8_DECODER.decode(bytes.slice(0, 4));
      expect(magic, `${glbPath} glTF magic`).toBe('glTF');
      const headerView = new DataView(bytes.buffer, bytes.byteOffset, 12);
      expect(headerView.getUint32(4, true), `${glbPath} glTF version`).toBe(2);
      expect(headerView.getUint32(8, true), `${glbPath} declared byte length`).toBe(
        bytes.byteLength,
      );
    }
  });

  it('includes Caleño glTF model with Wolf3D outfit/skin materials, Hips bone, and < 10 MB size', async () => {
    const fs = await loadNodeFs();
    const calenoUrl = resolvePublicUrl('/models/caleno.glb');
    expect(fs.existsSync(calenoUrl), 'missing public/models/caleno.glb').toBe(true);

    const bytes = fs.readFileSync(calenoUrl);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes.byteLength).toBeLessThan(MAX_ASSET_BYTES);
    expect(UTF8_DECODER.decode(bytes.slice(0, 4))).toBe('glTF');
    const headerView = new DataView(bytes.buffer, bytes.byteOffset, 12);
    expect(headerView.getUint32(4, true)).toBe(2);

    const glbJson = parseGlbJsonChunk(bytes);
    const materialNames = (glbJson.materials ?? [])
      .map((mat) => mat.name)
      .filter((name): name is string => typeof name === 'string');
    expect(materialNames).toContain('Wolf3D_Outfit_Top');
    expect(materialNames).toContain('Wolf3D_Skin');

    const nodeNames = (glbJson.nodes ?? [])
      .map((node) => node.name)
      .filter((name): name is string => typeof name === 'string');
    expect(nodeNames).toContain('Hips');
  });

  it('includes Valeria glTF model with Mixamo rig bones, SambaDance clip, and < 10 MB size', async () => {
    const fs = await loadNodeFs();
    const valeriaUrl = resolvePublicUrl('/models/valeria.glb');
    expect(fs.existsSync(valeriaUrl), 'missing public/models/valeria.glb').toBe(true);

    const bytes = fs.readFileSync(valeriaUrl);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes.byteLength).toBeLessThan(MAX_ASSET_BYTES);
    expect(UTF8_DECODER.decode(bytes.slice(0, 4))).toBe('glTF');

    const glbJson = parseGlbJsonChunk(bytes);
    const nodeNames = (glbJson.nodes ?? [])
      .map((node) => node.name)
      .filter((name): name is string => typeof name === 'string');
    const mixamoBones = nodeNames.filter((name) => name.startsWith('mixamorig:'));
    expect(mixamoBones.length).toBeGreaterThan(0);

    const animationNames = (glbJson.animations ?? [])
      .map((clip) => clip.name)
      .filter((name): name is string => typeof name === 'string');
    expect(animationNames).toContain('SambaDance');
  });

  it('includes all 10 photographic PBR 1K JPEG texture sets with valid JPEG magic headers', async () => {
    const fs = await loadNodeFs();
    const sets = Object.entries(ASSET_PATHS.textures) as Array<
      [string, PbrTextureSetPaths]
    >;
    expect(sets).toHaveLength(10);

    for (const [kind, paths] of sets) {
      for (const [channel, filePath] of Object.entries(paths)) {
        const fileUrl = resolvePublicUrl(filePath);
        expect(fs.existsSync(fileUrl), `missing ${kind}.${channel} (${filePath})`).toBe(
          true,
        );
        const bytes = fs.readFileSync(fileUrl);
        assertJpegMagic(bytes, `${kind}.${channel}`);
      }
    }
  });

  it('keeps every file in public/ non-empty and strictly under 10 MB', async () => {
    const fs = await loadNodeFs();
    const allFiles = walkFiles(fs, PUBLIC_ROOT);
    expect(allFiles.length).toBeGreaterThanOrEqual(36);

    for (const fileUrl of allFiles) {
      const stat = fs.statSync(fileUrl);
      expect(stat.size, `${fileUrl.pathname} must be non-empty`).toBeGreaterThan(0);
      expect(
        stat.size,
        `${fileUrl.pathname} (${stat.size} bytes) exceeds 10 MB limit`,
      ).toBeLessThan(MAX_ASSET_BYTES);
    }
  });

  it('includes local attribution documentation in public/ASSETS_LICENSE.md', async () => {
    const fs = await loadNodeFs();
    const licenseUrl = resolvePublicUrl('/ASSETS_LICENSE.md');
    expect(fs.existsSync(licenseUrl)).toBe(true);
    const bytes = fs.readFileSync(licenseUrl);
    expect(bytes.byteLength).toBeGreaterThan(100);
    const licenseText = UTF8_DECODER.decode(bytes);
    expect(licenseText).toContain('models/valeria.glb');
    expect(licenseText).toContain('models/caleno.glb');
  });
});

describe('loadWorldAssets', () => {
  it('degrades cleanly without throwing in headless Node and dispose() is idempotent', async () => {
    const assets = await loadWorldAssets();

    expect(assets.hdriTexture).toBeNull();
    expect(assets.ferrari).toBeNull();
    expect(assets.character).toBeNull();
    expect(assets.valeria).toBeNull();
    expect(assets.caleno).toBeNull();
    expect(assets.textures.asphalt).toBeNull();
    expect(assets.textures.sidewalk).toBeNull();
    expect(assets.textures.terrain).toBeNull();
    expect(assets.textures.plaster).toBeNull();
    expect(assets.textures.roof).toBeNull();
    expect(assets.textures.facade).toBeNull();
    expect(assets.textures.palmBark).toBeNull();
    expect(assets.textures.palmLeaves).toBeNull();
    expect(assets.textures.jacarandaBark).toBeNull();
    expect(assets.textures.jacarandaLeaves).toBeNull();

    expect(() => assets.dispose()).not.toThrow();
    expect(() => assets.dispose()).not.toThrow();
  });

  it('configures Draco decoder, all 10 PBR sets (including ARM roughness), HDRI mapping, and full disposal', async () => {
    const setDecoderPath = vi.fn();
    const disposeDraco = vi.fn();
    const disposedTextures: THREE.Texture[] = [];
    const disposedGeometries: THREE.BufferGeometry[] = [];
    const disposedMaterials: THREE.Material[] = [];

    const trackTexture = (tex: THREE.Texture): THREE.Texture => {
      const orig = tex.dispose.bind(tex);
      tex.dispose = () => {
        disposedTextures.push(tex);
        orig();
      };
      return tex;
    };

    const createModelGroup = (name: string): THREE.Group => {
      const group = new THREE.Group();
      group.name = name;
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const origGeomDispose = geom.dispose.bind(geom);
      geom.dispose = () => {
        disposedGeometries.push(geom);
        origGeomDispose();
      };
      const mapTex = trackTexture(new THREE.Texture());
      const mat = new THREE.MeshStandardMaterial({ map: mapTex });
      const origMatDispose = mat.dispose.bind(mat);
      mat.dispose = () => {
        disposedMaterials.push(mat);
        origMatDispose();
      };
      group.add(new THREE.Mesh(geom, mat));
      return group;
    };

    const hdriTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    trackTexture(hdriTex);
    const walkClip = new THREE.AnimationClip('Walk', 1, []);
    const sambaClip = new THREE.AnimationClip('SambaDance', 1, []);

    const deps: AssetLoaderDeps = {
      configureDraco: (path: string) => {
        setDecoderPath(path);
        return { dispose: disposeDraco };
      },
      loadHdri: async () => hdriTex,
      loadGltf: async (url: string) => {
        if (url === ASSET_PATHS.models.character) {
          return { scene: createModelGroup('character'), animations: [walkClip] };
        }
        if (url === ASSET_PATHS.models.valeria) {
          return { scene: createModelGroup('valeria'), animations: [sambaClip] };
        }
        if (url === ASSET_PATHS.models.caleno) {
          return { scene: createModelGroup('caleno'), animations: [] };
        }
        return { scene: createModelGroup(url), animations: [] };
      },
      loadTexture: async () => trackTexture(new THREE.Texture()),
    };

    const assets = await loadWorldAssets(deps);

    expect(setDecoderPath).toHaveBeenCalledWith(ASSET_PATHS.dracoDir);
    expect(disposeDraco).toHaveBeenCalledTimes(1);

    expect(assets.hdriTexture).toBe(hdriTex);
    expect(assets.hdriTexture?.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(assets.ferrari).not.toBeNull();
    expect(assets.character?.animations).toEqual([walkClip]);
    expect(assets.valeria?.animations).toEqual([sambaClip]);
    expect(assets.caleno).not.toBeNull();
    expect(assets.caleno?.scene.name).toBe('caleno');

    for (const set of [assets.textures.asphalt, assets.textures.palmBark, assets.textures.jacarandaLeaves]) {
      expect(set).not.toBeNull();
      if (set) {
        expect(set.map.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(set.normalMap.colorSpace).toBe(THREE.NoColorSpace);
        expect(set.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
        for (const tex of [set.map, set.normalMap, set.roughnessMap]) {
          expect(tex.wrapS).toBe(THREE.RepeatWrapping);
          expect(tex.wrapT).toBe(THREE.RepeatWrapping);
          expect(tex.anisotropy).toBe(8);
        }
      }
    }

    assets.dispose();
    const firstDisposeTextureCount = disposedTextures.length;
    const firstDisposeGeomCount = disposedGeometries.length;
    const firstDisposeMatCount = disposedMaterials.length;

    // 1 HDRI + 30 PBR maps (10 sets * 3) + 4 model mesh textures = 35 textures
    expect(firstDisposeTextureCount).toBe(35);
    expect(firstDisposeGeomCount).toBe(4);
    expect(firstDisposeMatCount).toBe(4);

    // Idempotent second dispose does not re-dispose resources
    assets.dispose();
    expect(disposedTextures.length).toBe(firstDisposeTextureCount);
    expect(disposedGeometries.length).toBe(firstDisposeGeomCount);
    expect(disposedMaterials.length).toBe(firstDisposeMatCount);
  });

  it('isolates partial failures and disposes orphaned textures when one channel in a PBR set fails', async () => {
    const disposeDraco = vi.fn();
    const orphanedDisposes = vi.fn();

    const deps: AssetLoaderDeps = {
      configureDraco: () => ({ dispose: disposeDraco }),
      loadHdri: async () => {
        throw new Error('HDRI decode failure');
      },
      loadGltf: async (url: string) => {
        if (url === ASSET_PATHS.models.ferrari) {
          throw new Error('Ferrari load failure');
        }
        return { scene: new THREE.Group(), animations: [] };
      },
      loadTexture: async (url: string) => {
        if (url === ASSET_PATHS.textures.asphalt.rough) {
          throw new Error('Roughness map load failure');
        }
        const tex = new THREE.Texture();
        if (url.startsWith('/textures/asphalt/')) {
          const orig = tex.dispose.bind(tex);
          tex.dispose = () => {
            orphanedDisposes();
            orig();
          };
        }
        return tex;
      },
    };

    const assets = await loadWorldAssets(deps);

    expect(disposeDraco).toHaveBeenCalledTimes(1);
    expect(assets.hdriTexture).toBeNull();
    expect(assets.ferrari).toBeNull();
    expect(assets.character).not.toBeNull();
    expect(assets.valeria).not.toBeNull();
    expect(assets.caleno).not.toBeNull();
    expect(assets.textures.asphalt).toBeNull();
    expect(orphanedDisposes).toHaveBeenCalledTimes(2);
    expect(assets.textures.sidewalk).not.toBeNull();
    expect(assets.textures.palmBark).not.toBeNull();
    expect(assets.textures.palmLeaves).not.toBeNull();
    expect(assets.textures.jacarandaBark).not.toBeNull();
    expect(assets.textures.jacarandaLeaves).not.toBeNull();

    assets.dispose();
  });
});
