# Aprender jugando — Claude Code & Claude inside GTA I - Cali - Colombia

## Goal
Players learn real Claude Code / Claude concepts while playing, without it feeling like a class. Every
concept is a GTA mechanic with the real command name, and links to the free AcaDevHack lessons
(`claude-code-desde-cero`, `claude-para-todos`). Learning content never changes Reto ranking times.

## Mechanics → lessons
| In game | Mechanic | Real concept | Lesson |
|---|---|---|---|
| **Modo Plan** | Briefing modal before the first launch of each story mission; approve plan Turbo (full nitro) or Discreto (−1 star). The clock starts after approval. | Plan mode | CC L4 (`s4`) |
| **`/rewind` [Z]** | Rewinds the player, the vehicles, pedestrians and bust progress ~5 s; 1 charge per mission. The clock and the wanted level are kept. | `/rewind` | CC L5 (`s5`) |
| Pay 'n' Spray | Toast: "como /clear" | `/clear` | CC L5 |
| M2 nitro refill per checkpoint | Toast: "esto es un hook" | PostToolUse hook | CC L6 (`s6`) |
| **Hackeo de la tomba** | When police corner you with ≥2★, an 8 s terminal question appears (keys 1/2/3). A right answer gives −1★, a wrong one +1★; a 45 s cooldown. | 24 questions adapted from both course exams | various |
| **Cartas Claude** | 10 hidden collectibles, one per lesson; Álbum Claude in pause; all 10 unlock the **Claude Naranja** paint | loop, CLAUDE.md, Plan, context, hooks, MCP, subagents, skills, 4-part prompt, artifacts | per card |
| **Misión 5 "El Golpe del Prompt"** | Collect Rol, Contexto, Tarea and Formato across Cali (2★), then deliver them at the Banco Sucursal IA. Collecting them in course order pays a +$100.000 bonus. | 4-part prompt | CPT L2 (`s2`) |
| Radio IA + celular | Spoken es-CO ad every 80 s on the radio; a "Profe JG" phone tip after each mission passed | mixed | mixed |

## Reto AcaDevHack
The order is now M1 → M2 → M3 → **M5** → Free Roam tour (5 stages). The plausibility minimum for M5 is 22 s; the fastest autopilot run took 27.1 s.
`firestore.rules` was updated in `knownMission`, `minSeconds` and the winners' `times` keys. **The rules must be redeployed**:
`firebase deploy --only firestore:gta-cali --project devhack-3f0c2`.

## Architecture
- **Pure, Three/DOM-free:**
  - `src/missions/learningCatalog.ts`: lesson refs and links.
  - `src/missions/learningProgress.ts`: rewind charges, hack state machine, cards and one-shot tips, persisted in `gta_cali_learning_v1`.
  - `src/config/hackQuestions.ts`
  - `src/config/claudeCardSpots.ts`
  - `src/config/mission5Layout.ts`
- **Simulation:** `GameWorld.rewind()` keeps a 0.25 s-sampled ring buffer of 8 s. `MissionDirector.applyWantedDelta()` lowers the mission star floor, and the director also runs the Mission 5 state machine.
- **Runtime:** `src/game/learningSession.ts` is the glue; `src/ui/learningController.ts` is the DOM.
- **World:** `src/world/claudeCards.ts` builds the floating cards; `src/world/mission5Bank.ts` builds the bank facade and its collider.

## Verification
- Vitest: learningProgress, the catalog and questions, rewind, Mission 5 in the director, card spots, the M5 layout, the Reto with 5 stages, and the autopilot (M5 7/8 seeds).
- Rules emulator suite: 7/7.
- Playwright: `tests/e2e/aprender-jugando.spec.mjs`; evidence in `docs/aprender-jugando/evidence/`.
