# Cross-AI Project Memory — GTA VI: Cali

## Active Context
- **Branch**: `feat/gta-vi-cali-3d`
- **Feature**: `gta-vi-cali-3d` — Playable 3D low-poly GTA VI-inspired web game set in Cali, Colombia (`La Sucursal del Cielo`).
- **Status**: Change `C-01` SHIPPED & VERIFIED (`qa-tester: DONE`, `e2e-blackbox-tester: PASSED`, `compliance-verifier: APPROVED`).
- **Verification**: 8 Vitest suites (59/59 passed), `tsc --noEmit`, `eslint src tests`, `vite build`, and live Playwright Chromium E2E (2/2 journeys across 4 viewports `375/768/1280/1920`, `check_evidence.py` exit `0`).

## Key Decisions
- **Decoupled 3D Engine (ADR-001)**: Headless Three.js/DOM-free `src/simulation/` & `src/missions/` emit immutable readonly snapshots to `src/world/` (Three.js), `src/audio/` (procedural Web Audio API), and `src/ui/` (DOM HUD + 2D GPS minimap).
- **100% Offline Procedural Assets**: Zero external `.glb`, `.mp3`, font CDNs, or backend HTTP APIs (`data-source: none`; `localStorage` key `gta_cali_records_v1` for best times & radio prefs).
- **Language Boundary**: Code, types, comments, docs, and commits strictly in English; authentic Español Caleño player copy isolated in `src/config/localeCali.ts`.

## Pointers
- [AGENTS.md](../../AGENTS.md) | [DESIGN.md](../../DESIGN.md)
- [PLAN.md](../../docs/gta-vi-cali-3d/PLAN.md) | [spec.md](../../docs/gta-vi-cali-3d/spec.md) | [adr-001](../../docs/gta-vi-cali-3d/adr-001-decoupled-3d-simulation.md) | [test-matrix.md](../../docs/gta-vi-cali-3d/test-matrix.md)
- [architecture.md](./architecture.md) | [conventions.md](./conventions.md) | [log/2026-11-21.md](./log/2026-11-21.md)
