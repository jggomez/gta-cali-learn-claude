import { describe, expect, it } from 'vitest';
import {
  BUILDING_COLLIDERS,
  CALI_MAP,
  LANDMARKS,
  MISSION_STARTS,
  ROAD_SEGMENTS,
  STUNT_JUMPS,
  isPointInRiver,
} from '../../../src/config/caliMap';
import {
  DEVHACK_AD_MESSAGE_IDS,
  DEVHACK_BILLBOARDS,
  DEVHACK_BILLBOARD_COLLIDERS,
  getBillboardPanelEnds,
  getBillboardPostPositions,
  type PlanarPoint,
} from '../../../src/config/devhackAds';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import { resolveCircleWorldCollision } from '../../../src/simulation/physics';

function distanceToSegment(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Samples the panel footprint segment (both ends, posts and center). */
function footprintSamples(placement: (typeof DEVHACK_BILLBOARDS)[number]): PlanarPoint[] {
  const [endA, endB] = getBillboardPanelEnds(placement);
  const samples: PlanarPoint[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    samples.push({ x: endA.x + (endB.x - endA.x) * t, z: endA.z + (endB.z - endA.z) * t });
  }
  return [...samples, ...getBillboardPostPositions(placement)];
}

const ROAD_SHOULDER_CLEARANCE_METERS = 1.5;
const SPAWN_CLEARANCE_METERS = 12;

describe('AcaDevHack billboard placements', () => {
  it('places about six billboards with unique ids', () => {
    expect(DEVHACK_BILLBOARDS.length).toBeGreaterThanOrEqual(6);
    expect(DEVHACK_BILLBOARDS.length).toBeLessThanOrEqual(8);
    const ids = new Set(DEVHACK_BILLBOARDS.map((entry) => entry.id));
    expect(ids.size).toBe(DEVHACK_BILLBOARDS.length);
  });

  it('references only valid message ids and covers every message', () => {
    const used = new Set(DEVHACK_BILLBOARDS.map((entry) => entry.messageId));
    for (const placement of DEVHACK_BILLBOARDS) {
      expect(DEVHACK_AD_MESSAGE_IDS).toContain(placement.messageId);
    }
    for (const messageId of DEVHACK_AD_MESSAGE_IDS) {
      expect(used.has(messageId)).toBe(true);
    }
  });

  it('has Español Caleño copy for every message with the devhack.co footer', () => {
    const copy = LOCALE_CALI.devhackAds;
    expect(copy.footer).toBe('devhack.co');
    for (const messageId of DEVHACK_AD_MESSAGE_IDS) {
      expect(copy.messages[messageId].headline.length).toBeGreaterThan(0);
      expect(copy.messages[messageId].tagline.length).toBeGreaterThan(0);
    }
    expect(copy.messages.subscription.tagline).toContain('$13 USD/mes');
  });

  it('keeps every panel footprint off the road surfaces', () => {
    for (const placement of DEVHACK_BILLBOARDS) {
      for (const sample of footprintSamples(placement)) {
        for (const road of ROAD_SEGMENTS) {
          const distance = distanceToSegment(sample, road.start, road.end);
          expect(
            distance,
            `${placement.id} vs ${road.id}`,
          ).toBeGreaterThan(road.width / 2 + ROAD_SHOULDER_CLEARANCE_METERS);
        }
      }
    }
  });

  it('stays out of Río Cali, buildings, landmark discovery radii and footprints', () => {
    for (const placement of DEVHACK_BILLBOARDS) {
      for (const sample of footprintSamples(placement)) {
        expect(isPointInRiver(sample.x, sample.z), placement.id).toBe(false);
        for (const bldg of BUILDING_COLLIDERS) {
          const inside =
            sample.x >= bldg.minX - 1 &&
            sample.x <= bldg.maxX + 1 &&
            sample.z >= bldg.minZ - 1 &&
            sample.z <= bldg.maxZ + 1;
          expect(inside, `${placement.id} vs ${bldg.id}`).toBe(false);
        }
        for (const landmark of LANDMARKS) {
          const distance = Math.hypot(
            sample.x - landmark.position.x,
            sample.z - landmark.position.z,
          );
          expect(distance, `${placement.id} vs ${landmark.id}`).toBeGreaterThan(
            landmark.discoveryRadius,
          );
        }
      }
    }
  });

  it('keeps clear of player/car spawns and stunt ramps', () => {
    const spawns: PlanarPoint[] = [
      CALI_MAP.playerStart,
      CALI_MAP.playerCarSpawn,
      ...Object.values(MISSION_STARTS).flatMap((start) => [start.playerSpawn, start.carSpawn]),
      ...STUNT_JUMPS,
    ];
    for (const placement of DEVHACK_BILLBOARDS) {
      for (const spawn of spawns) {
        expect(Math.hypot(placement.x - spawn.x, placement.z - spawn.z)).toBeGreaterThan(
          SPAWN_CLEARANCE_METERS,
        );
      }
    }
  });

  it('registers two solid post colliders per billboard on the Cali map', () => {
    expect(DEVHACK_BILLBOARD_COLLIDERS.length).toBe(DEVHACK_BILLBOARDS.length * 2);
    expect(CALI_MAP.propColliders).toBe(DEVHACK_BILLBOARD_COLLIDERS);
    const post = DEVHACK_BILLBOARD_COLLIDERS[0]!;
    const cx = (post.minX + post.maxX) / 2;
    const cz = (post.minZ + post.maxZ) / 2;
    const result = resolveCircleWorldCollision(cx + 0.2, cz, 0.5);
    expect(result.collided).toBe(true);
    expect(result.hitColliderId).toBe(post.id);
    expect(Math.hypot(result.x - cx, result.z - cz)).toBeGreaterThan(0.5);
  });
});
