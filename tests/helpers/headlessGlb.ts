import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedCharacterAsset } from '../../src/world/assetLoader';

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
    extensions?: unknown;
  }>;
}

interface NodeFsReader {
  readFileSync(path: URL): Uint8Array;
}

const PUBLIC_MODELS_ROOT = new URL('../../public/', import.meta.url);
const UTF8_DECODER = new TextDecoder('utf-8');
const UTF8_ENCODER = new TextEncoder();

export async function loadRealGlbForHeadlessTest(relativePublicPath: string): Promise<LoadedCharacterAsset> {
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
    // Material extensions (e.g. KHR_materials_specular) may also reference stripped textures.
    delete mat.extensions;
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
