/* global Buffer, HTMLCanvasElement, HTMLElement, document, performance, process, requestAnimationFrame, window */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { recordRun } from './e2e_recorder.mjs';

const EVIDENCE_DIR = resolve(process.cwd(), 'docs/gta-vi-cali-3d/evidence');

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, file: 'title-375.png' },
  { name: 'tablet', width: 768, height: 1024, file: 'title-768.png' },
  { name: 'desktop', width: 1280, height: 720, file: 'title-1280.png' },
  { name: 'widescreen', width: 1920, height: 1080, file: 'title-1920.png' },
];

/**
 * Decodes an 8-bit RGB/RGBA PNG buffer and verifies that the rendered frame
 * contains non-uniform, colorful pixels (proving WebGL + UI actually painted).
 */
function analyzePngPixels(pngBuffer) {
  const sig = pngBuffer.subarray(0, 8);
  if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Invalid PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = pngBuffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const decoded = Buffer.alloc(height * stride);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[rowIn + x];
      const a = x >= bpp ? decoded[rowOut + x - bpp] : 0;
      const b = y > 0 ? decoded[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? decoded[rowOut - stride + x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paeth(a, b, c)) & 0xff;
      decoded[rowOut + x] = recon;
    }
  }

  const buckets = new Set();
  let nonBlackCount = 0;
  let colorfulCount = 0;
  let sampled = 0;

  // Sample every 8th pixel in x and y for fast deterministic inspection
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const idx = y * stride + x * bpp;
      const r = decoded[idx];
      const g = decoded[idx + 1];
      const b = decoded[idx + 2];
      sampled += 1;
      if (r + g + b > 24) nonBlackCount += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colorfulCount += 1;
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
  }

  return {
    width,
    height,
    sampled,
    nonBlackRatio: nonBlackCount / sampled,
    colorfulRatio: colorfulCount / sampled,
    distinctColorBuckets: buckets.size,
  };
}

function attachErrorCollectors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  return { pageErrors, consoleErrors, badResponses };
}

async function waitForNextFrames(page, count = 3) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let remaining = n;
        const step = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
}

async function sampleWebglFramebuffer(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const canvas = document.getElementById('game-canvas');
          if (!(canvas instanceof HTMLCanvasElement)) {
            resolve({ ok: false, reason: 'canvas missing' });
            return;
          }
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (!gl) {
            resolve({ ok: false, reason: 'webgl context null' });
            return;
          }
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const pixel = new Uint8Array(4);
          const samples = [];
          const points = [
            [0.2, 0.2],
            [0.5, 0.25],
            [0.8, 0.2],
            [0.5, 0.5],
            [0.2, 0.75],
            [0.5, 0.75],
            [0.8, 0.75],
          ];
          for (const [nx, ny] of points) {
            gl.readPixels(
              Math.floor(w * nx),
              Math.floor(h * ny),
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixel,
            );
            samples.push([pixel[0], pixel[1], pixel[2], pixel[3]]);
          }
          const nonZero = samples.some(([r, g, b]) => r + g + b > 0);
          const unique = new Set(samples.map((s) => s.join(','))).size;
          resolve({ ok: nonZero && unique > 1, width: w, height: h, unique, samples });
        });
      }),
  );
}

