import { describe, expect, it } from 'vitest';
import {
  BUILDING_COLLIDERS,
  CALI_MAP,
  DEFAULT_GARAGE_CONFIG,
  LANDMARKS,
  MISSION_STARTS,
  MISSION_WAYPOINTS,
  PAY_N_SPRAY_ZONES,
  PLAYER_CAR_SPAWN,
  PLAYER_START,
  POLICE_SPAWNS,
  RIVER_CORRIDOR,
  ROADBLOCK_ZONES,
  ROAD_SEGMENTS,
  STUNT_JUMPS,
  TRAFFIC_ROUTES,
  WORLD_HALF_SIZE,
  getDistrictAt,
  getLandmarkById,
  getTerrainElevation,
  isPointInRiver,
  isPointOnBridge,
} from '../../../src/config/caliMap';
import type {
  AabbCollider,
  LandmarkId,
  MissionId,
  MissionWaypoint,
  RoadSegment,
  Vec2,
} from '../../../src/types/game';

function flattenMissionWaypoints(): readonly MissionWaypoint[] {
  const result: MissionWaypoint[] = [];
  for (const entry of Object.values(MISSION_WAYPOINTS)) {
    if (Array.isArray(entry)) {
      result.push(...entry);
    } else if (entry) {
      result.push(entry);
    }
  }
  return result;
}

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
    expect(CALI_MAP.trafficRoutes).toHaveLength(12);
    expect(CALI_MAP.parkedVehicles?.length).toBeGreaterThanOrEqual(6);
    expect(CALI_MAP.stuntJumps).toBe(STUNT_JUMPS);
    expect(CALI_MAP.payNSprayZones).toBe(PAY_N_SPRAY_ZONES);
    expect(CALI_MAP.roadblockZones).toBe(ROADBLOCK_ZONES);
  });

  it('keeps BUILDING_COLLIDERS strictly clear of spawns, waypoints, police, and traffic routes', () => {
    const spawnMargin = 4.0;
    const waypointMargin = 5.0;
    const routeMargin = 3.0;

    const missionTargets = flattenMissionWaypoints();

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

  it('keeps all traffic loops out of river water and strictly inside map bounds', () => {
    for (const route of TRAFFIC_ROUTES) {
      for (let i = 0; i < route.waypoints.length; i++) {
        const a = route.waypoints[i]!;
        const b = route.waypoints[(i + 1) % route.waypoints.length]!;
        expect(Math.abs(a.x), `${route.id}[${i}].x inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
        expect(Math.abs(a.z), `${route.id}[${i}].z inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
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
    for (const wp of flattenMissionWaypoints()) {
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

  it('defines distinct, non-colliding, dry-land MISSION_STARTS for all 4 missions', () => {
    const missionIds: readonly MissionId[] = [
      'mission_1_bulevar',
      'mission_2_cristo_rey',
      'mission_3_pique_bulevar',
      'free_roam',
    ];
    const minClearance = 2.5;

    expect(CALI_MAP.missionStarts).toBe(MISSION_STARTS);

    for (const missionId of missionIds) {
      const start = MISSION_STARTS[missionId];
      expect(start).toBeDefined();

      const poses = [
        { label: `${missionId}.playerSpawn`, pose: start.playerSpawn },
        { label: `${missionId}.carSpawn`, pose: start.carSpawn },
      ];

      for (const { label, pose } of poses) {
        expect(Number.isFinite(pose.x), `${label}.x finite`).toBe(true);
        expect(Number.isFinite(pose.z), `${label}.z finite`).toBe(true);
        expect(Number.isFinite(pose.heading), `${label}.heading finite`).toBe(true);
        expect(Math.abs(pose.x), `${label}.x inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
        expect(Math.abs(pose.z), `${label}.z inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
        expect(isPointInRiver(pose.x, pose.z), `${label} must not be in river`).toBe(false);

        for (const collider of BUILDING_COLLIDERS) {
          expect(
            overlapsAabbWithMargin(collider, pose.x, pose.z, minClearance),
            `${collider.id} violates ${minClearance}m clearance for ${label}`,
          ).toBe(false);
        }
      }

      if (!start.startInVehicle) {
        const separation = Math.hypot(
          start.carSpawn.x - start.playerSpawn.x,
          start.carSpawn.z - start.playerSpawn.z,
        );
        expect(
          separation,
          `${missionId} on-foot carSpawn must be > 3.5m from playerSpawn`,
        ).toBeGreaterThan(3.5);
      }
    }

    expect(MISSION_STARTS.mission_1_bulevar.startInVehicle).toBe(false);
    expect(MISSION_STARTS.mission_1_bulevar.initialWantedStars).toBe(0);
    expect(MISSION_STARTS.mission_1_bulevar.defaultTimeOfDay).toBe('golden_hour');

    expect(MISSION_STARTS.mission_2_cristo_rey.startInVehicle).toBe(true);
    expect(MISSION_STARTS.mission_2_cristo_rey.initialWantedStars).toBe(3);
    expect(MISSION_STARTS.mission_2_cristo_rey.defaultTimeOfDay).toBe('night');

    expect(MISSION_STARTS.mission_3_pique_bulevar.startInVehicle).toBe(true);
    expect(MISSION_STARTS.mission_3_pique_bulevar.initialWantedStars).toBe(0);
    expect(MISSION_STARTS.mission_3_pique_bulevar.defaultTimeOfDay).toBe('golden_hour');
    expect(MISSION_STARTS.mission_3_pique_bulevar.playerSpawn).toEqual({
      x: -4,
      z: 62,
      heading: Math.PI,
    });
    expect(MISSION_STARTS.mission_3_pique_bulevar.carSpawn).toEqual({
      x: -4,
      z: 62,
      heading: Math.PI,
    });

    expect(MISSION_STARTS.free_roam.startInVehicle).toBe(false);
    expect(MISSION_STARTS.free_roam.initialWantedStars).toBe(0);
    expect(MISSION_STARTS.free_roam.defaultTimeOfDay).toBe('golden_hour');
  });

  it('defines DEFAULT_GARAGE_CONFIG, Mission 3 checkpoints, Stunt Jumps, Pay n Spray bays, Roadblocks, and Colombian traffic routes', () => {
    expect(DEFAULT_GARAGE_CONFIG).toEqual({
      carKind: 'renault4_turbo',
      paintHex: 0xe63946,
      neonHex: 0x00f0ff,
      avatar: 'valeria',
      outfit: 'urbano_cali',
    });

    const m3Checkpoints = MISSION_WAYPOINTS.mission3Checkpoints;
    expect(m3Checkpoints).toBeDefined();
    expect(m3Checkpoints).toHaveLength(6);
    expect(m3Checkpoints?.map((cp) => cp.id)).toEqual([
      'm3_cp1_bulevar',
      'm3_cp2_ermita',
      'm3_cp3_granada',
      'm3_cp4_oriente',
      'm3_cp5_puente_sur',
      'm3_cp6_meta_bulevar',
    ]);

    expect(STUNT_JUMPS).toHaveLength(3);
    expect(STUNT_JUMPS.map((jump) => jump.id)).toEqual([
      'stunt_bulevar_launch',
      'stunt_ermita_bridge',
      'stunt_cristo_vista',
    ]);
    expect(STUNT_JUMPS[1]?.x).toBe(54);
    expect(STUNT_JUMPS[1]?.z).toBe(-24);
    for (const jump of STUNT_JUMPS) {
      expect(Math.abs(jump.x), `${jump.id}.x inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(Math.abs(jump.z), `${jump.id}.z inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(isPointInRiver(jump.x, jump.z), `${jump.id} not in river`).toBe(false);
      expect(jump.length).toBeGreaterThan(0);
      expect(jump.width).toBeGreaterThan(0);
      expect(jump.minSpeedMps).toBeGreaterThan(0);
      expect(jump.launchVy).toBeGreaterThan(0);
      expect(jump.rewardCop).toBeGreaterThan(0);
      for (const collider of BUILDING_COLLIDERS) {
        expect(
          overlapsAabbWithMargin(collider, jump.x, jump.z, 2.5),
          `${collider.id} overlaps stunt jump ${jump.id}`,
        ).toBe(false);
      }
      for (const landmark of LANDMARKS) {
        const landmarkBox: AabbCollider = {
          id: landmark.id,
          minX: landmark.position.x - landmark.footprintHalfX,
          maxX: landmark.position.x + landmark.footprintHalfX,
          minZ: landmark.position.z - landmark.footprintHalfZ,
          maxZ: landmark.position.z + landmark.footprintHalfZ,
          height: 10,
          kind: 'landmark',
          colorHex: landmark.colorHex,
        };
        expect(
          overlapsAabbWithMargin(landmarkBox, jump.x, jump.z, 2.5),
          `landmark ${landmark.id} overlaps stunt jump ${jump.id}`,
        ).toBe(false);
      }
    }

    expect(PAY_N_SPRAY_ZONES).toHaveLength(2);
    expect(PAY_N_SPRAY_ZONES.map((zone) => zone.id)).toEqual([
      'pay_n_spray_san_antonio',
      'pay_n_spray_granada',
    ]);
    for (const zone of PAY_N_SPRAY_ZONES) {
      expect(Math.abs(zone.x), `${zone.id}.x inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(Math.abs(zone.z), `${zone.id}.z inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(isPointInRiver(zone.x, zone.z), `${zone.id} not in river`).toBe(false);
      expect(zone.radius).toBe(7.5);
      for (const collider of BUILDING_COLLIDERS) {
        expect(
          overlapsAabbWithMargin(collider, zone.x, zone.z, zone.radius),
          `${collider.id} overlaps Pay 'n' Spray zone ${zone.id}`,
        ).toBe(false);
      }
      for (const landmark of LANDMARKS) {
        const landmarkBox: AabbCollider = {
          id: landmark.id,
          minX: landmark.position.x - landmark.footprintHalfX,
          maxX: landmark.position.x + landmark.footprintHalfX,
          minZ: landmark.position.z - landmark.footprintHalfZ,
          maxZ: landmark.position.z + landmark.footprintHalfZ,
          height: 10,
          kind: 'landmark',
          colorHex: landmark.colorHex,
        };
        expect(
          overlapsAabbWithMargin(landmarkBox, zone.x, zone.z, zone.radius),
          `landmark ${landmark.id} overlaps Pay 'n' Spray zone ${zone.id}`,
        ).toBe(false);
      }
    }

    expect(ROADBLOCK_ZONES).toHaveLength(2);
    expect(ROADBLOCK_ZONES.map((zone) => zone.id)).toEqual([
      'roadblock_puente_ermita',
      'roadblock_calle_quinta',
    ]);
    for (const zone of ROADBLOCK_ZONES) {
      expect(Math.abs(zone.x), `${zone.id}.x inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(Math.abs(zone.z), `${zone.id}.z inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(isPointOnBridge(zone.x, zone.z), `${zone.id} placed on bridge`).toBe(true);
      expect(zone.halfWidth).toBeGreaterThan(0);
      for (const collider of BUILDING_COLLIDERS) {
        expect(
          overlapsAabbWithMargin(collider, zone.x, zone.z, 2.5),
          `${collider.id} overlaps roadblock ${zone.id}`,
        ).toBe(false);
      }
    }

    const routeIds = TRAFFIC_ROUTES.map((route) => route.id);
    expect(routeIds).toContain('route_r4_centro');
    expect(routeIds).toContain('route_spark_granada');
    expect(routeIds).toContain('route_willys_sur');
  });

  it('defines the 3 new C-05 waypoints clear of buildings and river water', () => {
    const newWaypoints = [
      MISSION_WAYPOINTS.mission1Hideout,
      MISSION_WAYPOINTS.mission2RingBridge,
      MISSION_WAYPOINTS.mission2RingBulevar,
    ];
    const minClearance = 2.5;

    expect(MISSION_WAYPOINTS.mission1Hideout.id).toBe('m1_san_antonio_hideout');
    expect(MISSION_WAYPOINTS.mission1Hideout.landmarkId).toBe('san_antonio');
    expect(MISSION_WAYPOINTS.mission2RingBridge.id).toBe('m2_ring_bridge');
    expect(isPointOnBridge(
      MISSION_WAYPOINTS.mission2RingBridge.x,
      MISSION_WAYPOINTS.mission2RingBridge.z,
    )).toBe(true);
    expect(MISSION_WAYPOINTS.mission2RingBulevar.id).toBe('m2_ring_bulevar');

    for (const wp of newWaypoints) {
      expect(Math.abs(wp.x), `${wp.id}.x inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(Math.abs(wp.z), `${wp.id}.z inside world`).toBeLessThanOrEqual(WORLD_HALF_SIZE);
      expect(isPointInRiver(wp.x, wp.z), `${wp.id} must not be in river`).toBe(false);
      expect(getLandmarkById(wp.landmarkId).id).toBe(wp.landmarkId);

      for (const collider of BUILDING_COLLIDERS) {
        expect(
          overlapsAabbWithMargin(collider, wp.x, wp.z, minClearance),
          `${collider.id} violates ${minClearance}m clearance for ${wp.id}`,
        ).toBe(false);
      }
    }
  });
});
