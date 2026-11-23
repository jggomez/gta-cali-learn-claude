---
name: "GTA VI: Cali — Vice Sunset Cali"
version: "1.0.0"
colors:
  primary: "#FF2E93"
  primary_hover: "#FF5E7E"
  secondary: "#00F0FF"
  surface: "#120826"
  surface_glass: "rgba(14, 8, 30, 0.78)"
  surface_alt: "#1D0E3D"
  text: "#F8F7FF"
  text_muted: "#C9C2E3"
  text_on_accent: "#120826"
  border: "rgba(0, 240, 255, 0.35)"
  success: "#00E699"
  warning: "#FFB800"
  error: "#FF3B5C"
  police_red: "#FF3B5C"
  police_blue: "#2E7BFF"
typography:
  font_display: "\"Arial Narrow\", \"Impact\", \"Bahnschrift Condensed\", system-ui, sans-serif"
  font_sans: "\"Inter\", \"Segoe UI\", system-ui, -apple-system, sans-serif"
  font_mono: "\"JetBrains Mono\", \"SF Mono\", ui-monospace, monospace"
  scale:
    display: "clamp(2.25rem, 6vw, 4.5rem)/0.95"
    h1: "1.875rem/1.15"
    h2: "1.25rem/1.25"
    body: "0.9375rem/1.45"
    caption: "0.75rem/1.3"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button_primary:
    background: "{colors.secondary}"
    hover_background: "{colors.primary_hover}"
    color: "{colors.text_on_accent}"
    radius: "{rounded.md}"
    padding: "{spacing.sm} {spacing.lg}"
  hud_panel:
    background: "{colors.surface_glass}"
    color: "{colors.text}"
    border: "1px solid {colors.border}"
    radius: "{rounded.lg}"
    padding: "{spacing.sm} {spacing.md}"
  badge:
    background: "{colors.surface_alt}"
    color: "{colors.warning}"
    border: "1px solid {colors.primary}"
    radius: "{rounded.full}"
---

# DESIGN.md — GTA VI: Cali (Vice Sunset Cali)

## Overview
High-contrast neon-noir design system for *GTA VI: Cali (La Sucursal del Cielo)*. Anchors readable HUD telemetry over a dynamic 3D sunset WebGL canvas using frosted twilight glass, WCAG 2.1 AA contrast (`>= 4.5:1`), 100% offline font stacks, and Google `@google/design.md` YAML tokens.

## Colors
Pair deep twilight violet (`{colors.surface}` `#120826`) and frosted glass (`{colors.surface_glass}`) with crisp off-white copy (`{colors.text}` `#F8F7FF`, `>15:1` contrast) and muted lavender (`{colors.text_muted}` `#C9C2E3`). Solid accent fills (`{colors.secondary}` `#00F0FF`, `{colors.primary_hover}` `#FF5E7E`, `{colors.warning}` `#FFB800`) use dark foreground text (`{colors.text_on_accent}` `#120826`, `>=6:1`). Reserve neon magenta (`{colors.primary}` `#FF2E93`) for borders, glows, and large display accents, and `{colors.police_red}` / `{colors.police_blue}` for Wanted alerts paired with star icons (never color alone).

## Typography
Poster titles and mission banners use `font_display` in bold condensed italic (`font-weight: 900; font-style: italic; text-transform: uppercase`). Objectives, dialogue, and menus use `font_sans`. Speedometer, `$ COP` cash, and timers use `font_mono` with `font-variant-numeric: tabular-nums` to eliminate layout jitter.

## Layout
Keep `>=70%` of the central 3D viewport unobstructed. Anchor 5 edge HUD zones with `{spacing.md}` (`16px`) outer inset (`{spacing.sm}` `8px` on `<640px`): top-left, top-right, bottom-left, bottom-center, bottom-right. Z-index layers: `0` 3D canvas, `10` passive HUD & minimap, `20` dialogue/prompts, `30` Pause/Result modals, `40` Title/Victory screens. Responsive across `375px–1440px+` (`<640px` compacts HUD and hides verbose keycaps; zero horizontal scroll).

## Elevation & Depth
Apply `backdrop-filter: blur(10px)` with `1px solid {colors.border}` on all `hud_panel` overlays. Use neon magenta/coral glow (`0 0 18px rgba(255, 46, 147, 0.28)`) on active headers/modals and hard dark drop-shadows on bare 3D-overlay headlines.

## Shapes
Use `{rounded.sm}` (`4px`) for keycap pills, `{rounded.md}` (`8px`) for buttons and the rectangular GPS minimap frame, `{rounded.lg}` (`12px`) for HUD cards and dialogs, and `{rounded.full}` (`9999px`) for radio/ticker badges.

## Components
All interactive controls (`button_primary`, ghost buttons, mission cards, radio/audio toggles) must support: `default`, `hover` (coral/cyan shift + `scale(1.02)`), `focus-visible` (`2px solid {colors.secondary}`, `2px` offset), `active` (`scale(0.98)`), `disabled` (`opacity: 0.45`), `loading` (inline fixed-width indicator), `empty` (`--:--` / `Sin récord` badge), and `error` (`{colors.error}` border + icon/text notice). Minimum touch target `>=44x44px`; passive HUD wrappers use `pointer-events: none`.

## Do's and Don'ts
- **Do**: Reference `{colors.*}` / `{spacing.*}` tokens, enforce `prefers-reduced-motion: reduce` (disable siren strobing, pulse glows, and slide transitions while keeping static icons), and source player copy solely from `src/config/locale*.ts`. The `ES | EN` toggle (`.cali-lang-toggle`, top-left of the title + pause menu, `aria-pressed`, 44px targets) only changes UI text; city/ad copy and voices stay Caleño.
- **Don't**: Fetch external fonts/CDNs, hardcode hex colors in components, strip `:focus-visible` rings, or cover the center driving sightline with opaque boxes.
