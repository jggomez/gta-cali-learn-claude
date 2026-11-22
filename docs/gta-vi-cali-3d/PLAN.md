# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard) | **Data Contract**: `data-source: none` (100% local static assets in `public/` + offline sim + `localStorage`)
- **Status**: `C-01 [x]` | `C-02 [x]` | `C-03 [~] State 2 Build`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01 | 3D GTA VI Cali web game (6 landmarks, 2 missions, audio, HUD) | Tier 2 | SKIP | INVOKE | INVOKE | INVOKE (PASS) | SKIP |
| C-02 | Procedural PBR, shadows, bloom, GLSL water & particles | Tier 2 | SKIP | SKIP | SKIP | INVOKE (PASS) | SKIP |
| C-03 | Photorealistic GTA upgrade (.glb car/character/trees, HDRI, photo PBR, mouse cam) | Tier 2 | SKIP (chosen) | SKIP (no HUD) | SKIP (ADR-001) | INVOKE (WebGL2) | SKIP (Tier 2) |

## C-03 Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | User picked exact photorealistic `.glb`/HDRI/mouse-camera package. |
| `ui-ux-designer` | `SKIP` | Zero HUD layout changes; upgrades 3D world lighting, models & camera only. |
| `architect-engineer` | `SKIP` | Uses built-in Three.js `GLTFLoader`/`DRACOLoader`/`RGBELoader` inside ADR-001. |
| `critic` & `challenger` | `SKIP` | Tier 2 local static CC0/MIT assets & camera/rendering only. |
| `e2e-blackbox-tester` | `INVOKE` | Must verify HTTP 200 on local `public/` assets, 0 WebGL errors & fresh PNGs. |

## C-03 Execution Tracks (Mode A — Disjoint Files)
1. **Step 1 (Asset Pack + Loader)**: `public/{draco,models,hdri,textures}/**`, `public/ASSETS_LICENSE.md`, `src/world/assetLoader.ts`, `tests/unit/world/assetLoader.test.ts`.
2. **Step 2 Parallel (2 disjoint workers)**:
   - **Track B1 (`src/types/game.ts`, `src/game/inputManager.ts`, `src/game/gameApp.ts`, `tests/integration/gameLoop.test.ts`)**: GTA mouse-look free orbit + scroll zoom input wiring.
   - **Track B2 (`src/world/sceneSetup.ts`, `src/world/caliLandmarks.ts`, `src/world/vehicleMeshes.ts`, `src/world/worldRenderer.ts`, `tests/unit/world/caliLandmarks.test.ts`)**: Real HDRI golden-hour lighting, photographic PBR materials, `ferrari.glb` player supercar, rigged `character.glb` (`AnimationMixer`), real 3D palms & Cali jacarandas, GTA V free-orbit chase camera & GPU disposal.

## Wiring Map (`C-03` Asset & Camera Delta)
- 3D Canvas -> `AssetLoader` (local `/models/*`, `/hdri/*`, `/textures/*`, `/draco/*`) -> `WorldRenderer` (HDRI + PBR + GLTF + Mouse Orbit Camera).
