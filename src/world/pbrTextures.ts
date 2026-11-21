import * as THREE from 'three';

export interface PbrTextureSet {
  readonly map: THREE.Texture;
  readonly bumpMap: THREE.Texture;
  readonly roughnessMap: THREE.Texture;
}

export interface SidewalkTextureSet {
  readonly map: THREE.Texture;
  readonly bumpMap: THREE.Texture;
}

export interface BuildingFacadeTextureSet {
  readonly map: THREE.Texture;
  readonly roughnessMap: THREE.Texture;
  readonly emissiveMap: THREE.Texture;
  readonly bumpMap: THREE.Texture;
}

export type BuildingFacadeStyle =
  | 'modern_glass'
  | 'colonial_stucco'
  | 'downtown_midrise';

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface CanvasSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

interface FacadeSurfaces {
  readonly map: CanvasSurface;
  readonly roughness: CanvasSurface;
  readonly emissive: CanvasSurface;
  readonly bump: CanvasSurface;
}

interface PeriodicNoiseGrid {
  readonly freq: number;
  readonly values: Float32Array;
}

const DEFAULT_ANISOTROPY = 4;
const TEX_SIZE = 512;

function clampByte(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return Math.round(value);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hexToRgb(hex: number): RgbColor {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function mixRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: clampByte(a.r + (b.r - a.r) * clamped),
    g: clampByte(a.g + (b.g - a.g) * clamped),
    b: clampByte(a.b + (b.b - a.b) * clamped),
  };
}

function scaleRgb(color: RgbColor, factor: number): RgbColor {
  return {
    r: clampByte(color.r * factor),
    g: clampByte(color.g * factor),
    b: clampByte(color.b * factor),
  };
}

function rgbCss(color: RgbColor, alpha = 1): string {
  if (alpha >= 1) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
}

function grayCss(level: number): string {
  const v = clampByte(level);
  return `rgb(${v}, ${v}, ${v})`;
}

function createPeriodicNoiseGrid(freq: number, seed: number): PeriodicNoiseGrid {
  const rand = createSeededRandom(seed);
  const values = new Float32Array(freq * freq);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = rand();
  }
  return { freq, values };
}

function samplePeriodicGrid(grid: PeriodicNoiseGrid, u: number, v: number): number {
  const f = grid.freq;
  const x = u * f;
  const y = v * f;
  const x0 = Math.floor(x) % f;
  const y0 = Math.floor(y) % f;
  const x1 = (x0 + 1) % f;
  const y1 = (y0 + 1) % f;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = grid.values[y0 * f + x0] ?? 0;
  const n10 = grid.values[y0 * f + x1] ?? 0;
  const n01 = grid.values[y1 * f + x0] ?? 0;
  const n11 = grid.values[y1 * f + x1] ?? 0;

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function configureTexture<T extends THREE.Texture>(
  texture: T,
  repeat: boolean,
  isColor: boolean,
): T {
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.anisotropy = DEFAULT_ANISOTROPY;
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createCanvasSurface(width: number, height: number): CanvasSurface | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  return { canvas, ctx };
}

function createFallbackTexture(
  r: number,
  g: number,
  b: number,
  a: number,
  repeat: boolean,
  isColor: boolean,
): THREE.DataTexture {
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte(r);
    data[i + 1] = clampByte(g);
    data[i + 2] = clampByte(b);
    data[i + 3] = clampByte(a);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return configureTexture(texture, repeat, isColor);
}

function finalizeCanvasTexture(
  surface: CanvasSurface,
  repeat: boolean,
  isColor: boolean,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(surface.canvas);
  return configureTexture(texture, repeat, isColor);
}

function computeTireWearLut(width: number): Float32Array {
  const tracks = [0.22, 0.36, 0.64, 0.78];
  const lut = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const u = x / width;
    let wear = 0;
    for (const center of tracks) {
      const dist = (u - center) / 0.048;
      wear = Math.max(wear, Math.exp(-dist * dist));
    }
    lut[x] = wear;
  }
  return lut;
}

