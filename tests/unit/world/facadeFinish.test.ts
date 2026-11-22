import { describe, expect, it } from 'vitest';
import { CALI_MAP } from '../../../src/config/caliMap';
import { resolveBuildingFacadeFinish } from '../../../src/world/caliLandmarks';

function buildingsWithPrefix(...prefixes: string[]) {
  return CALI_MAP.buildingColliders.filter((bldg) =>
    prefixes.some((prefix) => bldg.id.startsWith(prefix)),
  );
}

describe('resolveBuildingFacadeFinish', () => {
  it('gives colonial San Antonio and Oeste houses whitewashed stucco or terracotta plaster', () => {
    const colonial = buildingsWithPrefix('bldg_san_antonio', 'bldg_oeste');
    expect(colonial.length).toBeGreaterThan(0);
    const roles = new Set(colonial.map((bldg) => resolveBuildingFacadeFinish(bldg).role));
    for (const role of roles) {
      expect(['stucco', 'terracotta_plaster']).toContain(role);
    }
    expect(roles.size).toBe(2);
  });

  it('paints low-rise Granada and El Peñón buildings in varied colorful stucco tints', () => {
    const colorful = buildingsWithPrefix('bldg_granada', 'bldg_penon').filter(
      (bldg) => bldg.height < 22,
    );
    const finishes = colorful.map((bldg) => resolveBuildingFacadeFinish(bldg));
    for (const finish of finishes) {
      expect(finish.role).toBe('stucco');
    }
    expect(new Set(finishes.map((finish) => finish.tintHex)).size).toBeGreaterThanOrEqual(3);
  });

  it('uses worn concrete (with some masonry) for Centro and concrete for towers', () => {
    for (const bldg of buildingsWithPrefix('bldg_centro', 'bldg_bulevar', 'bldg_oriente')) {
      expect(['concrete', 'facade']).toContain(resolveBuildingFacadeFinish(bldg).role);
    }
    for (const bldg of CALI_MAP.buildingColliders.filter((b) => b.height >= 22)) {
      expect(resolveBuildingFacadeFinish(bldg).role).toBe('concrete');
    }
  });

  it('is deterministic and uses all three new Cali finishes somewhere in the city', () => {
    const roles = new Set(
      CALI_MAP.buildingColliders.map((bldg) => resolveBuildingFacadeFinish(bldg).role),
    );
    expect(roles).toContain('stucco');
    expect(roles).toContain('concrete');
    expect(roles).toContain('terracotta_plaster');
    const sample = CALI_MAP.buildingColliders[0]!;
    expect(resolveBuildingFacadeFinish(sample)).toEqual(resolveBuildingFacadeFinish(sample));
  });
});
