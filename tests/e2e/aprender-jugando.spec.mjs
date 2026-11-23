/* global process, window */
/**
 * "Aprender jugando" live-browser flow: Modo Plan briefing, /rewind power, learning toast links,
 * the police-hack terminal, the Álbum Claude (empty and complete), the Claude Naranja paint unlock
 * and Mission 5 "El Golpe del Prompt". Offline: no backend involved (learning state is localStorage).
 */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { recordRun } from './e2e_recorder.mjs';

const EVIDENCE_DIR = resolve(process.cwd(), 'docs/aprender-jugando/evidence');
const SWEEP = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
const ALL_CARDS = [
  'card_agentic_loop',
  'card_claude_md',
  'card_plan_mode',
  'card_context',
  'card_hooks',
  'card_mcp',
  'card_subagents',
  'card_skills',
  'card_prompt_4',
  'card_artifacts',
];

async function waitForTitle(page) {
  await page.waitForFunction(
    () => window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
    undefined,
    { timeout: 120_000 },
  );
}

function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return () => errors.filter((text) => !/favicon|WebGL|GPU stall|firestore|firebase/i.test(text));
}

test.describe('Aprender jugando (Claude Code / Claude learning layer)', () => {
  test.beforeAll(() => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test('Modo Plan, /rewind, police hack and the empty Álbum Claude', async ({ page }) => {
    const run = recordRun(page, EVIDENCE_DIR, { dataSource: 'local-client-simulation (localStorage)' });
    const consoleErrors = trackConsoleErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForTitle(page);

    // Modo Plan gates Mission 1: the clock does not start until a plan is approved.
    await page.getByTestId('btn-mission-1').click();
    const plan = page.getByTestId('learn-plan');
    await expect(plan).toBeVisible();
    await expect(page.getByTestId('learn-plan-steps').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('learn-plan-link')).toHaveAttribute(
      'href',
      'https://devhack.co/academy-ai/claude-code-desde-cero/',
    );
    expect(await page.evaluate(() => window.__GTA_CALI__.mode)).toBe('title');
    for (const viewport of SWEEP) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId('btn-plan-turbo')).toBeInViewport();
      await page.screenshot({ path: resolve(EVIDENCE_DIR, `modo-plan-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('btn-plan-turbo').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');

    // The plan toast teaches the real feature and links to the free course.
    const toast = page.getByTestId('learn-toast');
    await expect(toast).toBeVisible();
    await expect(page.getByTestId('learn-toast-title')).toContainText('Modo Plan');
    await expect(page.getByTestId('learn-toast-link')).toHaveAttribute('href', /^https:\/\/devhack\.co\//);
    // Toasts auto-hide after 8 s (never pause the game); [×] closes them sooner.
    if (await toast.isVisible()) {
      await page.getByTestId('btn-learn-toast-close').click({ timeout: 2000 }).catch(() => undefined);
    }
    await expect(toast).toBeHidden({ timeout: 10_000 });

    // /rewind [Z]: walk away for a few seconds, then rewind ~5 s back along the path.
    const pill = page.getByTestId('learn-rewind-pill');
    await expect(pill).toContainText('/rewind ×1');
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => ({ ...window.__GTA_CALI__.world.player }));
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    // Wait on simulated progress, not wall time: SwiftShader renders ~1-2 fps with dt clamped.
    await page.waitForFunction(
      ({ x, z }) => {
        const p = window.__GTA_CALI__.world.player;
        return Math.hypot(p.x - x, p.z - z) > 12;
      },
      { x: before.x, z: before.z },
      { timeout: 180_000 },
    );
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    const walked = await page.evaluate(() => ({ ...window.__GTA_CALI__.world.player }));
    expect(Math.hypot(walked.x - before.x, walked.z - before.z)).toBeGreaterThan(5);
    await page.keyboard.press('KeyZ');
    await page.waitForFunction(() => window.__GTA_CALI__?.learning?.rewindCharges === 0);
    const rewound = await page.evaluate(() => ({ ...window.__GTA_CALI__.world.player }));
    expect(Math.hypot(rewound.x - walked.x, rewound.z - walked.z)).toBeGreaterThan(3);
    await expect(pill).toContainText('/rewind ×0');
    await expect(page.getByTestId('learn-toast-title')).toContainText('/rewind');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'rewind-toast-1280.png') });
    run.dataCheck(
      'state-change-on-screen',
      `/rewind moved the player back ${Math.hypot(rewound.x - walked.x, rewound.z - walked.z).toFixed(1)} m and the HUD pill dropped to ×0`,
    );

    // Álbum Claude from the pause menu: 10 locked cards for a fresh player.
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-pause-album').click();
    const album = page.getByTestId('learn-album');
    await expect(album).toBeVisible();
    await expect(page.getByTestId('learn-album-count')).toContainText('0 de 10');
    await expect(page.locator('[data-testid^="album-card-"][data-owned="false"]')).toHaveCount(10);
    await page.getByTestId('btn-album-close').click();
    await expect(album).toBeHidden();
    await page.getByTestId('btn-pause-title').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'title');

    // Police hack: Mission 2 starts with a 3-star pursuit; stop and let the police corner you.
    await page.getByTestId('btn-mission-2').click();
    await page.getByTestId('btn-plan-stealth').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');
    // ~15 s of simulated cooldown plus the pursuit closing in; SwiftShader runs the sim slowly.
    await page.waitForFunction(() => window.__GTA_CALI__?.learning?.hackQuestionIndex !== null, undefined, {
      timeout: 420_000,
    });
    const hack = page.getByTestId('learn-hack');
    await expect(hack).toBeVisible();
    await expect(page.getByTestId('learn-hack-prompt')).not.toBeEmpty();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'hack-1280.png') });
    const starsBefore = await page.evaluate(() => window.__GTA_CALI__.world.wantedStars);
    await page.keyboard.press('Digit1');
    await expect(hack).toBeHidden();
    await expect(page.getByTestId('learn-hack-feedback')).toBeVisible();
    const starsAfter = await page.evaluate(() => window.__GTA_CALI__.world.wantedStars);
    expect(Math.abs(starsAfter - starsBefore)).toBeLessThanOrEqual(1);
    run.dataCheck(
      'state-change-on-screen',
      `police hack answered with [1]: wanted stars ${starsBefore} -> ${starsAfter}, feedback flash shown`,
    );

    await run.save();
    expect(consoleErrors()).toEqual([]);
  });

  test('a complete Álbum Claude unlocks Claude Naranja and Mission 5 starts the prompt heist', async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    await page.addInitScript((cards) => {
      window.localStorage.setItem(
        'gta_cali_learning_v1',
        JSON.stringify({ cards, seenTips: [], answeredHacks: [] }),
      );
    }, ALL_CARDS);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForTitle(page);
    expect(await page.evaluate(() => window.__GTA_CALI__.learning.cards.length)).toBe(10);

    // Garaje: the Claude Naranja paint is revealed only with the full album.
    await page.getByTestId('btn-title-garage').click();
    const claudePaint = page.locator('[data-paint-id="claude_naranja"]');
    await expect(claudePaint).toBeVisible();
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'garage-claude-naranja-1280.png') });
    await page.keyboard.press('KeyG');

    // Mission 5 "El Golpe del Prompt".
    await page.getByTestId('btn-mission-5').click();
    await page.getByTestId('btn-plan-turbo').click();
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'playing' &&
        window.__GTA_CALI__?.mission.activeMission === 'mission_5_golpe_prompt' &&
        window.__GTA_CALI__?.mission.activeObjective?.id === 'm5_pkg_rol',
    );
    expect(await page.evaluate(() => window.__GTA_CALI__.world.wantedStars)).toBeGreaterThanOrEqual(1);
    // Let the chase camera finish its transition from the title orbit (slow on SwiftShader).
    await page.waitForTimeout(6000);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'mission5-start-1280.png') });

    // Pause → Álbum: every card shows its tip and a free-lesson link.
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-pause-album').click();
    await expect(page.getByTestId('learn-album-count')).toContainText('10 de 10');
    const owned = page.locator('[data-testid^="album-card-"][data-owned="true"]');
    await expect(owned).toHaveCount(10);
    await expect(owned.first().locator('a')).toHaveAttribute('href', /^https:\/\/devhack\.co\/academy-ai\//);
    for (const viewport of SWEEP) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: resolve(EVIDENCE_DIR, `album-${viewport.width}.png`) });
    }
    expect(consoleErrors()).toEqual([]);
  });
});
