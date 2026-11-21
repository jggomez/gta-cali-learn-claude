import { describe, expect, it } from 'vitest';
import {
  BUILDING_COLLIDERS,
  CALI_MAP,
  LANDMARKS,
  MISSION_WAYPOINTS,
  PLAYER_CAR_SPAWN,
  PLAYER_START,
  POLICE_SPAWNS,
  RIVER_CORRIDOR,
  ROAD_SEGMENTS,
  TRAFFIC_ROUTES,
  WORLD_HALF_SIZE,
  getDistrictAt,
  getLandmarkById,
  getTerrainElevation,
  isPointInRiver,
  isPointOnBridge,
} from '../../../src/config/caliMap';
import type { AabbCollider, LandmarkId, RoadSegment, Vec2 } from '../../../src/types/game';

function roadToAabb(road: RoadSegment, margin = 0): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const halfWidth = road.width / 2 + margin;
  return {
    minX: Math.min(road.start.x, road.end.x) - halfWidth,
    maxX: Math.max(road.start.x, road.end.x) + halfWidth,
    minZ: Math.min(road.start.z, road.end.z) - halfWidth,
    maxZ: Math.max(road.start.z, road.end.z) + halfWidth,
  };
}

function boxesOverlap(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function overlapsAabbWithMargin(
  collider: AabbCollider,
  x: number,
  z: number,
  margin: number,
): boolean {
  return (
    x >= collider.minX - margin &&
    x <= collider.maxX + margin &&
    z >= collider.minZ - margin &&
    z <= collider.maxZ + margin
  );
}

function segmentIntersectsAabb(
  a: Vec2,
  b: Vec2,
  collider: AabbCollider,
  margin: number,
): boolean {
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (overlapsAabbWithMargin(collider, x, z, margin)) {
      return true;
    }
  }
  return false;
}