function paintAsphaltMarkings(
  mapCtx: CanvasRenderingContext2D,
  bumpCtx: CanvasRenderingContext2D,
  roughCtx: CanvasRenderingContext2D,
  rand: () => number,
): void {
  const borderPositions = [22, TEX_SIZE - 30];
  for (const x of borderPositions) {
    mapCtx.fillStyle = 'rgba(235, 232, 240, 0.84)';
    mapCtx.fillRect(x, 0, 8, TEX_SIZE);
    bumpCtx.fillStyle = grayCss(172);
    bumpCtx.fillRect(x, 0, 8, TEX_SIZE);
    roughCtx.fillStyle = grayCss(162);
    roughCtx.fillRect(x, 0, 8, TEX_SIZE);
  }

  // Seamless dashed golden-yellow Cali centerline
  const dashCount = 2;
  const dashStride = TEX_SIZE / dashCount;
  const dashLength = 136;
  const centerX = TEX_SIZE / 2 - 5;

  for (let i = 0; i < dashCount; i += 1) {
    const startY = Math.round(i * dashStride + (dashStride - dashLength) * 0.5);
    mapCtx.fillStyle = '#f6c53b';
    mapCtx.fillRect(centerX, startY, 10, dashLength);
    bumpCtx.fillStyle = grayCss(182);
    bumpCtx.fillRect(centerX, startY, 10, dashLength);
    roughCtx.fillStyle = grayCss(148);
    roughCtx.fillRect(centerX, startY, 10, dashLength);
  }

  // Subtle aggregate erosion specks over road markings
  mapCtx.fillStyle = 'rgba(34, 31, 44, 0.42)';
  for (let i = 0; i < 360; i += 1) {
    const isCenter = i % 2 === 0;
    const x = isCenter
      ? centerX + rand() * 10
      : (i % 4 === 1 ? 22 : TEX_SIZE - 30) + rand() * 8;
    mapCtx.fillRect(x, rand() * TEX_SIZE, 2, 2);
  }

  // Subtle weathered tar cracks
  mapCtx.strokeStyle = 'rgba(18, 16, 26, 0.45)';
  mapCtx.lineWidth = 1.4;
  bumpCtx.strokeStyle = grayCss(55);
  bumpCtx.lineWidth = 1.6;
  roughCtx.strokeStyle = grayCss(115);
  roughCtx.lineWidth = 1.6;

  for (let crack = 0; crack < 5; crack += 1) {
    let cx = 60 + rand() * (TEX_SIZE - 120);
    let cy = rand() * TEX_SIZE;
    for (const ctx of [mapCtx, bumpCtx, roughCtx]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
    }
    for (let seg = 0; seg < 6; seg += 1) {
      cx += (rand() - 0.5) * 34;
      cy += (rand() - 0.5) * 44;
      for (const ctx of [mapCtx, bumpCtx, roughCtx]) {
        ctx.lineTo(cx, cy);
      }
    }
    for (const ctx of [mapCtx, bumpCtx, roughCtx]) {
      ctx.stroke();
    }
  }
}

export function createAsphaltTextures(): PbrTextureSet {
  const mapSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);
  const bumpSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);
  const roughSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);

  if (!mapSurface || !bumpSurface || !roughSurface) {
    return {
      map: createFallbackTexture(38, 35, 48, 255, true, true),
      bumpMap: createFallbackTexture(128, 128, 128, 255, true, false),
      roughnessMap: createFallbackTexture(196, 196, 196, 255, true, false),
    };
  }

  const rand = createSeededRandom(0xc411a501);
  const mapImg = mapSurface.ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const bumpImg = bumpSurface.ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const roughImg = roughSurface.ctx.createImageData(TEX_SIZE, TEX_SIZE);

  const coarseGrid = createPeriodicNoiseGrid(12, 0x1701);
  const dampLowGrid = createPeriodicNoiseGrid(3, 0x9103);
  const dampMidGrid = createPeriodicNoiseGrid(7, 0x4307);
  const tireWearLut = computeTireWearLut(TEX_SIZE);

  for (let y = 0; y < TEX_SIZE; y += 1) {
    const v = y / TEX_SIZE;
    for (let x = 0; x < TEX_SIZE; x += 1) {
      const u = x / TEX_SIZE;
      const idx = (y * TEX_SIZE + x) * 4;

      const grain = (rand() - 0.5) * 24;
      const coarse = (samplePeriodicGrid(coarseGrid, u, v) - 0.5) * 16;
      const tireWear = tireWearLut[x] ?? 0;

      // Seamless damp evening reflection patches for Cali sunset sky
      const dampField =
        samplePeriodicGrid(dampLowGrid, u, v) * 0.65 +
        samplePeriodicGrid(dampMidGrid, u, v) * 0.35;
      const wetness = Math.max(0, Math.min(1, (dampField - 0.56) * 3.1));

      const shoulderDarken = u < 0.035 || u > 0.965 ? 10 : 0;
      const baseTone = 39 + coarse + grain - tireWear * 7 - wetness * 11 - shoulderDarken;

      mapImg.data[idx] = clampByte(baseTone * 0.96);
      mapImg.data[idx + 1] = clampByte(baseTone * 0.93);
      mapImg.data[idx + 2] = clampByte(baseTone * 1.12);
      mapImg.data[idx + 3] = 255;

      const bumpLevel = clampByte(132 + grain * 1.6 + coarse * 0.8 - wetness * 22);
      bumpImg.data[idx] = bumpLevel;
      bumpImg.data[idx + 1] = bumpLevel;
      bumpImg.data[idx + 2] = bumpLevel;
      bumpImg.data[idx + 3] = 255;

      // Damp patches lower roughness sharply to reflect sunset neon & coral horizon
      const roughLevel = clampByte(
        222 - tireWear * 38 - wetness * 162 + grain * 0.45,
      );
      roughImg.data[idx] = roughLevel;
      roughImg.data[idx + 1] = roughLevel;
      roughImg.data[idx + 2] = roughLevel;
      roughImg.data[idx + 3] = 255;
    }
  }

  mapSurface.ctx.putImageData(mapImg, 0, 0);
  bumpSurface.ctx.putImageData(bumpImg, 0, 0);
  roughSurface.ctx.putImageData(roughImg, 0, 0);

  paintAsphaltMarkings(mapSurface.ctx, bumpSurface.ctx, roughSurface.ctx, rand);

  return {
    map: finalizeCanvasTexture(mapSurface, true, true),
    bumpMap: finalizeCanvasTexture(bumpSurface, true, false),
    roughnessMap: finalizeCanvasTexture(roughSurface, true, false),
  };
}

