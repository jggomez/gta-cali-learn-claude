/**
 * Deterministic road-intersection graph, Dijkstra GPS routing, and turn-bearing math.
 * Pure zero-dependency config module shared by simulation, missions, and minimap HUD.
 */

import { CALI_MAP } from './caliMap';
import type { CaliMapConfig, RoadSegment, Vec2 } from '../types/game';

export interface RoadGraphNode {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly isRampTransition: boolean;
}

export interface RoadGraphEdge {
  readonly a: number;
  readonly b: number;
  readonly weight: number;
  readonly isRamp: boolean;
}

export interface RoadAdjacencyEntry {
  readonly to: number;
  readonly weight: number;
}

export interface RoadGraph {
  readonly nodes: readonly RoadGraphNode[];
  readonly edges: readonly RoadGraphEdge[];
  readonly adjacency: readonly (readonly RoadAdjacencyEntry[])[];
}

interface SnapMatch {
  readonly edgeIndex: number;
  readonly point: Vec2;
  readonly distSq: number;
}

interface AnnotatedPoint {
  readonly point: Vec2;
  readonly preserve: boolean;
}

const PARAM_EPS = 1e-5;
const COLLINEAR_LINE_TOLERANCE = 0.5;
const NODE_MERGE_EPS = 0.25;
const MIN_ROUTE_STEP_METERS = 0.25;
const COLLINEAR_SIMPLIFY_TOLERANCE = 0.25;
const LOOKAHEAD_METERS = 8;
const TIE_EPS = 1e-9;

