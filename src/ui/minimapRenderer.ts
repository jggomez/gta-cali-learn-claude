/**
 * Procedural 2D Canvas zoomed player-centered GTA radar minimap for Santiago de Cali.
 * Consumes CALI_MAP + readonly WorldSnapshot and MissionSnapshot without mutating game state.
 */

import { CALI_MAP } from '../config/caliMap';
import type {
  CaliMapConfig,
  LandmarkId,
  MissionSnapshot,
  ObjectiveSnapshot,
  Vec2,
  WorldSnapshot,
} from '../types/game';

interface MinimapPalette {
  readonly surface: string;
  readonly grid: string;
  readonly hillContour: string;
  readonly building: string;
  readonly river: string;
  readonly riverBorder: string;
  readonly road: string;
  readonly ramp: string;
  readonly bridge: string;
  readonly landmarkUndiscovered: string;
  readonly landmarkDiscovered: string;
  readonly badgeBg: string;
  readonly badgeText: string;
  readonly gpsOutline: string;
  readonly gpsGlow: string;
  readonly gpsGold: string;
  readonly gpsMagenta: string;
  readonly objectiveGlow: string;
  readonly objectiveCore: string;
  readonly policeRed: string;
  readonly policeBlue: string;
  readonly playerCar: string;
  readonly playerArrow: string;
  readonly playerOutline: string;
  readonly trafficDot: string;
  readonly pedestrianDot: string;
  readonly pedestrianFleeDot: string;
}

interface RadarProjection {
  readonly width: number;
  readonly height: number;
  readonly pxPerMeter: number;
  toX(wx: number): number;
  toY(wz: number): number;
}

const DEFAULT_PALETTE: MinimapPalette = {
  surface: '#120826',
  grid: 'rgba(201, 194, 227, 0.08)',
  hillContour: 'rgba(255, 184, 0, 0.14)',
  building: '#1D0E3D',
  river: 'rgba(0, 240, 255, 0.36)',
  riverBorder: 'rgba(0, 240, 255, 0.78)',
  road: 'rgba(248, 247, 255, 0.3)',
  ramp: 'rgba(255, 184, 0, 0.58)',
  bridge: '#C9C2E3',
  landmarkUndiscovered: '#C9C2E3',
  landmarkDiscovered: '#00E699',
  badgeBg: 'rgba(18, 8, 38, 0.88)',
  badgeText: '#F8F7FF',
  gpsOutline: 'rgba(18, 8, 38, 0.94)',
  gpsGlow: 'rgba(255, 46, 147, 0.45)',
  gpsGold: '#FFB800',
  gpsMagenta: '#FF2E93',
  objectiveGlow: 'rgba(255, 46, 147, 0.45)',
  objectiveCore: '#FF2E93',
  policeRed: '#FF3B5C',
  policeBlue: '#2E7BFF',
  playerCar: '#00F0FF',
  playerArrow: '#F8F7FF',
  playerOutline: '#120826',
  trafficDot: 'rgba(201, 194, 227, 0.52)',
  pedestrianDot: 'rgba(201, 194, 227, 0.36)',
  pedestrianFleeDot: 'rgba(255, 184, 0, 0.65)',
};

const LANDMARK_CODES: Readonly<Record<LandmarkId, string>> = {
  san_antonio: 'SA',
  torre_de_cali: 'TC',
  bulevar_del_rio: 'BR',
  la_ermita: 'LE',
  estadio_pascual: 'EP',
  cristo_rey: 'CR',
};

const MAP_PADDING_PX = 8;
const RADAR_ZOOM = 2.0;
const BEACON_EDGE_MARGIN_PX = 9;