export function createCrosswalkTexture(): THREE.Texture {
  const width = 512;
  const height = 256;
  const surface = createCanvasSurface(width, height);

  if (!surface) {
    return createFallbackTexture(242, 240, 236, 220, false, true);
  }

  const { ctx } = surface;
  const rand = createSeededRandom(0xc411c205);
  ctx.clearRect(0, 0, width, height);

  const stripeCount = 7;
  const paddingX = 24;
  const usableWidth = width - paddingX * 2;
  const stride = usableWidth / stripeCount;
  const stripeWidth = Math.round(stride * 0.56);
  const topY = 20;
  const stripeHeight = height - 40;

  for (let i = 0; i < stripeCount; i += 1) {
    const sx = Math.round(paddingX + i * stride + (stride - stripeWidth) * 0.5);
    const grad = ctx.createLinearGradient(sx, topY, sx, topY + stripeHeight);
    grad.addColorStop(0, 'rgba(244, 242, 236, 0.90)');
    grad.addColorStop(0.5, 'rgba(232, 229, 224, 0.82)');
    grad.addColorStop(1, 'rgba(244, 242, 236, 0.90)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx, topY, stripeWidth, stripeHeight);

    ctx.fillStyle = 'rgba(42, 38, 52, 0.24)';
    ctx.fillRect(sx + stripeWidth * 0.15, topY + 26, stripeWidth * 0.22, stripeHeight - 52);
    ctx.fillRect(sx + stripeWidth * 0.63, topY + 26, stripeWidth * 0.22, stripeHeight - 52);

    for (let chip = 0; chip < 45; chip += 1) {
      ctx.clearRect(
        sx + rand() * stripeWidth,
        topY + rand() * stripeHeight,
        2 + rand() * 3,
        2 + rand() * 2,
      );
    }
  }

  return finalizeCanvasTexture(surface, false, true);
}

export function createSidewalkTextures(): SidewalkTextureSet {
  const mapSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);
  const bumpSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);

  if (!mapSurface || !bumpSurface) {
    return {
      map: createFallbackTexture(142, 134, 150, 255, true, true),
      bumpMap: createFallbackTexture(168, 168, 168, 255, true, false),
    };
  }

  const rand = createSeededRandom(0xc41151de);
  const mapCtx = mapSurface.ctx;
  const bumpCtx = bumpSurface.ctx;
  const tilesPerAxis = 8;
  const tileSize = TEX_SIZE / tilesPerAxis;
  const mortarWidth = 3;

  mapCtx.fillStyle = '#474152';
  mapCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  bumpCtx.fillStyle = grayCss(42);
  bumpCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  for (let row = 0; row < tilesPerAxis; row += 1) {
    for (let col = 0; col < tilesPerAxis; col += 1) {
      const x = col * tileSize + mortarWidth;
      const y = row * tileSize + mortarWidth;
      const w = tileSize - mortarWidth * 2;
      const h = tileSize - mortarWidth * 2;

      const toneShift = (rand() - 0.5) * 16;
      const slabColor: RgbColor = {
        r: clampByte(144 + toneShift),
        g: clampByte(136 + toneShift),
        b: clampByte(152 + toneShift),
      };

      mapCtx.fillStyle = rgbCss(slabColor);
      mapCtx.fillRect(x, y, w, h);

      mapCtx.fillStyle = 'rgba(255, 245, 255, 0.16)';
      mapCtx.fillRect(x, y, w, 3);
      mapCtx.fillRect(x, y, 3, h);

      mapCtx.fillStyle = 'rgba(24, 18, 36, 0.22)';
      mapCtx.fillRect(x, y + h - 3, w, 3);
      mapCtx.fillRect(x + w - 3, y, 3, h);

      bumpCtx.fillStyle = grayCss(clampByte(184 + toneShift * 0.7));
      bumpCtx.fillRect(x, y, w, h);

      for (let s = 0; s < 28; s += 1) {
        const sx = x + 3 + rand() * (w - 6);
        const sy = y + 3 + rand() * (h - 6);
        const dark = rand() > 0.5;
        mapCtx.fillStyle = dark ? 'rgba(56, 50, 68, 0.26)' : 'rgba(225, 218, 236, 0.24)';
        mapCtx.fillRect(sx, sy, 2, 2);
        bumpCtx.fillStyle = grayCss(dark ? 150 : 208);
        bumpCtx.fillRect(sx, sy, 2, 2);
      }
    }
  }

  // Raised beveled curb edge highlight
  const curbGrad = mapCtx.createLinearGradient(0, 0, 0, 22);
  curbGrad.addColorStop(0, 'rgba(232, 224, 242, 0.34)');
  curbGrad.addColorStop(0.7, 'rgba(130, 122, 144, 0.08)');
  curbGrad.addColorStop(1, 'rgba(32, 24, 48, 0.24)');
  mapCtx.fillStyle = curbGrad;
  mapCtx.fillRect(0, 0, TEX_SIZE, 22);

  bumpCtx.fillStyle = grayCss(224);
  bumpCtx.fillRect(0, 0, TEX_SIZE, 14);

  return {
    map: finalizeCanvasTexture(mapSurface, true, true),
    bumpMap: finalizeCanvasTexture(bumpSurface, true, false),
  };
}

