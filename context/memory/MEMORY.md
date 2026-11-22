# Cross-AI Project Memory — GTA VI: Cali

## Active Context
- **Branch**: `feat/gta-vi-cali-3d`
- **Feature**: `gta-vi-cali-3d` — Playable 3D third-person GTA VI-inspired web game set in Cali, Colombia (`La Sucursal del Cielo`).
- **Status**: Changes `C-01`..`C-08` SHIPPED & VERIFIED (`qa-tester: DONE`, `e2e-blackbox-tester: PASSED`, `compliance-verifier: APPROVED`).
- **Verification**: 13 Vitest suites (`228/228` passed), `tsc --noEmit`, `eslint src tests`, `vite build`, and live Playwright Chromium WebGL2 E2E (`2/2` journeys across `375/768/1280/1440/1920`, Garaje `[G]` + M1 + Night M2 + M3 *Pique Callejero* + Free Roam `PASO 1 DE 6` + `KeyT`/`KeyV`/`KeyH` + reload persistence, `36` local assets HTTP `200`, `0` errors, `check_evidence.py` exit `0`).
- **Next-Level Colombian Fleet, Caleños & Living Cali (`C-08`)**:
  - `public/models/caleno.glb` (`readyplayer.me.glb`, 1.75 MiB MIT) with prefix-stripped `Hips <-> mixamorig:Hips` retargeting, 512px woven Cali Jerseys (`escarlata`, `azucarero`, `tricolor`, `guayabera`, `urbano_cali`, `police_uniform`), 6 Vallecaucano skin tones, ZERO sci-fi Soldier visuals rendered; Valeria & Mateo switchable in Garaje `[G]`.
  - Sculpted clearcoat PBR fast Colombian fleet with solid roofs/A-B-C-D pillars, smoked dark glass (`opacity: 0.86`), Colombian yellow/white `CALI` plates, and live exhaust backfire flames: `renault4_turbo` (starter, 200 km/h), `spark_gt_turbo` (196 km/h), `willys_v8` (190 km/h w/ supercharger & Yipao rack), `banshee` (`ferrari.glb`), authentic Policía Nacional SUV Interceptor (`police`), authentic Taxi Zapatico (`taxi`), `mio_bus`, `chiva`.
  - Mission 3 (*Pique Callejero en el Bulevar*, 6 checkpoints, 2 rival racers, `POS 1/3`), Garaje Caleño `[G]` (`localStorage`), 3 Stunt Jump ramps (airborne arc + COP), 2 *Latonería y Pintura* Pay 'n' Spray bays (clear stars + repaint), `★★★` Retenes Policiales (barricades + uniformed officers), Drift Combo `x2..x5` COP, `[H]` Horn & Chiva *"La Cucaracha"*, Turbo BOV SFX, 5 Cholado stands, 4 working Semáforos, and 4 Cali murals.
- **Morena Caleña, Photorealistic 3D & Full GTA Audio (`C-06` + `C-07`)**:
  - `public/models/valeria.glb` (`Michelle.glb`, 3.13 MB MIT) rigged via `SkeletonUtils.retargetClip` (`Idle`/`Walk`/`Run` + native `SambaDance` at Cristo Rey), warm Morena Caleña calibration, plus 18 diverse rigged civilian pedestrians (`95m` culling) and per-session Free Roam `PASO 1 DE 6` (`la_ermita`).
  - 3D architectural facade relief (dark daytime / warm-night recessed glass windows, sills, projecting balconies & railings, striped Cali shopfront awnings, corner pilasters, San Antonio colonial terracotta eaves), 4 MIO bus shelters, Bulevar benches/bollards/planters, 16 wet specular road puddles, upgraded La Ermita / Torre de Cali / Cristo Rey, pooled `SkidMarkPool`, and `Render -> UnrealBloom -> Highlight-Safe CinematicGradePass -> SMAAPass -> OutputPass`.
  - Offline `es-CO` Web Speech API `VoiceEngine` (`src/audio/voiceEngine.ts` + `[V] Voces` HUD pill persisted in `localStorage`) + upgraded `AudioEngine` (5-speed V8/diesel synth with gear shifts, drift screech, collision foley, door slam + ignition, distance/Doppler Wail/Yelp police siren, radio squelch, street murmur).
- **3 Distinct Modes & Living Cali (`C-04` + `C-05`)**: M1 *"Golpe en la Torre"* (golden-hour on-foot Torre heist -> `★★` -> Ferrari getaway -> La Ermita -> San Antonio hideout), M2 *"Noche de Salsa en Cristo Rey"* (starlit night + 95s countdown + `+10s`/Nitro rings from Estadio Pascual Guerrero to floodlit Cristo Rey), Free Roam at Bulevar del Río + `[T]` Day/Night toggle, Dijkstra GPS, hijack any Cali vehicle, and GTA V free-orbit mouse camera.

## Key Decisions
- **Decoupled 3D Engine (ADR-001)**: Headless Three.js/DOM-free `src/simulation/` & `src/missions/` emit immutable readonly snapshots to `src/world/` (Three.js), `src/audio/` (Web Audio + Web Speech), and `src/ui/` (DOM HUD + 2D GPS minimap).
- **100% Offline Local Assets**: Zero external runtime CDNs or backend APIs (`data-source: none`; 28 MB local `public/` CC0/MIT pack, max file `3.13 MB < 10 MB`; `localStorage` key `gta_cali_records_v1`).
- **Language Boundary**: Code, types, comments, docs, and commits strictly in English; authentic Español Caleño player copy isolated in `src/config/localeCali.ts`.

## Pointers
- [AGENTS.md](../../AGENTS.md) | [DESIGN.md](../../DESIGN.md)
- [PLAN.md](../../docs/gta-vi-cali-3d/PLAN.md) | [spec.md](../../docs/gta-vi-cali-3d/spec.md) | [adr-001](../../docs/gta-vi-cali-3d/adr-001-decoupled-3d-simulation.md) | [test-matrix.md](../../docs/gta-vi-cali-3d/test-matrix.md)
- [architecture.md](./architecture.md) | [conventions.md](./conventions.md) | [log/2026-11-22.md](./log/2026-11-22.md) | [log/2026-11-21.md](./log/2026-11-21.md)