const graphCache = new WeakMap<CaliMapConfig, RoadGraph>();

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function cross2D(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function distance2D(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = (((angle + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
  if (wrapped <= -Math.PI) {
    wrapped += twoPi;
  }
  return wrapped;
}

function isPointOnMapBridge(x: number, z: number, map: CaliMapConfig): boolean {
  for (const bridge of map.river.bridges) {
    if (
      x >= bridge.minX &&
      x <= bridge.maxX &&
      z >= bridge.minZ &&
      z <= bridge.maxZ
    ) {
      return true;
    }
  }
  return false;
}

function isPointInMapRiver(x: number, z: number, map: CaliMapConfig): boolean {
  const { river } = map;
  const insideCorridor =
    x >= river.minX &&
    x <= river.maxX &&
    z >= river.minZ &&
    z <= river.maxZ;
  if (!insideCorridor) {
    return false;
  }
  return !isPointOnMapBridge(x, z, map);
}

function segmentEntersRiver(a: Vec2, b: Vec2, map: CaliMapConfig): boolean {
  const length = distance2D(a, b);
  const steps = Math.max(8, Math.ceil(length / 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (isPointInMapRiver(x, z, map)) {
      return true;
    }
  }
  return false;
}

function projectPointOntoSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { readonly point: Vec2; readonly distSq: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  const t =
    lenSq > 1e-8 ? clamp01(((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq) : 0;
  const projX = a.x + dx * t;
  const projZ = a.z + dz * t;
  const ox = p.x - projX;
  const oz = p.z - projZ;
  return {
    point: { x: projX, z: projZ },
    distSq: ox * ox + oz * oz,
  };
}

function collectSegmentSplits(roads: readonly RoadSegment[]): number[][] {
  const splits: number[][] = roads.map(() => [0, 1]);

  for (let i = 0; i < roads.length; i += 1) {
    const roadA = roads[i];
    if (!roadA) continue;
    const rx = roadA.end.x - roadA.start.x;
    const rz = roadA.end.z - roadA.start.z;
    const lenSqA = rx * rx + rz * rz;
    if (lenSqA < 1e-8) continue;

    for (let j = i + 1; j < roads.length; j += 1) {
      const roadB = roads[j];
      if (!roadB) continue;
      const sx = roadB.end.x - roadB.start.x;
      const sz = roadB.end.z - roadB.start.z;
      const lenSqB = sx * sx + sz * sz;
      if (lenSqB < 1e-8) continue;

      const qpx = roadB.start.x - roadA.start.x;
      const qpz = roadB.start.z - roadA.start.z;
      const denom = cross2D(rx, rz, sx, sz);

      if (Math.abs(denom) > 1e-6) {
        const t = cross2D(qpx, qpz, sx, sz) / denom;
        const u = cross2D(qpx, qpz, rx, rz) / denom;
        if (
          t >= -PARAM_EPS &&
          t <= 1 + PARAM_EPS &&
          u >= -PARAM_EPS &&
          u <= 1 + PARAM_EPS
        ) {
          splits[i]?.push(clamp01(t));
          splits[j]?.push(clamp01(u));
        }
        continue;
      }

      // Parallel segments: split collinear overlapping roads (e.g., river bridges)
      // at each other's endpoints so both segments share connected intersection nodes.
      const perpDist = Math.abs(cross2D(qpx, qpz, rx, rz)) / Math.sqrt(lenSqA);
      if (perpDist > COLLINEAR_LINE_TOLERANCE) {
        continue;
      }

      const t0 = (qpx * rx + qpz * rz) / lenSqA;
      const t1 =
        ((roadB.end.x - roadA.start.x) * rx + (roadB.end.z - roadA.start.z) * rz) /
        lenSqA;
      if (t0 >= -PARAM_EPS && t0 <= 1 + PARAM_EPS) splits[i]?.push(clamp01(t0));
      if (t1 >= -PARAM_EPS && t1 <= 1 + PARAM_EPS) splits[i]?.push(clamp01(t1));

      const u0 = (-qpx * sx - qpz * sz) / lenSqB;
      const u1 =
        ((roadA.end.x - roadB.start.x) * sx + (roadA.end.z - roadB.start.z) * sz) /
        lenSqB;
      if (u0 >= -PARAM_EPS && u0 <= 1 + PARAM_EPS) splits[j]?.push(clamp01(u0));
      if (u1 >= -PARAM_EPS && u1 <= 1 + PARAM_EPS) splits[j]?.push(clamp01(u1));
    }
  }

  return splits;
}

function uniqueSortedParams(params: readonly number[]): number[] {
  const sorted = [...params].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const t of sorted) {
    const last = unique[unique.length - 1];
    if (last === undefined || Math.abs(t - last) > PARAM_EPS) {
      unique.push(t);
    }
  }
  return unique;
}

function internGraphNode(nodes: Vec2[], x: number, z: number): number {
  for (let i = 0; i < nodes.length; i += 1) {
    const existing = nodes[i];
    if (existing && Math.hypot(existing.x - x, existing.z - z) <= NODE_MERGE_EPS) {
      return i;
    }
  }
  const id = nodes.length;
  nodes.push({ x, z });
  return id;
}

function recordUndirectedEdge(
  edgeMap: Map<string, RoadGraphEdge>,
  nodes: readonly Vec2[],
  nodeIdA: number,
  nodeIdB: number,
  isRamp: boolean,
): void {
  const a = Math.min(nodeIdA, nodeIdB);
  const b = Math.max(nodeIdA, nodeIdB);
  const nodeA = nodes[a];
  const nodeB = nodes[b];
  if (!nodeA || !nodeB) return;

  const weight = distance2D(nodeA, nodeB);
  const key = `${a}:${b}`;
  const existing = edgeMap.get(key);
  if (!existing || weight < existing.weight) {
    edgeMap.set(key, {
      a,
      b,
      weight,
      isRamp: existing ? existing.isRamp || isRamp : isRamp,
    });
  } else if (isRamp && !existing.isRamp) {
    edgeMap.set(key, { ...existing, isRamp: true });
  }
}

/**
 * Builds a connected weighted undirected road-intersection graph from `map.roads`.
 * Automatically splits segments at perpendicular crossings and collinear overlaps (bridges).
 */
export function buildRoadGraph(map: CaliMapConfig = CALI_MAP): RoadGraph {
  const rawNodes: Vec2[] = [];
  const edgeMap = new Map<string, RoadGraphEdge>();
  const splits = collectSegmentSplits(map.roads);

  for (let i = 0; i < map.roads.length; i += 1) {
    const road = map.roads[i];
    const params = splits[i];
    if (!road || !params) continue;

    const dx = road.end.x - road.start.x;
    const dz = road.end.z - road.start.z;
    if (dx * dx + dz * dz < 1e-8) continue;

    const isRamp = Boolean(road.isRamp);
    let prevNodeId: number | null = null;
    for (const t of uniqueSortedParams(params)) {
      const nodeId = internGraphNode(rawNodes, road.start.x + dx * t, road.start.z + dz * t);
      if (prevNodeId !== null && prevNodeId !== nodeId) {
        recordUndirectedEdge(edgeMap, rawNodes, prevNodeId, nodeId, isRamp);
      }
      prevNodeId = nodeId;
    }
  }

  const edges = [...edgeMap.values()];
  const adjacency: RoadAdjacencyEntry[][] = rawNodes.map(() => []);
  const hasRampEdge = rawNodes.map(() => false);
  const hasFlatEdge = rawNodes.map(() => false);

  for (const edge of edges) {
    adjacency[edge.a]?.push({ to: edge.b, weight: edge.weight });
    adjacency[edge.b]?.push({ to: edge.a, weight: edge.weight });
    if (edge.isRamp) {
      hasRampEdge[edge.a] = true;
      hasRampEdge[edge.b] = true;
    } else {
      hasFlatEdge[edge.a] = true;
      hasFlatEdge[edge.b] = true;
    }
  }

  for (const list of adjacency) {
    list.sort((lhs, rhs) => lhs.to - rhs.to);
  }

  const nodes: RoadGraphNode[] = rawNodes.map((pos, id) => ({
    id,
    x: pos.x,
    z: pos.z,
    isRampTransition: Boolean(hasRampEdge[id] && hasFlatEdge[id]),
  }));

  return { nodes, edges, adjacency };
}

function getCachedRoadGraph(map: CaliMapConfig): RoadGraph {
  const cached = graphCache.get(map);
  if (cached) {
    return cached;
  }
  const built = buildRoadGraph(map);
  graphCache.set(map, built);
  return built;
}

function snapPointToGraph(
  point: Vec2,
  graph: RoadGraph,
  map: CaliMapConfig,
): SnapMatch | null {
  let bestDry: SnapMatch | null = null;
  let bestAny: SnapMatch | null = null;

  for (let i = 0; i < graph.edges.length; i += 1) {
    const edge = graph.edges[i];
    if (!edge) continue;
    const nodeA = graph.nodes[edge.a];
    const nodeB = graph.nodes[edge.b];
    if (!nodeA || !nodeB) continue;

    const proj = projectPointOntoSegment(point, nodeA, nodeB);
    const candidate: SnapMatch = {
      edgeIndex: i,
      point: proj.point,
      distSq: proj.distSq,
    };

    if (!bestAny || candidate.distSq < bestAny.distSq - TIE_EPS) {
      bestAny = candidate;
    }

    if (
      (!bestDry || candidate.distSq < bestDry.distSq - TIE_EPS) &&
      !segmentEntersRiver(point, proj.point, map)
    ) {
      bestDry = candidate;
    }
  }

  return bestDry ?? bestAny;
}

function runDijkstra(
  nodeCount: number,
  startIdx: number,
  endIdx: number,
  getNeighbors: (idx: number) => readonly RoadAdjacencyEntry[],
): number[] | null {
  const dist = new Array<number>(nodeCount).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(nodeCount).fill(-1);
  const visited = new Array<boolean>(nodeCount).fill(false);
  dist[startIdx] = 0;

  for (let step = 0; step < nodeCount; step += 1) {
    let bestNode = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nodeCount; i += 1) {
      const d = dist[i] ?? Number.POSITIVE_INFINITY;
      if (!visited[i] && d < bestDist - TIE_EPS) {
        bestDist = d;
        bestNode = i;
      }
    }

    if (bestNode === -1 || bestNode === endIdx) {
      break;
    }

    visited[bestNode] = true;
    const neighbors = getNeighbors(bestNode);
    for (const edge of neighbors) {
      if (visited[edge.to]) continue;
      const candidate = bestDist + edge.weight;
      const current = dist[edge.to] ?? Number.POSITIVE_INFINITY;
      if (candidate < current - TIE_EPS) {
        dist[edge.to] = candidate;
        prev[edge.to] = bestNode;
      }
    }
  }

  if (!Number.isFinite(dist[endIdx] ?? Number.POSITIVE_INFINITY)) {
    return null;
  }

  const path: number[] = [];
  let cursor = endIdx;
  while (cursor !== -1) {
    path.push(cursor);
    if (cursor === startIdx) break;
    cursor = prev[cursor] ?? -1;
  }
  path.reverse();
  return path[0] === startIdx ? path : null;
}

function isCollinearMiddle(a: Vec2, b: Vec2, c: Vec2): boolean {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const bcx = c.x - b.x;
  const bcz = c.z - b.z;
  // Never collapse a reversal corner.
  if (abx * bcx + abz * bcz < 0) {
    return false;
  }

  const acx = c.x - a.x;
  const acz = c.z - a.z;
  const acLen = Math.hypot(acx, acz);
  if (acLen < 1e-6) {
    return true;
  }

  const perpDist = Math.abs(cross2D(abx, abz, acx, acz)) / acLen;
  return perpDist <= COLLINEAR_SIMPLIFY_TOLERANCE;
}

function simplifyRoute(raw: readonly AnnotatedPoint[]): readonly Vec2[] {
  const first = raw[0];
  if (!first) return [];

  const deduped: AnnotatedPoint[] = [first];
  for (let i = 1; i < raw.length; i += 1) {
    const entry = raw[i];
    const prev = deduped[deduped.length - 1];
    if (!entry || !prev) continue;

    const isLast = i === raw.length - 1;
    if (distance2D(prev.point, entry.point) < MIN_ROUTE_STEP_METERS) {
      if (isLast) {
        if (deduped.length > 1) {
          deduped[deduped.length - 1] = { point: entry.point, preserve: true };
        } else {
          deduped.push({ point: entry.point, preserve: true });
        }
      } else if (entry.preserve && !prev.preserve) {
        deduped[deduped.length - 1] = entry;
      }
      continue;
    }

    deduped.push(entry);
  }

  const simplified: AnnotatedPoint[] = [];
  for (const entry of deduped) {
    while (simplified.length >= 2) {
      const prev = simplified[simplified.length - 1];
      const beforePrev = simplified[simplified.length - 2];
      if (
        prev &&
        beforePrev &&
        !prev.preserve &&
        isCollinearMiddle(beforePrev.point, prev.point, entry.point)
      ) {
        simplified.pop();
      } else {
        break;
      }
    }
    simplified.push(entry);
  }

  return simplified.map((entry) => entry.point);
}

function buildAugmentedNeighborLookup(
  graph: RoadGraph,
  startSnap: SnapMatch,
  endSnap: SnapMatch,
  startVirtualId: number,
  endVirtualId: number,
): ((idx: number) => readonly RoadAdjacencyEntry[]) | null {
  const startEdge = graph.edges[startSnap.edgeIndex];
  const endEdge = graph.edges[endSnap.edgeIndex];
  if (!startEdge || !endEdge) return null;

  const startNodeA = graph.nodes[startEdge.a];
  const startNodeB = graph.nodes[startEdge.b];
  const endNodeA = graph.nodes[endEdge.a];
  const endNodeB = graph.nodes[endEdge.b];
  if (!startNodeA || !startNodeB || !endNodeA || !endNodeB) return null;

  const startNeighbors: RoadAdjacencyEntry[] = [
    { to: startEdge.a, weight: distance2D(startSnap.point, startNodeA) },
    { to: startEdge.b, weight: distance2D(startSnap.point, startNodeB) },
  ];
  if (startSnap.edgeIndex === endSnap.edgeIndex) {
    startNeighbors.push({
      to: endVirtualId,
      weight: distance2D(startSnap.point, endSnap.point),
    });
  }

  const endEdgeDistA = distance2D(endNodeA, endSnap.point);
  const endEdgeDistB = distance2D(endNodeB, endSnap.point);

  return (idx: number): readonly RoadAdjacencyEntry[] => {
    if (idx === startVirtualId) return startNeighbors;
    if (idx === endVirtualId) return [];
    const baseNeighbors = graph.adjacency[idx] ?? [];
    if (idx === endEdge.a || idx === endEdge.b) {
      const weightToEnd = idx === endEdge.a ? endEdgeDistA : endEdgeDistB;
      return [...baseNeighbors, { to: endVirtualId, weight: weightToEnd }];
    }
    return baseNeighbors;
  };
}

/**
 * Computes a deterministic shortest-path road route from `from` to `to` using Dijkstra
 * over the map's road graph, simplifying redundant collinear points while preserving endpoints.
 */
export function computeGpsRoute(
  from: Vec2,
  to: Vec2,
  map: CaliMapConfig = CALI_MAP,
): readonly Vec2[] {
  if (distance2D(from, to) <= 1e-6) {
    return [{ x: from.x, z: from.z }];
  }

  const fallbackRoute: readonly Vec2[] = [
    { x: from.x, z: from.z },
    { x: to.x, z: to.z },
  ];
  const graph = getCachedRoadGraph(map);
  if (graph.nodes.length === 0 || graph.edges.length === 0) {
    return fallbackRoute;
  }

  const startSnap = snapPointToGraph(from, graph, map);
  const endSnap = snapPointToGraph(to, graph, map);
  if (!startSnap || !endSnap) {
    return fallbackRoute;
  }

  const baseCount = graph.nodes.length;
  const startVirtualId = baseCount;
  const endVirtualId = baseCount + 1;
  const getNeighbors = buildAugmentedNeighborLookup(
    graph,
    startSnap,
    endSnap,
    startVirtualId,
    endVirtualId,
  );
  if (!getNeighbors) {
    return fallbackRoute;
  }

  const nodePath = runDijkstra(baseCount + 2, startVirtualId, endVirtualId, getNeighbors);
  if (!nodePath) {
    return fallbackRoute;
  }

  const rawPoints: AnnotatedPoint[] = [
    { point: { x: from.x, z: from.z }, preserve: true },
  ];
  for (const nodeId of nodePath) {
    if (nodeId === startVirtualId) {
      rawPoints.push({ point: startSnap.point, preserve: false });
    } else if (nodeId === endVirtualId) {
      rawPoints.push({ point: endSnap.point, preserve: false });
    } else {
      const node = graph.nodes[nodeId];
      if (node) {
        rawPoints.push({
          point: { x: node.x, z: node.z },
          preserve: node.isRampTransition,
        });
      }
    }
  }
  rawPoints.push({ point: { x: to.x, z: to.z }, preserve: true });

  return simplifyRoute(rawPoints);
}

/**
 * Computes the total Euclidean polyline length in meters for a GPS route.
 */
export function computeRouteDistanceMeters(route: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    const prev = route[i - 1];
    const curr = route[i];
    if (prev && curr) {
      total += distance2D(prev, curr);
    }
  }
  return total;
}

/**
 * Computes the signed turn-bearing delta in `[-Math.PI, Math.PI]` from `playerHeading`
 * toward a look-ahead point at least 8m ahead along `route` (or the final destination if closer).
 * Sign convention matches `physics.ts`: 0 = straight ahead, positive = turn left, negative = turn right.
 */
export function computeNextTurnBearing(
  playerPos: Vec2,
  playerHeading: number,
  route: readonly Vec2[],
): number {
  const firstPoint = route[0];
  if (!firstPoint) {
    return 0;
  }

  let lookAhead: Vec2 = route[route.length - 1] ?? firstPoint;

  if (route.length >= 2) {
    let bestSegIndex = 0;
    let bestDistSq = Number.POSITIVE_INFINITY;
    let bestProj: Vec2 = firstPoint;

    for (let i = 0; i < route.length - 1; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      if (!a || !b) continue;
      const proj = projectPointOntoSegment(playerPos, a, b);
      if (proj.distSq < bestDistSq - TIE_EPS) {
        bestDistSq = proj.distSq;
        bestSegIndex = i;
        bestProj = proj.point;
      }
    }

    let cursor = bestProj;
    let remaining = LOOKAHEAD_METERS;
    for (let i = bestSegIndex; i < route.length - 1; i += 1) {
      const segEnd = route[i + 1];
      if (!segEnd) continue;
      const segDx = segEnd.x - cursor.x;
      const segDz = segEnd.z - cursor.z;
      const segLen = Math.hypot(segDx, segDz);
      if (segLen >= remaining && segLen > 1e-6) {
        const ratio = remaining / segLen;
        lookAhead = {
          x: cursor.x + segDx * ratio,
          z: cursor.z + segDz * ratio,
        };
        break;
      }
      remaining -= segLen;
      cursor = segEnd;
    }
  }

  const dx = lookAhead.x - playerPos.x;
  const dz = lookAhead.z - playerPos.z;
  if (dx * dx + dz * dz < 1e-8) {
    return 0;
  }

  const targetAngle = Math.atan2(dx, dz);
  return normalizeAngle(targetAngle - playerHeading);
}