function paintModernGlassFacade(
  surfaces: FacadeSurfaces,
  baseRgb: RgbColor,
  accentRgb: RgbColor,
  rand: () => number,
): void {
  const { map, roughness, emissive, bump } = surfaces;
  const mullionRgb = mixRgb(baseRgb, { r: 26, g: 24, b: 44 }, 0.65);

  map.ctx.fillStyle = rgbCss(mullionRgb);
  map.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  roughness.ctx.fillStyle = grayCss(172);
  roughness.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  emissive.ctx.fillStyle = '#000000';
  emissive.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  bump.ctx.fillStyle = grayCss(212);
  bump.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const floors = 8;
  const cols = 6;
  const floorHeight = TEX_SIZE / floors;
  const colWidth = TEX_SIZE / cols;
  const spandrelHeight = 14;
  const mullionGap = 6;

  for (let floor = 0; floor < floors; floor += 1) {
    const fy = floor * floorHeight;
    map.ctx.fillStyle = rgbCss(mixRgb(mullionRgb, accentRgb, 0.14));
    map.ctx.fillRect(0, fy, TEX_SIZE, spandrelHeight);
    bump.ctx.fillStyle = grayCss(226);
    bump.ctx.fillRect(0, fy, TEX_SIZE, spandrelHeight);

    const floorLitBias = 0.25 + rand() * 0.45;
    for (let col = 0; col < cols; col += 1) {
      const wx = col * colWidth + mullionGap * 0.5;
      const wy = fy + spandrelHeight + 2;
      const ww = colWidth - mullionGap;
      const wh = floorHeight - spandrelHeight - 4;

      const isLit = rand() < floorLitBias;
      const isCoolOffice = rand() < 0.34;
      const litColor: RgbColor = isCoolOffice
        ? mixRgb({ r: 96, g: 232, b: 255 }, accentRgb, 0.25)
        : mixRgb({ r: 255, g: 204, b: 120 }, { r: 255, g: 152, b: 96 }, rand());

      if (isLit) {
        const glassGrad = map.ctx.createLinearGradient(wx, wy, wx, wy + wh);
        glassGrad.addColorStop(0, rgbCss(scaleRgb(litColor, 0.95)));
        glassGrad.addColorStop(0.6, rgbCss(scaleRgb(litColor, 0.7)));
        glassGrad.addColorStop(1, rgbCss(scaleRgb(litColor, 0.35)));
        map.ctx.fillStyle = glassGrad;
        map.ctx.fillRect(wx, wy, ww, wh);

        const emitGrad = emissive.ctx.createLinearGradient(wx, wy, wx, wy + wh);
        emitGrad.addColorStop(0, rgbCss(litColor));
        emitGrad.addColorStop(0.55, rgbCss(scaleRgb(litColor, 0.62)));
        emitGrad.addColorStop(1, rgbCss(scaleRgb(litColor, 0.18)));
        emissive.ctx.fillStyle = emitGrad;
        emissive.ctx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      } else {
        const darkGlassGrad = map.ctx.createLinearGradient(wx, wy, wx, wy + wh);
        darkGlassGrad.addColorStop(0, rgbCss(mixRgb(baseRgb, { r: 44, g: 34, b: 78 }, 0.6)));
        darkGlassGrad.addColorStop(1, rgbCss({ r: 19, g: 18, b: 40 }));
        map.ctx.fillStyle = darkGlassGrad;
        map.ctx.fillRect(wx, wy, ww, wh);
      }

      // Low glass roughness allows PMREM sunset reflections across curtain walls
      roughness.ctx.fillStyle = grayCss(isLit ? 42 : 26);
      roughness.ctx.fillRect(wx, wy, ww, wh);
      bump.ctx.fillStyle = grayCss(88);
      bump.ctx.fillRect(wx, wy, ww, wh);
    }
  }
}

function traceArchedPath(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  winW: number,
  winH: number,
  inset: number,
): void {
  const halfW = winW * 0.5 - inset;
  const archCenterY = topY + winW * 0.5;
  ctx.beginPath();
  ctx.arc(centerX, archCenterY, halfW, Math.PI, 0);
  ctx.lineTo(centerX + halfW, topY + winH - inset);
  ctx.lineTo(centerX - halfW, topY + winH - inset);
  ctx.closePath();
}

function paintColonialBalconyRail(
  surfaces: FacadeSurfaces,
  winX: number,
  topY: number,
  winW: number,
  winH: number,
): void {
  const railY = topY + winH - 28;
  const railX = winX - 16;
  const railW = winW + 32;
  const railH = 38;

  surfaces.map.ctx.fillStyle = '#17131f';
  surfaces.map.ctx.fillRect(railX, railY, railW, 4);
  surfaces.map.ctx.fillRect(railX, railY + railH - 4, railW, 5);

  surfaces.bump.ctx.fillStyle = grayCss(232);
  surfaces.bump.ctx.fillRect(railX, railY, railW, 4);
  surfaces.bump.ctx.fillRect(railX, railY + railH - 4, railW, 5);

  for (let bx = railX + 6; bx < railX + railW - 4; bx += 10) {
    surfaces.map.ctx.fillRect(bx, railY, 3, railH);
    surfaces.bump.ctx.fillRect(bx, railY, 3, railH);
  }
}

