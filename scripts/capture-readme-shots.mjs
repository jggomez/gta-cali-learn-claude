/* global process, window, console */
/**
 * Captures README / promo screenshots from the running game (dev server on :4173).
 * Usage: node scripts/capture-readme-shots.mjs [--swiftshader]
 * Output: docs/readme/*.png and public/og-cover.png (1200x630 social card).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';
const OUT = resolve(process.cwd(), 'docs/readme');
const SOFTWARE_GL = process.argv.includes('--swiftshader');
/** --title-only re-captures just the title, showcase, social card and mobile shots. */
const TITLE_ONLY = process.argv.includes('--title-only');
const ALL_CARDS = [
  'card_agentic_loop', 'card_claude_md', 'card_plan_mode', 'card_context', 'card_hooks',
  'card_mcp', 'card_subagents', 'card_skills', 'card_prompt_4', 'card_artifacts',
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: SOFTWARE_GL
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
    : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});

async function openGame({ width, height, seedCards = false, quality = 'high' }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'es-CO' });
  const page = await context.newPage();
  await page.addInitScript(
    ({ cards, seed }) => {
      try {
        if (seed) {
          window.localStorage.setItem('gta_cali_learning_v1', JSON.stringify({ cards, seenTips: [], answeredHacks: [] }));
        }
      } catch {
        /* storage unavailable */
      }
    },
    { cards: ALL_CARDS, seed: seedCards },
  );
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
    undefined,
    { timeout: 180_000 },
  );
  // Raise render quality for marketing shots ([Q] cycles low → medium → high).
  for (let i = 0; i < 3; i += 1) {
    const level = await page.evaluate(() => window.__GTA_CALI__.perf?.quality);
    if (level === quality) break;
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(400);
  }
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });
const settle = (page, ms = 3500) => page.waitForTimeout(ms);
const fps = (page) => page.evaluate(() => window.__GTA_CALI__.fps);

// 1. Title screen hero (desktop + mobile)
{
  const { context, page } = await openGame({ width: 1440, height: 900 });
  await settle(page);
  console.log('fps', await fps(page));
  await shot(page, '01-title');
  await page.getByTestId('learn-showcase').scrollIntoViewIfNeeded();
  await settle(page, 800);
  await page.getByTestId('learn-showcase').screenshot({ path: resolve(OUT, '02-aprende-claude.png') });
  // Social card (1200x630)
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 1500);
  await page.screenshot({ path: resolve(process.cwd(), 'public/og-cover.png') });

  if (TITLE_ONLY) {
    await context.close();
  } else {
  // 3. Modo Plan briefing
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('btn-mission-1').click();
  await page.getByTestId('learn-plan').waitFor();
  await settle(page, 800);
  await shot(page, '03-modo-plan');
  await page.getByTestId('btn-plan-turbo').click();
  await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');

  // 4. /rewind
  await settle(page, 2500);
  const start = await page.evaluate(() => ({ ...window.__GTA_CALI__.world.player }));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(
    ({ x, z }) => Math.hypot(window.__GTA_CALI__.world.player.x - x, window.__GTA_CALI__.world.player.z - z) > 14,
    start,
    { timeout: 180_000 },
  );
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyZ');
  await settle(page, 1200);
  await shot(page, '04-rewind');
  await context.close();
  }
}

// 5. Police hack (Mission 2 night chase)
if (!TITLE_ONLY) {
  const { context, page } = await openGame({ width: 1440, height: 900 });
  await page.getByTestId('btn-mission-2').click();
  await page.getByTestId('btn-plan-turbo').click();
  await page.waitForFunction(() => window.__GTA_CALI__?.learning?.hackQuestionIndex !== null, undefined, {
    timeout: 300_000,
  });
  await settle(page, 600);
  await shot(page, '05-hackeo');
  await context.close();
}

// 6-8. Mission 5, Álbum, Garaje (complete album seeded)
if (!TITLE_ONLY) {
  const { context, page } = await openGame({ width: 1440, height: 900, seedCards: true });
  await page.getByTestId('btn-title-garage').click();
  await settle(page, 1200);
  await shot(page, '08-garaje-claude-naranja');
  await page.keyboard.press('KeyG');
  await page.getByTestId('btn-mission-5').click();
  await page.getByTestId('btn-plan-turbo').click();
  await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');
  await page.getByTestId('btn-learn-toast-close').click().catch(() => undefined);
  await page.keyboard.down('KeyW');
  await settle(page, 2500);
  await page.keyboard.up('KeyW');
  await settle(page, 2500);
  await shot(page, '06-mision-5-golpe-del-prompt');
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-pause-album').click();
  await settle(page, 800);
  await shot(page, '07-album-claude');
  await context.close();
}

// 9. Mobile title
{
  const { context, page } = await openGame({ width: 390, height: 844 });
  await settle(page);
  await shot(page, '09-mobile-title');
  await context.close();
}

await browser.close();
console.log('screenshots written to', OUT);
