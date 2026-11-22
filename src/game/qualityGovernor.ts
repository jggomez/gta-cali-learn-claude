/**
 * Pure, Three.js-free rendering quality policy for GTA VI: Cali.
 * Defines the low/medium/high/ultra presets, picks a startup preset from device hints, and
 * drives a dynamic resolution scaler from the smoothed FPS. The renderer only applies results.
 */

import type { QualityLevel } from '../types/game';

export type { QualityLevel };

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityPreset {
  readonly level: QualityLevel;
  /** Upper bound for the canvas pixel ratio before dynamic scaling. */
  readonly maxPixelRatio: number;
  readonly shadowMapSize: number;
  /** Fraction of the drawing buffer used by the bloom mip chain. */
  readonly bloomResolutionScale: number;
  readonly smaa: boolean;
  readonly ambientOcclusion: boolean;
  /** Pedestrians beyond this camera distance are hidden. */
  readonly pedestrianDrawDistance: number;
  /** Small static props (bollards, trims, bolts) beyond this camera distance are hidden. */
  readonly detailDrawDistance: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    level: 'low',
    maxPixelRatio: 0.85,
    shadowMapSize: 1024,
    bloomResolutionScale: 0.35,
    smaa: false,
    ambientOcclusion: false,
    pedestrianDrawDistance: 55,
    detailDrawDistance: 70,
  },
  medium: {
    level: 'medium',
    maxPixelRatio: 1.25,
    shadowMapSize: 2048,
    bloomResolutionScale: 0.5,
    smaa: true,
    ambientOcclusion: false,
    pedestrianDrawDistance: 80,
    detailDrawDistance: 110,
  },
  high: {
    level: 'high',
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    bloomResolutionScale: 0.5,
    smaa: true,
    ambientOcclusion: true,
    pedestrianDrawDistance: 95,
    detailDrawDistance: 150,
  },
  ultra: {
    level: 'ultra',
    maxPixelRatio: 2,
    shadowMapSize: 4096,
    bloomResolutionScale: 1,
    smaa: true,
    ambientOcclusion: true,
    pedestrianDrawDistance: 120,
    detailDrawDistance: 220,
  },
};

export function cycleQualityLevel(level: QualityLevel): QualityLevel {
  const index = QUALITY_LEVELS.indexOf(level);
  return QUALITY_LEVELS[(index + 1) % QUALITY_LEVELS.length] ?? 'medium';
}

export interface DeviceProfile {
  readonly devicePixelRatio: number;
  readonly isMobile: boolean;
  readonly hardwareConcurrency?: number;
  readonly deviceMemoryGb?: number;
  /** Unmasked WebGL renderer string when available. */
  readonly gpuRenderer?: string;
}

const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|software|microsoft basic render/i;

export function detectInitialQuality(profile: DeviceProfile): QualityLevel {
  if (profile.gpuRenderer && SOFTWARE_RENDERER_PATTERN.test(profile.gpuRenderer)) {
    return 'low';
  }
  const cores = profile.hardwareConcurrency ?? 4;
  const memory = profile.deviceMemoryGb ?? 8;
  if (profile.isMobile) {
    return cores <= 4 || memory <= 2 ? 'low' : 'medium';
  }
  if (cores >= 12 && memory >= 16) {
    return 'ultra';
  }
  return cores >= 8 ? 'high' : 'medium';
}

export interface ResolutionScalerState {
  /** Multiplier applied to the preset pixel ratio, in [MIN_RESOLUTION_SCALE, 1]. */
  readonly scale: number;
  readonly cooldownSeconds: number;
}

const MIN_RESOLUTION_SCALE = 0.5;
const MIN_PIXEL_RATIO = 0.5;
const FPS_DROP_THRESHOLD = 45;
const FPS_RAISE_THRESHOLD = 58;
const SCALE_DROP_STEP = 0.1;
const SCALE_RAISE_STEP = 0.05;
const COOLDOWN_AFTER_DROP_SECONDS = 1;
const COOLDOWN_AFTER_RAISE_SECONDS = 1.5;

export function createResolutionScalerState(): ResolutionScalerState {
  return { scale: 1, cooldownSeconds: 0 };
}

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lowers the resolution scale quickly when FPS sags below the floor and restores it slowly
 * when there is headroom; a cooldown prevents oscillation.
 */
export function stepResolutionScaler(
  state: ResolutionScalerState,
  smoothedFps: number,
  dt: number,
): ResolutionScalerState {
  if (!Number.isFinite(smoothedFps) || !Number.isFinite(dt) || dt <= 0) {
    return state;
  }
  const cooldownSeconds = state.cooldownSeconds - dt;
  if (cooldownSeconds > 0) {
    return { scale: state.scale, cooldownSeconds };
  }
  if (smoothedFps < FPS_DROP_THRESHOLD && state.scale > MIN_RESOLUTION_SCALE) {
    return {
      scale: Math.max(MIN_RESOLUTION_SCALE, roundScale(state.scale - SCALE_DROP_STEP)),
      cooldownSeconds: COOLDOWN_AFTER_DROP_SECONDS,
    };
  }
  if (smoothedFps >= FPS_RAISE_THRESHOLD && state.scale < 1) {
    return {
      scale: Math.min(1, roundScale(state.scale + SCALE_RAISE_STEP)),
      cooldownSeconds: COOLDOWN_AFTER_RAISE_SECONDS,
    };
  }
  return { scale: state.scale, cooldownSeconds: 0 };
}

export function resolveRenderPixelRatio(
  preset: QualityPreset,
  devicePixelRatio: number,
  scale: number,
): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const safeScale = Number.isFinite(scale) ? scale : 1;
  return Math.max(MIN_PIXEL_RATIO, Math.min(dpr, preset.maxPixelRatio) * safeScale);
}