function paintColonialWindowBay(
  surfaces: FacadeSurfaces,
  centerX: number,
  topY: number,
  hasBalcony: boolean,
  accentRgb: RgbColor,
  rand: () => number,
): void {
  const { map, roughness, emissive, bump } = surfaces;
  const winW = 58;
  const winH = 122;
  const winX = centerX - winW * 0.5;
  const woodColor = '#3a2216';

  map.ctx.fillStyle = woodColor;
  traceArchedPath(map.ctx, centerX, topY, winW, winH, -6);
  map.ctx.fill();

  bump.ctx.fillStyle = grayCss(196);
  bump.ctx.fillRect(winX - 6, topY, winW + 12, winH + 6);

  // Louvered wooden shutters
  map.ctx.fillStyle = rgbCss(mixRgb(accentRgb, { r: 62, g: 38, b: 28 }, 0.65));
  const shutterTop = topY + winW * 0.5;
  const shutterH = winH - winW * 0.5 + 4;
  map.ctx.fillRect(winX - 20, shutterTop, 14, shutterH);
  map.ctx.fillRect(winX + winW + 6, shutterTop, 14, shutterH);

  const isLit = rand() < 0.62;
  const lampColor: RgbColor = {
    r: 255,
    g: clampByte(172 + rand() * 38),
    b: clampByte(88 + rand() * 32),
  };

  map.ctx.fillStyle = isLit ? rgbCss(lampColor) : '#211c32';
  traceArchedPath(map.ctx, centerX, topY, winW, winH, 2);
  map.ctx.fill();

  roughness.ctx.fillStyle = grayCss(44);
  traceArchedPath(roughness.ctx, centerX, topY, winW, winH, 2);
  roughness.ctx.fill();

  bump.ctx.fillStyle = grayCss(82);
  traceArchedPath(bump.ctx, centerX, topY, winW, winH, 2);
  bump.ctx.fill();

  if (isLit) {
    emissive.ctx.fillStyle = rgbCss(scaleRgb(lampColor, 0.88));
    traceArchedPath(emissive.ctx, centerX, topY, winW, winH, 2);
    emissive.ctx.fill();
  }

  map.ctx.fillStyle = woodColor;
  map.ctx.fillRect(centerX - 2, topY + 6, 4, winH - 6);
  map.ctx.fillRect(winX, topY + winH * 0.54, winW, 4);

  if (hasBalcony) {
    paintColonialBalconyRail(surfaces, winX, topY, winW, winH);
  }
}

function paintColonialStuccoFacade(
  surfaces: FacadeSurfaces,
  baseRgb: RgbColor,
  accentRgb: RgbColor,
  rand: () => number,
): void {
  const { map, roughness, emissive, bump } = surfaces;
  const stuccoBase = mixRgb(baseRgb, { r: 232, g: 196, b: 158 }, 0.38);

  map.ctx.fillStyle = rgbCss(stuccoBase);
  map.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  roughness.ctx.fillStyle = grayCss(224);
  roughness.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  emissive.ctx.fillStyle = '#000000';
  emissive.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  bump.ctx.fillStyle = grayCss(148);
  bump.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // San Antonio stucco plaster speckles
  for (let i = 0; i < 1600; i += 1) {
    const px = rand() * TEX_SIZE;
    const py = rand() * TEX_SIZE;
    const warm = rand() > 0.5;
    map.ctx.fillStyle = warm ? 'rgba(255, 240, 218, 0.14)' : 'rgba(92, 62, 48, 0.12)';
    map.ctx.fillRect(px, py, 3, 3);
    bump.ctx.fillStyle = grayCss(warm ? 168 : 126);
    bump.ctx.fillRect(px, py, 2, 2);
  }

  const trimCss = rgbCss(mixRgb(accentRgb, { r: 138, g: 52, b: 56 }, 0.35));
  for (const bandY of [0, 250, 470]) {
    const bandH = bandY === 470 ? 42 : 14;
    map.ctx.fillStyle = trimCss;
    map.ctx.fillRect(0, bandY, TEX_SIZE, bandH);
    bump.ctx.fillStyle = grayCss(216);
    bump.ctx.fillRect(0, bandY, TEX_SIZE, bandH);
    roughness.ctx.fillStyle = grayCss(198);
    roughness.ctx.fillRect(0, bandY, TEX_SIZE, bandH);
  }

  const rows = [46, 290];
  const cols = 4;
  const colWidth = TEX_SIZE / cols;
  for (let r = 0; r < rows.length; r += 1) {
    const topY = rows[r] ?? 46;
    for (let c = 0; c < cols; c += 1) {
      paintColonialWindowBay(
        surfaces,
        c * colWidth + colWidth * 0.5,
        topY,
        r === 0,
        accentRgb,
        rand,
      );
    }
  }
}

