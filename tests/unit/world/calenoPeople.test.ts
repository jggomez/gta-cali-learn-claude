import { describe, expect, it } from 'vitest';
import type { CaliOutfitId } from '../../../src/types/game';
import {
  CALI_OUTFIT_IDS,
  VALERIA_OUTFIT_PALETTES,
  buildAmbientRoleSpots,
  classifyValeriaAtlasPixel,
  recolorValeriaAtlasPixels,
  resolveCharacterLod,
  resolveCivilianLook,
  valeriaRecolorKey,
} from '../../../src/world/calenoPeople';

/** Real colors sampled from valeria.glb's Ch03_1001_Diffuse atlas. */
const ATLAS = {
  yellowPants: [251, 216, 90],
  yellowPantsShadow: [196, 160, 62],
  cropTopGrey: [115, 103, 100],
  skinArm: [93, 58, 36],
  skinPalm: [133, 103, 87],
  curlyHair: [26, 24, 22],
  sneakerWhite: [220, 219, 218],
  redAccent: [228, 46, 36],
  cyanHairTie: [75, 158, 169],
} as const;

function rgba(...pixels: ReadonlyArray<readonly [number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    data.set([r, g, b, 200 + i], i * 4);
  });
  return data;
}

describe('classifyValeriaAtlasPixel', () => {
  it.each([
    ['yellowPants', 'bottoms'],
    ['yellowPantsShadow', 'bottoms'],
    ['cropTopGrey', 'top'],
    ['skinArm', 'skin'],
    ['skinPalm', 'skin'],
    ['curlyHair', 'hair'],
    ['sneakerWhite', 'white'],
    ['redAccent', 'accent'],
    ['cyanHairTie', 'trim'],
  ] as const)('classifies atlas %s as %s', (key, region) => {
    const [r, g, b] = ATLAS[key];
    expect(classifyValeriaAtlasPixel(r, g, b)).toBe(region);
  });
});

describe('recolorValeriaAtlasPixels', () => {
  it('keeps hair, white sneakers, trims and alpha untouched', () => {
    const data = rgba(ATLAS.curlyHair, ATLAS.sneakerWhite, ATLAS.cyanHairTie);
    const before = Array.from(data);
    recolorValeriaAtlasPixels(data, 3, 1, VALERIA_OUTFIT_PALETTES.escarlata);
    expect(Array.from(data)).toEqual(before);
  });

  it('turns the yellow pants into the outfit bottoms (denim blue for urbano) preserving shading', () => {
    const data = rgba(ATLAS.yellowPants, ATLAS.yellowPantsShadow);
    recolorValeriaAtlasPixels(data, 2, 1, VALERIA_OUTFIT_PALETTES.urbano_cali);
    const [r0, g0, b0] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    expect(b0).toBeGreaterThan(r0);
    expect(b0).toBeGreaterThan(g0);
    // Shadowed pants pixel stays darker than the lit one
    expect((data[4] ?? 0) + (data[5] ?? 0) + (data[6] ?? 0)).toBeLessThan(r0 + g0 + b0);
    expect(data[3]).toBe(200);
  });

  it('dyes the crop top in the jersey color (América red for escarlata)', () => {
    const data = rgba(ATLAS.cropTopGrey);
    recolorValeriaAtlasPixels(data, 1, 1, VALERIA_OUTFIT_PALETTES.escarlata);
    expect(data[0] ?? 0).toBeGreaterThan(150);
    expect(data[0] ?? 0).toBeGreaterThan((data[1] ?? 0) * 2);
  });

  it('keeps her natural skin by default and shifts it only when a skin tone is requested', () => {
    const natural = rgba(ATLAS.skinArm);
    recolorValeriaAtlasPixels(natural, 1, 1, VALERIA_OUTFIT_PALETTES.urbano_cali);
    expect(Array.from(natural.slice(0, 3))).toEqual([...ATLAS.skinArm]);

    const lighter = rgba(ATLAS.skinArm);
    recolorValeriaAtlasPixels(lighter, 1, 1, {
      ...VALERIA_OUTFIT_PALETTES.urbano_cali,
      skinHex: 0xc48b66,
    });
    expect(lighter[0] ?? 0).toBeGreaterThan(ATLAS.skinArm[0]);
    // Still a warm brown (red > green > blue)
    expect(lighter[0] ?? 0).toBeGreaterThan(lighter[1] ?? 0);
    expect(lighter[1] ?? 0).toBeGreaterThan(lighter[2] ?? 0);
  });

  it('prints a floral pattern on the salsa shirt top', () => {
    const width = 64;
    const pixels = Array.from({ length: width * width }, () => ATLAS.cropTopGrey);
    const data = rgba(...pixels);
    recolorValeriaAtlasPixels(data, width, width, VALERIA_OUTFIT_PALETTES.camisa_salsera);
    const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });
});

describe('outfit catalogue', () => {
  it('offers the 8 Cali outfits including the new Selección, esqueleto and salsera looks', () => {
    expect(CALI_OUTFIT_IDS).toEqual([
      'urbano_cali',
      'escarlata',
      'azucarero',
      'tricolor',
      'guayabera',
      'camiseta_seleccion',
      'esqueleto_blanco',
      'camisa_salsera',
    ] satisfies CaliOutfitId[]);
    for (const id of CALI_OUTFIT_IDS) {
      expect(VALERIA_OUTFIT_PALETTES[id]).toBeDefined();
    }
  });

  it('builds stable texture cache keys per outfit and skin', () => {
    expect(valeriaRecolorKey('escarlata', undefined)).toBe('escarlata|natural');
    expect(valeriaRecolorKey('escarlata', 0xc48b66)).toBe('escarlata|c48b66');
  });
});

