import { describe, expect, it } from 'vitest';
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  createResolutionScalerState,
  cycleQualityLevel,
  detectInitialQuality,
  resolveRenderPixelRatio,
  stepResolutionScaler,
} from '../../../src/game/qualityGovernor';

describe('QUALITY_PRESETS', () => {
  it('orders low < medium < high < ultra on every cost knob', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high', 'ultra']);
    for (let i = 1; i < QUALITY_LEVELS.length; i += 1) {
      const prev = QUALITY_PRESETS[QUALITY_LEVELS[i - 1]!];
      const next = QUALITY_PRESETS[QUALITY_LEVELS[i]!];
      expect(next.maxPixelRatio).toBeGreaterThanOrEqual(prev.maxPixelRatio);
      expect(next.shadowMapSize).toBeGreaterThanOrEqual(prev.shadowMapSize);
      expect(next.bloomResolutionScale).toBeGreaterThanOrEqual(prev.bloomResolutionScale);
      expect(next.pedestrianDrawDistance).toBeGreaterThanOrEqual(prev.pedestrianDrawDistance);
      expect(next.detailDrawDistance).toBeGreaterThanOrEqual(prev.detailDrawDistance);
    }
  });

  it('enables SMAA from medium and ambient occlusion only on high and ultra', () => {
    expect(QUALITY_PRESETS.low.smaa).toBe(false);
    expect(QUALITY_PRESETS.medium.smaa).toBe(true);
    expect(QUALITY_PRESETS.low.ambientOcclusion).toBe(false);
    expect(QUALITY_PRESETS.medium.ambientOcclusion).toBe(false);
    expect(QUALITY_PRESETS.high.ambientOcclusion).toBe(true);
    expect(QUALITY_PRESETS.ultra.ambientOcclusion).toBe(true);
  });
});

describe('cycleQualityLevel', () => {
  it('cycles low -> medium -> high -> ultra -> low', () => {
    expect(cycleQualityLevel('low')).toBe('medium');
    expect(cycleQualityLevel('medium')).toBe('high');
    expect(cycleQualityLevel('high')).toBe('ultra');
    expect(cycleQualityLevel('ultra')).toBe('low');
  });
});

describe('detectInitialQuality', () => {
  it('picks low for software rasterizers regardless of CPU', () => {
    expect(
      detectInitialQuality({
        devicePixelRatio: 1,
        hardwareConcurrency: 16,
        isMobile: false,
        gpuRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
      }),
    ).toBe('low');
    expect(
      detectInitialQuality({ devicePixelRatio: 1, isMobile: false, gpuRenderer: 'llvmpipe (LLVM 15.0.7)' }),
    ).toBe('low');
  });

  it('picks medium on phones and low on weak phones', () => {
    expect(detectInitialQuality({ devicePixelRatio: 3, hardwareConcurrency: 8, isMobile: true })).toBe('medium');
    expect(
      detectInitialQuality({ devicePixelRatio: 3, hardwareConcurrency: 4, deviceMemoryGb: 2, isMobile: true }),
    ).toBe('low');
  });

  it('picks high on typical desktops and ultra on strong ones', () => {
    expect(detectInitialQuality({ devicePixelRatio: 2, hardwareConcurrency: 8, isMobile: false })).toBe('high');
    expect(
      detectInitialQuality({ devicePixelRatio: 2, hardwareConcurrency: 12, deviceMemoryGb: 16, isMobile: false }),
    ).toBe('ultra');
    expect(detectInitialQuality({ devicePixelRatio: 1, hardwareConcurrency: 4, isMobile: false })).toBe('medium');
  });
});

describe('stepResolutionScaler', () => {
  it('drops resolution when FPS stays under the floor, respecting the cooldown and minimum', () => {
    let state = createResolutionScalerState();
    expect(state.scale).toBe(1);

    state = stepResolutionScaler(state, 30, 0.1);
    expect(state.scale).toBeCloseTo(0.9, 5);

    // Cooldown blocks an immediate second drop
    state = stepResolutionScaler(state, 30, 0.1);
    expect(state.scale).toBeCloseTo(0.9, 5);

    for (let i = 0; i < 200; i += 1) {
      state = stepResolutionScaler(state, 10, 0.5);
    }
    expect(state.scale).toBeCloseTo(0.5, 5);
  });

  it('raises resolution back slowly once FPS has headroom and holds inside the comfort band', () => {
    let state = { scale: 0.6, cooldownSeconds: 0 };
    state = stepResolutionScaler(state, 50, 2);
    expect(state.scale).toBeCloseTo(0.6, 5);

    state = stepResolutionScaler(state, 60, 2);
    expect(state.scale).toBeCloseTo(0.65, 5);

    for (let i = 0; i < 100; i += 1) {
      state = stepResolutionScaler(state, 60, 2);
    }
    expect(state.scale).toBe(1);
  });

  it('ignores non-finite inputs', () => {
    const state = createResolutionScalerState();
    expect(stepResolutionScaler(state, Number.NaN, 0.1)).toEqual(state);
    expect(stepResolutionScaler(state, 30, Number.NaN)).toEqual(state);
  });
});

describe('resolveRenderPixelRatio', () => {
  it('caps the device pixel ratio by the preset and applies the dynamic scale with a floor', () => {
    expect(resolveRenderPixelRatio(QUALITY_PRESETS.ultra, 3, 1)).toBe(2);
    expect(resolveRenderPixelRatio(QUALITY_PRESETS.low, 2, 1)).toBe(QUALITY_PRESETS.low.maxPixelRatio);
    expect(resolveRenderPixelRatio(QUALITY_PRESETS.high, 2, 0.5)).toBeCloseTo(0.75, 5);
    expect(resolveRenderPixelRatio(QUALITY_PRESETS.low, 1, 0.1)).toBe(0.5);
    expect(resolveRenderPixelRatio(QUALITY_PRESETS.medium, Number.NaN, 1)).toBe(1);
  });
});