test.describe('GTA VI: Cali — Black-Box E2E Verification', () => {
  test('Flow 1: Title screen renders 3D Cali across all 4 viewports with zero overflow & zero errors', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/', { waitUntil: 'networkidle' });

      await expect(page.locator('#game-canvas')).toBeVisible();
      await expect(page.getByTestId('title-screen')).toBeVisible();
      await expect(page.getByTestId('webgl-error-overlay')).toBeHidden();

      await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'title');
      await waitForNextFrames(page, 4);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        overflow.scrollWidth,
        `Horizontal overflow at ${vp.width}x${vp.height}`,
      ).toBeLessThanOrEqual(overflow.innerWidth);

      if (vp.width <= 375) {
        for (const id of ['btn-mission-1', 'btn-mission-2', 'btn-free-roam']) {
          const box = await page.getByTestId(id).boundingBox();
          expect(box).not.toBeNull();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      }

      const webglProbe = await sampleWebglFramebuffer(page);
      expect(webglProbe.ok, `WebGL buffer check failed at ${vp.width}x${vp.height}`).toBe(true);

      const outPath = resolve(EVIDENCE_DIR, vp.file);
      await page.screenshot({ path: outPath });

      const pixelStats = analyzePngPixels(readFileSync(outPath));
      expect(pixelStats.width).toBeGreaterThanOrEqual(vp.width);
      expect(pixelStats.nonBlackRatio).toBeGreaterThan(0.5);
      expect(pixelStats.colorfulRatio).toBeGreaterThan(0.15);
      expect(pixelStats.distinctColorBuckets).toBeGreaterThan(25);
    }

    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.badResponses).toEqual([]);
  });

  test('Flow 2: Live Gameplay Journey — Mission 1 drive, radio switch, pause/resume, Mission 2, & manifest', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const run = recordRun(page, EVIDENCE_DIR, { noDataSource: true });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'title');
    await expect(page.getByTestId('webgl-error-overlay')).toBeHidden();

    // Start Mission 1
    await page.getByTestId('btn-mission-1').click();
    await expect(page.getByTestId('gameplay-hud')).toBeVisible();
    await expect(page.getByTestId('title-screen')).toBeHidden();

    const startSnap = await page.evaluate(() => window.__GTA_CALI__);
    expect(startSnap?.mode).toBe('playing');
    expect(startSnap?.mission.activeMission).toBe('mission_1_bulevar');

    // Press KeyF to board Banshee
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__GTA_CALI__?.world.player.mode === 'driving');
    await expect(page.getByTestId('hud-objective')).toContainText('Torre de Cali');

    const beforeDrive = await page.evaluate(() => ({
      x: window.__GTA_CALI__.world.player.x,
      z: window.__GTA_CALI__.world.player.z,
      t: performance.now(),
    }));

    // Hold KeyW + ShiftLeft until speedKmh > 20, car drives > 8m, and nitro drains below 100%
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      ({ startX, startZ }) => {
        const snap = window.__GTA_CALI__;
        if (!snap) return false;
        const dist = Math.hypot(snap.world.player.x - startX, snap.world.player.z - startZ);
        const fill = document.querySelector('[data-testid="hud-nitro"] .cali-nitro-fill');
        const widthPct = fill instanceof HTMLElement ? Number.parseFloat(fill.style.width) : 100;
        return snap.world.player.speedKmh > 20 && dist > 8 && widthPct < 100;
      },
      { startX: beforeDrive.x, startZ: beforeDrive.z },
      { timeout: 45_000 },
    );

    // Source-on-screen check comparing window.__GTA_CALI__ vs DOM speedometer & nitro gauge
    const driveComparison = await page.evaluate(() => {
      const snap = window.__GTA_CALI__;
      const domSpeedText = document.querySelector('[data-testid="hud-speed"] .cali-speed-number')?.textContent;
      const domSpeed = Number.parseInt(domSpeedText ?? '', 10);
      const sourceSpeed = Math.round(snap.world.player.speedKmh);
      const nitroFill = document.querySelector('[data-testid="hud-nitro"] .cali-nitro-fill');
      const nitroTrack = document.querySelector('[data-testid="hud-nitro"] .cali-nitro-track');
      const nitroWidth = nitroFill instanceof HTMLElement ? nitroFill.style.width : '';
      const nitroWidthPct = Number.parseFloat(nitroWidth);
      const nitroAria = Number.parseInt(nitroTrack?.getAttribute('aria-valuenow') ?? '', 10);
      return {
        x: snap.world.player.x,
        z: snap.world.player.z,
        speedKmh: snap.world.player.speedKmh,
        sourceSpeed,
        domSpeed,
        nitroSource: snap.world.player.nitro,
        nitroWidth,
        nitroWidthPct,
        nitroAria,
      };
    });
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    // Trigger a brief drift (KeyW + Space + KeyD) to exercise drift physics & ParticleSystem smoke/sparks
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => window.__GTA_CALI__?.world.player.isDrifting === true, null, {
      timeout: 10_000,
    });
    await page.keyboard.up('KeyD');
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');

    const movedDistance = Math.hypot(
      driveComparison.x - beforeDrive.x,
      driveComparison.z - beforeDrive.z,
    );
    expect(driveComparison.speedKmh).toBeGreaterThan(20);
    expect(movedDistance).toBeGreaterThan(5);
    expect(driveComparison.domSpeed).toBeGreaterThan(0);
    expect(Math.abs(driveComparison.domSpeed - driveComparison.sourceSpeed)).toBeLessThanOrEqual(2);
    expect(driveComparison.nitroWidthPct).toBeLessThan(100);
    expect(driveComparison.nitroWidthPct).toBeGreaterThan(0);
    expect(driveComparison.nitroAria).toBeLessThan(100);
    expect(driveComparison.nitroAria).toBe(Math.round(driveComparison.nitroWidthPct));
    run.dataCheck(
      'source-on-screen',
      `speedKmh=${driveComparison.sourceSpeed} matches hud-speed=${driveComparison.domSpeed}; nitro width=${driveComparison.nitroWidth} aria-valuenow=${driveComparison.nitroAria}`,
    );

    // Switch radio station with KeyR
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.__GTA_CALI__?.audio.station === 'sucursal_synth');
    await expect(page.getByTestId('hud-radio')).toContainText('Sucursal Synth');
    run.dataCheck('source-on-screen', 'audio.station=sucursal_synth reflected on hud-radio');

    // Capture Mission 1 gameplay screenshot
    await waitForNextFrames(page, 3);
    const m1CanvasCheck = await sampleWebglFramebuffer(page);
    expect(m1CanvasCheck.ok).toBe(true);
    const m1Path = resolve(EVIDENCE_DIR, 'gameplay-mission1-1280.png');
    await page.screenshot({ path: m1Path });
    const m1Pixels = analyzePngPixels(readFileSync(m1Path));
    expect(m1Pixels.colorfulRatio).toBeGreaterThan(0.15);
    expect(m1Pixels.distinctColorBuckets).toBeGreaterThan(30);

    // Pause via Escape, capture pause-1280.png, then Resume
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'paused');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'pause-1280.png') });

    await page.getByTestId('btn-resume').click();
    await expect(page.getByTestId('pause-overlay')).toBeHidden();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');

    // Pause -> Return to Title -> Mission 2 -> board Banshee + drive briefly
    await page.getByTestId('btn-pause').click();
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.getByTestId('btn-pause-title').click();
    await expect(page.getByTestId('title-screen')).toBeVisible();

    await page.getByTestId('btn-mission-2').click();
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'playing' &&
        window.__GTA_CALI__?.mission.activeMission === 'mission_2_cristo_rey',
    );
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__GTA_CALI__?.world.player.mode === 'driving');

    const m2Start = await page.evaluate(() => ({
      x: window.__GTA_CALI__.world.player.x,
      z: window.__GTA_CALI__.world.player.z,
    }));
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      ({ startX, startZ }) => {
        const snap = window.__GTA_CALI__;
        if (!snap) return false;
        const dist = Math.hypot(snap.world.player.x - startX, snap.world.player.z - startZ);
        return snap.world.player.speedKmh > 20 && dist > 5;
      },
      { startX: m2Start.x, startZ: m2Start.z },
      { timeout: 45_000 },
    );
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    await waitForNextFrames(page, 3);
    const m2Path = resolve(EVIDENCE_DIR, 'gameplay-mission2-1280.png');
    await page.screenshot({ path: m2Path });
    const m2Pixels = analyzePngPixels(readFileSync(m2Path));
    expect(m2Pixels.colorfulRatio).toBeGreaterThan(0.15);
    expect(m2Pixels.distinctColorBuckets).toBeGreaterThan(30);

    // Reload and verify localStorage audio preference persisted
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__GTA_CALI__?.audio.station === 'sucursal_synth');
    run.dataCheck(
      'persisted-after-reload',
      'preferredStation=sucursal_synth persisted in localStorage after reload',
    );

    await run.save('run-gta-cali.json');

    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.badResponses).toEqual([]);
  });
});
