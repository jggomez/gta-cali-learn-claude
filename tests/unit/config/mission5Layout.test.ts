import { describe, expect, it } from 'vitest';
import {
  BUILDING_COLLIDERS,
  CALI_MAP,
  LANDMARKS,
  MISSION_STARTS,
  ROAD_SEGMENTS,
  STUNT_JUMPS,
  getDistrictAt,
  isPointInRiver,
} from '../../../src/config/caliMap';
import {
  MISSION5_BANK_COLLIDERS,
  MISSION5_LAYOUT,
  MISSION5_PACKAGE_ORDER,
  getBankFacadeFootprint,
} from '../../../src/config/mission5Layout';
import type { MissionStartConfig, MissionWaypoint } from '../../../src/types/game';

interface Point {
  readonly x: number;
  readonly z: number;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Distance from a point to the nearest drivable road edge (<= 0 means on the asphalt). */
function distanceToNearestRoadEdge(p: Point): number {
  return Math.min(
    ...ROAD_SEGMENTS.map((road) => distanceToSegment(p, road.start, road.end) - road.width / 2),
  );
}

function isInsideAnyCollider(p: Point, margin: number): string | null {
  for (const box of [...BUILDING_COLLIDERS, ...(CALI_MAP.propColliders ?? []), ...MISSION5_BANK_COLLIDERS]) {
    if (
      p.x >= box.minX - margin &&
      p.x <= box.maxX + margin &&
      p.z >= box.minZ - margin &&
      p.z <= box.maxZ + margin
    ) {
      return box.id;
    }
  }
  return null;
}

const packages = MISSION5_PACKAGE_ORDER.map((id) => MISSION5_LAYOUT.packages[id]);
const waypoints: readonly MissionWaypoint[] = [...packages, MISSION5_LAYOUT.bank];

describe('Mission 5 "El Golpe del Prompt" layout', () => {
  it('is drop-in compatible with MissionStartConfig and starts in a car at 2 stars', () => {
    const start: MissionStartConfig = MISSION5_LAYOUT;
    expect(start.startInVehicle).toBe(true);
    expect(start.initialWantedStars).toBe(2);
    expect(Number.isFinite(start.playerSpawn.heading)).toBe(true);
    expect(Number.isFinite(start.carSpawn.heading)).toBe(true);
    expect(distanceToNearestRoadEdge(start.carSpawn)).toBeLessThan(0);
  });

  it('has four uniquely named packages in four different districts plus the bank', () => {
    expect(MISSION5_PACKAGE_ORDER).toEqual(['rol', 'contexto', 'tarea', 'formato']);
    expect(new Set(waypoints.map((wp) => wp.id)).size).toBe(5);
    const districts = new Set(packages.map((wp) => wp.district));
    expect(districts.size).toBe(4);
    for (const wp of waypoints) {
      expect(getDistrictAt(wp.x, wp.z), wp.id).toBe(wp.district);
      expect(wp.radius).toBeGreaterThanOrEqual(10);
    }
    expect(MISSION5_LAYOUT.bank.district).toBe('Centro de Cali');
  });

  it('places every package on drivable asphalt and the bank right next to Calle 13', () => {
    for (const wp of packages) {
      expect(distanceToNearestRoadEdge(wp), wp.id).toBeLessThan(0);
    }
    expect(distanceToNearestRoadEdge(MISSION5_LAYOUT.bank)).toBeLessThan(MISSION5_LAYOUT.bank.radius);
  });

  it('keeps waypoints out of colliders, the river, landmark footprints, spawns and ramps', () => {
    const occupied: Point[] = [
      CALI_MAP.playerStart,
      CALI_MAP.playerCarSpawn,
      ...Object.values(MISSION_STARTS).flatMap((start) => [start.playerSpawn, start.carSpawn]),
      ...STUNT_JUMPS,
    ];
    for (const wp of [...waypoints, MISSION5_LAYOUT.carSpawn]) {
      const label = 'id' in wp ? wp.id : 'carSpawn';
      expect(isInsideAnyCollider(wp, 1), label).toBeNull();
      expect(isPointInRiver(wp.x, wp.z)).toBe(false);
      for (const landmark of LANDMARKS) {
        const insideFootprint =
          Math.abs(wp.x - landmark.position.x) <= landmark.footprintHalfX + 2 &&
          Math.abs(wp.z - landmark.position.z) <= landmark.footprintHalfZ + 2;
        expect(insideFootprint, landmark.id).toBe(false);
      }
      for (const spot of occupied) {
        expect(Math.hypot(wp.x - spot.x, wp.z - spot.z)).toBeGreaterThan(12);
      }
    }
  });

  it('keeps the bank in the Centro, off the road and outside landmark discovery radii', () => {
    const footprint = getBankFacadeFootprint(MISSION5_LAYOUT.bankFacade);
    const corners: Point[] = [
      { x: footprint.minX, z: footprint.minZ },
      { x: footprint.maxX, z: footprint.minZ },
      { x: footprint.minX, z: footprint.maxZ },
      { x: footprint.maxX, z: footprint.maxZ },
    ];
    for (const corner of corners) {
      expect(distanceToNearestRoadEdge(corner)).toBeGreaterThan(1.5);
      expect(getDistrictAt(corner.x, corner.z)).toBe('Centro de Cali');
      for (const landmark of LANDMARKS) {
        expect(
          Math.hypot(corner.x - landmark.position.x, corner.z - landmark.position.z),
          landmark.id,
        ).toBeGreaterThan(landmark.discoveryRadius);
      }
    }
    // Back of the portico is flush with (sunk into) bldg_centro_4's south face.
    const host = BUILDING_COLLIDERS.find((box) => box.id === 'bldg_centro_4')!;
    expect(footprint.minZ).toBeLessThan(host.maxZ);
    expect(footprint.minX).toBeGreaterThanOrEqual(host.minX);
    expect(footprint.maxX).toBeLessThanOrEqual(host.maxX);
    expect(MISSION5_BANK_COLLIDERS[0]).toMatchObject({ id: 'm5_bank_portico', kind: 'prop', ...footprint });
    // The delivery point is in front of the entrance, outside the portico.
    expect(MISSION5_LAYOUT.bank.z).toBeGreaterThan(footprint.maxZ);
  });

  it('spans a 60-120 s route for a decent driver (0.7-1.6 km of road)', () => {
    const route: Point[] = [MISSION5_LAYOUT.carSpawn, ...waypoints];
    let manhattan = 0;
    for (let i = 1; i < route.length; i += 1) {
      manhattan += Math.abs(route[i]!.x - route[i - 1]!.x) + Math.abs(route[i]!.z - route[i - 1]!.z);
    }
    expect(manhattan).toBeGreaterThan(700);
    expect(manhattan).toBeLessThan(1600);
  });
});
