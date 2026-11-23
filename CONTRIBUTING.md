# Contributing

Thanks for helping make Cali (and Claude) more fun to learn! 🌴

## Setup

```bash
npm install
npm run dev -- --port 4173
```

## Ground rules

- **Headless core:** `src/simulation/` and `src/missions/` must not import `three` or DOM APIs. Put rendering in `src/world/` and DOM in `src/ui/`.
- **Copy lives in locales:** player-facing text goes in `src/config/localeEs.ts` **and** `src/config/localeEn.ts` (same shape; a test enforces parity). City/advertising copy (billboards, #CaliViral, radio, street shouts) stays Spanish in `src/config/localeCity.ts`.
- **Code in English:** identifiers, comments, docs and commit messages are in English. Use [Conventional Commits](https://www.conventionalcommits.org/) on a `feat/<slug>` or `fix/<slug>` branch.
- **Offline first:** no runtime CDN or asset downloads. New assets go in `public/` with their license added to `public/ASSETS_LICENSE.md` (MIT/CC0 preferred).

## Before opening a PR

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

UI changes should include a screenshot. For gameplay changes, run the Playwright suite (`npx playwright test --config=tests/e2e/playwright.config.mjs`) with the dev server on port 4173.

## Ideas we'd love

- A mission per Claude Code lesson (MCP, subagents, skills)
- New Cali landmarks and vehicles
- Gamepad support and performance work for low-end phones
