import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  computeShadowTexelSnappedFocus,
  createSunsetLighting,
  setShadowQuality,
  updateShadowFocus,
} from '../../../src/world/sceneSetup';

function keyLightOf(group: THREE.Group): THREE.DirectionalLight {
  const light = group.getObjectByName('sunset_key_light');
  if (!(light instanceof THREE.DirectionalLight)) {
    throw new Error('missing key light');
  }
  return light;
}

describe('computeShadowTexelSnappedFocus', () => {
  it('keeps the shadow origin fixed while the player moves inside one shadow texel (no shimmer)', () => {
    const a = computeShadowTexelSnappedFocus(10.0, 2, 20.0, 2048);
    const b = computeShadowTexelSnappedFocus(10.004, 2, 20.003, 2048);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });

  it('stays within one texel of the requested focus and moves once the player crosses texels', () => {
    const texel = 144 / 1024;
    const raw = new THREE.Vector3(37.3, 4, -81.9);
    const snapped = computeShadowTexelSnappedFocus(raw.x, raw.y, raw.z, 1024);
    expect(new THREE.Vector3(snapped.x, snapped.y, snapped.z).distanceTo(raw)).toBeLessThanOrEqual(texel);

    const far = computeShadowTexelSnappedFocus(raw.x + 3, raw.y, raw.z, 1024);
    expect(Math.abs(far.x - snapped.x)).toBeGreaterThan(texel);
  });

  it('falls back to the raw focus for invalid map sizes', () => {
    expect(computeShadowTexelSnappedFocus(1.234, 0, 5.678, 0)).toEqual({ x: 1.234, y: 0, z: 5.678 });
  });
});

describe('updateShadowFocus', () => {
  it('positions the key light at the snapped focus plus the constant sun offset', () => {
    const lighting = createSunsetLighting();
    const keyLight = keyLightOf(lighting);
    updateShadowFocus(lighting, 12.34, -56.78);

    const offset = keyLight.position.clone().sub(keyLight.target.position);
    expect(offset.x).toBeCloseTo(-152, 4);
    expect(offset.y).toBeCloseTo(76, 4);
    expect(offset.z).toBeCloseTo(-24, 4);
    expect(Math.abs(keyLight.target.position.x - 12.34)).toBeLessThan(0.2);
    expect(Math.abs(keyLight.target.position.z + 56.78)).toBeLessThan(0.2);
  });
});

describe('setShadowQuality', () => {
  it('resizes the sun shadow map, scales normal bias with texel size, and drops the stale map', () => {
    const lighting = createSunsetLighting();
    const keyLight = keyLightOf(lighting);
    const staleMap = new THREE.WebGLRenderTarget(8, 8);
    keyLight.shadow.map = staleMap;
    let disposed = false;
    staleMap.dispose = () => {
      disposed = true;
    };

    setShadowQuality(lighting, 1024);
    expect(keyLight.shadow.mapSize.x).toBe(1024);
    expect(keyLight.shadow.mapSize.y).toBe(1024);
    expect(keyLight.shadow.map).toBeNull();
    expect(disposed).toBe(true);
    const lowBias = keyLight.shadow.normalBias;

    setShadowQuality(lighting, 4096);
    expect(keyLight.shadow.mapSize.x).toBe(4096);
    expect(keyLight.shadow.normalBias).toBeLessThan(lowBias);
    expect(keyLight.shadow.bias).toBeLessThan(0);
  });
});
