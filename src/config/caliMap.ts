/**
 * Geometrically verified Mini-Cali map data and spatial helpers.
 * Serves as the single source of truth shared by headless simulation, missions, 3D world, and minimap.
 */

import type {
  AabbCollider,
  CaliMapConfig,
  GarageConfig,
  LandmarkDef,
  LandmarkId,
  MissionId,
  MissionStartConfig,
  MissionWaypointsConfig,
  ParkedVehicleDef,
  PlayerCarKind,
  PayNSprayZone,
  RiverCorridor,
  RoadblockZone,
  RoadSegment,
  SpawnPose,
  StuntJumpDef,
  TrafficRoute,
} from '../types/game';
import { DEVHACK_BILLBOARD_COLLIDERS } from './devhackAds';

export const WORLD_HALF_SIZE = 240;

export const DEFAULT_GARAGE_CONFIG: GarageConfig = {
  carKind: 'renault4_turbo',
  paintHex: 0xe63946,
  neonHex: 0x00f0ff,
  avatar: 'valeria',
  outfit: 'urbano_cali',
};

// Record keys make the compiler enforce that every PlayerCarKind is listed (and in Garaje order).
const PLAYER_CAR_KIND_GARAGE_SLOTS: Readonly<Record<PlayerCarKind, true>> = {
  renault4_turbo: true,
  spark_gt_turbo: true,
  willys_v8: true,
  banshee: true,
  mazda_323_coupe: true,
  renault_18_gtx: true,
  chevrolet_sprint_turbo: true,
  chevrolet_monza: true,
  nissan_sentra_b13: true,
  chevette_turbo: true,
  renault_twingo: true,
  yamaha_rx115: true,
  yamaha_dt125: true,
};

/** Every player-selectable Garaje vehicle (cars first, then motos), in display order. */
export const PLAYER_CAR_KINDS: readonly PlayerCarKind[] = Object.keys(
  PLAYER_CAR_KIND_GARAGE_SLOTS,
) as PlayerCarKind[];

const CRISTO_REY_Z = -24;
const CRISTO_REY_MAX_ELEVATION = 22;
const SAN_ANTONIO_ELEVATION = 3.5;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic C1-smooth terrain height function for Santiago de Cali:
 * - 0m across downtown, Bulevar del Río, Río Cali, La Ermita, and Estadio Pascual Guerrero.
 * - Gentle 3.5m colonial hillside terrace in Barrio San Antonio (x: -115..-75, z: 10..55).
 * - Smooth climb up to 22m at Cerro Los Cristales / Cristo Rey with a 24m-wide level-banked ramp along z = -24.
 */
export function getTerrainElevation(x: number, z: number): number {
  const rampWeight = 1 - smoothstep(12, 32, Math.abs(z - CRISTO_REY_Z));
  const rampClimb = CRISTO_REY_MAX_ELEVATION * smoothstep(-110, -175, x);
  const ridgeClimb = CRISTO_REY_MAX_ELEVATION * smoothstep(-115, -180, x);
  const cristoHill = ridgeClimb + (rampClimb - ridgeClimb) * rampWeight;

  const sanX = smoothstep(-115, -102, x) * (1 - smoothstep(-75, -60, x));
  const sanZ = smoothstep(8, 20, z) * (1 - smoothstep(46, 58, z));
  const sanAntonioTerrace = SAN_ANTONIO_ELEVATION * sanX * sanZ;

  return cristoHill + sanAntonioTerrace;
}

