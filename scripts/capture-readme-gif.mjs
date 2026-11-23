/* global process, window, console */
/**
 * Records a short gameplay clip (title → Mission 2 night run → /rewind) and converts it into
 * docs/readme/demo.gif with ffmpeg. Usage (dev server on :4173): node scripts/capture-readme-gif.mjs
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';
const OUT = resolve(process.cwd(), 'docs/readme');
const TMP = resolve(OUT, '.video-tmp');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  locale: 'es-CO',
  recordVideo: { dir: TMP, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
  undefined,
  { timeout: 180_000 },
);
for (let i = 0; i < 3; i += 1) {
  if ((await page.evaluate(() => window.__GTA_CALI__.perf?.quality)) === 'high') break;
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(2500);
await page.getByTestId('btn-mission-2').click();
await page.getByTestId('btn-plan-turbo').click();
await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');
await page.getByTestId('btn-learn-toast-close').click({ timeout: 3000 }).catch(() => undefined);
await page.waitForTimeout(1500);
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(2500);
await page.keyboard.down('KeyA');
await page.waitForTimeout(500);
await page.keyboard.up('KeyA');
await page.waitForTimeout(2500);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyZ');
await page.waitForTimeout(3500);
const videoPath = await page.video()?.path();
await context.close();
await browser.close();

const source = videoPath ?? resolve(TMP, readdirSync(TMP).find((f) => f.endsWith('.webm')) ?? '');
// Skip the loading screen, keep ~16 s, 12 fps, 800 px wide, shared palette for a small GIF.
execFileSync('ffmpeg', [
  '-y', '-ss', '4', '-t', '16', '-i', source,
  '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
  resolve(OUT, 'demo.gif'),
], { stdio: 'inherit' });
rmSync(TMP, { recursive: true, force: true });
console.log('demo.gif written to', OUT);
