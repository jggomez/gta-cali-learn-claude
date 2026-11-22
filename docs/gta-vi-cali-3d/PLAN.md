# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard) | **Data Contract**: `data-source: none` (local `public/` assets + offline sim/Web Speech + `localStorage`)
- **Status**: `C-01..C-06 [x]` | `C-07 [~] State 2 Build`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01..C-06 | 3D Cali + PBR/Bloom + Ferrari/HDRI + GPS + Day/Night + Free Roam 1/6 + Rigged Peds | Tier 2 | SKIP | DONE | DONE | PASS | SKIP |
| C-07 | Morena Caleña Valeria (`valeria.glb`), 3D facade relief/SMAA/skidmarks, 5-speed V8/Doppler siren & spoken `es-CO` voices | Tier 2 | SKIP (approved `/plan`) | SKIP (DESIGN.md) | SKIP (ADR-001) | INVOKE (Render+Audio) | SKIP (Tier 2) |

## C-07 Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | Scope approved in `implementation_plan_c07.md`. |
| `ui-ux-designer` | `SKIP` | Reuses root `DESIGN.md` tokens; adds `[V] Voces` pill beside audio controls. |
| `architect-engineer` | `SKIP` | Extends ADR-001 cleanly (`valeria.glb`, `voiceEngine.ts`, `SMAAPass`, `SkidMarkPool`). |
| `critic` & `challenger` | `SKIP` | Tier 2 offline client rendering & Web Audio/Speech; no security/concurrency risk. |
| `e2e-blackbox-tester` | `INVOKE` | Must verify HTTP 200 on `valeria.glb`, 0 SMAA/shader errors, 3D relief & fresh PNGs. |

## C-07 Execution Tracks (Mode A — Disjoint Files)
1. **Step 1 Contract-First (committed `0bd92f0`)**: `public/models/valeria.glb`, `public/ASSETS_LICENSE.md`, `src/types/game.ts`, `src/config/localeCali.ts`, `src/world/assetLoader.ts`, `tests/unit/world/assetLoader.test.ts`.
2. **Step 2 Wave 1 Parallel (3 disjoint workers)**:
   - **Track E1 (`src/audio/voiceEngine.ts`, `src/audio/audioEngine.ts`, `tests/unit/audio/**`)**: Offline `es-CO` `VoiceEngine` + 5-speed V8/diesel synth, drift screech, crash foley, distance/Doppler Wail/Yelp police siren, radio squelch & city street murmur.
   - **Track E2A (`src/world/{particles,sceneSetup,vehicleMeshes}.ts`, `tests/unit/world/visualEffects.test.ts`)**: Morena Caleña `valeria.glb` + Mixamo clip retargeter (`Idle/Walk/Run/SambaDance`), diverse civilian peds, `SkidMarkPool`, `CinematicGradePass` & `SMAAPass`.
   - **Track E2B (`src/world/caliLandmarks.ts`, `tests/unit/world/caliLandmarks.test.ts`)**: 3D architectural facade relief (windows, balconies, eaves, awnings, pilasters), Cali street props (MIO stops, benches, bollards), wet specular puddles, upgraded La Ermita/Torre/Cristo Rey.
3. **Step 3 Wave 2 Parallel Integration (2 disjoint workers)**:
   - **Track E3A (`src/world/worldRenderer.ts`, `tests/unit/world/worldRenderer.test.ts`)**: Wire Morena Valeria, civilian peds, Cristo Rey Samba, `SkidMarkPool`, `setGradeTimeOfDay`.
   - **Track E3B (`src/missions/missionDirector.ts`, `src/ui/hudController.ts`, `src/styles/theme.css`, `src/game/{inputManager,gameApp}.ts`, `tests/unit/ui/hudController.test.ts`, `tests/integration/gameLoop.test.ts`)**: Wire `VoiceEngine`, collision/siren audio, `[V] Voces` HUD pill & persistence.

## Wiring Map (`C-07` Delta)
- `valeria.glb` + Mixamo Retarget -> `AssetLoader` -> `WorldRenderer` (Morena Valeria + civilian peds + Cristo Rey Samba)
- `VoiceEngine` (`es-CO`) + Upgraded `AudioEngine` -> `GameApp` + `[V]` HUD Pill (`data-source: none`)
