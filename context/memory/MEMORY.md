# Cross-AI Project Memory — GTA VI: Cali

## Active Context
- **Branch**: `feat/gta-vi-cali-3d`
- **Feature**: `gta-vi-cali-3d` — Playable 3D low-poly GTA VI-inspired web game set in Cali, Colombia (`La Sucursal del Cielo`).
- **Status**: Changes `C-01`..`C-04` SHIPPED & VERIFIED (`qa-tester: DONE`, `e2e-blackbox-tester: PASSED`, `compliance-verifier: APPROVED`).
- **Verification**: 11 Vitest suites (123/123 passed), `tsc --noEmit`, `eslint src tests`, `vite build`, and live Playwright Chromium WebGL2 E2E (2/2 journeys across `375/768/1280/1920`, 34 local assets HTTP 200, `gpsRoute=5 pts`, `18` pedestrians, `check_evidence.py` exit `0`).
- **Mission Clarity & Living GTA (`C-04`)**: Dijkstra bridge-safe road GPS (`src/config/roadGraph.ts`), top-center CSS polygon compass + live meters, `PASO X DE Y`, center action banners, 2.0× zoomed radar with `SA/TC/BR/LE/EP/CR` badges, daylight 3D checkpoints + giant floating arrow, 3D props (`vinyl_briefcase`, `mateo_speakers`, `summit_stage`), 3D street GPS chevrons, San Antonio road-slope fix, hijack any Cali vehicle with per-kind handling, 18 walking/fleeing pedestrians, and dynamic Free-Roam police heat/evasion.
- **Photorealistic Visual Engine (`C-02` + `C-03`)**: 25 MB local `public/` CC0/MIT pack (`ferrari.glb` Rosso Corsa supercar, rigged `character.glb` `Idle/Walk/Run`, `evening_road_01_puresky_1k.hdr` golden-hour HDRI skybox/IBL, local JS Draco decoder, 10 1K photo PBR sets for asphalt/sidewalks/terrain/plaster/roof/facade/palm/jacaranda), `2048px` shadows, subtle HDR `UnrealBloomPass`, GLSL Río Cali water, GPU `ParticleSystem`, and GTA V free-orbit mouse-look + wheel zoom camera with full GPU/listener disposal.

## Key Decisions
- **Decoupled 3D Engine (ADR-001)**: Headless Three.js/DOM-free `src/simulation/` & `src/missions/` emit immutable readonly snapshots to `src/world/` (Three.js), `src/audio/` (procedural Web Audio API), and `src/ui/` (DOM HUD + 2D GPS minimap).
- **100% Offline Procedural Assets**: Zero external `.glb`, `.mp3`, font CDNs, or backend HTTP APIs (`data-source: none`; `localStorage` key `gta_cali_records_v1` for best times & radio prefs).
- **Language Boundary**: Code, types, comments, docs, and commits strictly in English; authentic Español Caleño player copy isolated in `src/config/localeCali.ts`.

## Pointers
- [AGENTS.md](../../AGENTS.md) | [DESIGN.md](../../DESIGN.md)
- [PLAN.md](../../docs/gta-vi-cali-3d/PLAN.md) | [spec.md](../../docs/gta-vi-cali-3d/spec.md) | [adr-001](../../docs/gta-vi-cali-3d/adr-001-decoupled-3d-simulation.md) | [test-matrix.md](../../docs/gta-vi-cali-3d/test-matrix.md)
- [architecture.md](./architecture.md) | [conventions.md](./conventions.md) | [log/2026-11-21.md](./log/2026-11-21.md)
