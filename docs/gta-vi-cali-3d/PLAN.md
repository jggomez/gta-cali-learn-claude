# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard) | **Data Contract**: `data-source: none` (local `public/` assets + offline sim + `localStorage`)
- **Status**: `C-01..C-04 [x]` | `C-05 [~] State 2 Build`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01..C-04 | 3D Cali game + PBR/Bloom + Ferrari/HDRI + GPS/Compass/Pedestrians/Hijack | Tier 2 | SKIP | DONE | DONE | PASS | SKIP |
| C-05 | Distinct missions: M1 on-foot Torre heist (day), M2 NIGHT timed race from Estadio to lit Cristo Rey, Free Roam Bulevar + `T` Day/Night | Tier 2 | SKIP (chosen) | SKIP (DESIGN.md) | SKIP (ADR-001) | INVOKE (Day+Night) | SKIP (Tier 2) |

## C-05 Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | User approved exact 3-mode structure (on-foot heist, night race, T toggle). |
| `ui-ux-designer` | `SKIP` | Reuses `DESIGN.md` tokens for countdown urgency, `time_up` modal & `[T]` pill. |
| `architect-engineer` | `SKIP` | Extends ADR-001 with `TimeOfDay`, `MISSION_STARTS`, and countdown state. |
| `critic` & `challenger` | `SKIP` | Tier 2 offline client simulation & rendering; no security/concurrency risk. |
| `e2e-blackbox-tester` | `INVOKE` | Must visually prove Golden-Hour M1 at Torre vs Real Night M2 at Estadio & `[T]` switch. |

## C-05 Execution Tracks (Mode A — Disjoint Files)
1. **Step 1 Contract-First (commit first)**: `src/types/game.ts`, `src/config/caliMap.ts`, `src/config/localeCali.ts`, `tests/unit/config/caliMap.test.ts`.
2. **Step 2 Parallel (3 disjoint workers)**:
   - **Track D1 (`src/missions/missionDirector.ts`, `src/ui/hudController.ts`, `src/styles/theme.css`, `tests/unit/missions/**`, `tests/unit/ui/**`)**: Redesigned M1 on-foot Torre heist, M2 95s night timed ring race (`+10s` bonus & `time_up` fail), Free Roam `toggleTimeOfDay()`, urgent timer & `[T]` HUD toggle.
   - **Track D2 (`src/world/sceneSetup.ts`, `src/world/caliLandmarks.ts`, `src/world/worldRenderer.ts`, `tests/unit/world/caliLandmarks.test.ts`)**: Live Golden-Hour ↔ Starlit Neon Night lighting engine (dark starry sky+moon, glowing windows/neons/floodlights, 65m night headlights, floodlit Cristo Rey, high-bloom night mode).
   - **Track D3 (`src/simulation/gameWorld.ts`, `src/game/inputManager.ts`, `src/game/gameApp.ts`, `tests/integration/gameLoop.test.ts`)**: Per-mission `carSpawn`/`playerSpawn`/`startInVehicle`, `refillNitro()`, `KeyT` day/night input, and full 3-mode integration tests.

## Wiring Map (`C-05` Delta)
- `[T]` Day/Night Pill & Key -> `GameApp` -> `MissionDirector.toggleTimeOfDay()` -> `WorldRenderer.setTimeOfDay()`
- Mission 1/2/FreeRoam Starts -> `CALI_MAP.missionStarts[id]` -> `GameWorld.reset()` -> 3 distinct Cali districts
