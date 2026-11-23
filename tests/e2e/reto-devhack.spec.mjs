/* global fetch, process, window */
/**
 * Reto AcaDevHack live-browser flow against the local Firebase emulators (never production).
 * Run with: npm run test:e2e:reto  (wraps `firebase emulators:exec --only firestore,auth`).
 */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { recordRun } from './e2e_recorder.mjs';

const EVIDENCE_DIR = resolve(process.cwd(), 'docs/devhack-reto/evidence');
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = 'devhack-3f0c2';
const DB_ROOT = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/gta-cali/documents`;
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const SWEEP = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

test.skip(!FIRESTORE, 'Reto E2E needs FIRESTORE_EMULATOR_HOST (run via npm run test:e2e:reto)');

async function seedEntry(missionId, uid, nickname, seconds) {
  const response = await fetch(
    `${DB_ROOT}/leaderboards/${missionId}/entries?documentId=${uid}`,
    {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({
        fields: {
          nickname: { stringValue: nickname },
          bestTimeSeconds: { doubleValue: seconds },
        },
      }),
    },
  );
  expect(response.ok).toBe(true);
}

test.describe('Reto AcaDevHack (Firestore emulator)', () => {
  test.beforeAll(async () => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/gta-cali/documents`, {
      method: 'DELETE',
    });
    await seedEntry('mission_1_bulevar', 'seed-a', 'Mateo_Pro', 75.5);
    await seedEntry('mission_1_bulevar', 'seed-b', 'LaCaleña', 92.25);
  });

  test('shows the ranking, validates the nickname, and starts a back-to-back run', async ({ page }) => {
    const run = recordRun(page, EVIDENCE_DIR, {
      dataSource: `Firestore emulator ${FIRESTORE} (project ${PROJECT}, database gta-cali)`,
    });
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/?firestoreEmulator=${FIRESTORE}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
      undefined,
      { timeout: 120_000 },
    );

    const card = page.getByTestId('reto-title-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('3 meses gratis');
    await expect(page.getByTestId('reto-free-courses').locator('a')).toHaveCount(2);
    for (const viewport of SWEEP) {
      await page.setViewportSize(viewport);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      await page.screenshot({ path: resolve(EVIDENCE_DIR, `reto-title-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Live top-10 from Firestore (emulator), fastest first
    await page.getByTestId('btn-reto-ranking').click();
    const table = page.getByTestId('reto-ranking-table');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr').first()).toContainText('Mateo_Pro');
    await expect(table.locator('tbody tr').first()).toContainText('01:15.50');
    await expect(table.locator('tbody tr').nth(1)).toContainText('LaCaleña');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'reto-ranking-1280.png') });
    run.dataCheck(
      'source-on-screen',
      'leaderboards/mission_1_bulevar entries seeded in Firestore (Mateo_Pro 75.5 s, LaCaleña 92.25 s) render fastest-first in the ranking modal',
    );
    await page.getByTestId('reto-ranking-tab-free_roam').click();
    await expect(page.getByTestId('reto-ranking-empty')).toBeVisible();
    await page.getByTestId('btn-reto-ranking-close').click();

    // Nickname validation, then a real claim through anonymous auth + rules
    await page.getByTestId('btn-reto-start').click();
    const input = page.getByTestId('reto-nickname-input');
    await input.fill('a b');
    await page.getByTestId('btn-reto-nickname-start').click();
    await expect(page.getByTestId('reto-nickname-error')).toContainText('Solo letras');
    await input.fill('Valeria_E2E');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'reto-nickname-1280.png') });
    await page.getByTestId('btn-reto-nickname-start').click();
    // Modo Plan briefing opens before the clock starts on the first stage.
    await expect(page.getByTestId('learn-plan')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('btn-plan-turbo').click();

    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing', undefined, {
      timeout: 30_000,
    });
    const chip = page.getByTestId('reto-hud-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Reto 1/5');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'reto-run-hud-1280.png') });

    const reservation = await fetch(`${DB_ROOT}/nicknames/valeria_e2e`, { headers: ADMIN });
    expect(reservation.ok).toBe(true);
    const body = await reservation.json();
    expect(body.fields.nickname.stringValue).toBe('Valeria_E2E');
    expect(body.fields.uid.stringValue.length).toBeGreaterThan(5);
    run.dataCheck(
      'persisted-to-backend',
      'nickname Valeria_E2E claimed in the UI is stored in Firestore nicknames/valeria_e2e with the anonymous uid',
    );

    // Another player cannot steal the nickname (case-insensitive)
    const second = await page.context().browser().newContext();
    const other = await second.newPage();
    await other.goto(`/?firestoreEmulator=${FIRESTORE}`, { waitUntil: 'networkidle' });
    // A second full game boots while the first keeps rendering under SwiftShader: allow extra time.
    await other.waitForFunction(() => window.__GTA_CALI__?.mode === 'title', undefined, {
      timeout: 300_000,
    });
    await other.getByTestId('btn-reto-start').click();
    await other.getByTestId('reto-nickname-input').fill('VALERIA_e2e');
    await other.getByTestId('btn-reto-nickname-start').click();
    await expect(other.getByTestId('reto-nickname-error')).toContainText('ya lo tiene otro');
    await second.close();
    run.dataCheck(
      'backend-rule-enforced',
      'a second anonymous player is refused VALERIA_e2e (case-insensitive) by firestore.rules and the UI shows the taken error',
    );

    // Leave the run and drive past an AcaDevHack billboard (Calle 5 by the Estadio, Mission 2 start)
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-pause-title').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'title');
    await expect(chip).toBeHidden();
    await page.getByTestId('btn-mission-2').click();
    await page.getByTestId('btn-plan-turbo').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'billboard-e2e-1280.png') });
    await run.save();

    expect(consoleErrors.filter((text) => !/favicon|WebGL|GPU stall/i.test(text))).toEqual([]);
  });
});
