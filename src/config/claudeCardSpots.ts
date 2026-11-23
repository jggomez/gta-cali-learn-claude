/**
 * Claude card hidden collectibles ("aprender jugando"): ten GTA-style hidden packages, one per
 * Claude Code / Claude lesson, tucked into alleys, courtyards, river banks and hillsides of Cali.
 * Pure, Three-free data. Lesson copy is owned by the missions/UI layer, not by these spots.
 */

export type ClaudeCardId =
  | 'card_agentic_loop'
  | 'card_claude_md'
  | 'card_plan_mode'
  | 'card_context'
  | 'card_hooks'
  | 'card_mcp'
  | 'card_subagents'
  | 'card_skills'
  | 'card_prompt_4'
  | 'card_artifacts';

export interface ClaudeCardSpot {
  readonly id: ClaudeCardId;
  readonly x: number;
  readonly z: number;
}

/** Distance (meters, XZ) at which the player collects a card on foot or by car. */
export const CLAUDE_CARD_PICKUP_RADIUS = 3.2;

/**
 * Ordered card spots (index + 1 is the card number painted on the card).
 * Every spot sits on open walkable ground outside building/prop colliders, the river,
 * landmark footprints, spawns and stunt ramps.
 */
export const CLAUDE_CARD_SPOTS: readonly ClaudeCardSpot[] = [
  // Centro: service alley between the downtown towers (bldg_centro_1/3)
  { id: 'card_agentic_loop', x: -44.5, z: -69 },
  // Avenida Las Américas: gap between the two towers west of Torre de Cali
  { id: 'card_claude_md', x: -41, z: -142 },
  // Barrio San Antonio: behind the hillside colonials, south of bldg_san_antonio_3
  { id: 'card_plan_mode', x: -99, z: 68 },
  // Cerro Los Cristales: hillside below the Cristo Rey lookout, off the climb road
  { id: 'card_context', x: -172, z: -50 },
  // Bulevar del Río: east river bank between Río Cali and Carrera 1
  { id: 'card_hooks', x: 48.5, z: 46 },
  // Barrio Granada: inner courtyard between the four Granada blocks
  { id: 'card_mcp', x: 135, z: -25 },
  // Estadio Pascual Guerrero: east perimeter behind the stands
  { id: 'card_subagents', x: 162, z: 134 },
  // Iglesia La Ermita: behind the church, toward Avenida 6N
  { id: 'card_skills', x: 84, z: -46 },
  // San Fernando riverside: alley between bldg_san_fernando_1/2
  { id: 'card_prompt_4', x: 77, z: 123 },
  // El Peñón: crossing of the alleys between the four Peñón blocks
  { id: 'card_artifacts', x: -34.5, z: 119.5 },
];