function paintMidriseStorefront(
  surfaces: FacadeSurfaces,
  accentRgb: RgbColor,
  groundY: number,
): void {
  const { map, roughness, emissive, bump } = surfaces;

  map.ctx.fillStyle = '#211930';
  map.ctx.fillRect(0, groundY, TEX_SIZE, TEX_SIZE - groundY);

  const awningH = 22;
  for (let x = 0; x < TEX_SIZE; x += 24) {
    const even = (x / 24) % 2 === 0;
    map.ctx.fillStyle = even ? rgbCss(accentRgb) : '#f6efe9';
    map.ctx.fillRect(x, groundY, 24, awningH);
  }
  bump.ctx.fillStyle = grayCss(238);
  bump.ctx.fillRect(0, groundY, TEX_SIZE, awningH);
  roughness.ctx.fillStyle = grayCss(158);
  roughness.ctx.fillRect(0, groundY, TEX_SIZE, awningH);

  const bays = 3;
  const bayWidth = TEX_SIZE / bays;
  for (let bay = 0; bay < bays; bay += 1) {
    const bx = Math.round(bay * bayWidth + 14);
    const by = groundY + awningH + 8;
    const bw = Math.round(bayWidth - 28);
    const bh = TEX_SIZE - by - 10;

    const shopGlow: RgbColor =
      bay === 1
        ? mixRgb({ r: 0, g: 240, b: 255 }, accentRgb, 0.35)
        : { r: 255, g: 204, b: 128 };

    const grad = map.ctx.createLinearGradient(bx, by, bx, by + bh);
    grad.addColorStop(0, rgbCss(shopGlow));
    grad.addColorStop(1, rgbCss(scaleRgb(shopGlow, 0.42)));
    map.ctx.fillStyle = grad;
    map.ctx.fillRect(bx, by, bw, bh);

    emissive.ctx.fillStyle = rgbCss(scaleRgb(shopGlow, 0.9));
    emissive.ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
    roughness.ctx.fillStyle = grayCss(34);
    roughness.ctx.fillRect(bx, by, bw, bh);
    bump.ctx.fillStyle = grayCss(74);
    bump.ctx.fillRect(bx, by, bw, bh);
  }
}

function paintDowntownMidriseFacade(
  surfaces: FacadeSurfaces,
  baseRgb: RgbColor,
  accentRgb: RgbColor,
  rand: () => number,
): void {
  const { map, roughness, emissive, bump } = surfaces;
  const facadeRgb = mixRgb(baseRgb, { r: 128, g: 108, b: 122 }, 0.35);
  const groundY = 392;

  map.ctx.fillStyle = rgbCss(facadeRgb);
  map.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  roughness.ctx.fillStyle = grayCss(208);
  roughness.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  emissive.ctx.fillStyle = '#000000';
  emissive.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  bump.ctx.fillStyle = grayCss(154);
  bump.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Precast vertical panel joints
  map.ctx.fillStyle = 'rgba(24, 18, 36, 0.25)';
  bump.ctx.fillStyle = grayCss(76);
  for (let x = 0; x < TEX_SIZE; x += 64) {
    map.ctx.fillRect(x, 0, 2, groundY);
    bump.ctx.fillRect(x, 0, 2, groundY);
  }

  const upperFloors = 4;
  const floorHeight = 96;
  const cols = 5;
  const colWidth = TEX_SIZE / cols;

  for (let floor = 0; floor < upperFloors; floor += 1) {
    const fy = floor * floorHeight;
    map.ctx.fillStyle = rgbCss(mixRgb(facadeRgb, accentRgb, 0.32));
    map.ctx.fillRect(0, fy, TEX_SIZE, 10);
    bump.ctx.fillStyle = grayCss(228);
    bump.ctx.fillRect(0, fy, TEX_SIZE, 10);

    for (let col = 0; col < cols; col += 1) {
      const wx = Math.round(col * colWidth + 16);
      const wy = fy + 24;
      const ww = Math.round(colWidth - 32);
      const wh = 54;

      map.ctx.fillStyle = '#251d33';
      map.ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
      bump.ctx.fillStyle = grayCss(84);
      bump.ctx.fillRect(wx, wy, ww, wh);
      roughness.ctx.fillStyle = grayCss(42);
      roughness.ctx.fillRect(wx, wy, ww, wh);

      if (rand() < 0.58) {
        const cool = rand() < 0.25;
        const glowRgb: RgbColor = cool
          ? { r: 120, g: 234, b: 255 }
          : { r: 255, g: clampByte(188 + rand() * 38), b: clampByte(106 + rand() * 44) };
        map.ctx.fillStyle = rgbCss(glowRgb);
        map.ctx.fillRect(wx, wy, ww, wh);

        map.ctx.fillStyle = rgbCss(mixRgb(accentRgb, { r: 60, g: 30, b: 70 }, 0.4), 0.38);
        map.ctx.fillRect(wx, wy, ww * 0.28, wh);

        emissive.ctx.fillStyle = rgbCss(scaleRgb(glowRgb, 0.85));
        emissive.ctx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      } else {
        map.ctx.fillStyle = '#1b172c';
        map.ctx.fillRect(wx, wy, ww, wh);
      }

      map.ctx.fillStyle = rgbCss(scaleRgb(facadeRgb, 1.2));
      map.ctx.fillRect(wx - 5, wy + wh + 2, ww + 10, 5);
      bump.ctx.fillStyle = grayCss(218);
      bump.ctx.fillRect(wx - 5, wy + wh + 2, ww + 10, 5);
    }
  }

  paintMidriseStorefront(surfaces, accentRgb, groundY);
}