export interface SidewalkSlabBlock {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Height of the raised concrete sidewalk slabs and Bulevar del Río promenade decks. */
export const SIDEWALK_SLAB_HEIGHT_METERS = 0.28;

/** Raised sidewalk slab footprints shared by the 3D world builder and on-foot grounding. */
export const SIDEWALK_SLAB_BLOCKS: readonly SidewalkSlabBlock[] = [
  // Flat city blocks neatly framing building colliders clear of every road & river edge
  { id: 'block_centro_nw', minX: -59, maxX: -13, minZ: -103, maxZ: -33 },
  { id: 'block_bulevar_adj', minX: -59, maxX: -13, minZ: -15, maxZ: 28 },
  { id: 'block_san_antonio_fringe', minX: -59, maxX: -13, minZ: 44, maxZ: 68 },
  { id: 'block_penon_sw', minX: -59, maxX: -13, minZ: 86, maxZ: 157 },
  { id: 'block_americas_n', minX: -64, maxX: -20, minZ: -160, maxZ: -122 },
  { id: 'block_granada_ne', minX: 104, maxX: 166, minZ: -60, maxZ: 12 },
  { id: 'block_oriente_w', minX: 66, maxX: 88, minZ: 28, maxZ: 68 },
  { id: 'block_oriente_e', minX: 104, maxX: 166, minZ: 28, maxZ: 68 },
  { id: 'block_versalles_w', minX: 66, maxX: 88, minZ: -116, maxZ: -76 },
  { id: 'block_san_fernando', minX: 66, maxX: 88, minZ: 86, maxZ: 157 },
  { id: 'block_versalles_e', minX: 104, maxX: 166, minZ: -116, maxZ: -76 },
  // Bulevar del Río continuous riverside promenade decks
  { id: 'promenade_bulevar_mid', minX: 4.5, maxX: 22.8, minZ: -15, maxZ: 65 },
  { id: 'promenade_bulevar_north', minX: 4.5, maxX: 22.8, minZ: -103, maxZ: -35 },
  { id: 'promenade_bulevar_south', minX: 4.5, maxX: 22.8, minZ: 89, maxZ: 157 },
];

/**
 * Height of the surface a person stands on: terrain elevation, raised onto any sidewalk slab
 * so on-foot characters never sink their feet into the concrete.
 */
export function getWalkableGroundHeight(x: number, z: number): number {
  const terrain = getTerrainElevation(x, z);
  for (const block of SIDEWALK_SLAB_BLOCKS) {
    if (x >= block.minX && x <= block.maxX && z >= block.minZ && z <= block.maxZ) {
      return Math.max(terrain, SIDEWALK_SLAB_HEIGHT_METERS);
    }
  }
  return terrain;
}

export const RIVER_CORRIDOR: RiverCorridor = {
  id: 'rio_cali',
  name: 'Río Cali',
  minX: 24,
  maxX: 46,
  minZ: -WORLD_HALF_SIZE,
  maxZ: WORLD_HALF_SIZE,
  waterLevel: -0.6,
  bridges: [
    {
      id: 'puente_ermita',
      name: 'Puente La Ermita',
      minX: 20,
      maxX: 50,
      minZ: -34,
      maxZ: -12,
      deckElevation: 0.25,
    },
    {
      id: 'puente_bulevar_sur',
      name: 'Puente Bulevar Sur',
      minX: 20,
      maxX: 50,
      minZ: 66,
      maxZ: 88,
      deckElevation: 0.25,
    },
  ],
};

export function isPointOnBridge(x: number, z: number): boolean {
  for (const bridge of RIVER_CORRIDOR.bridges) {
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

export function isPointInRiver(x: number, z: number): boolean {
  const insideCorridor =
    x >= RIVER_CORRIDOR.minX &&
    x <= RIVER_CORRIDOR.maxX &&
    z >= RIVER_CORRIDOR.minZ &&
    z <= RIVER_CORRIDOR.maxZ;
  if (!insideCorridor) {
    return false;
  }
  return !isPointOnBridge(x, z);
}

export const LANDMARKS: readonly LandmarkDef[] = [
  {
    id: 'san_antonio',
    name: 'Barrio San Antonio',
    district: 'Barrio San Antonio',
    position: { x: -96, z: 32 },
    elevation: getTerrainElevation(-96, 32),
    discoveryRadius: 28,
    colorHex: 0xf7e7ce,
    accentHex: 0xd95b43,
    footprintHalfX: 6,
    footprintHalfZ: 5,
  },
  {
    id: 'torre_de_cali',
    name: 'Torre de Cali',
    district: 'Avenida Las Américas',
    position: { x: -4, z: -140 },
    elevation: getTerrainElevation(-4, -140),
    discoveryRadius: 34,
    colorHex: 0x3b2d5f,
    accentHex: 0x00f0ff,
    footprintHalfX: 11,
    footprintHalfZ: 11,
  },
  {
    id: 'bulevar_del_rio',
    name: 'Bulevar del Río',
    district: 'Bulevar del Río',
    position: { x: 12, z: 12 },
    elevation: getTerrainElevation(12, 12),
    discoveryRadius: 28,
    colorHex: 0xff5e7e,
    accentHex: 0xffb800,
    footprintHalfX: 6,
    footprintHalfZ: 14,
  },
  {
    id: 'la_ermita',
    name: 'Iglesia La Ermita',
    district: 'Iglesia La Ermita',
    position: { x: 74, z: -24 },
    elevation: getTerrainElevation(74, -24),
    discoveryRadius: 28,
    colorHex: 0xe6ecff,
    accentHex: 0x72b6ff,
    footprintHalfX: 9,
    footprintHalfZ: 12,
  },
  {
    id: 'estadio_pascual',
    name: 'Estadio Pascual Guerrero',
    district: 'Estadio Pascual Guerrero',
    position: { x: 132, z: 126 },
    elevation: getTerrainElevation(132, 126),
    discoveryRadius: 42,
    colorHex: 0xd92b4b,
    accentHex: 0xf8f7ff,
    footprintHalfX: 22,
    footprintHalfZ: 24,
  },
  {
    id: 'cristo_rey',
    name: 'Mirador de Cristo Rey',
    district: 'Cerro Los Cristales',
    position: { x: -188, z: -24 },
    elevation: getTerrainElevation(-188, -24),
    discoveryRadius: 36,
    colorHex: 0xf5f2ff,
    accentHex: 0xffb800,
    footprintHalfX: 8,
    footprintHalfZ: 8,
  },
];

export function getLandmarkById(id: LandmarkId): LandmarkDef {
  const landmark = LANDMARKS.find((entry) => entry.id === id);
  if (!landmark) {
    throw new Error(`Unknown Cali landmark id: ${id}`);
  }
  return landmark;
}

export function getDistrictAt(x: number, z: number): string {
  if (x <= -118) {
    return 'Cerro Los Cristales';
  }
  if (x <= -72 && z >= 0 && z <= 68) {
    return 'Barrio San Antonio';
  }
  if (x <= 24 && z <= -95) {
    return 'Avenida Las Américas';
  }
  if (x >= -14 && x <= 48 && z >= -16 && z <= 66) {
    return 'Bulevar del Río';
  }
  if (x >= 46 && x <= 96 && z >= -60 && z <= 22) {
    return 'Iglesia La Ermita';
  }
  if (x >= 90 && z >= 72) {
    return 'Estadio Pascual Guerrero';
  }
  if (x >= 46 && z < 72) {
    return 'Barrio Granada';
  }
  if (x < 24 && z > 66) {
    return 'El Peñón';
  }
  return 'Centro de Cali';
}

export const ROAD_SEGMENTS: readonly RoadSegment[] = [
  // West bank east-west arteries & Cristo Rey mountain ascent
  {
    id: 'calle_cristo_rey_ramp',
    name: 'Vía al Cerro Los Cristales',
    start: { x: -178, z: -24 },
    end: { x: -68, z: -24 },
    width: 18,
    isRamp: true,
  },
  {
    id: 'av_ermita_oeste',
    name: 'Calle 13 Centro',
    start: { x: -68, z: -24 },
    end: { x: 24, z: -24 },
    width: 16,
  },
  {
    id: 'puente_ermita_road',
    name: 'Puente La Ermita',
    start: { x: 20, z: -24 },
    end: { x: 58, z: -24 },
    width: 16,
  },
  {
    id: 'av_las_americas',
    name: 'Avenida Las Américas',
    start: { x: -68, z: -112 },
    end: { x: 10, z: -112 },
    width: 16,
    hasMedian: true,
  },
  {
    id: 'calle_san_antonio',
    name: 'Calle 2 San Antonio',
    start: { x: -86, z: 36 },
    end: { x: -4, z: 36 },
    width: 14,
  },
  {
    id: 'calle_quinta_oeste',
    name: 'Calle 5 Oeste',
    start: { x: -68, z: 77 },
    end: { x: 24, z: 77 },
    width: 16,
    hasMedian: true,
  },
  {
    id: 'puente_bulevar_sur_road',
    name: 'Calle 5 / Puente Bulevar Sur',
    start: { x: 20, z: 77 },
    end: { x: 174, z: 77 },
    width: 16,
    hasMedian: true,
  },
  {
    id: 'calle_sur_oeste',
    name: 'Avenida Circunvalar Sur',
    start: { x: -68, z: 166 },
    end: { x: -4, z: 166 },
    width: 14,
  },

  // West bank north-south spines
  {
    id: 'av_circunvalar',
    name: 'Avenida Circunvalar',
    start: { x: -68, z: -112 },
    end: { x: -68, z: 166 },
    width: 16,
  },
  {
    id: 'av_colombia',
    name: 'Avenida Colombia',
    start: { x: -4, z: -112 },
    end: { x: -4, z: 166 },
    width: 16,
    hasMedian: true,
  },

  // East bank north-south & east-west grid (La Ermita, Granada, Estadio Pascual Guerrero)
  {
    id: 'carrera_primera',
    name: 'Carrera 1 Paseo del Río',
    start: { x: 58, z: -112 },
    end: { x: 58, z: 166 },
    width: 14,
  },
  {
    id: 'av_granada_norte',
    name: 'Avenida 6N Granada',
    start: { x: 58, z: -68 },
    end: { x: 174, z: -68 },
    width: 14,
  },
  {
    id: 'calle_ermita_sur',
    name: 'Calle 10 Oriente',
    start: { x: 58, z: 20 },
    end: { x: 174, z: 20 },
    width: 14,
  },
  {
    id: 'av_roosevelt_sur',
    name: 'Avenida Roosevelt',
    start: { x: 58, z: 166 },
    end: { x: 174, z: 166 },
    width: 16,
  },
  {
    id: 'carrera_36_estadio',
    name: 'Carrera 36 Estadio',
    start: { x: 96, z: -68 },
    end: { x: 96, z: 166 },
    width: 14,
  },
  {
    id: 'carrera_39_oriente',
    name: 'Carrera 39 Oriente',
    start: { x: 174, z: -68 },
    end: { x: 174, z: 166 },
    width: 14,
  },
];

export const PLAYER_START: SpawnPose = {
  x: -90,
  z: 36,
  heading: Math.PI / 2,
};

export const PLAYER_CAR_SPAWN: SpawnPose = {
  x: -82,
  z: 36,
  heading: Math.PI / 2,
};

export const MISSION_STARTS: Readonly<Record<MissionId, MissionStartConfig>> = {
  mission_1_bulevar: {
    playerSpawn: { x: -24, z: -112, heading: Math.PI / 2 },
    carSpawn: { x: -16, z: -102, heading: 0 },
    startInVehicle: false,
    initialWantedStars: 0,
    defaultTimeOfDay: 'golden_hour',
  },
  mission_2_cristo_rey: {
    playerSpawn: { x: 122, z: 77, heading: -Math.PI / 2 },
    carSpawn: { x: 122, z: 77, heading: -Math.PI / 2 },
    startInVehicle: true,
    initialWantedStars: 3,
    defaultTimeOfDay: 'night',
  },
  mission_3_pique_bulevar: {
    playerSpawn: { x: -4, z: 62, heading: Math.PI },
    carSpawn: { x: -4, z: 62, heading: Math.PI },
    startInVehicle: true,
    initialWantedStars: 0,
    defaultTimeOfDay: 'golden_hour',
  },
  free_roam: {
    playerSpawn: { x: 6, z: 14, heading: Math.PI / 2 },
    carSpawn: { x: -4, z: 18, heading: Math.PI },
    startInVehicle: false,
    initialWantedStars: 0,
    defaultTimeOfDay: 'golden_hour',
  },
};

export const MISSION_WAYPOINTS: MissionWaypointsConfig = {
  mission1Pickup: {
    id: 'm1_torre_pickup',
    landmarkId: 'torre_de_cali',
    x: -4,
    z: -112,
    radius: 14,
    district: 'Avenida Las Américas',
  },
  mission1Escape: {
    id: 'm1_bulevar_checkpoint',
    landmarkId: 'bulevar_del_rio',
    x: -4,
    z: 12,
    radius: 14,
    district: 'Bulevar del Río',
  },
  mission1Finish: {
    id: 'm1_ermita_finish',
    landmarkId: 'la_ermita',
    x: 58,
    z: -24,
    radius: 14,
    district: 'Iglesia La Ermita',
  },
  mission1Hideout: {
    id: 'm1_san_antonio_hideout',
    landmarkId: 'san_antonio',
    x: -82,
    z: 36,
    radius: 15,
    district: 'Barrio San Antonio',
  },
  mission2Stage: {
    id: 'm2_estadio_stage',
    landmarkId: 'estadio_pascual',
    x: 132,
    z: 77,
    radius: 15,
    district: 'Estadio Pascual Guerrero',
  },
  mission2RingBridge: {
    id: 'm2_ring_bridge',
    landmarkId: 'bulevar_del_rio',
    x: 35,
    z: 77,
    radius: 16,
    district: 'Bulevar del Río',
  },
  mission2RingBulevar: {
    id: 'm2_ring_bulevar',
    landmarkId: 'bulevar_del_rio',
    x: -4,
    z: 16,
    radius: 16,
    district: 'Bulevar del Río',
  },
  mission2RampEntry: {
    id: 'm2_cristo_rey_ramp',
    landmarkId: 'cristo_rey',
    x: -68,
    z: -24,
    radius: 18,
    district: 'Avenida Circunvalar',
  },
  mission2Summit: {
    id: 'm2_cristo_rey_summit',
    landmarkId: 'cristo_rey',
    x: -176,
    z: -24,
    radius: 15,
    district: 'Cerro Los Cristales',
  },
  mission3Checkpoints: [
    {
      id: 'm3_cp1_bulevar',
      landmarkId: 'bulevar_del_rio',
      x: -4,
      z: -24,
      radius: 15,
      district: 'Bulevar del Río',
    },
    {
      id: 'm3_cp2_ermita',
      landmarkId: 'la_ermita',
      x: 58,
      z: -24,
      radius: 15,
      district: 'Iglesia La Ermita',
    },
    {
      id: 'm3_cp3_granada',
      landmarkId: 'la_ermita',
      x: 96,
      z: -68,
      radius: 15,
      district: 'Barrio Granada',
    },
    {
      id: 'm3_cp4_oriente',
      landmarkId: 'estadio_pascual',
      x: 174,
      z: 77,
      radius: 16,
      district: 'Estadio Pascual Guerrero',
    },
    {
      id: 'm3_cp5_puente_sur',
      landmarkId: 'bulevar_del_rio',
      x: 35,
      z: 77,
      radius: 16,
      district: 'Bulevar del Río',
    },
    {
      id: 'm3_cp6_meta_bulevar',
      landmarkId: 'bulevar_del_rio',
      x: -4,
      z: 16,
      radius: 16,
      district: 'Bulevar del Río',
    },
  ],
};

export const STUNT_JUMPS: readonly StuntJumpDef[] = [
  {
    id: 'stunt_bulevar_launch',
    name: 'Salto del Bulevar',
    x: -4,
    z: 48,
    heading: Math.PI,
    length: 9,
    width: 6,
    minSpeedMps: 22,
    launchVy: 11.5,
    rewardCop: 35_000,
  },
  {
    id: 'stunt_ermita_bridge',
    name: 'Vuelo de La Ermita',
    x: 54,
    z: -24,
    heading: -Math.PI / 2,
    length: 9,
    width: 6,
    minSpeedMps: 24,
    launchVy: 12.0,
    rewardCop: 45_000,
  },
  {
    id: 'stunt_cristo_vista',
    name: 'Salto Mirador Cristo Rey',
    x: -120,
    z: -24,
    heading: Math.PI / 2,
    length: 10,
    width: 6.5,
    minSpeedMps: 25,
    launchVy: 13.0,
    rewardCop: 55_000,
  },
];

export const PAY_N_SPRAY_ZONES: readonly PayNSprayZone[] = [
  {
    id: 'pay_n_spray_san_antonio',
    name: 'Taller San Antonio',
    x: -78,
    z: 18,
    radius: 7.5,
    heading: 0,
  },
  {
    id: 'pay_n_spray_granada',
    name: 'Taller Barrio Granada',
    x: 96,
    z: -12,
    radius: 7.5,
    heading: Math.PI / 2,
  },
];

export const ROADBLOCK_ZONES: readonly RoadblockZone[] = [
  {
    id: 'roadblock_puente_ermita',
    name: 'Retén Puente La Ermita',
    x: 38,
    z: -24,
    heading: Math.PI / 2,
    halfWidth: 7.5,
  },
  {
    id: 'roadblock_calle_quinta',
    name: 'Retén Calle Quinta',
    x: 38,
    z: 77,
    heading: Math.PI / 2,
    halfWidth: 7.5,
  },
];

export const POLICE_SPAWNS: readonly SpawnPose[] = [
  { x: -4, z: -60, heading: 0 },
  { x: 58, z: 20, heading: Math.PI },
  { x: 96, z: 77, heading: -Math.PI / 2 },
  { x: -68, z: -24, heading: Math.PI / 2 },
];

export const TRAFFIC_ROUTES: readonly TrafficRoute[] = [
  {
    id: 'route_mio_bulevar',
    vehicleKind: 'mio_bus',
    speedMps: 11.5,
    colorHex: 0x1677ff,
    accentHex: 0xf8f7ff,
    waypoints: [
      { x: -68, z: -112 },
      { x: -4, z: -112 },
      { x: -4, z: 77 },
      { x: -68, z: 77 },
    ],
  },
  {
    id: 'route_taxi_puentes',
    vehicleKind: 'taxi',
    speedMps: 13.5,
    colorHex: 0xffc400,
    accentHex: 0x1a1a2e,
    waypoints: [
      { x: -4, z: -24 },
      { x: 58, z: -24 },
      { x: 58, z: 77 },
      { x: -4, z: 77 },
    ],
  },
  {
    id: 'route_chiva_estadio',
    vehicleKind: 'chiva',
    speedMps: 10.0,
    colorHex: 0xff2e93,
    accentHex: 0xffb800,
    waypoints: [
      { x: 96, z: -68 },
      { x: 174, z: -68 },
      { x: 174, z: 166 },
      { x: 96, z: 166 },
    ],
  },
  {
    id: 'route_r4_centro',
    vehicleKind: 'renault4_turbo',
    speedMps: 15.5,
    colorHex: 0xe63946,
    accentHex: 0xf8fafc,
    waypoints: [
      { x: -68, z: -24 },
      { x: -4, z: -24 },
      { x: -4, z: 36 },
      { x: -68, z: 36 },
    ],
  },
  {
    id: 'route_spark_granada',
    vehicleKind: 'spark_gt_turbo',
    speedMps: 16.0,
    colorHex: 0x00f0ff,
    accentHex: 0x111827,
    waypoints: [
      { x: 96, z: -68 },
      { x: 174, z: -68 },
      { x: 174, z: 20 },
      { x: 96, z: 20 },
    ],
  },
  {
    id: 'route_willys_sur',
    vehicleKind: 'willys_v8',
    speedMps: 14.5,
    colorHex: 0xf59e0b,
    accentHex: 0x1e293b,
    waypoints: [
      { x: -68, z: 77 },
      { x: -4, z: 77 },
      { x: -4, z: 166 },
      { x: -68, z: 166 },
    ],
  },
  // Classic Cali "pique" fleet sharing the arterial loops (rotated so spawns never stack)
  {
    id: 'route_r18_puentes',
    vehicleKind: 'renault_18_gtx',
    speedMps: 14.5,
    colorHex: 0xf8fafc,
    accentHex: 0x111827,
    waypoints: [
      { x: 58, z: -24 },
      { x: 58, z: 77 },
      { x: -4, z: 77 },
      { x: -4, z: -24 },
    ],
  },
  {
    id: 'route_sprint_estadio',
    vehicleKind: 'chevrolet_sprint_turbo',
    speedMps: 15.0,
    colorHex: 0xdc2626,
    accentHex: 0xf8fafc,
    waypoints: [
      { x: 174, z: -68 },
      { x: 174, z: 166 },
      { x: 96, z: 166 },
      { x: 96, z: -68 },
    ],
  },
  {
    id: 'route_monza_americas',
    vehicleKind: 'chevrolet_monza',
    speedMps: 14.0,
    colorHex: 0x1e3a8a,
    accentHex: 0xcbd5e1,
    waypoints: [
      { x: -4, z: -112 },
      { x: -4, z: 77 },
      { x: -68, z: 77 },
      { x: -68, z: -112 },
    ],
  },
  // "Motorizados": RX115 / DT125 motos filtering along a 3 m inner moto lane
  {
    id: 'route_moto_rx_centro',
    vehicleKind: 'yamaha_rx115',
    speedMps: 17.0,
    colorHex: 0x1d4ed8,
    accentHex: 0xf8fafc,
    waypoints: [
      { x: -65, z: -21 },
      { x: -7, z: -21 },
      { x: -7, z: 33 },
      { x: -65, z: 33 },
    ],
  },
  {
    id: 'route_moto_dt_granada',
    vehicleKind: 'yamaha_dt125',
    speedMps: 16.0,
    colorHex: 0xf8fafc,
    accentHex: 0xdc2626,
    waypoints: [
      { x: 99, z: -65 },
      { x: 171, z: -65 },
      { x: 171, z: 17 },
      { x: 99, z: 17 },
    ],
  },
  {
    id: 'route_moto_rx_sur',
    vehicleKind: 'yamaha_rx115',
    speedMps: 15.5,
    colorHex: 0x111827,
    accentHex: 0xffb800,
    waypoints: [
      { x: -65, z: 80 },
      { x: -7, z: 80 },
      { x: -7, z: 163 },
      { x: -65, z: 163 },
    ],
  },
];

/**
 * Driverless classics and motos parked street-side (5.5 m off the centerline) across Cali,
 * ready to hijack with [E]/[F].
 */
export const PARKED_VEHICLES: readonly ParkedVehicleDef[] = [
  { id: 'parked_mazda_323_circunvalar', vehicleKind: 'mazda_323_coupe', x: -62.5, z: 0, heading: 0, colorHex: 0xe11d48, accentHex: 0x111827 },
  { id: 'parked_rx115_circunvalar', vehicleKind: 'yamaha_rx115', x: -62.5, z: 8, heading: 0, colorHex: 0x1d4ed8, accentHex: 0xf8fafc },
  { id: 'parked_sentra_colombia', vehicleKind: 'nissan_sentra_b13', x: 1.5, z: 120, heading: Math.PI, colorHex: 0x9ca3af, accentHex: 0x111827 },
  { id: 'parked_chevette_carrera1', vehicleKind: 'chevette_turbo', x: 63.5, z: 122, heading: 0, colorHex: 0xf59e0b, accentHex: 0x111827 },
  { id: 'parked_twingo_ermita', vehicleKind: 'renault_twingo', x: 120, z: 25.5, heading: Math.PI / 2, colorHex: 0x10b981, accentHex: 0xf8fafc },
  { id: 'parked_dt125_ermita', vehicleKind: 'yamaha_dt125', x: 128, z: 25.5, heading: Math.PI / 2, colorHex: 0xf8fafc, accentHex: 0x1d4ed8 },
  { id: 'parked_monza_quinta', vehicleKind: 'chevrolet_monza', x: -30, z: 82.5, heading: Math.PI / 2, colorHex: 0x7f1d1d, accentHex: 0xe5e7eb },
  { id: 'parked_rx115_quinta', vehicleKind: 'yamaha_rx115', x: -22, z: 82.5, heading: Math.PI / 2, colorHex: 0xdc2626, accentHex: 0x111827 },
  { id: 'parked_r18_roosevelt', vehicleKind: 'renault_18_gtx', x: 150, z: 160.5, heading: -Math.PI / 2, colorHex: 0x0f766e, accentHex: 0xf8fafc },
];

function createBuilding(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height: number,
  colorHex: number,
  accentHex: number,
): AabbCollider {
  return {
    id,
    minX,
    maxX,
    minZ,
    maxZ,
    height,
    kind: 'building',
    colorHex,
    accentHex,
  };
}

/**
 * 33 vibrant Vice-Sunset Cali buildings positioned strictly inside city blocks,
 * clear of all roads, Río Cali, bridges, landmarks, spawns, waypoints, and traffic loops.
 */
export const BUILDING_COLLIDERS: readonly AabbCollider[] = [
  // Block 1: Downtown North-West (x: -55..-17, z: -99..-38)
  createBuilding('bldg_centro_1', -52, -38, -95, -73, 24, 0xe86f51, 0x00f0ff),
  createBuilding('bldg_centro_2', -33, -19, -95, -71, 30, 0x30205a, 0xff2e93),
  createBuilding('bldg_centro_3', -52, -37, -65, -42, 18, 0xf4a261, 0xffb800),
  createBuilding('bldg_centro_4', -32, -18, -64, -41, 22, 0x45267a, 0x00f0ff),

  // Block 2: Downtown South / Bulevar Adjacent (x: -55..-17, z: -10..24)
  createBuilding('bldg_bulevar_1', -52, -37, -8, 6, 16, 0xff758f, 0xffb800),
  createBuilding('bldg_bulevar_2', -32, -18, -8, 7, 26, 0x2a1e4d, 0x00f0ff),
  createBuilding('bldg_bulevar_3', -52, -38, 11, 23, 14, 0xf2c14e, 0xff2e93),
  createBuilding('bldg_bulevar_4', -32, -18, 12, 23, 20, 0x3b2c68, 0xff5e7e),

  // Block 3: San Antonio Colonial Fringe (x: -55..-17, z: 48..64)
  createBuilding('bldg_san_antonio_1', -52, -38, 49, 63, 9, 0xf7e7ce, 0xd95b43),
  createBuilding('bldg_san_antonio_2', -32, -18, 49, 63, 11, 0xffe5a8, 0xc84b31),

  // Block 4: San Antonio Hillside Colonials (clear of plaza & player spawns)
  createBuilding('bldg_san_antonio_3', -106, -92, 50, 63, 8, 0xfaebd7, 0xe05a47),
  createBuilding('bldg_san_antonio_4', -88, -80, 50, 62, 9, 0xffd6a5, 0xd95b43),
  createBuilding('bldg_san_antonio_5', -106, -92, 4, 16, 9, 0xf4e3cf, 0xc84b31),

  // Block 5: El Peñón / South-West Cali (x: -55..-17, z: 90..153)
  createBuilding('bldg_penon_1', -52, -37, 94, 114, 17, 0xd96b52, 0xffb800),
  createBuilding('bldg_penon_2', -32, -18, 94, 116, 21, 0x36245e, 0x00f0ff),
  createBuilding('bldg_penon_3', -52, -37, 124, 146, 15, 0xf29f67, 0xff2e93),
  createBuilding('bldg_penon_4', -32, -18, 125, 148, 19, 0x2d2052, 0x00e699),

  // Block 6: Avenida Las Américas & West Circunvalar (flanking Torre de Cali)
  createBuilding('bldg_americas_1', -60, -44, -156, -132, 25, 0x35255e, 0x00f0ff),
  createBuilding('bldg_americas_2', -38, -24, -152, -130, 20, 0x522b7a, 0xff2e93),
  createBuilding('bldg_oeste_1', -104, -84, -96, -74, 14, 0xe98a6b, 0xffb800),
  createBuilding('bldg_oeste_2', -104, -84, -64, -44, 12, 0xf4c095, 0xd95b43),

  // Block 7: Barrio Granada North-East (x: 108..162, z: -56..8)
  createBuilding('bldg_granada_1', 112, 130, -52, -32, 18, 0x422873, 0xff2e93),
  createBuilding('bldg_granada_2', 140, 158, -52, -30, 23, 0x2b1d4d, 0x00f0ff),
  createBuilding('bldg_granada_3', 112, 130, -18, 4, 16, 0xeb6b76, 0xffb800),
  createBuilding('bldg_granada_4', 140, 158, -16, 4, 20, 0x3c2569, 0x00e699),

  // Block 8: East Mid-Town / Salsa District (z: 32..64 & north Versalles)
  createBuilding('bldg_oriente_1', 70, 84, 34, 60, 15, 0xf28482, 0xffb800),
  createBuilding('bldg_oriente_2', 112, 130, 34, 58, 19, 0x31225c, 0x00f0ff),
  createBuilding('bldg_oriente_3', 140, 158, 34, 60, 24, 0x4d2378, 0xff2e93),
  createBuilding('bldg_oriente_4', 70, 84, -110, -82, 17, 0xe58f65, 0x00f0ff),

  // Block 9: San Fernando Riverside (West of Estadio Pascual Guerrero)
  createBuilding('bldg_san_fernando_1', 70, 84, 94, 118, 14, 0xf6bd60, 0xff2e93),
  createBuilding('bldg_san_fernando_2', 70, 84, 128, 150, 16, 0x3c2a6b, 0x00f0ff),

  // Block 10: Far North-East Versalles / Granada
  createBuilding('bldg_granada_5', 112, 132, -108, -84, 22, 0x2e1f54, 0xff5e7e),
  createBuilding('bldg_granada_6', 140, 160, -106, -84, 18, 0xe76f51, 0xffb800),
];

export const CALI_MAP: CaliMapConfig = {
  worldHalfSize: WORLD_HALF_SIZE,
  river: RIVER_CORRIDOR,
  landmarks: LANDMARKS,
  roads: ROAD_SEGMENTS,
  buildingColliders: BUILDING_COLLIDERS,
  propColliders: DEVHACK_BILLBOARD_COLLIDERS,
  playerStart: PLAYER_START,
  playerCarSpawn: PLAYER_CAR_SPAWN,
  missionStarts: MISSION_STARTS,
  missionWaypoints: MISSION_WAYPOINTS,
  policeSpawns: POLICE_SPAWNS,
  trafficRoutes: TRAFFIC_ROUTES,
  parkedVehicles: PARKED_VEHICLES,
  stuntJumps: STUNT_JUMPS,
  payNSprayZones: PAY_N_SPRAY_ZONES,
  roadblockZones: ROADBLOCK_ZONES,
};
