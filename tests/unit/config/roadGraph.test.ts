import { describe, expect, it } from 'vitest';
import {
  CALI_MAP,
  LANDMARKS,
  MISSION_WAYPOINTS,
  isPointInRiver,
  isPointOnBridge,
} from '../../../src/config/caliMap';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import {
  buildRoadGraph,
  computeGpsRoute,
  computeNextTurnBearing,
  computeRouteDistanceMeters,
} from '../../../src/config/roadGraph';
import type { Vec2 } from '../../../src/types/game';

function sampleRouteSegments(route: readonly Vec2[], stepMeters = 1.5): Vec2[] {
  const samples: Vec2[] = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(4, Math.ceil(length / stepMeters));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      samples.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }
  return samples;
}

function minDistanceToPolyline(point: Vec2, route: readonly Vec2[]): number {
  let minDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t =
      lenSq > 1e-8
        ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lenSq))
        : 0;
    const projX = a.x + dx * t;
    const projZ = a.z + dz * t;
    const dist = Math.hypot(point.x - projX, point.z - projZ);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

describe('roadGraph GPS routing and bearing math', () => {
  it('builds a single connected road graph spanning west bank, both bridges, and east bank', () => {
    const graph = buildRoadGraph(CALI_MAP);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(20);
    expect(graph.edges.length).toBeGreaterThanOrEqual(25);

    // BFS from node 0 must reach every single node in the road graph.
    const visited = new Set<number>([0]);
    const queue: number[] = [0];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = graph.adjacency[current] ?? [];
      for (const edge of neighbors) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }

    expect(visited.size).toBe(graph.nodes.length);
  });

  it('connects all 6 Cali landmarks and all mission waypoints without crossing river water', () => {
    const flattenedWaypoints = Object.values(MISSION_WAYPOINTS).flatMap((entry) =>
      Array.isArray(entry) ? entry : entry ? [entry] : [],
    );
    const points: { readonly name: string; readonly pos: Vec2 }[] = [
      ...LANDMARKS.map((landmark) => ({ name: landmark.id, pos: landmark.position })),
      ...flattenedWaypoints.map((wp) => ({
        name: wp.id,
        pos: { x: wp.x, z: wp.z },
      })),
    ];

    expect(MISSION_WAYPOINTS.mission2RampEntry).toEqual({
      id: 'm2_cristo_rey_ramp',
      landmarkId: 'cristo_rey',
      x: -68,
      z: -24,
      radius: 18,
      district: 'Avenida Circunvalar',
    });

    for (let i = 0; i < points.length; i += 1) {
      const origin = points[i]!;
      for (let j = i + 1; j < points.length; j += 1) {
        const dest = points[j]!;
        if (origin.pos.x === dest.pos.x && origin.pos.z === dest.pos.z) {
          continue;
        }
        const route = computeGpsRoute(origin.pos, dest.pos, CALI_MAP);
        expect(route.length, `Route ${origin.name} -> ${dest.name}`).toBeGreaterThanOrEqual(2);
        expect(route[0]).toEqual(origin.pos);
        expect(route[route.length - 1]).toEqual(dest.pos);

        const distance = computeRouteDistanceMeters(route);
        const directDistance = Math.hypot(
          dest.pos.x - origin.pos.x,
          dest.pos.z - origin.pos.z,
        );
        expect(distance).toBeGreaterThanOrEqual(directDistance - 1e-4);

        const samples = sampleRouteSegments(route, 2);
        for (const sample of samples) {
          expect(
            isPointInRiver(sample.x, sample.z),
            `Route ${origin.name} -> ${dest.name} enters river at (${sample.x.toFixed(1)}, ${sample.z.toFixed(1)})`,
          ).toBe(false);
        }
      }
    }
  });

  it('routes cleanly from San Antonio (-82, 36) to Torre de Cali (-4, -112) along city roads', () => {
    const from: Vec2 = { x: -82, z: 36 };
    const to: Vec2 = { x: -4, z: -112 };

    const route = computeGpsRoute(from, to, CALI_MAP);
    const repeatRoute = computeGpsRoute(from, to, CALI_MAP);

    expect(route).toEqual(repeatRoute);
    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);
    expect(route.length).toBeGreaterThanOrEqual(3);

    const distance = computeRouteDistanceMeters(route);
    expect(distance).toBeGreaterThan(150);
    expect(distance).toBeLessThan(450);

    for (const sample of sampleRouteSegments(route)) {
      expect(isPointInRiver(sample.x, sample.z)).toBe(false);
    }
  });

  it('routes from Estadio Pascual Guerrero (132, 77) to Mirador de Cristo Rey (-176, -24) over a bridge and through the mountain ramp (-68, -24)', () => {
    const from: Vec2 = { x: 132, z: 77 };
    const to: Vec2 = { x: -176, z: -24 };
    const rampEntry: Vec2 = { x: -68, z: -24 };

    const route = computeGpsRoute(from, to, CALI_MAP);
    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);

    const samples = sampleRouteSegments(route, 1);
    let crossedBridge = false;
    for (const sample of samples) {
      expect(
        isPointInRiver(sample.x, sample.z),
        `Route enters Río Cali water at (${sample.x.toFixed(1)}, ${sample.z.toFixed(1)})`,
      ).toBe(false);
      if (isPointOnBridge(sample.x, sample.z)) {
        crossedBridge = true;
      }
    }
    expect(crossedBridge).toBe(true);

    // Must pass right through the Cristo Rey ramp entry junction (-68, -24).
    expect(minDistanceToPolyline(rampEntry, route)).toBeLessThan(0.5);
    expect(
      route.some((pt) => Math.hypot(pt.x - rampEntry.x, pt.z - rampEntry.z) < 0.5),
    ).toBe(true);

    const distance = computeRouteDistanceMeters(route);
    expect(distance).toBeGreaterThan(350);
    expect(distance).toBeLessThan(500);
  });

  it('computes polyline route distance accurately for edge and multi-segment routes', () => {
    expect(computeRouteDistanceMeters([])).toBe(0);
    expect(computeRouteDistanceMeters([{ x: 5, z: 5 }])).toBe(0);
    expect(
      computeRouteDistanceMeters([
        { x: 0, z: 0 },
        { x: 3, z: 4 },
        { x: 3, z: 14 },
      ]),
    ).toBeCloseTo(15, 6);
  });

  it('computes next-turn bearing matching physics.ts heading convention (0 straight, +left, -right)', () => {
    const origin: Vec2 = { x: 0, z: 0 };

    // Facing +Z (heading = 0): forward is (0, +1), left is (+1, 0), right is (-1, 0).
    const straightSouthRoute: readonly Vec2[] = [origin, { x: 0, z: 30 }];
    expect(computeNextTurnBearing(origin, 0, straightSouthRoute)).toBeCloseTo(0, 5);

    const leftEastRoute: readonly Vec2[] = [origin, { x: 30, z: 0 }];
    expect(computeNextTurnBearing(origin, 0, leftEastRoute)).toBeCloseTo(Math.PI / 2, 5);

    const rightWestRoute: readonly Vec2[] = [origin, { x: -30, z: 0 }];
    expect(computeNextTurnBearing(origin, 0, rightWestRoute)).toBeCloseTo(-Math.PI / 2, 5);

    const behindNorthRoute: readonly Vec2[] = [origin, { x: 0, z: -30 }];
    expect(Math.abs(computeNextTurnBearing(origin, 0, behindNorthRoute))).toBeCloseTo(
      Math.PI,
      5,
    );

    // Facing East (+X, heading = +PI/2): forward is (+1, 0), left is (0, -1), right is (0, +1).
    expect(computeNextTurnBearing(origin, Math.PI / 2, leftEastRoute)).toBeCloseTo(0, 5);
    expect(computeNextTurnBearing(origin, Math.PI / 2, behindNorthRoute)).toBeCloseTo(
      Math.PI / 2,
      5,
    );
    expect(computeNextTurnBearing(origin, Math.PI / 2, straightSouthRoute)).toBeCloseTo(
      -Math.PI / 2,
      5,
    );

    // Partway along a route: must look ahead along the polyline, never back at start.
    const longRoute: readonly Vec2[] = [
      { x: 0, z: 0 },
      { x: 0, z: 50 },
      { x: 50, z: 50 },
    ];
    expect(computeNextTurnBearing({ x: 0, z: 25 }, 0, longRoute)).toBeCloseTo(0, 5);

    // Close to final destination (< 8m): targets final destination cleanly.
    expect(computeNextTurnBearing({ x: 46, z: 50 }, Math.PI / 2, longRoute)).toBeCloseTo(
      0,
      5,
    );

    // Empty route returns 0 safely.
    expect(computeNextTurnBearing(origin, 0, [])).toBe(0);
  });

  it('exposes C-04 Español Caleño vehicle names, banners, HUD strings, and dialogues', () => {
    expect(LOCALE_CALI.vehicleNames.renault4_turbo).toBe('Renault 4 GT Turbo');
    expect(LOCALE_CALI.vehicleNames.spark_gt_turbo).toBe('Spark GT Turbo');
    expect(LOCALE_CALI.vehicleNames.willys_v8).toBe('Jeep Willys Yipao V8');
    expect(LOCALE_CALI.vehicleNames.banshee).toBe('Ferrari 458 Caleño');
    expect(LOCALE_CALI.vehicleNames.taxi).toBe('Taxi Zapatico Turbo');
    expect(LOCALE_CALI.vehicleNames.mio_bus).toBe('Bus MIO');
    expect(LOCALE_CALI.vehicleNames.chiva).toBe('Chiva Rumbera');
    expect(LOCALE_CALI.vehicleNames.police).toBe('Patrulla Policía Nacional');
    expect(LOCALE_CALI.hud.stepProgress(2, 4)).toBe('PASO 2 DE 4');
    expect(LOCALE_CALI.hud.enterNamedVehicle('Taxi Zapatico Turbo')).toBe(
      '[F] Subir a Taxi Zapatico Turbo',
    );
    expect(LOCALE_CALI.hud.hijackNamedVehicle('Bus MIO')).toBe('[F] Tomar Bus MIO');
    expect(LOCALE_CALI.objectives.mission2.rampLabel.length).toBeGreaterThan(0);
    expect(LOCALE_CALI.banners.m2Ramp.title.length).toBeGreaterThan(0);
    expect(LOCALE_CALI.dialogues.m2Ramp.text.length).toBeGreaterThan(0);
    expect(LOCALE_CALI.dialogues.freeRoamWanted.text.length).toBeGreaterThan(0);
    expect(LOCALE_CALI.dialogues.freeRoamEscaped.text.length).toBeGreaterThan(0);
  });
});
