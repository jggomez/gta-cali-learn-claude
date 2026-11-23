/* global Buffer, HTMLCanvasElement, HTMLElement, URL, document, process, requestAnimationFrame, window */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { recordRun } from './e2e_recorder.mjs';

/** Modo Plan (aprender jugando) gates the first launch of each story mission: approve plan Turbo. */
async function approvePlan(page) {
  const plan = page.getByTestId('learn-plan');
  await expect(plan).toBeVisible();
  await page.getByTestId('btn-plan-turbo').click();
  await expect(plan).toBeHidden();
}

const EVIDENCE_DIR = resolve(process.cwd(), 'docs/gta-vi-cali-3d/evidence');

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, file: 'title-375.png' },
  { name: 'tablet', width: 768, height: 1024, file: 'title-768.png' },
  { name: 'desktop', width: 1280, height: 720, file: 'title-1280.png' },
  { name: 'laptop1440', width: 1440, height: 900, file: 'title-1440.png' },
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
  const asset200s = new Set();

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (
      msg.type() === 'error' ||
      /THREE\.WebGLProgram|Shader Error|GL_INVALID|SMAAPass/i.test(text)
    ) {
      consoleErrors.push(text);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.url()}`);
    } else if (res.status() === 200) {
      const url = res.url();
      if (
        url.includes('/models/') ||
        url.includes('/hdri/') ||
        url.includes('/draco/') ||
        url.includes('/textures/')
      ) {
        asset200s.add(new URL(url).pathname);
      }
    }
  });

  return { pageErrors, consoleErrors, badResponses, asset200s };
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

test.describe('GTA I - Cali - Colombia — Black-Box E2E Verification', () => {
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

      await page.waitForFunction(
        () =>
          window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
        null,
        { timeout: 45_000 },
      );
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
        for (const id of [
          'btn-title-garage',
          'btn-mission-1',
          'btn-mission-2',
          'btn-mission-3',
          'btn-mission-5',
          'btn-free-roam',
        ]) {
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

    const loadedPaths = [...errors.asset200s];
    expect(loadedPaths).toContain('/models/caleno.glb');
    expect(loadedPaths).toContain('/models/valeria.glb');
    expect(loadedPaths).toContain('/models/ferrari.glb');
    expect(loadedPaths).toContain('/models/character.glb');
    expect(loadedPaths.some((p) => p.startsWith('/hdri/'))).toBe(true);
    expect(loadedPaths.some((p) => p.startsWith('/draco/'))).toBe(true);
    expect(loadedPaths.some((p) => p.startsWith('/textures/'))).toBe(true);
    expect(loadedPaths.length).toBeGreaterThanOrEqual(36);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.badResponses).toEqual([]);
  });

  test('Flow 2: Live Gameplay Journey — Garaje, Mission 1, Pause, Mission 2, Mission 3 Pique, Free Roam, & persistence', async ({
    page,
  }) => {
    const errors = attachErrorCollectors(page);
    const run = recordRun(page, EVIDENCE_DIR, { noDataSource: true });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => window.__GTA_CALI__?.mode === 'title' && window.__GTA_CALI__?.assetsLoaded === true,
      null,
      { timeout: 45_000 },
    );
    await expect(page.getByTestId('webgl-error-overlay')).toBeHidden();

    // Garaje Caleño [G] interactive flow & localStorage persistence
    await page.getByTestId('btn-title-garage').click();
    await expect(page.getByTestId('garage-panel')).toBeVisible();
    await waitForNextFrames(page, 2);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'garage-1280.png') });

    await page.getByTestId('garage-car-willys_v8').click();
    await page.getByTestId('garage-avatar-mateo').click();
    await page.getByTestId('garage-outfit-escarlata').click();
    await page.getByTestId('btn-garage-close').click();
    await expect(page.getByTestId('garage-panel')).toBeHidden();

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'title' &&
        window.__GTA_CALI__?.assetsLoaded === true &&
        window.__GTA_CALI__?.garage.carKind === 'willys_v8' &&
        window.__GTA_CALI__?.garage.avatar === 'mateo' &&
        window.__GTA_CALI__?.garage.outfit === 'escarlata',
      null,
      { timeout: 45_000 },
    );
    run.dataCheck(
      'persisted-after-reload',
      'Garaje Caleño selection (willys_v8, mateo, escarlata) persisted in localStorage across reload',
    );

    // Switch to Renault 4 GT Turbo + Valeria + Urbano Cali for Mission 1 & Mission 2
    await page.getByTestId('btn-title-garage').click();
    await expect(page.getByTestId('garage-panel')).toBeVisible();
    await page.getByTestId('garage-car-renault4_turbo').click();
    await page.getByTestId('garage-avatar-valeria').click();
    await page.getByTestId('garage-outfit-urbano_cali').click();
    await page.getByTestId('btn-garage-close').click();
    await expect(page.getByTestId('garage-panel')).toBeHidden();
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.garage.carKind === 'renault4_turbo' &&
        window.__GTA_CALI__?.garage.avatar === 'valeria' &&
        window.__GTA_CALI__?.garage.outfit === 'urbano_cali',
    );

    // Start Mission 1 — "Golpe en la Torre" (golden_hour, ON FOOT at Torre de Cali)
    await page.getByTestId('btn-mission-1').click();
    await expect(page.getByTestId('learn-plan-steps').locator('li')).toHaveCount(3);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'modo-plan-1280.png') });
    await approvePlan(page);
    await expect(page.getByTestId('gameplay-hud')).toBeVisible();
    await expect(page.getByTestId('title-screen')).toBeHidden();

    // Wait for first simulation frame to enrich GPS route & pedestrians
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'playing' &&
        (window.__GTA_CALI__?.mission.activeObjective?.distanceMeters ?? -1) >= 0 &&
        (window.__GTA_CALI__?.world.pedestrians?.length ?? 0) > 0,
    );

    const startSnap = await page.evaluate(() => window.__GTA_CALI__);
    expect(startSnap?.mode).toBe('playing');
    expect(startSnap?.mission.activeMission).toBe('mission_1_bulevar');
    expect(startSnap?.mission.timeOfDay).toBe('golden_hour');
    expect(startSnap?.world.player.mode).toBe('on_foot');
    expect(startSnap?.mission.activeObjective?.id).toBe('m1_torre_pickup');
    expect(startSnap?.mission.activeObjective?.requiresOnFoot).toBe(true);

    // C-05 Mission 1 start HUD clarity checks
    await expect(page.getByTestId('hud-step-progress')).toContainText('PASO 1 DE 4');
    await expect(page.getByTestId('hud-compass')).toBeVisible();
    await expect(page.getByTestId('hud-distance')).toBeVisible();
    await expect(page.getByTestId('hud-distance')).toHaveText(/\d+\s*m/);
    await expect(page.getByTestId('hud-banner')).toBeVisible();
    await expect(page.getByTestId('btn-time-toggle')).toContainText('Atardecer');
    await expect(page.getByTestId('btn-garage')).toBeVisible();
    await expect(page.getByTestId('btn-voices')).toBeVisible();
    await expect(page.getByTestId('btn-voices')).toContainText('[V] Voces: ON');
    await expect(page.getByTestId('btn-voices')).toHaveAttribute('aria-pressed', 'true');

    // Responsive HUD overflow check across 375, 768, 1440, 1280 including [G] Garaje & [V] Voces pills
    for (const hudVp of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(hudVp);
      await waitForNextFrames(page, 2);
      const hudOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        hudOverflow.scrollWidth,
        `HUD horizontal overflow at ${hudVp.width}x${hudVp.height}`,
      ).toBeLessThanOrEqual(hudOverflow.innerWidth);
      await expect(page.getByTestId('btn-garage')).toBeVisible();
      await expect(page.getByTestId('btn-voices')).toBeVisible();
    }

    // Walk/sprint forward (KeyW + ShiftLeft) on foot to grab the golden Vinilo briefcase at Torre de Cali
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mission.activeObjective?.id === 'm1_board_getaway' &&
        window.__GTA_CALI__?.world.wantedStars === 2,
      null,
      { timeout: 60_000 },
    );
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    await expect(page.getByTestId('hud-step-progress')).toContainText('PASO 2 DE 4');
    run.dataCheck(
      'source-on-screen',
      'Mission 1 on-foot Vinilo pickup triggered alarm (wantedStars=2, PASO 2 DE 4, m1_board_getaway)',
    );

    // Turn south toward the parked getaway Ferrari at (-16, -102) and sprint until canEnterVehicle === true
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => (window.__GTA_CALI__?.world.player.heading ?? 2) <= 0.28, null, {
      timeout: 30_000,
    });
    await page.keyboard.up('KeyD');

    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(() => window.__GTA_CALI__?.world.player.canEnterVehicle === true, null, {
      timeout: 60_000,
    });
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    // Board the getaway Renault 4 GT Turbo with KeyF -> PASO 3 DE 4
    await page.keyboard.press('KeyF');
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.world.player.mode === 'driving' &&
        (window.__GTA_CALI__?.mission.activeObjective?.stepIndex ?? 0) === 2,
      null,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('hud-step-progress')).toContainText('PASO 3 DE 4');

    const postBoard = await page.evaluate(() => {
      const snap = window.__GTA_CALI__;
      const activeVehicle = snap?.world.vehicles.find(
        (v) => v.id === snap?.world.player.vehicleId,
      );
      const hasPolice = snap?.world.vehicles.some((v) => v.kind === 'police') ?? false;
      return {
        vehicleKind: activeVehicle?.kind ?? null,
        hasPolice,
        gpsLen: snap?.mission.activeObjective?.gpsRoute?.length ?? 0,
        distanceMeters: snap?.mission.activeObjective?.distanceMeters ?? 0,
        pedCount: snap?.world.pedestrians?.length ?? 0,
        domDistance: document.querySelector('[data-testid="hud-distance"]')?.textContent ?? '',
      };
    });
    expect(postBoard.vehicleKind).toBe('renault4_turbo');
    expect(postBoard.hasPolice).toBe(true);
    expect(postBoard.gpsLen).toBeGreaterThanOrEqual(2);
    expect(postBoard.distanceMeters).toBeGreaterThan(0);
    expect(postBoard.pedCount).toBeGreaterThan(0);
    expect(postBoard.domDistance).toMatch(/\d+\s*m/);
    run.dataCheck(
      'source-on-screen',
      `vehicleKind=${postBoard.vehicleKind}, hasPolice=${postBoard.hasPolice}, gpsRoute=${postBoard.gpsLen} pts, distanceMeters=${postBoard.distanceMeters}m (${postBoard.domDistance}), pedestrians=${postBoard.pedCount}`,
    );

    const beforeDrive = await page.evaluate(() => ({
      x: window.__GTA_CALI__.world.player.x,
      z: window.__GTA_CALI__.world.player.z,
    }));

    // Drive south down Avenida Las Américas with nitro + switch radio
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      ({ startX, startZ }) => {
        const snap = window.__GTA_CALI__;
        if (!snap) return false;
        const dist = Math.hypot(snap.world.player.x - startX, snap.world.player.z - startZ);
        return snap.world.player.speedKmh > 25 && dist > 4;
      },
      { startX: beforeDrive.x, startZ: beforeDrive.z },
      { timeout: 90_000 },
    );
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    // Brief drift (KeyW + Space + KeyD) to exercise SkidMarkPool + ParticleSystem + SMAAPass + CinematicGradePass
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => window.__GTA_CALI__?.world.player.isDrifting === true, null, {
      timeout: 30_000,
    });
    await page.keyboard.up('KeyD');
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');

    // Switch radio station with KeyR
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.__GTA_CALI__?.audio.station === 'sucursal_synth');
    await expect(page.getByTestId('hud-radio')).toContainText('Sucursal Synth');
    run.dataCheck('source-on-screen', 'audio.station=sucursal_synth reflected on hud-radio');

    // Capture Golden-Hour Mission 1 gameplay screenshot (Torre de Cali / Av. Las Américas)
    await waitForNextFrames(page, 3);
    const m1CanvasCheck = await sampleWebglFramebuffer(page);
    expect(m1CanvasCheck.ok).toBe(true);
    const m1Path = resolve(EVIDENCE_DIR, 'gameplay-mission1-1280.png');
    await page.screenshot({ path: m1Path });
    const m1Pixels = analyzePngPixels(readFileSync(m1Path));
    expect(m1Pixels.colorfulRatio).toBeGreaterThan(0.15);
    expect(m1Pixels.distinctColorBuckets).toBeGreaterThan(30);

    // Exercise GTA V free-orbit mouse-look drag + wheel zoom on #game-canvas
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(780, 320, { steps: 6 });
    await page.mouse.up();
    await page.mouse.wheel(0, -120);
    await waitForNextFrames(page, 3);

    // Pause via Escape, capture pause-1280.png, then Resume -> Pause -> Title
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'paused');
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'pause-1280.png') });

    await page.getByTestId('btn-resume').click();
    await expect(page.getByTestId('pause-overlay')).toBeHidden();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');

    await page.getByTestId('btn-pause').click();
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.getByTestId('btn-pause-title').click();
    await expect(page.getByTestId('title-screen')).toBeVisible();

    // Start Mission 2 — "Noche de Salsa en Cristo Rey" (night, DRIVING at Estadio Pascual Guerrero, 95s countdown, ★★★)
    await page.getByTestId('btn-mission-2').click();
    await approvePlan(page);
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'playing' &&
        window.__GTA_CALI__?.mission.activeMission === 'mission_2_cristo_rey' &&
        window.__GTA_CALI__?.mission.timeOfDay === 'night',
      null,
      { timeout: 30_000 },
    );

    const m2Init = await page.evaluate(() => window.__GTA_CALI__);
    expect(m2Init?.mission.timeOfDay).toBe('night');
    expect(m2Init?.mission.isCountdown).toBe(true);
    expect(m2Init?.mission.timerSeconds).toBeGreaterThan(80);
    expect(m2Init?.mission.timerSeconds).toBeLessThanOrEqual(95);
    expect(m2Init?.world.player.mode).toBe('driving');
    expect(m2Init?.world.wantedStars).toBe(3);
    await expect(page.getByTestId('btn-time-toggle')).toContainText('Noche');

    const m2Start = {
      x: m2Init.world.player.x,
      z: m2Init.world.player.z,
    };
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      ({ startX, startZ }) => {
        const snap = window.__GTA_CALI__;
        if (!snap) return false;
        const dist = Math.hypot(snap.world.player.x - startX, snap.world.player.z - startZ);
        const fill = document.querySelector('[data-testid="hud-nitro"] .cali-nitro-fill');
        const widthPct = fill instanceof HTMLElement ? Number.parseFloat(fill.style.width) : 100;
        return snap.world.player.speedKmh > 25 && dist > 4 && widthPct < 100;
      },
      { startX: m2Start.x, startZ: m2Start.z },
      { timeout: 90_000 },
    );

    // Source-on-screen check comparing window.__GTA_CALI__ vs DOM speedometer & nitro gauge in Night Mission 2
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
        speedKmh: snap.world.player.speedKmh,
        sourceSpeed,
        domSpeed,
        nitroWidth,
        nitroWidthPct,
        nitroAria,
      };
    });
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    expect(driveComparison.speedKmh).toBeGreaterThan(25);
    expect(driveComparison.domSpeed).toBeGreaterThan(0);
    expect(Math.abs(driveComparison.domSpeed - driveComparison.sourceSpeed)).toBeLessThanOrEqual(2);
    expect(driveComparison.nitroWidthPct).toBeLessThan(100);
    expect(driveComparison.nitroWidthPct).toBeGreaterThan(0);
    expect(driveComparison.nitroAria).toBeLessThan(100);
    expect(driveComparison.nitroAria).toBe(Math.round(driveComparison.nitroWidthPct));
    run.dataCheck(
      'source-on-screen',
      `Mission 2 Night speedKmh=${driveComparison.sourceSpeed} matches hud-speed=${driveComparison.domSpeed}; nitro width=${driveComparison.nitroWidth} aria-valuenow=${driveComparison.nitroAria}`,
    );

    // Capture REAL NIGHTTIME CALI Mission 2 screenshot
    await waitForNextFrames(page, 3);
    const m2Path = resolve(EVIDENCE_DIR, 'gameplay-mission2-1280.png');
    await page.screenshot({ path: m2Path });
    const m2Pixels = analyzePngPixels(readFileSync(m2Path));
    expect(m2Pixels.nonBlackRatio).toBeGreaterThan(0.25);
    expect(m2Pixels.colorfulRatio).toBeGreaterThan(0.08);
    expect(m2Pixels.distinctColorBuckets).toBeGreaterThan(25);

    // Toggle Night <-> Golden-Hour live via KeyT
    await page.keyboard.press('KeyT');
    await page.waitForFunction(() => window.__GTA_CALI__?.mission.timeOfDay === 'golden_hour');
    await expect(page.getByTestId('btn-time-toggle')).toContainText('Atardecer');
    await page.keyboard.press('KeyT');
    await page.waitForFunction(() => window.__GTA_CALI__?.mission.timeOfDay === 'night');
    await expect(page.getByTestId('btn-time-toggle')).toContainText('Noche');
    run.dataCheck('source-on-screen', 'KeyT toggled Night <-> Golden-Hour live on btn-time-toggle');

    // Return to Title -> launch Mission 3 ("Pique Callejero en el Bulevar")
    await page.getByTestId('btn-pause').click();
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.getByTestId('btn-pause-title').click();
    await expect(page.getByTestId('title-screen')).toBeVisible();

    await page.getByTestId('btn-mission-3').click();
    await approvePlan(page);
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'playing' &&
        window.__GTA_CALI__?.mission.activeMission === 'mission_3_pique_bulevar' &&
        window.__GTA_CALI__?.world.raceTotalRacers === 3,
      null,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('hud-race-pos')).toBeVisible();
    await expect(page.getByTestId('hud-race-pos')).toHaveText(/^POS [1-3]\/3$/);

    // Trigger [H] Horn & accelerate in street race
    await page.keyboard.down('KeyH');
    await page.waitForFunction(() => window.__GTA_CALI__?.world.hornActive === true, null, {
      timeout: 15_000,
    });
    await page.keyboard.up('KeyH');

    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(
      () => (window.__GTA_CALI__?.world.player.speedKmh ?? 0) > 25,
      null,
      { timeout: 60_000 },
    );
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');

    await waitForNextFrames(page, 3);
    const m3Path = resolve(EVIDENCE_DIR, 'gameplay-mission3-1280.png');
    await page.screenshot({ path: m3Path });
    const m3Pixels = analyzePngPixels(readFileSync(m3Path));
    expect(m3Pixels.nonBlackRatio).toBeGreaterThan(0.4);
    expect(m3Pixels.distinctColorBuckets).toBeGreaterThan(25);
    run.dataCheck(
      'source-on-screen',
      'Mission 3 Pique Callejero launched with raceTotalRacers=3, hud-race-pos visible, KeyH hornActive=true',
    );

    // Return to Title -> switch Garaje to Mateo (caleno.glb) + Camiseta Escarlata -> launch Free Roam
    await page.getByTestId('btn-pause').click();
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    await page.getByTestId('btn-pause-title').click();
    await expect(page.getByTestId('title-screen')).toBeVisible();

    await page.getByTestId('btn-title-garage').click();
    await expect(page.getByTestId('garage-panel')).toBeVisible();
    await page.getByTestId('garage-avatar-mateo').click();
    await page.getByTestId('garage-outfit-escarlata').click();
    await page.getByTestId('btn-garage-close').click();
    await expect(page.getByTestId('garage-panel')).toBeHidden();

    await page.getByTestId('btn-free-roam').click();
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'playing' &&
        window.__GTA_CALI__?.mission.activeMission === 'free_roam' &&
        window.__GTA_CALI__?.garage.avatar === 'mateo' &&
        window.__GTA_CALI__?.garage.outfit === 'escarlata' &&
        (window.__GTA_CALI__?.world.pedestrians?.length ?? 0) >= 28,
      null,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('hud-step-progress')).toContainText('PASO 1 DE 6');
    const freeRoamSnap = await page.evaluate(() => ({
      landmarkId: window.__GTA_CALI__?.mission.activeObjective?.landmarkId,
      stepIndex: window.__GTA_CALI__?.mission.activeObjective?.stepIndex,
      totalSteps: window.__GTA_CALI__?.mission.activeObjective?.totalSteps,
      pedestrians: window.__GTA_CALI__?.world.pedestrians?.length ?? 0,
      avatar: window.__GTA_CALI__?.garage.avatar,
      outfit: window.__GTA_CALI__?.garage.outfit,
    }));
    expect(freeRoamSnap.landmarkId).toBe('la_ermita');
    expect(freeRoamSnap.stepIndex).toBe(0);
    expect(freeRoamSnap.totalSteps).toBe(6);
    expect(freeRoamSnap.pedestrians).toBeGreaterThanOrEqual(28);
    expect(freeRoamSnap.avatar).toBe('mateo');
    expect(freeRoamSnap.outfit).toBe('escarlata');
    run.dataCheck(
      'source-on-screen',
      `Free Roam started at PASO 1 DE 6 (${freeRoamSnap.landmarkId}), avatar=${freeRoamSnap.avatar} (${freeRoamSnap.outfit}), pedestrians=${freeRoamSnap.pedestrians}`,
    );
    await waitForNextFrames(page, 3);
    await page.screenshot({ path: resolve(EVIDENCE_DIR, 'gameplay-freeroam-1280.png') });

    // Toggle [V] Voces OFF via KeyV, verify DOM + snapshot, reload and verify localStorage persistence, then toggle back ON
    await page.keyboard.press('KeyV');
    await page.waitForFunction(() => window.__GTA_CALI__?.audio.voicesEnabled === false);
    await expect(page.getByTestId('btn-voices')).toContainText('[V] Voces: OFF');
    await expect(page.getByTestId('btn-voices')).toHaveAttribute('aria-pressed', 'false');

    // Reload and verify localStorage audio + voicesEnabled + garage preference persisted
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        window.__GTA_CALI__?.mode === 'title' &&
        window.__GTA_CALI__?.assetsLoaded === true &&
        window.__GTA_CALI__?.audio.station === 'sucursal_synth' &&
        window.__GTA_CALI__?.audio.voicesEnabled === false &&
        window.__GTA_CALI__?.garage.avatar === 'mateo' &&
        window.__GTA_CALI__?.garage.outfit === 'escarlata',
      null,
      { timeout: 45_000 },
    );
    await page.getByTestId('btn-free-roam').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.mode === 'playing');
    await expect(page.getByTestId('btn-voices')).toContainText('[V] Voces: OFF');
    await expect(page.getByTestId('btn-voices')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('btn-voices').click();
    await page.waitForFunction(() => window.__GTA_CALI__?.audio.voicesEnabled === true);
    await expect(page.getByTestId('btn-voices')).toContainText('[V] Voces: ON');
    await expect(page.getByTestId('btn-voices')).toHaveAttribute('aria-pressed', 'true');

    run.dataCheck(
      'persisted-after-reload',
      'preferredStation=sucursal_synth, voicesEnabled=false, and garage=(mateo, escarlata) persisted in localStorage after reload',
    );
    run.dataCheck(
      'source-on-screen',
      `C-08 local assets loaded (${errors.asset200s.size} files including /models/caleno.glb & /models/valeria.glb) with assetsLoaded=true`,
    );

    await run.save('run-gta-cali.json');

    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.badResponses).toEqual([]);
  });
});