describe('CALI_MAP geometry and spatial invariants', () => {
  it('defines all 6 iconic Cali landmarks within world bounds', () => {
    const expectedIds: LandmarkId[] = [
      'san_antonio',
      'torre_de_cali',
      'bulevar_del_rio',
      'la_ermita',
      'estadio_pascual',
      'cristo_rey',
    ];

    expect(LANDMARKS).toHaveLength(6);
    const actualIds = LANDMARKS.map((landmark) => landmark.id);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }

    for (const landmark of LANDMARKS) {
      expect(Math.abs(landmark.position.x)).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(Math.abs(landmark.position.z)).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(landmark.district.length).toBeGreaterThan(0);
      expect(landmark.discoveryRadius).toBeGreaterThan(0);
      expect(getDistrictAt(landmark.position.x, landmark.position.z)).toBe(landmark.district);
    }
  });

  it('exposes consistent aggregate CALI_MAP config', () => {
    expect(CALI_MAP.worldHalfSize).toBe(240);
    expect(CALI_MAP.landmarks).toBe(LANDMARKS);
    expect(CALI_MAP.roads).toBe(ROAD_SEGMENTS);
    expect(CALI_MAP.river).toBe(RIVER_CORRIDOR);
    expect(CALI_MAP.buildingColliders).toBe(BUILDING_COLLIDERS);
    expect(CALI_MAP.buildingColliders.length).toBeGreaterThanOrEqual(28);
    expect(CALI_MAP.trafficRoutes).toHaveLength(3);
  });

  it('keeps BUILDING_COLLIDERS strictly clear of spawns, waypoints, police, and traffic routes', () => {
    const spawnMargin = 4.0;
    const waypointMargin = 5.0;
    const routeMargin = 3.0;

    const missionTargets = Object.values(MISSION_WAYPOINTS);

    for (const collider of BUILDING_COLLIDERS) {
      expect(collider.maxX).toBeGreaterThan(collider.minX);
      expect(collider.maxZ).toBeGreaterThan(collider.minZ);
      expect(collider.height).toBeGreaterThan(0);

      // Player start and car spawn
      expect(
        overlapsAabbWithMargin(collider, PLAYER_START.x, PLAYER_START.z, spawnMargin),
        `${collider.id} overlaps PLAYER_START`,
      ).toBe(false);
      expect(
        overlapsAabbWithMargin(collider, PLAYER_CAR_SPAWN.x, PLAYER_CAR_SPAWN.z, spawnMargin),
        `${collider.id} overlaps PLAYER_CAR_SPAWN`,
      ).toBe(false);

      // Mission waypoints
      for (const wp of missionTargets) {
        expect(
          overlapsAabbWithMargin(collider, wp.x, wp.z, waypointMargin),
          `${collider.id} overlaps mission waypoint ${wp.id}`,
        ).toBe(false);
      }

      // Police spawns
      for (const [index, spawn] of POLICE_SPAWNS.entries()) {
        expect(
          overlapsAabbWithMargin(collider, spawn.x, spawn.z, spawnMargin),
          `${collider.id} overlaps police spawn ${index}`,
        ).toBe(false);
      }

      // Landmark centers
      for (const landmark of LANDMARKS) {
        expect(
          overlapsAabbWithMargin(
            collider,
            landmark.position.x,
            landmark.position.z,
            spawnMargin,
          ),
          `${collider.id} overlaps landmark ${landmark.id}`,
        ).toBe(false);
      }

      // Traffic closed-loop waypoints and connecting road segments
      for (const route of TRAFFIC_ROUTES) {
        expect(route.waypoints.length).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < route.waypoints.length; i++) {
          const current = route.waypoints[i]!;
          const next = route.waypoints[(i + 1) % route.waypoints.length]!;
          expect(
            overlapsAabbWithMargin(collider, current.x, current.z, routeMargin),
            `${collider.id} overlaps waypoint ${i} of ${route.id}`,
          ).toBe(false);
          expect(
            segmentIntersectsAabb(current, next, collider, routeMargin),
            `${collider.id} blocks segment ${i} of ${route.id}`,
          ).toBe(false);
        }
      }

      // River corridor separation
      const overlapsRiverX =
        collider.maxX > RIVER_CORRIDOR.minX - 2 && collider.minX < RIVER_CORRIDOR.maxX + 2;
      expect(overlapsRiverX, `${collider.id} intrudes into Río Cali corridor`).toBe(false);
    }
  });

  it('distinguishes Río Cali water from both drivable bridges', () => {
    expect(RIVER_CORRIDOR.minX).toBe(24);
    expect(RIVER_CORRIDOR.maxX).toBe(46);
    expect(RIVER_CORRIDOR.bridges).toHaveLength(2);

    // Mid-river open water points (not on bridges)
    expect(isPointOnBridge(35, 10)).toBe(false);
    expect(isPointInRiver(35, 10)).toBe(true);
    expect(isPointInRiver(35, -80)).toBe(true);
    expect(isPointInRiver(35, 150)).toBe(true);

    // Outside river banks
    expect(isPointInRiver(12, 12)).toBe(false);
    expect(isPointInRiver(74, -24)).toBe(false);

    // Puente La Ermita (minZ: -34, maxZ: -12)
    expect(isPointOnBridge(35, -24)).toBe(true);
    expect(isPointInRiver(35, -24)).toBe(false);

    // Puente Bulevar Sur (minZ: 66, maxZ: 88)
    expect(isPointOnBridge(35, 77)).toBe(true);
    expect(isPointInRiver(35, 77)).toBe(false);
  });

  it('computes smooth, finite terrain elevation: 0 downtown, terrace in San Antonio, rising to Cristo Rey summit', () => {
    // Downtown, river, and east Cali are flat 0
    expect(getTerrainElevation(-4, -140)).toBe(0);
    expect(getTerrainElevation(12, 12)).toBe(0);
    expect(getTerrainElevation(35, 0)).toBe(0);
    expect(getTerrainElevation(74, -24)).toBe(0);
    expect(getTerrainElevation(132, 126)).toBe(0);

    // San Antonio gentle terrace (~3.5m)
    const sanAntonioHeight = getTerrainElevation(-96, 32);
    expect(sanAntonioHeight).toBeCloseTo(3.5, 2);
    expect(getTerrainElevation(PLAYER_START.x, PLAYER_START.z)).toBeCloseTo(3.5, 2);
    expect(getTerrainElevation(PLAYER_CAR_SPAWN.x, PLAYER_CAR_SPAWN.z)).toBeCloseTo(3.5, 2);

    // Cristo Rey ramp rises smoothly and monotonically from x = -110 to x = -175 along z = -24
    expect(getTerrainElevation(-110, -24)).toBe(0);
    let previousY = getTerrainElevation(-110, -24);
    for (let x = -111; x >= -190; x -= 1) {
      const currentY = getTerrainElevation(x, -24);
      expect(Number.isFinite(currentY)).toBe(true);
      expect(currentY).toBeGreaterThanOrEqual(previousY - 1e-9);
      expect(currentY - previousY).toBeLessThan(0.75);
      previousY = currentY;
    }

    // Summit height at Cristo Rey (-188, -24) reaches 22m and ramp has no lateral tilt across 24m width
    expect(getTerrainElevation(-188, -24)).toBeCloseTo(22, 3);
    const rampMidCenter = getTerrainElevation(-142.5, -24);
    const rampMidNorth = getTerrainElevation(-142.5, -35);
    const rampMidSouth = getTerrainElevation(-142.5, -13);
    expect(rampMidCenter).toBeCloseTo(11, 1);
    expect(rampMidNorth).toBeCloseTo(rampMidCenter, 5);
    expect(rampMidSouth).toBeCloseTo(rampMidCenter, 5);
  });

  it('keeps all traffic loops out of river water', () => {
    for (const route of TRAFFIC_ROUTES) {
      for (let i = 0; i < route.waypoints.length; i++) {
        const a = route.waypoints[i]!;
        const b = route.waypoints[(i + 1) % route.waypoints.length]!;
        for (let step = 0; step <= 40; step++) {
          const t = step / 40;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          expect(
            isPointInRiver(x, z),
            `Traffic route ${route.id} enters river water at (${x.toFixed(1)}, ${z.toFixed(1)})`,
          ).toBe(false);
        }
      }
    }
  });

  it('prevents BUILDING_COLLIDERS from overlapping roads, landmark footprints, or each other', () => {
    for (let i = 0; i < BUILDING_COLLIDERS.length; i++) {
      const building = BUILDING_COLLIDERS[i]!;

      for (const road of ROAD_SEGMENTS) {
        const roadBox = roadToAabb(road, 1.5);
        expect(
          boxesOverlap(building, roadBox),
          `${building.id} intrudes on road ${road.id}`,
        ).toBe(false);
      }

      for (const landmark of LANDMARKS) {
        const landmarkBox = {
          minX: landmark.position.x - landmark.footprintHalfX - 2,
          maxX: landmark.position.x + landmark.footprintHalfX + 2,
          minZ: landmark.position.z - landmark.footprintHalfZ - 2,
          maxZ: landmark.position.z + landmark.footprintHalfZ + 2,
        };
        expect(
          boxesOverlap(building, landmarkBox),
          `${building.id} overlaps landmark footprint ${landmark.id}`,
        ).toBe(false);
      }

      for (let j = i + 1; j < BUILDING_COLLIDERS.length; j++) {
        const other = BUILDING_COLLIDERS[j]!;
        expect(
          boxesOverlap(building, other),
          `${building.id} overlaps ${other.id}`,
        ).toBe(false);
      }
    }
  });

  it('places all mission waypoints on dry land and resolves every landmark via getLandmarkById', () => {
    for (const wp of Object.values(MISSION_WAYPOINTS)) {
      expect(Math.abs(wp.x)).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(Math.abs(wp.z)).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(isPointInRiver(wp.x, wp.z)).toBe(false);
      expect(getLandmarkById(wp.landmarkId).id).toBe(wp.landmarkId);
    }

    expect(
      getTerrainElevation(
        MISSION_WAYPOINTS.mission2Summit.x,
        MISSION_WAYPOINTS.mission2Summit.z,
      ),
    ).toBeCloseTo(22, 2);
  });
});
