/**
 * Caleño people: pure, Three.js-free policies for on-foot animation playback, character
 * level-of-detail, diffuse-atlas recoloring, and ambient role NPC placement.
 */

import type { CaliOutfitId } from '../types/game';

export type LocomotionClipState = 'idle' | 'walk' | 'run';

/**
 * Ground speed (m/s) at which the retargeted Mixamo Walk/Run clips plant their feet without
 * sliding at timeScale 1, measured from the planted-foot velocity of the real GLB rigs
 * (verified by tests/unit/world/characterLocomotion.test.ts).
 */
export const LOCOMOTION_CLIP_GROUND_SPEED_MPS: Readonly<Record<'walk' | 'run', number>> = {
  walk: 1.65,
  run: 4.5,
};

const IDLE_SPEED_THRESHOLD_MPS = 0.35;
const WALK_TO_RUN_SPEED_MPS = 3.0;
const MIN_PLAYBACK_RATE = 0.5;
const MAX_PLAYBACK_RATE = 2.0;

export interface LocomotionPlayback {
  readonly state: LocomotionClipState;
  /** Signed mixer action time scale: negative plays the gait backwards when backing up. */
  readonly timeScale: number;
}

/**
 * Chooses the gait clip and its playback rate so the animated stride matches the simulated
 * on-foot ground speed (no foot sliding), reversing the gait for backwards movement.
 */
export function resolveLocomotionPlayback(
  speedMps: number,
  isSprinting: boolean,
): LocomotionPlayback {
  const absSpeed = Number.isFinite(speedMps) ? Math.abs(speedMps) : 0;
  if (absSpeed <= IDLE_SPEED_THRESHOLD_MPS) {
    return { state: 'idle', timeScale: 1 };
  }
  const state: 'walk' | 'run' =
    isSprinting || absSpeed > WALK_TO_RUN_SPEED_MPS ? 'run' : 'walk';
  const rate = Math.min(
    MAX_PLAYBACK_RATE,
    Math.max(MIN_PLAYBACK_RATE, absSpeed / LOCOMOTION_CLIP_GROUND_SPEED_MPS[state]),
  );
  return { state, timeScale: speedMps < 0 ? -rate : rate };
}

// ---------------------------------------------------------------------------------------------
// Outfit catalogue & Valeria diffuse-atlas recoloring
// ---------------------------------------------------------------------------------------------

/** Garage/civilian outfit order; Spanish display names live in localeCali.ts. */
export const CALI_OUTFIT_IDS: readonly CaliOutfitId[] = [
  'urbano_cali',
  'escarlata',
  'azucarero',
  'tricolor',
  'guayabera',
  'camiseta_seleccion',
  'esqueleto_blanco',
  'camisa_salsera',
];

/** Regions painted in valeria.glb's baked Ch03 diffuse atlas. */
export type ValeriaAtlasRegion =
  | 'hair'
  | 'white'
  | 'top'
  | 'bottoms'
  | 'accent'
  | 'skin'
  | 'trim'
  | 'other';

export interface ValeriaPalette {
  /** Crop top color (the atlas paints it as a mauve grey). */
  readonly topHex: number;
  /** Red atlas details (sneaker panels, hair accents). */
  readonly accentHex: number;
  /** Replaces the atlas' yellow trousers. */
  readonly bottomsHex: number;
  /** Optional target skin tone; omitted keeps Valeria's natural Afro-Caleña skin. */
  readonly skinHex?: number;
  /** Optional flower print color stamped onto the top (camisa salsera). */
  readonly floralHex?: number;
}

/** Current Cali street-fashion looks for Valeria per garage outfit. */
export const VALERIA_OUTFIT_PALETTES: Readonly<Record<CaliOutfitId, ValeriaPalette>> = {
  urbano_cali: { topHex: 0xf4f1ec, accentHex: 0xff4b7d, bottomsHex: 0x4f73a8 },
  escarlata: { topHex: 0xc8102e, accentHex: 0xf4c430, bottomsHex: 0x2b3a55 },
  azucarero: { topHex: 0x0b7a3e, accentHex: 0xf7faf8, bottomsHex: 0xf0efe8 },
  tricolor: { topHex: 0xf2c200, accentHex: 0xce1126, bottomsHex: 0x0b2c6b },
  guayabera: { topHex: 0xf4efe4, accentHex: 0xd9a441, bottomsHex: 0xc8b48c },
  camiseta_seleccion: { topHex: 0xfcd116, accentHex: 0x003893, bottomsHex: 0x3f5f93 },
  esqueleto_blanco: { topHex: 0xfafafa, accentHex: 0x1c1c1c, bottomsHex: 0x1e1e24 },
  camisa_salsera: {
    topHex: 0xe23d6e,
    accentHex: 0xffc145,
    bottomsHex: 0x1e1e24,
    floralHex: 0xfff3c4,
  },
};

