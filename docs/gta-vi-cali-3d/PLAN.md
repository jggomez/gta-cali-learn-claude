# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard) | **Data Contract**: `data-source: none` (100% local `public/` assets + offline sim + `localStorage`)
- **Status**: `C-01..C-03 [x]` | `C-04 [~] State 2 Build`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01..C-03 | 3D Cali game + PBR/Bloom + Ferrari/Character/HDRI/Mouse Cam | Tier 2 | SKIP | DONE | DONE | PASS | SKIP |
| C-04 | Clear missions (road GPS, compass, steps, 3D props, road fix) + hijack any car, pedestrians & dynamic police | Tier 2 | SKIP (chosen) | SKIP (DESIGN.md) | SKIP (ADR-001) | INVOKE (HUD+3D) | SKIP (Tier 2) |

## C-04 Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | User selected exact C-04 mission clarity + living GTA package. |
| `ui-ux-designer` | `SKIP` | Reuses root `DESIGN.md` tokens for compass pill, step badge & banners. |
| `architect-engineer` | `SKIP` | Pure `roadGraph.ts` + ADR-001 decoupled sim/missions/world/UI layers. |
| `critic` & `challenger` | `SKIP` | Tier 2 offline game; no auth, payments, or untrusted input surfaces. |
| `e2e-blackbox-tester` | `INVOKE` | HUD compass/steps/banners + 3D props/pedestrians/hijack require WebGL2 E2E. |

## C-04 Execution Tracks (Mode A — Disjoint Files)
1. **Step 1 Contract-First (commit first)**: `src/types/game.ts`, `src/config/caliMap.ts`, `src/config/roadGraph.ts` (new Dijkstra GPS router), `src/config/localeCali.ts`, `tests/unit/config/roadGraph.test.ts`.
2. **Step 2 Parallel (3 disjoint workers)**:
   - **Track C1 (`src/simulation/**`, `tests/unit/simulation/**`)**: Hijack any Cali vehicle with per-kind physics, sidewalk pedestrians + flee reaction, dynamic Free Roam police heat/evasion.
   - **Track C2 (`src/missions/**`, `src/ui/**`, `src/styles/theme.css`, `tests/unit/missions/**`, `tests/unit/ui/**`)**: Road-GPS objectives, M2 ramp step, banners, zoomed radar minimap, top-center compass + meters + step `X/Y` HUD.
   - **Track C3 (`src/world/**`, `tests/unit/world/caliLandmarks.test.ts`)**: Daylight-visible 3D GTA checkpoints + giant chevron, 3D props (Vinilo, Mateo+speakers, Summit stage), 3D GPS road arrows, animated pedestrians, San Antonio road-slope fix.

## Wiring Map (`C-04` Delta)
- Compass / Distance / Step `X/Y` / Banners -> `MissionDirector` + `computeGpsRoute()` -> `HudController`
- Zoomed GPS Radar -> `MinimapRenderer` <- `MissionSnapshot.activeObjective.gpsRoute` + `WorldSnapshot`
- 3D Props / Pedestrians / Any-Car Camera -> `WorldRenderer.sync()` <- `WorldSnapshot` + `MissionSnapshot`
