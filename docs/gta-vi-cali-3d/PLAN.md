# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard) | **Data Contract**: `data-source: none` (local `public/` assets + offline sim/Web Speech + `localStorage`)
- **Status**: `C-01..C-07 [x] DONE` | `C-08 [~] State 2 Build`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01..C-07 | 3D Cali, PBR/HDRI/SMAA, 3D facade relief, Morena `valeria.glb`, 5-speed V8/Doppler siren & `es-CO` voices | Tier 2 | SKIP | DONE | DONE | PASS | SKIP |
| C-08 | Caleño characters (`caleno.glb` + jerseys), fast Colombian cars (R4 Turbo, Spark GT, Willys V8, Duster Policía, Taxi), Garaje `[G]`, Mission 3, Stunts/PayNSpray/Retenes | Tier 2 | SKIP (approved `/plan`) | SKIP (DESIGN.md) | SKIP (ADR-001) | INVOKE (UI+3D+Assets) | SKIP (Tier 2) |

## C-08 Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | Full scope, R4 Turbo default, Valeria/Mateo & Mission 3 approved in `implementation_plan_c08.md`. |
| `ui-ux-designer` | `SKIP` | Extends root `DESIGN.md` tokens for Garaje `[G]`, `POS 1/3`, and `DERRAPE xN` pills. |
| `architect-engineer` | `SKIP` | Strictly preserves ADR-001 pure headless sim/missions vs Three.js/audio/UI presentation. |
| `critic` & `challenger` | `SKIP` | Tier 2 offline client game; zero auth/payments/destructive DB risk. |
| `e2e-blackbox-tester` | `INVOKE` | Verify HTTP 200 on `caleno.glb` (36 assets), Garaje `[G]` switch + reload, Mission 3 & fresh PNGs. |

## C-08 Execution Tracks (Mode A — Disjoint Files)
1. **Step 1 Contract-First (commit first)**: `public/models/caleno.glb`, `public/ASSETS_LICENSE.md`, `src/types/game.ts`, `src/config/{caliMap,localeCali}.ts`, `src/world/assetLoader.ts`, `tests/unit/world/assetLoader.test.ts`, `tests/unit/config/caliMap.test.ts`.
2. **Step 2 Wave 1 Parallel (3 disjoint workers)**:
   - **Track F1 (Sim & Mission 3)**: `src/simulation/{physics,trafficAi,gameWorld}.ts`, `src/missions/missionDirector.ts`, `tests/unit/simulation/**`, `tests/unit/missions/**`.
   - **Track F2 (Colombian Fleet & Caleños)**: `src/world/{vehicleMeshes,particles}.ts`, `tests/unit/world/visualEffects.test.ts`.
   - **Track F3 (Living Cali City & Turbo/Horn Audio)**: `src/world/caliLandmarks.ts`, `src/audio/{audioEngine,voiceEngine}.ts`, `tests/unit/world/caliLandmarks.test.ts`, `tests/unit/audio/**`.
3. **Step 3 Wave 2 Parallel Integration (2 disjoint workers)**:
   - **Track F4A (`WorldRenderer`)**: `src/world/worldRenderer.ts`, `tests/unit/world/worldRenderer.test.ts`.
   - **Track F4B (Garaje `[G]` HUD & Runtime)**: `src/ui/hudController.ts`, `src/styles/theme.css`, `src/game/{inputManager,gameApp}.ts`, `tests/unit/ui/hudController.test.ts`, `tests/integration/gameLoop.test.ts`.

## Wiring Map (`C-08` Delta)
- `caleno.glb` + Cali Jerseys -> `AssetLoader` -> `vehicleMeshes.ts` -> `WorldRenderer` (Mateo/peds/police, zero Soldier visuals)
- `GarageConfig` -> `MissionDirector` (`localStorage`) <-> `GameApp` -> `GameWorld` + `WorldRenderer` + `HudController` (`[G]`)
- Stunts / Pay 'n' Spray / Retenes / Race AI / `[H]` Horn -> `GameWorld` -> `WorldRenderer` + `AudioEngine` + `VoiceEngine` (`data-source: none`)