/** Cache key for a recolored atlas variant (outfit + optional skin tone). */
export function valeriaRecolorKey(outfit: CaliOutfitId, skinHex: number | undefined): string {
  const skin =
    skinHex === undefined || !Number.isFinite(skinHex)
      ? 'natural'
      : Math.max(0, Math.floor(skinHex)).toString(16).padStart(6, '0');
  return `${outfit}|${skin}`;
}

interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  return { h: h < 0 ? h + 360 : h, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

/** Classifies one atlas pixel by HSV into the garment/body region it belongs to. */
export function classifyValeriaAtlasPixel(r: number, g: number, b: number): ValeriaAtlasRegion {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.16) {
    return 'hair';
  }
  if (s < 0.22) {
    if (v < 0.3) return 'hair';
    return v >= 0.8 ? 'white' : 'top';
  }
  if (h >= 38 && h <= 70 && s > 0.35 && v > 0.45) {
    return 'bottoms';
  }
  if ((h <= 12 || h >= 340) && s > 0.6 && v > 0.35) {
    return 'accent';
  }
  if (h >= 5 && h <= 45) {
    return 'skin';
  }
  if (h >= 165 && h <= 225) {
    return 'trim';
  }
  return 'other';
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mean albedo of each recolorable region in the original atlas (shading reference). */
const ATLAS_REFERENCE_LUMA: Readonly<Record<'top' | 'bottoms' | 'accent', number>> = {
  top: luma(115, 103, 100),
  bottoms: luma(251, 216, 90),
  accent: luma(228, 46, 36),
};
const ATLAS_SKIN_REFERENCE: readonly [number, number, number] = [100, 64, 40];
const FLORAL_CELL_PX = 22;
const MAX_SHADE_GAIN = 1.35;

function hexToRgb(hex: number): readonly [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function hashCell(cx: number, cy: number): number {
  const n = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function isFloralPetal(x: number, y: number): boolean {
  const cx = Math.floor(x / FLORAL_CELL_PX);
  const cy = Math.floor(y / FLORAL_CELL_PX);
  const centerX = (cx + 0.3 + hashCell(cx, cy) * 0.4) * FLORAL_CELL_PX;
  const centerY = (cy + 0.3 + hashCell(cy, cx) * 0.4) * FLORAL_CELL_PX;
  const dx = x - centerX;
  const dy = y - centerY;
  // Five-petal hibiscus silhouette
  const radius = FLORAL_CELL_PX * (0.22 + 0.1 * Math.cos(Math.atan2(dy, dx) * 5));
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Recolors Valeria's baked RGBA diffuse atlas in place: yellow trousers become the outfit
 * bottoms, the mauve crop top takes the jersey color (optionally flower-printed), red details
 * take the accent color, and skin shifts toward an optional tone. Painted shading is preserved
 * via luminance ratios; curly black hair, white sneakers, cyan hair ties and alpha are untouched.
 */
export function recolorValeriaAtlasPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: ValeriaPalette,
): void {
  const top = hexToRgb(palette.topHex);
  const accent = hexToRgb(palette.accentHex);
  const bottoms = hexToRgb(palette.bottomsHex);
  const floral = palette.floralHex !== undefined ? hexToRgb(palette.floralHex) : null;
  const skinRatio =
    palette.skinHex !== undefined && Number.isFinite(palette.skinHex)
      ? hexToRgb(palette.skinHex).map((c, i) =>
          Math.min(2.2, Math.max(0.55, c / (ATLAS_SKIN_REFERENCE[i] ?? 1))),
        )
      : null;
  const pixelCount = Math.min(width * height, Math.floor(data.length / 4));

  for (let p = 0; p < pixelCount; p += 1) {
    const i = p * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    let target: readonly [number, number, number];
    let reference: number;

    switch (classifyValeriaAtlasPixel(r, g, b)) {
      case 'top':
        target = floral && isFloralPetal(p % width, Math.floor(p / width)) ? floral : top;
        reference = ATLAS_REFERENCE_LUMA.top;
        break;
      case 'bottoms':
        target = bottoms;
        reference = ATLAS_REFERENCE_LUMA.bottoms;
        break;
      case 'accent':
        target = accent;
        reference = ATLAS_REFERENCE_LUMA.accent;
        break;
      case 'skin':
        if (skinRatio) {
          data[i] = r * (skinRatio[0] ?? 1);
          data[i + 1] = g * (skinRatio[1] ?? 1);
          data[i + 2] = b * (skinRatio[2] ?? 1);
        }
        continue;
      default:
        continue;
    }

    const shade = Math.min(MAX_SHADE_GAIN, luma(r, g, b) / reference);
    data[i] = target[0] * shade;
    data[i + 1] = target[1] * shade;
    data[i + 2] = target[2] * shade;
  }
}

// ---------------------------------------------------------------------------------------------
// Civilian looks
// ---------------------------------------------------------------------------------------------

export type CalenoHeadAccessory = 'none' | 'gorra' | 'gorra_reversa' | 'sombrero_vueltiao';

/** Vallecaucano skin tones from deep Afro-Pacific brown to warm tan. */
export const VALLECAUCANO_SKIN_TONES: readonly number[] = [
  0x6e4630, // Deep Afro-Pacific brown
  0x8c5a3c, // Deep bronze
  0xa86f4c, // Rich cinnamon
  0xc48b66, // Warm cinnamon
  0xd6a47e, // Golden olive
  0xe4ba98, // Warm tan
];

/** Caleña skin targets for Valeria's atlas; `undefined` keeps her natural Afro-Caleña tone. */
const CALENA_SKIN_TONES: readonly (number | undefined)[] = [
  undefined,
  0x8c5a3c,
  0xa86f4c,
  undefined,
  0xc48b66,
  0x6e4630,
];

/** One rare sombrero vueltiao in nine Caleño heads; gorras (some backwards) are common. */
const CALENO_HEAD_ROTATION: readonly CalenoHeadAccessory[] = [
  'gorra',
  'none',
  'gorra_reversa',
  'none',
  'sombrero_vueltiao',
  'gorra',
  'none',
  'gorra_reversa',
  'none',
];

export interface CivilianLook {
  readonly body: 'caleno' | 'valeria';
  readonly outfit: CaliOutfitId;
  readonly skinHex: number | undefined;
  readonly headAccessory: CalenoHeadAccessory;
  readonly sunglasses: boolean;
  readonly showBeard: boolean;
}

/**
 * Deterministic street look for civilian #index: Caleño men and Caleña women alternate,
 * cycling every Cali outfit, skin tone, gorra/sombrero, sunglasses and beard combination.
 */
export function resolveCivilianLook(index: number): CivilianLook {
  const safeIndex = Math.abs(Math.floor(Number.isFinite(index) ? index : 0));
  const slot = Math.floor(safeIndex / 2);
  const outfitCount = CALI_OUTFIT_IDS.length;
  if (safeIndex % 2 === 0) {
    return {
      body: 'caleno',
      outfit: CALI_OUTFIT_IDS[(slot * 3) % outfitCount] ?? 'urbano_cali',
      skinHex: VALLECAUCANO_SKIN_TONES[slot % VALLECAUCANO_SKIN_TONES.length],
      headAccessory: CALENO_HEAD_ROTATION[slot % CALENO_HEAD_ROTATION.length] ?? 'none',
      sunglasses: slot % 4 === 1,
      showBeard: slot % 2 === 0,
    };
  }
  return {
    body: 'valeria',
    outfit: CALI_OUTFIT_IDS[(slot * 3 + 1) % outfitCount] ?? 'urbano_cali',
    skinHex: CALENA_SKIN_TONES[slot % CALENA_SKIN_TONES.length],
    headAccessory: 'none',
    sunglasses: false,
    showBeard: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Character level of detail
// ---------------------------------------------------------------------------------------------

export interface CharacterLod {
  readonly visible: boolean;
  /** Mixer update cadence: 1 = every frame, 2 = every other frame, 0 = frozen. */
  readonly updateInterval: 0 | 1 | 2;
  readonly castShadow: boolean;
}

const LOD_FULL_RATE_METERS = 25;
const LOD_HALF_RATE_METERS = 60;
export const CHARACTER_HIDE_DISTANCE_METERS = 95;

/** Distance-based animation/shadow budget for rigged characters (squared distance input). */
export function resolveCharacterLod(distanceSq: number): CharacterLod {
  if (!Number.isFinite(distanceSq) || distanceSq > CHARACTER_HIDE_DISTANCE_METERS ** 2) {
    return { visible: false, updateInterval: 0, castShadow: false };
  }
  if (distanceSq < LOD_FULL_RATE_METERS ** 2) {
    return { visible: true, updateInterval: 1, castShadow: true };
  }
  if (distanceSq < LOD_HALF_RATE_METERS ** 2) {
    return { visible: true, updateInterval: 2, castShadow: false };
  }
  return { visible: true, updateInterval: 0, castShadow: false };
}

// ---------------------------------------------------------------------------------------------
// Ambient role NPCs (vendors, salsa dancers, tinto seller, bench sitters)
// ---------------------------------------------------------------------------------------------

export type AmbientRole = 'cholado_vendor' | 'salsa_dancer' | 'tinto_vendor' | 'bench_sitter';

export interface AmbientRoleSpot {
  readonly id: string;
  readonly role: AmbientRole;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface YawedPlacement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

const VENDOR_BEHIND_CART_METERS = 0.95;
const BENCH_SEAT_OFFSET_METERS = 0.48;

/** Salsa rueda on the Bulevar del Río promenade deck (x 4.5..22.8). */
const SALSA_DANCER_SPOTS: readonly YawedPlacement[] = [
  { x: 6.4, z: 22.4, yaw: Math.PI * 0.5 },
  { x: 8.2, z: 22.4, yaw: -Math.PI * 0.5 },
  { x: 6.4, z: 25.2, yaw: Math.PI * 0.35 },
  { x: 8.2, z: 25.2, yaw: -Math.PI * 0.65 },
];

/** Vendedor de tintos with his thermos on the Bulevar del Río promenade. */
const TINTO_VENDOR_SPOT: YawedPlacement = { x: 16.2, z: 17.5, yaw: -Math.PI * 0.5 };

function offsetLocal(
  base: YawedPlacement,
  localX: number,
  localZ: number,
): { readonly x: number; readonly z: number } {
  const cos = Math.cos(base.yaw);
  const sin = Math.sin(base.yaw);
  return {
    x: base.x + localX * cos + localZ * sin,
    z: base.z - localX * sin + localZ * cos,
  };
}

/**
 * Deterministic placements for static ambient Caleño roles: one vendor behind each cholado
 * cart (facing customers), a salsa group on Bulevar del Río, a tinto seller, and people
 * resting on every other promenade bench.
 */
export function buildAmbientRoleSpots(
  choladoStands: readonly (YawedPlacement & { readonly id: string })[],
  benches: readonly YawedPlacement[],
): AmbientRoleSpot[] {
  const spots: AmbientRoleSpot[] = [];
  for (const stand of choladoStands) {
    const pos = offsetLocal(stand, 0, -VENDOR_BEHIND_CART_METERS);
    spots.push({ id: `vendor_${stand.id}`, role: 'cholado_vendor', ...pos, heading: stand.yaw });
  }
  SALSA_DANCER_SPOTS.forEach((spot, index) => {
    spots.push({ id: `salsa_${index}`, role: 'salsa_dancer', x: spot.x, z: spot.z, heading: spot.yaw });
  });
  spots.push({
    id: 'tinto_bulevar',
    role: 'tinto_vendor',
    x: TINTO_VENDOR_SPOT.x,
    z: TINTO_VENDOR_SPOT.z,
    heading: TINTO_VENDOR_SPOT.yaw,
  });
  benches.forEach((bench, index) => {
    if (index % 2 !== 0) {
      return;
    }
    const side = index % 4 === 0 ? 1 : -1;
    const pos = offsetLocal(bench, side * BENCH_SEAT_OFFSET_METERS, 0.06);
    spots.push({ id: `bench_${index}`, role: 'bench_sitter', ...pos, heading: bench.yaw });
  });
  return spots;
}
