# ADR-001: Decoupled Headless Simulation with Procedural 3D & Web Audio

> **Status**: Accepted — **Date**: 2026-11-21

## 1. Context
*GTA VI: Cali* (`C-01`) must run 100% offline in the browser at `>= 60 FPS` (frame delta clamped `<= 0.05s`) with zero external CDN/asset fetches (`data-source: local-client-simulation`). Physics, collisions, traffic, police pursuit AI, and missions require deterministic headless Vitest execution (`< 3s`) free of WebGL/AudioContext mock fragility while enabling 3 disjoint parallel implementation tracks (`world`, `simulation`, `missions/audio/ui`).

## 2. Options Considered
1. **Option A — Scene-Coupled Three.js + External GLTF/Audio Assets**: Couple physics and mission state to `THREE.Object3D` transforms and fetch `.glb`/`.mp3` files. Fails the 100% offline/zero-network constraint, inflates assets, and breaks headless Vitest without brittle WebGL stubs.
2. **Option B — Full ECS Framework + WASM Physics Engine (Rapier/Cannon)**: Adds external runtime dependencies, WASM boot overhead, and query boilerplate excessive for 2 arcade missions and ~30 active entities (violates KISS/YAGNI).
3. **Option C — Decoupled Headless Simulation + Procedural Three.js & Web Audio *(Selected)***: Isolate pure TypeScript simulation/mission logic from procedural Three.js rendering, synthesized Web Audio, and DOM/Canvas UI via readonly snapshots.

## 3. Decision & Justification
Adopt **Option C (Decoupled Headless Simulation + Procedural Three.js & Web Audio)**.
- **Zero-Dependency Core**: `src/types/` and `src/config/` (`CALI_MAP`, `LOCALE_CALI`) define shared immutable contracts, `-240..+240` map geometry/AABBs, and player copy as a single source of truth.
- **Headless Domain**: `src/simulation/` (`GameWorld.step(dt, input)`) and `src/missions/` (`MissionDirector` + `StorageAdapter`) import ONLY `src/types/` and `src/config/`—never `three` or DOM APIs—preserving SOLID/DIP and fast, deterministic Vitest TDD.
- **Procedural Adapters & Composition Root**: `src/world/` (`WorldRenderer.sync`), `src/audio/` (`AudioEngine` with injectable/optional `AudioContext` factory), and `src/ui/` (`HudController`, `MinimapRenderer`) observe readonly snapshots without mutating domain state. `src/game/GameApp` clamps `dt <= 0.05s` and exposes readonly `window.__GTA_CALI__`.

## 4. Trade-offs
- **+ Benefits**:
  - Deterministic headless Vitest suites (`exit code 0`) immune to WebGL, Canvas, or AudioContext test flakiness.
  - 100% offline single Vite bundle with zero external network failures, CORS issues, or media load stalls.
  - Unidirectional contracts allow 3 parallel workers to build `world`, `simulation`, and `missions/audio/ui` cleanly on disjoint files.
- **- Costs & Operational Risks**:
  - Procedural low-poly geometry and Web Audio synthesis offer less detail than sculpted GLTF/MP3 assets -> **Mitigation**: Craft distinct silhouettes for all 6 Cali landmarks, Vice Sunset lighting/emissives, and rhythm-sequenced Salsa/Synthwave voices.
  - Collision AABBs and 3D meshes could diverge if authored independently -> **Mitigation**: Generate both `src/simulation/` colliders and `src/world/` landmarks/buildings from `CALI_MAP` in `src/config/`, verified by `tsc --noEmit`.
  - Missing WebGL, blocked audio autoplay, or unavailable `localStorage` can disrupt startup -> **Mitigation**: Render `DESIGN.md` WebGL fallback card, lazily resume `AudioContext` on user gesture with headless no-op fallback, and wrap `StorageAdapter` with silent in-memory fallback.