export function createBuildingFacadeTextures(
  style: BuildingFacadeStyle,
  baseHex: number,
  accentHex: number,
): BuildingFacadeTextureSet {
  const mapSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);
  const roughSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);
  const emissiveSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);
  const bumpSurface = createCanvasSurface(TEX_SIZE, TEX_SIZE);

  const baseRgb = hexToRgb(baseHex);
  const accentRgb = hexToRgb(accentHex);

  if (!mapSurface || !roughSurface || !emissiveSurface || !bumpSurface) {
    const fallbackRough = style === 'modern_glass' ? 48 : 204;
    return {
      map: createFallbackTexture(baseRgb.r, baseRgb.g, baseRgb.b, 255, true, true),
      roughnessMap: createFallbackTexture(
        fallbackRough,
        fallbackRough,
        fallbackRough,
        255,
        true,
        false,
      ),
      emissiveMap: createFallbackTexture(
        clampByte(accentRgb.r * 0.4),
        clampByte(accentRgb.g * 0.4),
        clampByte(accentRgb.b * 0.4),
        255,
        true,
        true,
      ),
      bumpMap: createFallbackTexture(140, 140, 140, 255, true, false),
    };
  }

  const rand = createSeededRandom(hashString(`${style}:${baseHex}:${accentHex}`));
  const surfaces: FacadeSurfaces = {
    map: mapSurface,
    roughness: roughSurface,
    emissive: emissiveSurface,
    bump: bumpSurface,
  };

  if (style === 'modern_glass') {
    paintModernGlassFacade(surfaces, baseRgb, accentRgb, rand);
  } else if (style === 'colonial_stucco') {
    paintColonialStuccoFacade(surfaces, baseRgb, accentRgb, rand);
  } else {
    paintDowntownMidriseFacade(surfaces, baseRgb, accentRgb, rand);
  }

  return {
    map: finalizeCanvasTexture(mapSurface, true, true),
    roughnessMap: finalizeCanvasTexture(roughSurface, true, false),
    emissiveMap: finalizeCanvasTexture(emissiveSurface, true, true),
    bumpMap: finalizeCanvasTexture(bumpSurface, true, false),
  };
}

export function createNeonSignTexture(label: string, colorHex: number): THREE.Texture {
  const width = 512;
  const height = 128;
  const surface = createCanvasSurface(width, height);
  const neonRgb = hexToRgb(colorHex);

  if (!surface) {
    return createFallbackTexture(neonRgb.r, neonRgb.g, neonRgb.b, 255, false, true);
  }

  const { ctx } = surface;
  const displayLabel = (label.trim() || 'CALI').toUpperCase();
  const neonCss = rgbCss(neonRgb);
  const hotCoreCss = rgbCss(mixRgb(neonRgb, { r: 255, g: 255, b: 255 }, 0.78));

  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#130928');
  bgGrad.addColorStop(0.5, '#0b0618');
  bgGrad.addColorStop(1, '#170b2e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let y = 4; y < height; y += 6) {
    ctx.fillRect(8, y, width - 16, 1);
  }

  ctx.save();
  ctx.strokeStyle = neonCss;
  ctx.shadowColor = neonCss;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  ctx.strokeStyle = hotCoreCss;
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  const targetWidth = width - 64;
  let fontSize = 68;
  ctx.font = `900 italic ${fontSize}px "Arial Narrow", "Impact", system-ui, sans-serif`;
  const measured = ctx.measureText(displayLabel).width;
  if (measured > targetWidth && measured > 0) {
    fontSize = Math.max(28, Math.floor((fontSize * targetWidth) / measured));
    ctx.font = `900 italic ${fontSize}px "Arial Narrow", "Impact", system-ui, sans-serif`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = neonCss;
  ctx.shadowBlur = 28;
  ctx.fillStyle = neonCss;
  ctx.fillText(displayLabel, width * 0.5, height * 0.53);

  ctx.shadowBlur = 12;
  ctx.strokeStyle = neonCss;
  ctx.lineWidth = 4;
  ctx.strokeText(displayLabel, width * 0.5, height * 0.53);

  ctx.shadowBlur = 4;
  ctx.fillStyle = hotCoreCss;
  ctx.fillText(displayLabel, width * 0.5, height * 0.53);
  ctx.restore();

  return finalizeCanvasTexture(surface, false, true);
}

const WATER_VERTEX_SHADER = /* glsl */ `
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vWaveHeight;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);

  float waveA = sin(worldPos.x * 0.19 + worldPos.z * 0.14 + uTime * 1.45) * 0.045;
  float waveB = cos(worldPos.x * 0.31 - worldPos.z * 0.23 - uTime * 1.15) * 0.03;
  float displacement = waveA + waveB;

  worldPos.y += displacement;
  vWorldPos = worldPos.xyz;
  vWaveHeight = displacement;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uSkyZenithColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vWaveHeight;

vec3 computeWaterNormal(vec2 p, float t) {
  float dX = 0.0;
  float dZ = 0.0;

  float p1 = p.x * 0.26 + p.y * 0.18 + t * 1.55;
  dX += cos(p1) * 0.26 * 0.16;
  dZ += cos(p1) * 0.18 * 0.16;

  float p2 = -p.x * 0.41 + p.y * 0.33 + t * 1.95;
  dX += -cos(p2) * 0.41 * 0.11;
  dZ += cos(p2) * 0.33 * 0.11;

  float p3 = p.x * 0.78 - p.y * 0.62 - t * 2.45;
  dX += cos(p3) * 0.78 * 0.06;
  dZ += -cos(p3) * 0.62 * 0.06;

  float p4 = p.x * 1.35 + p.y * 1.15 + t * 3.1;
  dX += cos(p4) * 1.35 * 0.025;
  dZ += cos(p4) * 1.15 * 0.025;

  return normalize(vec3(-dX, 1.0, -dZ));
}

void main() {
  vec3 normal = computeWaterNormal(vWorldPos.xz, uTime);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);

  float bankProximity = 1.0 - smoothstep(0.0, 0.22, min(vUv.x, 1.0 - vUv.x));
  float shallowBlend = clamp(0.28 + bankProximity * 0.58 + vWaveHeight * 2.2, 0.0, 1.0);
  vec3 waterBody = mix(uDeepColor, uShallowColor, shallowBlend);

  // Fresnel reflection of coral-violet Cali sunset sky
  float ndotv = max(dot(normal, viewDir), 0.0);
  float fresnel = clamp(0.08 + 0.88 * pow(1.0 - ndotv, 3.4), 0.0, 1.0);

  vec3 reflectDir = reflect(-viewDir, normal);
  float skyElevation = clamp(reflectDir.y * 0.75 + 0.12, 0.0, 1.0);
  vec3 skyReflection = mix(uSkyHorizonColor, uSkyZenithColor, pow(skyElevation, 0.7));

  float sunGlow = pow(max(dot(reflectDir, sunDir), 0.0), 6.0);
  skyReflection += vec3(1.0, 0.48, 0.52) * sunGlow * 0.38;

  vec3 color = mix(waterBody, skyReflection, fresnel);

  // Golden sunset specular glitter on animated ripples
  vec3 halfVec = normalize(sunDir + viewDir);
  float ndoth = max(dot(normal, halfVec), 0.0);
  float crispGlitter = pow(ndoth, 130.0) * 1.45;
  float warmSheen = pow(ndoth, 20.0) * 0.32;
  color += vec3(1.0, 0.84, 0.55) * (crispGlitter + warmSheen);

  // Subtle neon-cyan edge shimmer along Rio Cali embankments
  float edgeRipple = 0.5 + 0.5 * sin(vWorldPos.z * 0.55 + uTime * 2.6 + normal.x * 6.0);
  vec3 cyanShimmer = vec3(0.0, 0.94, 1.0) * bankProximity * (0.16 + 0.22 * edgeRipple);
  color += cyanShimmer;

  gl_FragColor = vec4(color, 0.94);
}
`;

export function createWaterShaderMaterial(): THREE.ShaderMaterial {
  const sunDirection = new THREE.Vector3(-0.62, 0.24, -0.75).normalize();
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDirection: { value: sunDirection },
      uDeepColor: { value: new THREE.Color(0x0b2238) },
      uShallowColor: { value: new THREE.Color(0x0e6b78) },
      uSkyHorizonColor: { value: new THREE.Color(0xff5e7e) },
      uSkyZenithColor: { value: new THREE.Color(0x2a1458) },
    },
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
  });
}

