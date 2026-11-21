/**
 * Procedural 2D Canvas GPS minimap renderer for Santiago de Cali.
 * Consumes CALI_MAP + readonly WorldSnapshot and MissionSnapshot without mutating game state.
 */

import { CALI_MAP } from '../config/caliMap';
import type { CaliMapConfig, MissionSnapshot, WorldSnapshot } from '../types/game';

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
  readonly objectiveGlow: string;
  readonly objectiveCore: string;
  readonly policeRed: string;
  readonly policeBlue: string;
  readonly playerCar: string;
  readonly playerArrow: string;
  readonly playerOutline: string;
  readonly trafficDot: string;
}

const DEFAULT_PALETTE: MinimapPalette = {
  surface: '#120826',
  grid: 'rgba(201, 194, 227, 0.08)',
  hillContour: 'rgba(255, 184, 0, 0.12)',
  building: '#1D0E3D',
  river: 'rgba(0, 240, 255, 0.34)',
  riverBorder: 'rgba(0, 240, 255, 0.7)',
  road: 'rgba(248, 247, 255, 0.24)',
  ramp: 'rgba(255, 184, 0, 0.48)',
  bridge: '#C9C2E3',
  landmarkUndiscovered: '#C9C2E3',
  landmarkDiscovered: '#00E699',
  objectiveGlow: 'rgba(255, 46, 147, 0.45)',
  objectiveCore: '#FF2E93',
  policeRed: '#FF3B5C',
  policeBlue: '#2E7BFF',
  playerCar: '#00F0FF',
  playerArrow: '#F8F7FF',
  playerOutline: '#120826',
  trafficDot: 'rgba(201, 194, 227, 0.45)',
};

const MAP_PADDING_PX = 8;

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
    const worldSpan = this.map.worldHalfSize * 2;
    const drawableW = Math.max(1, width - MAP_PADDING_PX * 2);
    const drawableH = Math.max(1, height - MAP_PADDING_PX * 2);

    const toX = (wx: number): number =>
      MAP_PADDING_PX + ((wx + this.map.worldHalfSize) / worldSpan) * drawableW;
    const toY = (wz: number): number =>
      MAP_PADDING_PX + ((wz + this.map.worldHalfSize) / worldSpan) * drawableH;
    const scaleX = drawableW / worldSpan;
    const scaleY = drawableH / worldSpan;

    // 1. Twilight background & subtle radar grid
    ctx.fillStyle = this.palette.surface;
    ctx.fillRect(0, 0, width, height);
    this.drawGrid(ctx, width, height);

    // 2. Cerro Los Cristales western ridge contour hint
    ctx.fillStyle = this.palette.hillContour;
    ctx.fillRect(MAP_PADDING_PX, MAP_PADDING_PX, toX(-118) - MAP_PADDING_PX, drawableH);

    // 3. Urban building footprints
    ctx.fillStyle = this.palette.building;
    for (const building of this.map.buildingColliders) {
      const bx = toX(building.minX);
      const by = toY(building.minZ);
      const bw = Math.max(2, (building.maxX - building.minX) * scaleX);
      const bh = Math.max(2, (building.maxZ - building.minZ) * scaleY);
      ctx.fillRect(bx, by, bw, bh);
    }

    // 4. Río Cali cyan corridor
    const river = this.map.river;
    const rx = toX(river.minX);
    const ry = toY(river.minZ);
    const rw = Math.max(4, (river.maxX - river.minX) * scaleX);
    const rh = Math.max(4, (river.maxZ - river.minZ) * scaleY);
    ctx.fillStyle = this.palette.river;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = this.palette.riverBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);

    // 5. Road network
    ctx.lineCap = 'round';
    for (const road of this.map.roads) {
      ctx.beginPath();
      ctx.strokeStyle = road.isRamp ? this.palette.ramp : this.palette.road;
      ctx.lineWidth = Math.max(2, road.width * Math.min(scaleX, scaleY));
      ctx.moveTo(toX(road.start.x), toY(road.start.z));
      ctx.lineTo(toX(road.end.x), toY(road.end.z));
      ctx.stroke();
    }

    // 6. Twin bridges over Río Cali
    ctx.fillStyle = this.palette.bridge;
    for (const bridge of river.bridges) {
      const bx = toX(bridge.minX);
      const by = toY(bridge.minZ);
      const bw = Math.max(4, (bridge.maxX - bridge.minX) * scaleX);
      const bh = Math.max(3, (bridge.maxZ - bridge.minZ) * scaleY);
      ctx.fillRect(bx, by, bw, bh);
    }

    // 7. Landmark markers (6 Cali icons)
    const discovered = new Set(mission.discoveredLandmarks);
    for (const landmark of this.map.landmarks) {
      const lx = toX(landmark.position.x);
      const ly = toY(landmark.position.z);
      const isDiscovered = discovered.has(landmark.id);

      ctx.beginPath();
      ctx.arc(lx, ly, isDiscovered ? 3.2 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = isDiscovered
        ? this.palette.landmarkDiscovered
        : this.palette.landmarkUndiscovered;
      ctx.fill();
    }

    // 8. Active objective GPS route line + pulsing beacon
    const objective = mission.activeObjective;
    if (objective?.target) {
      const px = toX(world.player.x);
      const py = toY(world.player.z);
      const tx = toX(objective.target.x);
      const ty = toY(objective.target.z);
      const beaconColor = hexNumberToCss(objective.beaconColorHex);
      const pulse = reducedMotion ? 0.5 : (Math.sin(world.timeSeconds * 6) + 1) * 0.5;

      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = beaconColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(tx, ty, 5 + pulse * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = this.palette.objectiveGlow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tx, ty, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = beaconColor || this.palette.objectiveCore;
      ctx.fill();
    }

    // 9. Vehicles: traffic dots, parked Banshee, and flashing police blips
    const policeRedPhase = Math.floor(world.timeSeconds * 6) % 2 === 0;
    for (const vehicle of world.vehicles) {
      const vx = toX(vehicle.x);
      const vy = toY(vehicle.z);

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
        ctx.arc(vx, vy, 4.4, 0, Math.PI * 2);
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(vx, vy, 2.7, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();
      } else if (vehicle.role === 'player' && world.player.mode === 'on_foot') {
        ctx.beginPath();
        ctx.arc(vx, vy, 3, 0, Math.PI * 2);
        ctx.fillStyle = this.palette.playerCar;
        ctx.fill();
      } else if (vehicle.role === 'traffic') {
        ctx.beginPath();
        ctx.arc(vx, vy, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = this.palette.trafficDot;
        ctx.fill();
      }
    }

    // 10. Rotated player chevron arrow (dx = sin(heading), dz = cos(heading))
    this.drawPlayerChevron(
      ctx,
      toX(world.player.x),
      toY(world.player.z),
      Math.atan2(Math.cos(world.player.heading), Math.sin(world.player.heading)),
    );
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = this.palette.grid;
    ctx.lineWidth = 1;
    const cols = 4;
    const rows = 3;

    for (let i = 1; i < cols; i++) {
      const x = (width / cols) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let j = 1; j < rows; j++) {
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
    ctx.moveTo(6.5, 0);
    ctx.lineTo(-4.5, -4.2);
    ctx.lineTo(-2.4, 0);
    ctx.lineTo(-4.5, 4.2);
    ctx.closePath();

    ctx.fillStyle = this.palette.playerArrow;
    ctx.fill();
    ctx.strokeStyle = this.palette.playerOutline;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();
  }
}
