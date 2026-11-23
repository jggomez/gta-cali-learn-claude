/**
 * Mission 5 "El Golpe del Prompt" layout: Valeria collects the four prompt packages
 * (Rol, Contexto, Tarea, Formato) across Cali and delivers them to the bank AI in the Centro
 * while the police chase her (starts at 2 stars).
 * Pure, Three-free data shaped like `MissionStartConfig` / `MissionWaypoint` in caliMap.ts.
 * Intentionally does not import caliMap.ts so caliMap can import the bank collider without a cycle.
 */

import type { AabbCollider, MissionStartConfig, MissionWaypoint } from '../types/game';

export type Mission5PackageId = 'rol' | 'contexto' | 'tarea' | 'formato';

/** Package pickup order along the intended route. */
export const MISSION5_PACKAGE_ORDER: readonly Mission5PackageId[] = [
  'rol',
  'contexto',
  'tarea',
  'formato',
];

export interface Mission5BankFacade {
  /** Center of the facade box footprint (XZ). */
  readonly x: number;
  readonly z: number;
  /** Rotation around +Y; the entrance faces (sin(yaw), cos(yaw)). */
  readonly yaw: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export interface Mission5Layout extends MissionStartConfig {
  readonly packages: Readonly<Record<Mission5PackageId, MissionWaypoint>>;
  /** Delivery waypoint on the sidewalk in front of the bank entrance. */
  readonly bank: MissionWaypoint;
  readonly bankFacade: Mission5BankFacade;
}

/**
 * Ground-floor bank portico mounted on the south face (z = -41) of bldg_centro_4,
 * facing Calle 13 Centro (z = -24). Its back sinks 0.1 m into the tower.
 */
const BANK_FACADE: Mission5BankFacade = {
  x: -25,
  z: -39.85,
  yaw: 0,
  width: 12,
  depth: 2.5,
  height: 6.8,
};

/**
 * Route (shortest road path ~0.87 km):
 * Carrera 39 Oriente start -> Rol (Av 6N Granada) -> Contexto (Carrera 36, Estadio)
 * -> Tarea (Calle 5 Oeste, El Peñón, across Puente Bulevar Sur) -> Formato (Cristo Rey climb)
 * -> bank on Calle 13 Centro.
 */
export const MISSION5_LAYOUT: Mission5Layout = {
  playerSpawn: { x: 174, z: 4, heading: Math.PI },
  carSpawn: { x: 174, z: 4, heading: Math.PI },
  startInVehicle: true,
  initialWantedStars: 2,
  defaultTimeOfDay: 'night',
  packages: {
    rol: {
      id: 'm5_pkg_rol',
      landmarkId: 'la_ermita',
      x: 130,
      z: -68,
      radius: 12,
      district: 'Barrio Granada',
    },
    contexto: {
      id: 'm5_pkg_contexto',
      landmarkId: 'estadio_pascual',
      x: 96,
      z: 130,
      radius: 12,
      district: 'Estadio Pascual Guerrero',
    },
    tarea: {
      id: 'm5_pkg_tarea',
      landmarkId: 'san_antonio',
      x: -50,
      z: 77,
      radius: 12,
      district: 'El Peñón',
    },
    formato: {
      id: 'm5_pkg_formato',
      landmarkId: 'cristo_rey',
      x: -145,
      z: -24,
      radius: 12,
      district: 'Cerro Los Cristales',
    },
  },
  bank: {
    id: 'm5_bank_delivery',
    landmarkId: 'bulevar_del_rio',
    x: -25,
    z: -33,
    radius: 12,
    district: 'Centro de Cali',
  },
  bankFacade: BANK_FACADE,
};

/** Axis-aligned footprint of a facade (supports yaw multiples of PI/2). */
export function getBankFacadeFootprint(facade: Mission5BankFacade = BANK_FACADE): {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
} {
  const quarterTurns = Math.round(facade.yaw / (Math.PI / 2));
  const swapped = Math.abs(quarterTurns) % 2 === 1;
  const halfX = (swapped ? facade.depth : facade.width) / 2;
  const halfZ = (swapped ? facade.width : facade.depth) / 2;
  return {
    minX: facade.x - halfX,
    maxX: facade.x + halfX,
    minZ: facade.z - halfZ,
    maxZ: facade.z + halfZ,
  };
}

/**
 * Solid prop collider for the bank portico. Not yet registered in `CALI_MAP.propColliders`;
 * wire it there next to DEVHACK_BILLBOARD_COLLIDERS to make the portico solid.
 */
export const MISSION5_BANK_COLLIDERS: readonly AabbCollider[] = [
  {
    id: 'm5_bank_portico',
    ...getBankFacadeFootprint(BANK_FACADE),
    height: BANK_FACADE.height,
    kind: 'prop',
    colorHex: 0xe9e4da,
  },
];
