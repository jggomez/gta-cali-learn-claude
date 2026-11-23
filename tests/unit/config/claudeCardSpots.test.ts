import { describe, expect, it } from 'vitest';
import {
  BUILDING_COLLIDERS,
  CALI_MAP,
  LANDMARKS,
  MISSION_STARTS,
  STUNT_JUMPS,
  WORLD_HALF_SIZE,
  isPointInRiver,
} from '../../../src/config/caliMap';
import {
  CLAUDE_CARD_PICKUP_RADIUS,
  CLAUDE_CARD_SPOTS,
  type ClaudeCardId,
} from '../../../src/config/claudeCardSpots';
import { MISSION5_BANK_COLLIDERS, MISSION5_LAYOUT } from '../../../src/config/mission5Layout';
import { resolveCircleWorldCollision } from '../../../src/simulation/physics';

const EXPECTED_IDS: readonly ClaudeCardId[] = [
  'card_agentic_loop',
  'card_claude_md',
  'card_plan_mode',
  'card_context',
  'card_hooks',
  'card_mcp',
  'card_subagents',
  'card_skills',
  'card_prompt_4',
  'card_artifacts',
];

/** Card body half-width plus a walking margin around every solid collider. */
const COLLIDER_CLEARANCE_METERS = 1.2;
const SPAWN_CLEARANCE_METERS = 12;
const MIN_CARD_SPACING_METERS = 25;

describe('Claude card spots', () => {
  it('lists exactly the ten lesson cards with unique ids', () => {
    expect(CLAUDE_CARD_SPOTS.map((spot) => spot.id)).toEqual(EXPECTED_IDS);
    expect(new Set(CLAUDE_CARD_SPOTS.map((spot) => spot.id)).size).toBe(10);
    expect(CLAUDE_CARD_PICKUP_RADIUS).toBe(3.2);
  });

  it('stays inside the playable world and out of Río Cali', () => {
    for (const spot of CLAUDE_CARD_SPOTS) {
      expect(Math.abs(spot.x), spot.id).toBeLessThan(WORLD_HALF_SIZE - 10);
      expect(Math.abs(spot.z), spot.id).toBeLessThan(WORLD_HALF_SIZE - 10);
      expect(isPointInRiver(spot.x, spot.z), spot.id).toBe(false);
    }
  });

  it('never sits inside building, prop or bank colliders', () => {
    const colliders = [
      ...BUILDING_COLLIDERS,
      ...(CALI_MAP.propColliders ?? []),
      ...MISSION5_BANK_COLLIDERS,
    ];
    for (const spot of CLAUDE_CARD_SPOTS) {
      for (const box of colliders) {
        const inside =
          spot.x >= box.minX - COLLIDER_CLEARANCE_METERS &&
          spot.x <= box.maxX + COLLIDER_CLEARANCE_METERS &&
          spot.z >= box.minZ - COLLIDER_CLEARANCE_METERS &&
          spot.z <= box.maxZ + COLLIDER_CLEARANCE_METERS;
        expect(inside, `${spot.id} vs ${box.id}`).toBe(false);
      }
      expect(resolveCircleWorldCollision(spot.x, spot.z, 0.5).collided, spot.id).toBe(false);
    }
  });

  it('stays outside every landmark footprint', () => {
    for (const spot of CLAUDE_CARD_SPOTS) {
      for (const landmark of LANDMARKS) {
        const insideX = Math.abs(spot.x - landmark.position.x) <= landmark.footprintHalfX + 3;
        const insideZ = Math.abs(spot.z - landmark.position.z) <= landmark.footprintHalfZ + 3;
        expect(insideX && insideZ, `${spot.id} vs ${landmark.id}`).toBe(false);
      }
    }
  });

  it('keeps clear of spawns, mission 5 waypoints and stunt ramps', () => {
    const spawns = [
      CALI_MAP.playerStart,
      CALI_MAP.playerCarSpawn,
      ...Object.values(MISSION_STARTS).flatMap((start) => [start.playerSpawn, start.carSpawn]),
      MISSION5_LAYOUT.playerSpawn,
      MISSION5_LAYOUT.carSpawn,
      ...Object.values(MISSION5_LAYOUT.packages),
      MISSION5_LAYOUT.bank,
      ...STUNT_JUMPS,
    ];
    for (const spot of CLAUDE_CARD_SPOTS) {
      for (const spawn of spawns) {
        expect(Math.hypot(spot.x - spawn.x, spot.z - spawn.z), spot.id).toBeGreaterThan(
          SPAWN_CLEARANCE_METERS,
        );
      }
    }
  });

  it('spreads cards at least 25 m apart across the map', () => {
    for (let i = 0; i < CLAUDE_CARD_SPOTS.length; i += 1) {
      for (let j = i + 1; j < CLAUDE_CARD_SPOTS.length; j += 1) {
        const a = CLAUDE_CARD_SPOTS[i]!;
        const b = CLAUDE_CARD_SPOTS[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(
          MIN_CARD_SPACING_METERS,
        );
      }
    }
    const xs = CLAUDE_CARD_SPOTS.map((spot) => spot.x);
    const zs = CLAUDE_CARD_SPOTS.map((spot) => spot.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(250);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(200);
  });
});