const ENV_SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ENV_SKY_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  vec3 zenith = vec3(0.08, 0.04, 0.20);
  vec3 midSky = vec3(0.32, 0.11, 0.44);
  vec3 horizon = vec3(1.0, 0.36, 0.54);
  vec3 groundDark = vec3(0.09, 0.05, 0.16);
  vec3 groundBounce = vec3(0.24, 0.11, 0.28);

  vec3 color;
  if (h >= 0.0) {
    float horizonBand = pow(1.0 - clamp(h, 0.0, 1.0), 2.4);
    vec3 upper = mix(midSky, zenith, smoothstep(0.18, 0.85, h));
    color = mix(upper, horizon, horizonBand);
  } else {
    float bounce = exp(h * 5.0);
    color = mix(groundDark, groundBounce, bounce);
  }

  float sunAlign = max(dot(dir, normalize(uSunDir)), 0.0);
  color += vec3(1.0, 0.62, 0.34) * pow(sunAlign, 10.0) * 0.9;
  color += vec3(1.0, 0.92, 0.72) * pow(sunAlign, 96.0) * 2.2;

  gl_FragColor = vec4(color, 1.0);
}
`;

export function createSunsetEnvironmentMap(
  renderer: THREE.WebGLRenderer,
): THREE.Texture | null {
  if (!renderer || typeof renderer.getContext !== 'function') {
    return null;
  }

  let pmrem: THREE.PMREMGenerator | null = null;
  let skyGeo: THREE.SphereGeometry | null = null;
  let skyMat: THREE.ShaderMaterial | null = null;

  try {
    if (!renderer.getContext()) {
      return null;
    }

    pmrem = new THREE.PMREMGenerator(renderer);
    const tempScene = new THREE.Scene();

    skyGeo = new THREE.SphereGeometry(20, 32, 16);
    skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(-0.62, 0.24, -0.75).normalize() },
      },
      vertexShader: ENV_SKY_VERTEX_SHADER,
      fragmentShader: ENV_SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
    });

    tempScene.add(new THREE.Mesh(skyGeo, skyMat));
    const renderTarget = pmrem.fromScene(tempScene, 0.04);
    return renderTarget.texture;
  } catch {
    return null;
  } finally {
    skyGeo?.dispose();
    skyMat?.dispose();
    pmrem?.dispose();
  }
}
