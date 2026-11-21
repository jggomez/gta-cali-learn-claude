# PLAN — GTA VI: Cali 3D (`feat/gta-vi-cali-3d`)

- **Tier**: Tier 2 (Standard — Greenfield 3D web game, approved `/plan`, no auth/payments/DB migration)
- **Data Contract**: `data-source: none` (100% offline local-client-simulation + `localStorage` best times/prefs; zero backend HTTP API)
- **Status**: `[x] State 0` | `[x] State 1` | `[x] State 2` | `[x] State 3-4` | `[x] State 5`

## Changes
| ID | Request | Tier | product | design | arch | e2e | critic/challenger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| C-01 | 3D GTA VI Cali web game with 6 landmarks & 2 missions | Tier 2 | SKIP (approved plan) | INVOKE (new UI/DESIGN.md) | INVOKE (greenfield 3D ADR) | INVOKE (web UI game) | SKIP (Tier 2 low-risk) |

## Discovery & Architecture Triage (`Invoke / SKIP`)
| Specialist | Decision | Rationale |
| :--- | :--- | :--- |
| `product-analyst` | `SKIP` | Scope, 6 landmarks, Caleño tone, and 2 missions approved in `/plan`. |
| `ui-ux-designer` | `INVOKE` | Missing root `DESIGN.md`; new GTA VI Cali neon HUD, minimap & screens. |
| `architect-engineer` | `INVOKE` | Greenfield Three.js 3D + headless simulation boundaries & ADR-001. |
| `critic` & `challenger` | `SKIP` | Tier 2 client-side game; no auth, payments, concurrency, or untrusted input. |
| `e2e-blackbox-tester` | `INVOKE` | Live web UI; must verify real Vite server, WebGL canvas, HUD & screenshots. |

## Parallel Execution Tracks (Mode A — Disjoint Files)
1. **Contract-First (1 worker, commit first)**: `package.json`, configs, `.gitignore`, `src/types/**`, `src/config/**`.
2. **Wave 1 Parallel (3 disjoint workers)**:
   - **Track A (`src/world/**`, `tests/unit/world/**`)**: Three.js sunset scene, 6 Cali landmarks, vehicle/player/beacon meshes, chase camera.
   - **Track B (`src/simulation/**`, `tests/unit/simulation/**`)**: Headless arcade physics, AABB/river/bridge collisions, Cali traffic & Police AI, `GameWorld`.
   - **Track C (`src/missions/**`, `src/audio/**`, `src/ui/**`, `tests/unit/missions/**`, `tests/unit/audio/**`)**: 2 Cali missions + Free Roam, procedural Salsa/Synth Web Audio, 2D minimap & HUD.
3. **Wave 2 Integration (1 worker)**: `index.html`, `src/styles/**`, `src/game/**`, `src/main.ts`, `tests/integration/**`.

## Wiring Map (UI -> Real Source)
- Title/Pause/Victory -> `MissionDirector` + `localStorage` (`gta_cali_records_v1`)
- HUD/Speed/Wanted/Radio -> `GameWorld.getSnapshot()` + `AudioEngine.getState()`
- GPS Minimap -> `CALI_MAP` + `WorldSnapshot` + `MissionSnapshot.activeObjective`
- 3D Canvas -> `WorldRenderer.sync(WorldSnapshot, MissionSnapshot)`
