# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard) | **Data Contract**: `data-source: none` (offline simulation + `localStorage`)
- **Status**: `C-01 [x] DONE` | `C-02 [~] State 2 Build`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01 | 3D GTA VI Cali web game (6 landmarks, 2 missions, audio, HUD) | Tier 2 | SKIP (approved) | INVOKE (DESIGN.md) | INVOKE (ADR-001) | INVOKE (PASS) | SKIP (Tier 2) |
| C-02 | Cinematic visual realism upgrade (PBR, shadows, bloom, VFX, cars) | Tier 2 | SKIP (clear choice) | SKIP (no HUD change) | SKIP (ADR-001 world) | INVOKE (WebGL visual) | SKIP (Tier 2) |

## C-02 Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | User picked exact cinematic visual upgrade scope via modal. |
| `ui-ux-designer` | `SKIP` | Zero HUD/DOM screen changes; reuses root `DESIGN.md` tokens. |
| `architect-engineer` | `SKIP` | Extends `src/world/` inside ADR-001; uses built-in Three.js postprocessing. |
| `critic` & `challenger` | `SKIP` | Tier 2 visual rendering only; no auth, payments, or concurrency surfaces. |
| `e2e-blackbox-tester` | `INVOKE` | Live WebGL visual change; must verify Chromium render, 0 errors & fresh PNGs. |

## C-02 Parallel Execution Tracks (Mode A — Disjoint Files)
1. **Wave 1 Parallel (2 disjoint workers)**:
   - **Track A1 (`src/world/pbrTextures.ts`, `src/world/particles.ts`, `tests/unit/world/visualEffects.test.ts`)**: Procedural PBR textures (asphalt, sidewalks, facades, neon signs), PMREM sunset env map, GLSL animated Río Cali water shader, pooled drift smoke / sparks / nitro trail particles.
   - **Track A2 (`src/world/vehicleMeshes.ts`, `src/world/sceneSetup.ts`)**: Sculpted clearcoat PBR vehicles (4 rotating/steering alloy wheels, headlight cones, brake lights), richer Valeria mesh, FBM sunset clouds sky shader, `2048px` player-tracking shadow sun, `EffectComposer` + `UnrealBloomPass`, dynamic FOV/shake GTA camera.
2. **Wave 2 Integration (`src/world/caliLandmarks.ts`, `src/world/worldRenderer.ts`, `tests/unit/world/caliLandmarks.test.ts`)**: Wire PBR roads/crosswalks/sidewalks/buildings/neon signs, GLSL river, streetlamp pools, headlight `SpotLight`, brake light detection, `ParticleSystem`, PMREM env, and Bloom pipeline.

## Wiring Map (`C-02` Visual Delta)
- 3D Canvas -> `WorldRenderer.sync()` -> `EffectComposer (RenderPass + UnrealBloomPass + OutputPass)` + `ParticleSystem` + `PMREM` env + GLSL Sky/Water shaders (`data-source: none`).