function clamp(value: number, min: number, max: number): number {
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function prefersReducedMotion(): boolean {
  try {
    const scope = globalThis as { matchMedia?: (query: string) => MediaQueryList };
    return Boolean(scope.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function hexNumberToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class MinimapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly map: CaliMapConfig;
  private readonly palette: MinimapPalette = DEFAULT_PALETTE;

  public constructor(canvas: HTMLCanvasElement, map: CaliMapConfig = CALI_MAP) {
    this.canvas = canvas;
    this.map = map;
    this.ctx = canvas.getContext('2d');
  }

  public render(world: WorldSnapshot, mission: MissionSnapshot): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }

    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 0 || height <= 0) {
      return;
    }

    const reducedMotion = prefersReducedMotion();
    const proj = this.createProjection(width, height, world.player.x, world.player.z);

    // 1. Twilight background & subtle radar grid
    ctx.fillStyle = this.palette.surface;
    ctx.fillRect(0, 0, width, height);
    this.drawGrid(ctx, width, height);

    // 2. Cerro Los Cristales western ridge contour hint
    const ridgeRightX = proj.toX(-118);
    if (ridgeRightX > 0) {
      ctx.fillStyle = this.palette.hillContour;
      ctx.fillRect(0, 0, Math.min(width, ridgeRightX), height);
    }

    // 3. Urban building footprints
    ctx.fillStyle = this.palette.building;
    for (const building of this.map.buildingColliders) {
      const bx = proj.toX(building.minX);
      const by = proj.toY(building.minZ);
      const bw = Math.max(2, (building.maxX - building.minX) * proj.pxPerMeter);
      const bh = Math.max(2, (building.maxZ - building.minZ) * proj.pxPerMeter);
      if (bx + bw < 0 || bx > width || by + bh < 0 || by > height) {
        continue;
      }
      ctx.fillRect(bx, by, bw, bh);
    }

    // 4. Río Cali cyan corridor
    const river = this.map.river;
    const rx = proj.toX(river.minX);
    const ry = proj.toY(river.minZ);
    const rw = Math.max(4, (river.maxX - river.minX) * proj.pxPerMeter);
    const rh = Math.max(4, (river.maxZ - river.minZ) * proj.pxPerMeter);
    if (rx + rw >= 0 && rx <= width) {
      ctx.fillStyle = this.palette.river;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = this.palette.riverBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, ry, rw, rh);
    }

    // 5. Road network
    ctx.lineCap = 'round';
    for (const road of this.map.roads) {
      ctx.beginPath();
      ctx.strokeStyle = road.isRamp ? this.palette.ramp : this.palette.road;
      ctx.lineWidth = Math.max(3, road.width * proj.pxPerMeter);
      ctx.moveTo(proj.toX(road.start.x), proj.toY(road.start.z));
      ctx.lineTo(proj.toX(road.end.x), proj.toY(road.end.z));
      ctx.stroke();
    }

    // 6. Twin bridges over Río Cali
    ctx.fillStyle = this.palette.bridge;
    for (const bridge of river.bridges) {
      const bx = proj.toX(bridge.minX);
      const by = proj.toY(bridge.minZ);
      const bw = Math.max(4, (bridge.maxX - bridge.minX) * proj.pxPerMeter);
      const bh = Math.max(4, (bridge.maxZ - bridge.minZ) * proj.pxPerMeter);
      if (bx + bw < 0 || bx > width || by + bh < 0 || by > height) {
        continue;
      }
      ctx.fillRect(bx, by, bw, bh);
    }

    // 7. Landmark markers + 2-letter Cali badges (SA, TC, BR, LE, EP, CR)
    this.drawLandmarks(ctx, proj, mission.discoveredLandmarks);

    // 8. Nearby pedestrians as subtle tiny dots
    this.drawPedestrians(ctx, proj, world);

    // 9. Active objective road-following GPS polyline + in-frame or edge-clamped beacon
    const objective = mission.activeObjective;
    if (objective?.target) {
      this.drawObjectiveGpsAndBeacon(ctx, proj, world, objective, reducedMotion);
    }

    // 10. Vehicles: traffic dots, parked Banshee, and prominent flashing police blips
    this.drawVehicles(ctx, proj, world, reducedMotion);

    // 11. Rotated player chevron arrow (dx = sin(heading), dz = cos(heading))
    this.drawPlayerChevron(
      ctx,
      proj.toX(world.player.x),
      proj.toY(world.player.z),
      Math.atan2(Math.cos(world.player.heading), Math.sin(world.player.heading)),
    );
  }

  private createProjection(
    width: number,
    height: number,
    playerX: number,
    playerZ: number,
  ): RadarProjection {
    const worldHalf = this.map.worldHalfSize;
    const worldSpan = worldHalf * 2;
    const drawableW = Math.max(1, width - MAP_PADDING_PX * 2);
    const drawableH = Math.max(1, height - MAP_PADDING_PX * 2);
    const pxPerMeter = (drawableW / worldSpan) * RADAR_ZOOM;

    const viewHalfW = Math.min(worldHalf, drawableW / (2 * pxPerMeter));
    const viewHalfH = Math.min(worldHalf, drawableH / (2 * pxPerMeter));
    const maxCenterX = Math.max(0, worldHalf - viewHalfW);
    const maxCenterZ = Math.max(0, worldHalf - viewHalfH);

    const centerX = clamp(playerX, -maxCenterX, maxCenterX);
    const centerZ = clamp(playerZ, -maxCenterZ, maxCenterZ);
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;

    return {
      width,
      height,
      pxPerMeter,
      toX: (wx: number): number => halfWidth + (wx - centerX) * pxPerMeter,
      toY: (wz: number): number => halfHeight + (wz - centerZ) * pxPerMeter,
    };
  }

  private drawLandmarks(
    ctx: CanvasRenderingContext2D,
    proj: RadarProjection,
    discoveredList: readonly LandmarkId[],
  ): void {
    const discovered = new Set(discoveredList);
    ctx.save();
    ctx.font = 'bold 8px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const landmark of this.map.landmarks) {
      const lx = proj.toX(landmark.position.x);
      const ly = proj.toY(landmark.position.z);
      if (lx < -12 || lx > proj.width + 12 || ly < -12 || ly > proj.height + 12) {
        continue;
      }

      const isDiscovered = discovered.has(landmark.id);
      const dotColor = isDiscovered
        ? this.palette.landmarkDiscovered
        : this.palette.landmarkUndiscovered;

      ctx.beginPath();
      ctx.arc(lx, ly, isDiscovered ? 3.8 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.strokeStyle = this.palette.playerOutline;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      const code = LANDMARK_CODES[landmark.id];
      const badgeW = 16;
      const badgeH = 11;
      const preferLeft = lx + 6 + badgeW > proj.width - 2;
      const badgeX = clamp(
        preferLeft ? lx - 6 - badgeW : lx + 6,
        2,
        proj.width - badgeW - 2,
      );
      const badgeY = clamp(ly - badgeH * 0.5, 2, proj.height - badgeH - 2);

      ctx.fillStyle = this.palette.badgeBg;
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

      ctx.fillStyle = this.palette.badgeText;
      ctx.fillText(code, badgeX + badgeW * 0.5, badgeY + badgeH * 0.5 + 0.5);
    }

    ctx.restore();
  }

  private drawPedestrians(
    ctx: CanvasRenderingContext2D,
    proj: RadarProjection,
    world: WorldSnapshot,
  ): void {
    const pedestrians = world.pedestrians;
    if (!pedestrians || pedestrians.length === 0) {
      return;
    }

    for (const ped of pedestrians) {
      const px = proj.toX(ped.x);
      const py = proj.toY(ped.z);
      if (px < -4 || px > proj.width + 4 || py < -4 || py > proj.height + 4) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(px, py, 1.35, 0, Math.PI * 2);
      ctx.fillStyle = ped.fleeing ? this.palette.pedestrianFleeDot : this.palette.pedestrianDot;
      ctx.fill();
    }
  }

  private drawObjectiveGpsAndBeacon(
    ctx: CanvasRenderingContext2D,
    proj: RadarProjection,
    world: WorldSnapshot,
    objective: ObjectiveSnapshot,
    reducedMotion: boolean,
  ): void {
    if (!objective.target) {
      return;
    }

    const px = proj.toX(world.player.x);
    const py = proj.toY(world.player.z);
    const tx = proj.toX(objective.target.x);
    const ty = proj.toY(objective.target.z);
    const beaconColor = hexNumberToCss(objective.beaconColorHex);
    const pulse = reducedMotion ? 0.5 : (Math.sin(world.timeSeconds * 6) + 1) * 0.5;

    const routePoints: readonly Vec2[] =
      objective.gpsRoute && objective.gpsRoute.length >= 2
        ? objective.gpsRoute
        : [{ x: world.player.x, z: world.player.z }, objective.target];

    const routeCoreColor =
      objective.kind === 'escape_police' ? this.palette.gpsMagenta : this.palette.gpsGold;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    // Dark outline for contrast over roads & bridges
    this.traceRoutePolyline(ctx, proj, routePoints);
    ctx.strokeStyle = this.palette.gpsOutline;
    ctx.lineWidth = 5.4;
    ctx.stroke();

    // Neon outer glow
    this.traceRoutePolyline(ctx, proj, routePoints);
    ctx.strokeStyle = this.palette.gpsGlow;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Solid glowing GPS path core
    this.traceRoutePolyline(ctx, proj, routePoints);
    ctx.strokeStyle = routeCoreColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    const insideFrame =
      tx >= BEACON_EDGE_MARGIN_PX &&
      tx <= proj.width - BEACON_EDGE_MARGIN_PX &&
      ty >= BEACON_EDGE_MARGIN_PX &&
      ty <= proj.height - BEACON_EDGE_MARGIN_PX;

    if (insideFrame) {
      ctx.beginPath();
      ctx.arc(tx, ty, 5.5 + pulse * 3.8, 0, Math.PI * 2);
      ctx.fillStyle = this.palette.objectiveGlow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.fillStyle = beaconColor || this.palette.objectiveCore;
      ctx.fill();
      ctx.strokeStyle = this.palette.playerOutline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      return;
    }

    this.drawEdgeBeaconTriangle(ctx, proj, px, py, tx, ty, beaconColor, pulse);
  }

  private traceRoutePolyline(
    ctx: CanvasRenderingContext2D,
    proj: RadarProjection,
    points: readonly Vec2[],
  ): void {
    const first = points[0];
    if (!first) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(proj.toX(first.x), proj.toY(first.z));
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (point) {
        ctx.lineTo(proj.toX(point.x), proj.toY(point.z));
      }
    }
  }

  private drawEdgeBeaconTriangle(
    ctx: CanvasRenderingContext2D,
    proj: RadarProjection,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    beaconColor: string,
    pulse: number,
  ): void {
    const minX = BEACON_EDGE_MARGIN_PX;
    const maxX = proj.width - BEACON_EDGE_MARGIN_PX;
    const minY = BEACON_EDGE_MARGIN_PX;
    const maxY = proj.height - BEACON_EDGE_MARGIN_PX;

    const cx = clamp(originX, minX + 1, maxX - 1);
    const cy = clamp(originY, minY + 1, maxY - 1);
    const dx = targetX - cx;
    const dy = targetY - cy;

    let tMin = Number.POSITIVE_INFINITY;
    if (dx > 1e-6) {
      tMin = Math.min(tMin, (maxX - cx) / dx);
    } else if (dx < -1e-6) {
      tMin = Math.min(tMin, (minX - cx) / dx);
    }
    if (dy > 1e-6) {
      tMin = Math.min(tMin, (maxY - cy) / dy);
    } else if (dy < -1e-6) {
      tMin = Math.min(tMin, (minY - cy) / dy);
    }

    const bx = Number.isFinite(tMin) ? cx + dx * tMin : clamp(targetX, minX, maxX);
    const by = Number.isFinite(tMin) ? cy + dy * tMin : clamp(targetY, minY, maxY);
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(bx, by);

    ctx.beginPath();
    ctx.arc(0, 0, 5.5 + pulse * 3, 0, Math.PI * 2);
    ctx.fillStyle = this.palette.objectiveGlow;
    ctx.fill();

    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(6.2, 0);
    ctx.lineTo(-4.4, -4.4);
    ctx.lineTo(-4.4, 4.4);
    ctx.closePath();

    ctx.fillStyle = beaconColor || this.palette.objectiveCore;
    ctx.fill();
    ctx.strokeStyle = this.palette.playerOutline;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  private drawVehicles(
    ctx: CanvasRenderingContext2D,
    proj: RadarProjection,
    world: WorldSnapshot,
    reducedMotion: boolean,
  ): void {
    const policeRedPhase = Math.floor(world.timeSeconds * 6) % 2 === 0;
    for (const vehicle of world.vehicles) {
      const vx = proj.toX(vehicle.x);
      const vy = proj.toY(vehicle.z);
      if (vx < -10 || vx > proj.width + 10 || vy < -10 || vy > proj.height + 10) {
        continue;
      }

      if (vehicle.role === 'police' && world.wantedStars > 0) {
        const primary = reducedMotion
          ? this.palette.policeRed
          : policeRedPhase
            ? this.palette.policeRed
            : this.palette.policeBlue;
        const ring = reducedMotion
          ? this.palette.policeBlue
          : policeRedPhase
            ? this.palette.policeBlue
            : this.palette.policeRed;

        ctx.beginPath();
        ctx.arc(vx, vy, 5.4, 0, Math.PI * 2);
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(vx, vy, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();
      } else if (vehicle.role === 'player' && world.player.mode === 'on_foot') {
        ctx.beginPath();
        ctx.arc(vx, vy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = this.palette.playerCar;
        ctx.fill();
        ctx.strokeStyle = this.palette.playerOutline;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (vehicle.role === 'traffic') {
        ctx.beginPath();
        ctx.arc(vx, vy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = this.palette.trafficDot;
        ctx.fill();
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = this.palette.grid;
    ctx.lineWidth = 1;
    const cols = 4;
    const rows = 3;

    for (let i = 1; i < cols; i += 1) {
      const x = (width / cols) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let j = 1; j < rows; j += 1) {
      const y = (height / rows) * j;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  private drawPlayerChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angleRad: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad);

    ctx.beginPath();
    ctx.moveTo(7.2, 0);
    ctx.lineTo(-4.8, -4.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-4.8, 4.5);
    ctx.closePath();

    ctx.fillStyle = this.palette.playerArrow;
    ctx.fill();
    ctx.strokeStyle = this.palette.playerOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
}
