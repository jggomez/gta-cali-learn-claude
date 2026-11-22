import { describe, expect, it } from 'vitest';
import { CALI_MAP, isPointInRiver } from '../../../src/config/caliMap';
import { resolveCircleWorldCollision } from '../../../src/simulation/physics';
import { createInitialPedestrians } from '../../../src/simulation/trafficAi';

interface DistrictBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const BUSY_DISTRICTS: Readonly<Record<string, DistrictBox>> = {
  bulevar_del_rio: { minX: -14, maxX: 23, minZ: -104, maxZ: 158 },
  san_antonio: { minX: -90, maxX: -14, minZ: 20, maxZ: 52 },
  la_ermita: { minX: 46, maxX: 70, minZ: -62, maxZ: 20 },
  calle_5: { minX: -60, maxX: 170, minZ: 64, maxZ: 90 },
};

function inBox(box: DistrictBox, x: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

describe('Caleño pedestrian population', () => {
  const peds = createInitialPedestrians(CALI_MAP);

  it('fills the streets with at least 28 walkers with unique ids', () => {
    expect(peds.length).toBeGreaterThanOrEqual(28);
    expect(new Set(peds.map((p) => p.id)).size).toBe(peds.length);
  });

  it('concentrates people on Bulevar del Río, San Antonio, La Ermita and Calle 5', () => {
    const busy = peds.filter((p) =>
      Object.values(BUSY_DISTRICTS).some((box) => inBox(box, p.x, p.z)),
    );
    expect(busy.length).toBeGreaterThanOrEqual(24);
    expect(peds.filter((p) => inBox(BUSY_DISTRICTS.bulevar_del_rio!, p.x, p.z)).length).toBeGreaterThanOrEqual(10);
  });

  it('keeps every patrol corridor on dry, collision-free ground', () => {
    for (const ped of peds) {
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const x = ped.patrolStartX + (ped.patrolEndX - ped.patrolStartX) * t;
        const z = ped.patrolStartZ + (ped.patrolEndZ - ped.patrolStartZ) * t;
        expect(isPointInRiver(x, z), `${ped.id} enters the river at t=${t.toFixed(1)}`).toBe(false);
        expect(
          resolveCircleWorldCollision(x, z, 0.45, CALI_MAP).collided,
          `${ped.id} collides at t=${t.toFixed(1)} (${x.toFixed(1)}, ${z.toFixed(1)})`,
        ).toBe(false);
      }
    }
  });
});
