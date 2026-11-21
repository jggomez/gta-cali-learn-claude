# AGENTS.md — GTA VI: Cali (La Sucursal del Cielo)

## 1. Project Overview & Tech Stack
Playable 3D low-poly third-person web game inspired by GTA VI and set in Cali, Colombia, built to demonstrate Gemini and Antigravity. Runs 100% offline in the browser with TypeScript 5 (strict), Vite 6, Three.js (procedural 3D landmarks, vehicles, sunset sky), Web Audio API (procedural Salsa Brava & Synthwave radio + SFX), and Vitest.

## 2. Executable Commands
- **Install**: `npm install`
- **Dev**: `npm run dev -- --port 4173` (serves `http://localhost:4173`)
- **Test**: `npm test` (Vitest unit + integration suites)
- **E2E**: `npx playwright test --config=tests/e2e/playwright.config.mjs` (live Chromium WebGL suite)
- **Lint / Typecheck**: `npm run typecheck && npm run lint`
- **Build**: `npm run build` (production Vite bundle in `dist/`)

## 3. Architecture & Coding Conventions
- **Directory Layout**:
  - `src/types/`, `src/config/`: Shared immutable types, Cali map coordinates, and Español Caleño locale strings (`localeCali.ts`).
  - `src/simulation/`: Pure Three.js-free headless physics, AABB collisions, Cali traffic, Police pursuit AI, and `GameWorld`.
  - `src/missions/`: Pure mission state machine (`mission_1_bulevar`, `mission_2_cristo_rey`, `free_roam`) + `localStorage` scores.
  - `src/world/`: Procedural Three.js scene, sunset sky dome, 6 Cali landmarks, vehicle/player meshes, and chase camera.
  - `src/audio/`: Procedural Web Audio API radio stations and SFX (safe no-op when `AudioContext` is absent).
  - `src/ui/`, `src/styles/`: Neon GTA VI HUD, 2D Canvas GPS minimap, dialogue cards, and Title/Pause/Victory screens.
  - `src/game/`: Runtime `requestAnimationFrame` loop (`GameApp`) and `InputManager`.
  - `tests/unit/`, `tests/integration/`: Headless Vitest suites mirroring `src/`.
  - `docs/<feature-name>/`: `PLAN.md`, `spec.md`, `adr-NNN-*.md`, `test-matrix.md`, and `evidence/*.png`.
- **Key Invariants**:
  - Code, identifiers, types, comments, docs, and commits MUST be strictly in English; player-facing Español Caleño copy lives only in `src/config/localeCali.ts`.
  - Keep `src/simulation/` and `src/missions/` strictly decoupled from `three` and DOM APIs (SOLID / KISS / TDD).
  - Data source is `local-client-simulation` (in-memory + `localStorage`); never add fake backend stubs or external network asset fetches.
  - Never commit on `main`/`master`/`develop`; use Conventional Commits on `feat/<slug>` branches.
  - Require empirical `exit code 0` tests plus real browser Playwright E2E evidence before completion.

## 4. Design & Persistent Memory
- **UI Design System (`DESIGN.md`)**: Read root [DESIGN.md](./DESIGN.md) (`<= 110 lines`) for Vice Sunset Cali color, typography, HUD, and WCAG AA tokens; keep feature UI deltas in `## Design` of `docs/gta-vi-cali-3d/spec.md` (`<= 30 lines`).
- **Cross-Session AI Memory (`context/memory/`)**:
  - Read [context/memory/MEMORY.md](./context/memory/MEMORY.md) at session start to restore active state.
  - Consult [context/memory/architecture.md](./context/memory/architecture.md), [context/memory/conventions.md](./context/memory/conventions.md), and `context/memory/log/YYYY-MM-DD.md` on demand; update on milestone completion.
