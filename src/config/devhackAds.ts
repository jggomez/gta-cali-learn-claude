/**
 * AcaDevHack de IA roadside billboard placements across Cali.
 * Pure, Three-free data: positions, facing yaw and message id per billboard, plus the derived
 * post footprints used as solid AABB prop colliders by the headless physics.
 * Player-facing copy for each message id lives in `LOCALE_CALI.devhackAds`.
 */

import type { AabbCollider } from '../types/game';

export type DevhackAdMessageId =
  | 'school'
  | 'claude_code_course'
  | 'claude_for_all'
  | 'subscription'
  | 'future'
  | 'reto';

export const DEVHACK_AD_MESSAGE_IDS: readonly DevhackAdMessageId[] = [
  'school',
  'claude_code_course',
  'claude_for_all',
  'subscription',
  'future',
  'reto',
];

export interface DevhackBillboardPlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /**
   * Rotation around +Y (Three.js convention): the panel front faces (sin(yaw), cos(yaw)) in XZ.
   * Each panel faces its road, tilted ~0.5 rad toward the main approaching traffic.
   */
  readonly yaw: number;
  readonly messageId: DevhackAdMessageId;
}

/** Billboard panel dimensions (meters). */
export const DEVHACK_BILLBOARD_PANEL_WIDTH = 6;
export const DEVHACK_BILLBOARD_PANEL_HEIGHT = 3;
/** Height of the panel bottom edge above the local ground. */
export const DEVHACK_BILLBOARD_PANEL_BOTTOM = 3.2;
/** Local X offset of each support post from the billboard center. */
export const DEVHACK_BILLBOARD_POST_OFFSET = 2.3;
/** Half edge of the square AABB collider wrapped around each post. */
export const DEVHACK_BILLBOARD_POST_HALF = 0.3;

const TILT = 0.5;

/**
 * Seven billboards just off the road shoulders on the mission routes:
 * Avenida Las Américas (mission 1 start / Torre de Cali), Bulevar del Río north promenade
 * (missions 1 & 3), the Cristo Rey climb (mission 2), Carrera 1 by La Ermita (mission 3),
 * Calle 5 by Estadio Pascual Guerrero (mission 2 start) and Calle 5 by Puente Bulevar Sur.
 */
export const DEVHACK_BILLBOARDS: readonly DevhackBillboardPlacement[] = [
  { id: 'devhack_americas_torre', x: -42, z: -125, yaw: TILT, messageId: 'school' },
  {
    id: 'devhack_bulevar_norte',
    x: 7.5,
    z: -70,
    yaw: -Math.PI / 2 - TILT,
    messageId: 'claude_code_course',
  },
  {
    id: 'devhack_cristo_rey_base',
    x: -100,
    z: -10,
    yaw: Math.PI - TILT,
    messageId: 'claude_for_all',
  },
  { id: 'devhack_cristo_rey_subida', x: -140, z: -38, yaw: TILT, messageId: 'reto' },
  {
    id: 'devhack_ermita_carrera1',
    x: 69.5,
    z: -56,
    yaw: -Math.PI / 2 + TILT,
    messageId: 'subscription',
  },
  { id: 'devhack_estadio_calle5', x: 112, z: 64.5, yaw: TILT, messageId: 'future' },
  {
    id: 'devhack_puente_sur_calle5',
    x: 14,
    z: 90.5,
    yaw: Math.PI - TILT,
    messageId: 'reto',
  },
];

export interface PlanarPoint {
  readonly x: number;
  readonly z: number;
}

/** Converts a billboard-local X offset into world XZ (matches THREE rotation.y = yaw). */
export function billboardLocalToWorld(
  placement: DevhackBillboardPlacement,
  localX: number,
  localZ = 0,
): PlanarPoint {
  const cos = Math.cos(placement.yaw);
  const sin = Math.sin(placement.yaw);
  return {
    x: placement.x + localX * cos + localZ * sin,
    z: placement.z - localX * sin + localZ * cos,
  };
}

/** World XZ centers of the two support posts. */
export function getBillboardPostPositions(
  placement: DevhackBillboardPlacement,
): readonly [PlanarPoint, PlanarPoint] {
  return [
    billboardLocalToWorld(placement, -DEVHACK_BILLBOARD_POST_OFFSET),
    billboardLocalToWorld(placement, DEVHACK_BILLBOARD_POST_OFFSET),
  ];
}

/** World XZ ends of the panel (its full horizontal footprint segment). */
export function getBillboardPanelEnds(
  placement: DevhackBillboardPlacement,
): readonly [PlanarPoint, PlanarPoint] {
  const half = DEVHACK_BILLBOARD_PANEL_WIDTH / 2;
  return [billboardLocalToWorld(placement, -half), billboardLocalToWorld(placement, half)];
}

/** Solid AABB prop colliders for every billboard post. */
export function buildDevhackBillboardColliders(
  placements: readonly DevhackBillboardPlacement[] = DEVHACK_BILLBOARDS,
): readonly AabbCollider[] {
  const colliders: AabbCollider[] = [];
  for (const placement of placements) {
    getBillboardPostPositions(placement).forEach((post, index) => {
      colliders.push({
        id: `${placement.id}_post_${index}`,
        minX: post.x - DEVHACK_BILLBOARD_POST_HALF,
        maxX: post.x + DEVHACK_BILLBOARD_POST_HALF,
        minZ: post.z - DEVHACK_BILLBOARD_POST_HALF,
        maxZ: post.z + DEVHACK_BILLBOARD_POST_HALF,
        height: DEVHACK_BILLBOARD_PANEL_BOTTOM + DEVHACK_BILLBOARD_PANEL_HEIGHT,
        kind: 'prop',
        colorHex: 0x1a1430,
      });
    });
  }
  return colliders;
}

export const DEVHACK_BILLBOARD_COLLIDERS: readonly AabbCollider[] =
  buildDevhackBillboardColliders();
