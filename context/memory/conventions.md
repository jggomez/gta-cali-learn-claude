# Coding & Design Conventions — GTA VI: Cali

- **Strict TypeScript 5 & ESLint**: `strict: true`, `noUncheckedIndexedAccess: true`, `@typescript-eslint/no-explicit-any: "error"`, SOLID/DRY/KISS small functions.
- **Language Boundary**: All code, identifiers, types (`DialogueSpeaker` uses `'valeria' | 'mateo' | 'radio' | 'system'`), comments, docs, and commits in English; player-facing Español Caleño lives solely in `src/config/localeCali.ts`.
- **UI & A11y (`DESIGN.md`)**: Use CSS custom properties inside `:root` only (zero hardcoded hex literals outside `:root`), WCAG AA/AAA contrast (`>= 4.5:1`), `>= 44x44px` touch targets, `:focus-visible` cyan ring, and `prefers-reduced-motion: reduce`.
- **Verification**: Require `npm run typecheck && npm run lint && npm test && npm run build` plus Playwright E2E (`check_evidence.py`) exit `0` before shipping.
