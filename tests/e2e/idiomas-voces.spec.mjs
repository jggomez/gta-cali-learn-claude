/* global process, window, document */
/**
 * ES | EN language toggle: the UI switches to English while city/advertising copy (#CaliViral
 * ticker, radio, billboards) and every spoken voice line stay in Español Caleño.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { recordRun } from './e2e_recorder.mjs';

const EVIDENCE_DIR = resolve(process.cwd(), 'docs/idiomas-voces/evidence');
const SWEEP = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

async function waitForTitle(page) {
  await page.waitForFunction(
    () => window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
    undefined,
    { timeout: 180_000 },
  );
}

test.describe('Idiomas y voces (ES | EN)', () => {
  test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

  test('switches the UI to English while the city and voices stay Caleño', async ({ page }) => {
    const run = recordRun(page, EVIDENCE_DIR, { dataSource: 'local-client-simulation (localStorage)' });
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/favicon|WebGL|GPU stall|firestore|firebase/i.test(msg.text())) {
        errors.push(msg.text());
      }
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForTitle(page);

    // Spanish by default (Chromium test locale es-CO or saved choice).
    await page.evaluate(() => window.localStorage.removeItem('gta_cali_lang_v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await waitForTitle(page);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const startedInEnglish = lang === 'en';
    if (startedInEnglish) {
      await page.getByTestId('btn-lang-es').click();
      await page.waitForLoadState('networkidle');
      await waitForTitle(page);
    }
    await expect(page.getByTestId('btn-lang-es')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('learn-showcase')).toContainText('Aprende Claude mientras juegas');

    // Switch to English: the choice is saved and the page reloads into the title screen.
    await page.getByTestId('btn-lang-en').click();
    await page.waitForLoadState('networkidle');
    await waitForTitle(page);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    expect(await page.evaluate(() => window.localStorage.getItem('gta_cali_lang_v1'))).toBe('en');
    await expect(page.getByTestId('btn-lang-en')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('learn-showcase')).toContainText('Learn Claude while you play');
    await expect(page.getByTestId('btn-mission-1')).toContainText(/start/i);
    await expect(page.getByTestId('made-by-devhack')).toContainText('Made by');
    for (const viewport of SWEEP) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId('btn-lang-en')).toBeInViewport();
      await page.screenshot({ path: resolve(EVIDENCE_DIR, `title-en-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Mission 1 in English: English plan + subtitles, Caleño spoken line and Spanish city ticker.
    await page.getByTestId('btn-mission-1').click();
    await expect(page.getByTestId('learn-plan')).toContainText('PLAN MODE');
    await page.getByTestId('btn-plan-turbo').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');
    const dialogue = await page.evaluate(() => window.__GTA_CALI__.mission.dialogue);
    expect(dialogue.text).toMatch(/Run to Torre de Cali/);
    expect(dialogue.spokenText).toMatch(/Corre a pie hasta la Torre de Cali/);
    await expect(page.locator('#hud-root')).toContainText('OBJECTIVE');
    const ticker = await page.evaluate(() => window.__GTA_CALI__.mission.viralTicker);
    expect(ticker).toMatch(/^#/);
    expect(ticker).toMatch(/Cali|Río|Cristo|Pascual|tomba|Sucursal/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'mission1-en-1280.png') });
    run.dataCheck(
      'state-change-on-screen',
      `EN subtitle "${dialogue.text.slice(0, 40)}…" spoken as "${dialogue.spokenText.slice(0, 40)}…"; ticker stays Spanish`,
    );

    // Pause menu toggle brings Spanish back.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('btn-lang-en-pause')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'pause-en-1280.png') });
    await page.getByTestId('btn-lang-es-pause').click();
    await page.waitForLoadState('networkidle');
    await waitForTitle(page);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('es-CO');
    await expect(page.getByTestId('learn-showcase')).toContainText('Aprende Claude mientras juegas');

    await run.save();
    expect(errors).toEqual([]);
  });
});