describe('resolveCharacterLod', () => {
  it('animates at full rate with shadows up close', () => {
    expect(resolveCharacterLod(10 * 10)).toEqual({ visible: true, updateInterval: 1, castShadow: true });
  });

  it('halves the mixer rate and drops shadows at mid range', () => {
    expect(resolveCharacterLod(40 * 40)).toEqual({ visible: true, updateInterval: 2, castShadow: false });
  });

  it('freezes animation far away and hides beyond 95 m', () => {
    expect(resolveCharacterLod(80 * 80)).toEqual({ visible: true, updateInterval: 0, castShadow: false });
    expect(resolveCharacterLod(96 * 96)).toEqual({ visible: false, updateInterval: 0, castShadow: false });
  });
});

describe('buildAmbientRoleSpots', () => {
  const stands = [
    { id: 'bulevar_norte', x: 15.5, z: -4.5, yaw: -Math.PI / 2 },
    { id: 'bulevar_sur', x: 16.5, z: 54.0, yaw: -Math.PI / 2 },
    { id: 'san_antonio', x: -85.0, z: 24.0, yaw: 0 },
    { id: 'estadio', x: 109.0, z: 93.0, yaw: -Math.PI * 0.25 },
    { id: 'la_ermita', x: 68.5, z: -4.5, yaw: -Math.PI / 2 },
  ];
  const benches = [
    { x: 21.0, z: 1.0, yaw: Math.PI / 2 },
    { x: 21.0, z: 11.0, yaw: Math.PI / 2 },
    { x: 21.0, z: 34.0, yaw: Math.PI / 2 },
  ];

  it('places exactly one cholado vendor behind each of the 5 stands, facing the customers', () => {
    const spots = buildAmbientRoleSpots(stands, benches);
    const vendors = spots.filter((s) => s.role === 'cholado_vendor');
    expect(vendors).toHaveLength(5);
    for (const [i, vendor] of vendors.entries()) {
      const stand = stands[i];
      if (!stand) throw new Error('missing stand');
      expect(Math.hypot(vendor.x - stand.x, vendor.z - stand.z)).toBeGreaterThan(0.6);
      expect(Math.hypot(vendor.x - stand.x, vendor.z - stand.z)).toBeLessThan(1.4);
      expect(vendor.heading).toBeCloseTo(stand.yaw, 5);
    }
  });

  it('adds a salsa group dancing on Bulevar del Río, a tinto seller and bench sitters', () => {
    const spots = buildAmbientRoleSpots(stands, benches);
    const dancers = spots.filter((s) => s.role === 'salsa_dancer');
    expect(dancers.length).toBeGreaterThanOrEqual(2);
    for (const dancer of dancers) {
      expect(dancer.x).toBeGreaterThan(4.5);
      expect(dancer.x).toBeLessThan(22.8);
    }
    expect(spots.filter((s) => s.role === 'tinto_vendor')).toHaveLength(1);
    // Every other bench is occupied to keep the rigged-character budget small
    expect(spots.filter((s) => s.role === 'bench_sitter').length).toBe(Math.ceil(benches.length / 2));
    // Deterministic
    expect(buildAmbientRoleSpots(stands, benches)).toEqual(spots);
  });
});

describe('resolveCivilianLook', () => {
  const looks = Array.from({ length: 64 }, (_, index) => resolveCivilianLook(index));
  const calenos = looks.filter((look) => look.body === 'caleno');
  const calenas = looks.filter((look) => look.body === 'valeria');

  it('alternates Caleño men and Caleña women', () => {
    expect(looks[0]?.body).toBe('caleno');
    expect(looks[1]?.body).toBe('valeria');
    expect(calenos).toHaveLength(32);
  });

  it('dresses people in every Cali outfit', () => {
    expect(new Set(looks.map((look) => look.outfit))).toEqual(new Set(CALI_OUTFIT_IDS));
  });

  it('mixes gorras (some backwards), bare heads, sunglasses and only a rare sombrero vueltiao', () => {
    const count = (head: string) => calenos.filter((look) => look.headAccessory === head).length;
    expect(count('gorra')).toBeGreaterThan(0);
    expect(count('gorra_reversa')).toBeGreaterThan(0);
    expect(count('none')).toBeGreaterThan(0);
    expect(count('sombrero_vueltiao')).toBeGreaterThan(0);
    expect(count('sombrero_vueltiao')).toBeLessThanOrEqual(calenos.length / 6);
    expect(calenos.some((look) => look.sunglasses)).toBe(true);
    expect(calenos.some((look) => look.showBeard)).toBe(true);
    expect(calenos.some((look) => !look.showBeard)).toBe(true);
  });

  it('keeps Caleñas with their natural curly hair (no hats) and varied skin tones', () => {
    expect(calenas.every((look) => look.headAccessory === 'none')).toBe(true);
    expect(new Set(calenas.map((look) => look.skinHex ?? 'natural')).size).toBeGreaterThanOrEqual(3);
  });
});
