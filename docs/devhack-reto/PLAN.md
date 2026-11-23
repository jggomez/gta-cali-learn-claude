# Reto AcaDevHack — PLAN

| ID | Item | Status |
|----|------|--------|
| R-01 | Faster on-foot speed (6/10 m/s) + no pixelation (DPR caps, dyn-res floor 0.75) | Done |
| R-02 | Firestore DB `gta-cali` + web app in `devhack-3f0c2` | Done |
| R-03 | Pure challenge run (M1→M2→M3→Free Roam tour), claim codes, nickname rules | Done |
| R-04 | `LeaderboardPort` + Firestore lite adapter (anonymous auth, offline-safe) | Done |
| R-05 | Nickname / ranking / stage / failed / winner UI + HUD chip + free-course links | Done |
| R-06 | 7 AcaDevHack roadside billboards (with post colliders) | Done |
| R-07 | `firestore.rules` + emulator suite (`npm run test:rules`) | Done |
| R-08 | Enable Anonymous Auth in console | **Owner action** |
| R-09 | Deploy rules: `firebase deploy --only firestore:gta-cali --project devhack-3f0c2` | **Owner action** |

## Data model (`gta-cali`)
- `nicknames/{lowercase}` — `{uid, nickname, createdAt}`; create-only, unique.
- `leaderboards/{missionId}/entries/{uid}` — `{nickname, bestTimeSeconds, updatedAt}`; public read, owner write, must improve.
- `challengeWinners/{uid}` — `{nickname, code, times, totalSeconds, claimed:false, completedAt}`; owner read, create once; staff set `claimed` in console.

## Prize flow
Winner sees `CALI-XXXX-XXXX` + "Reclamar por WhatsApp" (wa.me/573174498336 with prefilled nickname, code, total). Staff cross-check the code in `challengeWinners` before granting 3 months of Suscripción AcaDevHack Virtual. Times are client-reported: rules bound plausibility, but manual verification is the final gate.

## Evidence
`evidence/reto-title-1280.png`, `reto-ranking-1280.png`, `reto-nickname-1280.png`, `reto-run-hud-1280.png`, `billboard-1280.png`.
